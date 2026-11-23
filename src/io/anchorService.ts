import {
  ANCHOR_FAILURE_TEXTS,
  anchorFromOutcome,
  anchorRequest,
  bytesToBase64Url,
  hexToBytes,
  parseRelayAnswer,
  parseServiceList,
  type Anchor,
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

/** What the adapter needs from the outside; all of it can be replaced in tests. */
export interface RelayOptions {
  fetch?: typeof fetch;
  /** Deadline of one call. The relay itself waits up to 10 s for the service: stay well above. */
  timeoutMs?: number;
  /**
   * Milliseconds on a clock for the pause after a 429. Default: the monotonic `performance.now()`, which a
   * change of the device clock does not move (a clock set back must not stretch the pause).
   */
  now?: () => number;
  /** The services the app trusts: id → PEM text of the trust anchors. */
  trusted?: ReadonlyMap<string, { anchors: string[] }>;
  verify?: typeof verifyTimestampToken;
}

/** The pause after a 429 without a usable `Retry-After`, and the longest pause the app takes at its word. */
const DEFAULT_RETRY_SECONDS = 60;
const MAX_RETRY_SECONDS = 3600;
/** How many of the relay's services are tried one after another when one cannot be reached. */
const MAX_SERVICES_TRIED = 3;

const VERIFY_TEXTS: Record<string, string> = {
  'imprint-mismatch': 'der bestätigte Hash ist ein anderer',
  'signature-invalid': 'die Signatur stimmt nicht',
  'untrusted-chain': 'die Zertifikatskette endet bei keinem bekannten Anker',
  'certificate-not-valid-at-time': 'ein Zertifikat war zur bestätigten Zeit nicht gültig',
  'time-in-future': 'die bestätigte Zeit liegt in der Zukunft',
  'message-digest-mismatch': 'der Inhalt des Tokens wurde verändert',
  malformed: 'das Token ist nicht lesbar',
  'unsupported-signature': 'Signaturverfahren nicht unterstützt (kein WebCrypto?)',
};

/**
 * The adapter for a time stamp relay (`<relay>/v1/services`, `<relay>/v1/stamp/<service>`), written to the
 * relay's documented interface. Only the 32-byte hash goes out (Base64url, in a JSON body), without
 * cookies, referrer or redirects. The answer is **never taken at its word**: the token is read and
 * verified here, against that hash and the trust anchors shipped with the app (the relay's `genTime` and
 * `serial` are only compared). A 429 pauses further requests until `Retry-After` has passed; 502/504 make
 * it try the next service the relay offers (up to three), anything else stops with the reason.
 */
export function createRelayService(base: string, options: RelayOptions = {}): AnchorService {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 20_000;
  const now = options.now ?? (() => performance.now());
  const trusted = options.trusted ?? trustedServices();
  const verify = options.verify ?? verifyTimestampToken;
  const root = base.replace(/\/+$/, '');
  let blockedUntil = -Infinity;

  type Reply =
    | { kind: 'reply'; status: number; headers: Headers; body: unknown }
    | { kind: 'failed'; detail: string };

  async function call(path: string, init: RequestInit): Promise<Reply> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(`${root}${path}`, {
        ...init,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // an error answer need not be JSON; a good one is checked below
      }
      return { kind: 'reply', status: response.status, headers: response.headers, body };
    } catch (error) {
      const detail = controller.signal.aborted
        ? 'Zeitüberschreitung'
        : error instanceof Error
          ? error.message
          : String(error);
      return { kind: 'failed', detail };
    } finally {
      clearTimeout(timer);
    }
  }

  const errorCode = (body: unknown): string => {
    const code = (body as { error?: unknown } | null)?.error;
    return typeof code === 'string' && /^[a-z-]{1,40}$/.test(code) ? `, ${code}` : '';
  };

  async function offered(): Promise<string[] | AnchorOutcome> {
    const r = await call('/v1/services', { method: 'GET' });
    if (r.kind === 'failed') return { ok: false, reason: 'unreachable', detail: r.detail };
    if (r.status !== 200) {
      return { ok: false, reason: 'refused', detail: `Status ${r.status}${errorCode(r.body)}` };
    }
    const ids = parseServiceList(r.body);
    if (!ids) return { ok: false, reason: 'bad-response', detail: 'Liste der Dienste' };
    const known = ids.filter((id) => trusted.has(id));
    if (known.length === 0) {
      return {
        ok: false,
        reason: 'refused',
        detail: 'kein Dienst des Weiterreichers ist der App bekannt',
      };
    }
    return known;
  }

  return {
    async anchor(hashHex) {
      const hash = hexToBytes(hashHex);
      if (!hash) return { ok: false, reason: 'bad-response', detail: 'Hash' };
      // a pause longer than the longest one ever set means the clock went back: forget it
      if (blockedUntil - now() > MAX_RETRY_SECONDS * 1000) blockedUntil = -Infinity;
      if (now() < blockedUntil) {
        const wait = Math.ceil((blockedUntil - now()) / 1000);
        return { ok: false, reason: 'rate-limited', detail: `bitte in ${wait} s erneut versuchen` };
      }
      const list = await offered();
      if (!Array.isArray(list)) return list;
      let last: AnchorOutcome = { ok: false, reason: 'unreachable', detail: 'kein Dienst' };
      for (const id of list.slice(0, MAX_SERVICES_TRIED)) {
        const r = await call(`/v1/stamp/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hash: bytesToBase64Url(hash) }),
        });
        if (r.kind === 'failed') return { ok: false, reason: 'unreachable', detail: r.detail };
        if (r.status === 429) {
          const asked = Number(r.headers.get('Retry-After'));
          const seconds =
            Number.isInteger(asked) && asked > 0
              ? Math.min(asked, MAX_RETRY_SECONDS)
              : DEFAULT_RETRY_SECONDS;
          blockedUntil = now() + seconds * 1000;
          return {
            ok: false,
            reason: 'rate-limited',
            detail: `bitte in ${seconds} s erneut versuchen`,
          };
        }
        if (r.status === 502 || r.status === 504) {
          last = {
            ok: false,
            reason: 'unreachable',
            detail: `Status ${r.status}${errorCode(r.body)}`,
          };
          continue; // this service did not answer: the next one may
        }
        if (r.status !== 200) {
          return { ok: false, reason: 'refused', detail: `Status ${r.status}${errorCode(r.body)}` };
        }
        const answer = parseRelayAnswer(r.body);
        if (!answer.ok) return answer;
        if (answer.value.tsaId !== id) {
          return { ok: false, reason: 'bad-response', detail: 'andere Dienstkennung als gefragt' };
        }
        let verified;
        try {
          verified = await verify(answer.value.token, hash, trusted.get(id)?.anchors ?? []);
        } catch (error) {
          return {
            ok: false,
            reason: 'not-verified',
            detail: error instanceof Error ? error.message : String(error),
          };
        }
        if (!verified.ok) {
          return {
            ok: false,
            reason: 'not-verified',
            detail: VERIFY_TEXTS[verified.reason] ?? verified.reason,
          };
        }
        if (verified.value.serial !== answer.value.serial) {
          return { ok: false, reason: 'bad-response', detail: 'Seriennummer weicht vom Token ab' };
        }
        return {
          ok: true,
          value: {
            tsaId: id,
            token: answer.value.token,
            genTime: verified.value.genTime,
            serial: verified.value.serial,
          },
        };
      }
      return last;
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
