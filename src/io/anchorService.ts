import {
  createRelayClient,
  type ClientFailure,
  type FetchLike,
  type RelayClient,
} from 'zeitstempel/client';
import {
  ANCHOR_FAILURE_TEXTS,
  anchorFromOutcome,
  anchorRequest,
  hexToBytes,
  relayOrigin,
  type Anchor,
  type AnchorFailure,
  type AnchorOutcome,
  type TimeBook,
} from '../logic/index.ts';
import { trustedServices } from './zeitstempel.ts';

/**
 * The external time stamping service as the app sees it: it takes the hash of the chain head and gives
 * back the **evidence** of a verified token (`zeitstempel/client`, format v1). The logic layer never touches
 * the network.
 */
export interface AnchorService {
  anchor(hashHex: string): Promise<AnchorOutcome>;
}

/**
 * The device key for the authenticated relay (`X-Zeitstempel-Auth`): a non-extractable `CryptoKey` (the app)
 * or PKCS#8 bytes (tests), and its key id in the relay's key file.
 */
export interface DeviceAuth {
  privateKey: CryptoKey | Uint8Array;
  keyId: string;
}

/**
 * Total deadline of one stamp (all attempts, waits and services): the client's default, the safe upper
 * bound of `zeitstempel` docs/client.md („Fristen“).
 */
export const RELAY_TIMEOUT_MS = 130_000;

/**
 * From this difference between the device clock and the relay's `Date` on, the app tells the person
 * (`clockWarningText`). Freshness itself is the client's: `minGenTime` from the send time, corrected by the
 * relay's `Date` after a 401 by at most `maxClockOffsetMs` (65 s).
 */
export const CLOCK_FIX_MS = 30_000;

/** What the adapter needs from the outside; all of it can be replaced in tests. */
export interface RelayOptions {
  fetch?: typeof fetch;
  /** Total deadline of one stamp; default `RELAY_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** The relay's `RELAY_AUDIENCE`; default the relay's origin (the relay's convention). */
  audience?: string;
  /** Wall clock (ms since the epoch): signed header, `Retry-After` date, freshness. Default `Date.now()`. */
  now?: () => number;
  /** Monotonic clock (ms): total deadline and the pause after a 429. Default `performance.now()`. */
  monoNow?: () => number;
  /** The services the app trusts, in order of preference: id → PEM texts of the trust anchors. */
  trusted?: ReadonlyMap<string, { anchors: string[] }>;
  /** Called with the relay's clock minus the device clock (ms) when it moves by over 30 s, and with 0 when it is back within 30 s. */
  onClockOffset?: (offsetMs: number) => void;
  /**
   * Ends this service for good once aborted: a stamp running then stops before its next send (nothing more
   * is signed with this device key), and every later call fails at once. Aborted when the device key is
   * removed or replaced, or the relay changes.
   */
  signal?: AbortSignal;
}

const VERIFY_TEXTS: Record<string, string> = {
  'imprint-mismatch': 'der bestätigte Hash ist ein anderer',
  'signature-invalid': 'die Signatur stimmt nicht',
  'untrusted-chain': 'die Zertifikatskette endet bei keinem bekannten Anker',
  'certificate-not-valid-at-time': 'ein Zertifikat war zur bestätigten Zeit nicht gültig',
  'time-in-future': 'die bestätigte Zeit liegt in der Zukunft',
  'message-digest-mismatch': 'der Inhalt des Tokens wurde verändert',
  malformed: 'das Token ist nicht lesbar',
  'unsupported-signature': 'Signaturverfahren nicht unterstützt (kein WebCrypto?)',
  'time-too-old': 'die bestätigte Zeit liegt vor der Anfrage (rückdatiert)',
};

const BAD_RESPONSE_TEXTS: Record<string, string> = {
  serial: 'Seriennummer weicht vom Token ab',
  shape: 'unerwartete Form oder andere Dienstkennung als gefragt',
  mode: 'Sammelbeleg statt Einzelstempel',
  json: 'kein JSON',
  token: 'Token nicht lesbar',
  size: 'Antwort zu groß',
  evidence: 'Beleg nicht lesbar',
};

/**
 * Reasons of `zeitstempel` that say the TOKEN did not verify (or could not be read): a real verification
 * failure. Every other code the client reports (`bad-pem`, `bad-options`, `bad-services`, …) is the app's
 * own setup being wrong.
 */
const TOKEN_REASONS = new Set([
  ...Object.keys(VERIFY_TEXTS),
  'too-large',
  'indefinite-length',
  'too-deep',
  'trailing-bytes',
  'bad-structure',
  'rejected',
  'no-token',
  'not-signed-data',
  'unsupported-version',
  'bad-content-type',
  'bad-tst-info',
  'unsupported-hash',
  'bad-time',
  'nonce-mismatch',
  'one-signer-required',
  'signed-attributes-missing',
  'signing-certificate-missing',
  'signing-certificate-mismatch',
  'tsa-mismatch',
  'policy-mismatch',
  'bad-certificate',
  'weak-key',
  'signer-certificate-missing',
  'bad-eku',
  'not-a-ca',
  'chain-too-long',
  'bad-evidence',
  'evidence-hash-mismatch',
]);

const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/** The client's failure (code, status, relay code) as the app's failure kind with a German detail. */
export function outcomeOf(failure: ClientFailure, pausedMs: number): AnchorOutcome {
  const no = (kind: AnchorFailure, text: string): AnchorOutcome => ({
    ok: false,
    reason: kind,
    detail: text,
  });
  const status = `Status ${failure.status ?? '?'}${failure.code ? `, ${failure.code}` : ''}`;
  switch (failure.reason) {
    case 'timeout':
      return no('unreachable', 'Zeitüberschreitung');
    case 'network-error':
      return no('unreachable', 'keine Antwort');
    case 'aborted':
      return no('unreachable', 'abgebrochen');
    case 'paused':
      return no('rate-limited', `bitte in ${seconds(pausedMs)} s erneut versuchen`);
    case 'bad-response':
      return no('bad-response', BAD_RESPONSE_TEXTS[failure.detail ?? ''] ?? failure.detail ?? '');
    case 'bad-hash':
      return no('bad-response', 'Hash');
    case 'bad-key':
    case 'bad-key-id':
      return no('unauthorized', 'Schlüssel nicht verwendbar');
    case 'relay-error': {
      const code = failure.status ?? 0;
      if (code === 401) return no('unauthorized', 'Status 401');
      if (code === 403 && failure.code === 'solo-not-allowed') {
        return no('unauthorized', 'Status 403, Schlüssel ohne Solo-Erlaubnis');
      }
      if (code === 403 && failure.code === 'service-not-allowed') {
        return no('unauthorized', 'Status 403, Schlüssel für keinen dieser Dienste');
      }
      if (code === 429 || (code === 503 && failure.code === 'busy')) {
        return no('rate-limited', `bitte in ${seconds(pausedMs || 60_000)} s erneut versuchen`);
      }
      if (code >= 500) return no('unreachable', status);
      return no('refused', status);
    }
    default:
      if (TOKEN_REASONS.has(failure.reason)) {
        return no('not-verified', VERIFY_TEXTS[failure.reason] ?? failure.reason);
      }
      return no(
        'misconfigured',
        failure.detail ? `${failure.reason}: ${failure.detail}` : failure.reason,
      );
  }
}

/** How long a service the relay does not offer or the key may not use is left out (monotonic, ms). */
export const DROPPED_FOR_MS = 60 * 60_000;

/**
 * The answer when no service is left: `unauthorized` with the 403 text when every one was dropped by
 * `403 service-not-allowed` (the device key may use none of them), else `refused` (the relay offers none
 * the app knows, or the app knows none).
 */
export function noServiceLeft(dropped: readonly ClientFailure[]): AnchorOutcome {
  const forbidden = dropped.filter((f) => f.status === 403 && f.code === 'service-not-allowed');
  if (dropped.length > 0 && forbidden.length === dropped.length) {
    return outcomeOf(forbidden[0] as ClientFailure, 0);
  }
  return {
    ok: false,
    reason: 'refused',
    detail: 'kein Dienst des Weiterreichers ist der App bekannt',
  };
}

/** A relay answer that says „this service is not here for you“: the next service is tried. */
const serviceMissing = (f: ClientFailure): boolean =>
  f.reason === 'relay-error' &&
  ((f.status === 404 && f.code === 'unknown-service') ||
    (f.status === 403 && f.code === 'service-not-allowed'));

/**
 * The adapter for a time stamp relay: a thin layer over `zeitstempel/client`'s `createRelayClient`, which
 * does the protocol (signed `POST <relay>/v1/stamp/<service>` with `{"hash", "mode": "solo"}`, clock fix
 * once after a 401, `Retry-After` and the pause across calls on the monotonic clock, failover on
 * 5xx/network error) and **verifies every token against the hash and the trust anchors shipped with the
 * app with a mandatory freshness check**, never taking the relay's word. The adapter hands in the app's
 * parts (origin, audience, device key, services in the order of `services.json`, their anchors), learns
 * the relay's clock from `Date` for the clock warning, and turns the client's codes into the app's
 * failure kinds and German texts. Every stamp is `solo`: a token of a collecting relay would stamp a
 * tree's root, which is no PAdES document time stamp of the PDF.
 *
 * A service the relay does not offer (`404 unknown-service`) or the key may not use
 * (`403 service-not-allowed`) is left out for `DROPPED_FOR_MS` (one hour on the monotonic clock; the relay's
 * list or the key's services may change), and the stamp is asked again of the rest. When every service is
 * left out by `403 service-not-allowed`, the answer is `unauthorized` (the device key lacks permission).
 */
/**
 * Only the origin of `base` is used (the client takes no path); `auth` is the device key.
 */
export function createRelayService(
  base: string,
  auth: DeviceAuth,
  options: RelayOptions = {},
): AnchorService {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const wallNow = options.now ?? (() => Date.now());
  const trusted = options.trusted ?? trustedServices();
  /**
   * The relay's clock minus the device clock, from the `Date` of its answers, reported when it moves by
   * more than 30 s: the app warns; it does not change the freshness check (that is the client's).
   */
  let clockOffsetMs = 0;
  const learnClock = (response: Response) => {
    const relayMs = Date.parse(response.headers.get('Date') ?? '');
    if (!Number.isFinite(relayMs)) return;
    const offset = relayMs - wallNow();
    // within 30 s of the relay's clock counts as „in agreement“ (0): that clears the warning again
    const seen = Math.abs(offset) > CLOCK_FIX_MS ? offset : 0;
    if (Math.abs(seen - clockOffsetMs) > CLOCK_FIX_MS || (seen === 0 && clockOffsetMs !== 0)) {
      clockOffsetMs = seen;
      options.onClockOffset?.(seen);
    }
  };
  const fetchLike: FetchLike = async (url, init) => {
    const response = await doFetch(url, { ...init, body: init.body as BodyInit });
    learnClock(response);
    return response;
  };
  const monoNow = options.monoNow ?? (() => performance.now());
  /** Services left out: id → the failure that dropped it and when (monotonic). */
  const dropped = new Map<string, { failure: ClientFailure; atMono: number }>();
  const missing = {
    has: (id: string): boolean => dropped.has(id),
    /** Forgets what was dropped longer than `DROPPED_FOR_MS` ago. */
    expire: () => {
      const now = monoNow();
      for (const [id, d] of dropped) if (now - d.atMono >= DROPPED_FOR_MS) dropped.delete(id);
    },
  };
  let clientProblem: ClientFailure | null = null;
  let current: { key: string; client: RelayClient | null } | undefined;
  /** The client over the services still in play (made again only when one drops out). */
  const clientNow = (): RelayClient | null => {
    const ids = [...trusted.keys()].filter((id) => !missing.has(id));
    const key = ids.join(',');
    if (current?.key === key) return current.client;
    // trust per service (decided in zeitstempel PR #10): a token is checked only against the anchors of
    // the service it was asked from, never against those of another service the build ships
    const trust = Object.fromEntries(ids.map((id) => [id, trusted.get(id)?.anchors ?? []]));
    const made =
      ids.length === 0
        ? null
        : createRelayClient({
            relayUrl: relayOrigin(base),
            audience: options.audience ?? relayOrigin(base),
            keyId: auth.keyId,
            privateKey: auth.privateKey,
            trust,
            services: ids,
            fetch: fetchLike,
            now: wallNow,
            monoNow,
            timeoutMs: options.timeoutMs ?? RELAY_TIMEOUT_MS,
          });
    const client = made === null ? null : made.ok ? made.value : null;
    current = { key, client };
    if (made && !made.ok) clientProblem = made;
    return client;
  };
  return {
    async anchor(hashHex) {
      const hash = hexToBytes(hashHex);
      if (!hash) return { ok: false, reason: 'bad-response', detail: 'Hash' };
      missing.expire();
      for (;;) {
        const client = clientNow();
        if (!client) {
          if (clientProblem) return outcomeOf(clientProblem, 0);
          return noServiceLeft([...dropped.values()].map((d) => d.failure));
        }
        const stamped = await client.stamp(
          hash,
          options.signal ? { mode: 'solo', signal: options.signal } : { mode: 'solo' },
        );
        if (stamped.ok) return { ok: true, value: { evidence: stamped.value } };
        if (serviceMissing(stamped)) {
          const service = stamped.detail;
          // the client names the service asked in `detail` (the relay's 404/403 carries no reason);
          // otherwise the first one still in play
          const first = [...trusted.keys()].find((id) => !missing.has(id));
          dropped.set(service && trusted.has(service) ? service : (first ?? ''), {
            failure: stamped,
            atMono: monoNow(),
          });
          continue;
        }
        return outcomeOf(stamped, client.pausedForMs());
      }
    },
  };
}

export type AnchorRound =
  | { kind: 'anchor'; anchor: Anchor }
  /** No service set up (or none usable in this build). */
  | { kind: 'off' }
  /** The head of the chain is covered already. */
  | { kind: 'nothing' }
  | { kind: 'failed'; text: string };

/**
 * One round with the service: asks for a time stamp of the chain head and returns the anchor to add (the
 * caller adds it to the book as it is then, because the book may have changed meanwhile), or why not.
 * A failure always carries a text for the person.
 */
export async function requestAnchor(
  book: TimeBook,
  service: AnchorService | undefined,
): Promise<AnchorRound> {
  if (book.settings.timestampRelay === '' || !service) return { kind: 'off' };
  const request = anchorRequest(book);
  if (!request) return { kind: 'nothing' };
  let outcome: AnchorOutcome;
  try {
    outcome = await service.anchor(request.hash);
  } catch (error) {
    outcome = {
      ok: false,
      reason: 'unreachable',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (!outcome.ok) {
    return { kind: 'failed', text: `${ANCHOR_FAILURE_TEXTS[outcome.reason]} (${outcome.detail})` };
  }
  return { kind: 'anchor', anchor: anchorFromOutcome(request, outcome.value) };
}
