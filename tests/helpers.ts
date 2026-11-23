import { emptyBook, type Break, type TimeBook, type Workday } from '../src/logic/index.ts';

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
