import {
  ANCHOR_FAILURE_TEXTS,
  anchorFromOutcome,
  anchorRequest,
  parseServiceAnswer,
  type Anchor,
  type AnchorOutcome,
  type TimeBook,
} from '../logic/index.ts';

/**
 * The external time stamping service as the app sees it: it takes the hash of the chain head and gives
 * back a token and the time the token says. The real service (a relay to time stamping authorities, and
 * the check of the token) is a separate piece; the logic layer never touches the network.
 */
export interface AnchorService {
  anchor(hashHex: string): Promise<AnchorOutcome>;
}

/**
 * A plain HTTP adapter for a relay. **Provisional protocol** (to be matched with the time stamp relay
 * package when it exists): POST the JSON `{"hash": "<64 hex digits>"}` to the address, answer JSON
 * `{"tsaId": …, "genTime": …, "token": "<Base64>"}`. The request carries no cookies, no referrer and
 * follows no redirect; it is cut off after `timeoutMs`. The relay sees the time and the network address of
 * the request, never any times or notes (only the hash is sent).
 */
export function createRelayService(
  url: string,
  doFetch: typeof fetch = (input, init) => fetch(input, init),
  timeoutMs = 20_000,
): AnchorService {
  return {
    async anchor(hashHex) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hash: hashHex }),
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        });
        if (!response.ok) {
          return { ok: false, reason: 'refused', detail: `Status ${response.status}` };
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return { ok: false, reason: 'bad-response', detail: 'keine gültige JSON-Antwort' };
        }
        return parseServiceAnswer(body);
      } catch (error) {
        const detail = controller.signal.aborted
          ? 'Zeitüberschreitung'
          : error instanceof Error
            ? error.message
            : String(error);
        return { ok: false, reason: 'unreachable', detail };
      } finally {
        clearTimeout(timer);
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
