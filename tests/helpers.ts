import {
  emptyBook,
  hexToBase64Url,
  type Break,
  type Evidence,
  type TimeBook,
  type Workday,
} from '../src/logic/index.ts';

export const NOW = '2026-11-23T09:00:00.000Z';
/** „Today“ of the tests: the date of the default day. */
export const CTX = { today: '2026-11-23' };

export function day(over: Partial<Workday> = {}): Workday {
  return {
    date: '2026-11-23',
    startMin: 8 * 60,
    endMin: 16 * 60 + 30,
    breaks: [{ kind: 'length', minutes: 30 }] as Break[],
    origin: 'manual',
    note: '',
    recordedAt: NOW,
    ...over,
  };
}

export function bookWith(...days: Workday[]): TimeBook {
  const book = emptyBook();
  for (const d of days) book.days[d.date] = d;
  return book;
}

/** Unwraps a result or fails the test with the reason. */
export function val<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`unexpected refusal: ${r.reason}`);
  return r.value;
}

/**
 * An evidence (format v1 of `zeitstempel/client`) for a hash given as hex: the form only; the token is a
 * stand-in (any bytes) unless one is given. `over` replaces fields (also with wrong values, for refusals).
 */
export function evidenceFor(
  hashHex: string,
  over: Partial<Record<keyof Evidence, unknown>> & { tokenBytes?: Uint8Array } = {},
): Evidence {
  const { tokenBytes, ...rest } = over;
  return {
    v: 1,
    kind: 'single',
    service: 'freetsa',
    hash: hexToBase64Url(hashHex) ?? 'not-a-hash',
    hashAlg: 'sha256',
    receivedAtMs: Date.parse('2026-11-20T16:00:02.000Z'),
    token: Buffer.from(tokenBytes ?? Uint8Array.from([1, 2, 3, 4, 5])).toString('base64url'),
    genTime: '2026-11-20T16:01:00.000Z',
    ...rest,
  } as Evidence;
}
