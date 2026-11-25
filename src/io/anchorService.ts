import { createRelayClient, type FetchLike, type Reason } from 'zeitstempel';
import {
  ANCHOR_FAILURE_TEXTS,
  anchorFromOutcome,
  anchorRequest,
  hexToBytes,
  type Anchor,
  type AnchorFailure,
  type AnchorOutcome,
  type TimeBook,
} from '../logic/index.ts';
import { trustedServices, verifyTimestampToken } from './zeitstempel.ts';

/**
 * The external time stamping service as the app sees it: it takes the hash of the chain head and gives
 * back a **verified** token with the time and serial it carries. The logic layer never touches the network.
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
 * Deadline of one call. The authenticated relay waits up to `RELAY_MAX_WAIT_MS` (30 s) for its turn at the
 * service, then up to about 17 s for body, service and check (47 s in single operation, more in collecting
 * operation): 80 s covers both with room.
 */
export const RELAY_TIMEOUT_MS = 80_000;

/** How far before the sending a token's time may lie (the relay's own `genTimeSlackMs`, clock differences). */
export const FRESHNESS_SLACK_MS = 60_000;

/** What the adapter needs from the outside; all of it can be replaced in tests. */
export interface RelayOptions {
  fetch?: typeof fetch;
  /** Deadline of one call; default `RELAY_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** The device key; without it requests go unsigned (only a relay started with `RELAY_AUTH=off` takes them). */
  auth?: DeviceAuth;
  /**
   * Wall clock (ms since the epoch): time in the signed header, a `Retry-After` date, and the freshness of a
   * token (not before sending − 60 s, not after now + 5 min). Default `Date.now()`.
   */
  wallNow?: () => number;
  /**
   * Milliseconds on a clock for the pause after a 429. Default: the monotonic `performance.now()`, which a
   * change of the device clock does not move (a clock set back must not stretch the pause).
   */
  now?: () => number;
  /** The services the app trusts: id → PEM text of the trust anchors. */
  trusted?: ReadonlyMap<string, { anchors: string[] }>;
  verify?: typeof verifyTimestampToken;
}

const VERIFY_TEXTS: Partial<Record<Reason, string>> = {
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

/** The library's English detail `status 502, upstream-failed` as the app's German `Status 502, …`. */
const statusDetail = (detail: string | undefined): string =>
  (detail ?? '').replace(/^status /, 'Status ');

/** The library's failure (code and English detail) as the app's failure kind with a German detail. */
function outcomeOf(failure: { reason: Reason; detail?: string }): AnchorOutcome {
  const { reason, detail } = failure;
  const no = (kind: AnchorFailure, text: string): AnchorOutcome => ({
    ok: false,
    reason: kind,
    detail: text,
  });
  switch (reason) {
    case 'relay-timeout':
      return no('unreachable', 'Zeitüberschreitung');
    case 'relay-unreachable':
      return no('unreachable', statusDetail(detail));
    case 'relay-refused':
      return no('refused', statusDetail(detail));
    case 'relay-rate-limited': {
      const seconds = /(\d+) s/.exec(detail ?? '')?.[1];
      return no('rate-limited', `bitte in ${seconds ?? '60'} s erneut versuchen`);
    }
    case 'no-trusted-service':
      return no('refused', 'kein Dienst des Weiterreichers ist der App bekannt');
    case 'relay-bad-response':
      return no(
        'bad-response',
        detail === 'serial differs from the token'
          ? 'Seriennummer weicht vom Token ab'
          : detail === 'another service id than asked for'
            ? 'andere Dienstkennung als gefragt'
            : (detail ?? ''),
      );
    case 'bad-hash':
      return no('bad-response', 'Hash');
    case 'relay-unauthorized':
      return no(
        'unauthorized',
        /solo-not-allowed/.test(detail ?? '')
          ? 'Status 403, Schlüssel ohne Solo-Erlaubnis'
          : statusDetail(detail),
      );
    case 'bad-key':
    case 'bad-key-id':
      return no('unauthorized', 'Schlüssel nicht verwendbar');
    default:
      return no('not-verified', VERIFY_TEXTS[reason] ?? reason);
  }
}

/**
 * The adapter for a time stamp relay: a thin layer over the Zeitstempel library's `createRelayClient`,
 * which does the protocol (`<relay>/v1/services`, `<relay>/v1/stamp/<service>`, only the hash goes out,
 * 429 pause on the monotonic clock, next service on 502/504/network error, and the token is **verified
 * against the hash and the trust anchors shipped with the app**, never taken at the relay's word). This
 * adapter only hands the app's parts in and turns the library's codes into the app's failure kinds and
 * German texts.
 */
export function createRelayService(base: string, options: RelayOptions = {}): AnchorService {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const wallNow = options.wallNow ?? (() => Date.now());
  const verifyToken = options.verify ?? verifyTimestampToken;
  /** Start times (wall clock) of the calls going on; a token must not be older than the earliest − 60 s. */
  const sending: number[] = [];
  const client = createRelayClient({
    relay: base,
    fetch: ((url, init) => doFetch(url, init as RequestInit)) as FetchLike,
    now: options.now ?? (() => performance.now()),
    wallNow,
    trusted: new Map([...(options.trusted ?? trustedServices())].map(([id, s]) => [id, s.anchors])),
    timeoutMs: options.timeoutMs ?? RELAY_TIMEOUT_MS,
    // always one stamp of exactly this hash: a token of a collecting relay would stamp a tree's root, which
    // is no PAdES document time stamp of the PDF (its imprint must be the digest of the byte range)
    mode: 'solo',
    ...(options.auth ? { auth: options.auth } : {}),
    // freshness: the library's client checks no token age itself (`minGenTime`), so the app adds it
    verify: (token, hash, anchors) =>
      verifyToken(token, hash, anchors, {
        now: new Date(wallNow()),
        minGenTime: new Date(
          (sending.length > 0 ? Math.min(...sending) : wallNow()) - FRESHNESS_SLACK_MS,
        ),
      }),
  });
  return {
    async anchor(hashHex) {
      const hash = hexToBytes(hashHex);
      if (!hash) return { ok: false, reason: 'bad-response', detail: 'Hash' };
      const started = wallNow();
      sending.push(started);
      let stamped;
      try {
        stamped = await client.stamp(hash);
      } finally {
        sending.splice(sending.indexOf(started), 1);
      }
      if (!stamped.ok) return outcomeOf(stamped);
      const { serviceId, token, genTime, serial } = stamped.value;
      return { ok: true, value: { tsaId: serviceId, token, genTime, serial } };
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
