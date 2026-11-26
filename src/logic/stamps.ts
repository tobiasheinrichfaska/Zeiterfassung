import {
  LIMITS,
  STAMP_KINDS,
  fail,
  ok,
  type DateKey,
  type MonthKey,
  type Reason,
  type Result,
  type Stamp,
  type StampBase,
  type StampKind,
  type TimeBook,
  type Workday,
} from './model.ts';
import { canonicalJson } from './canonical.ts';
import { isHash, sha256Hex } from './sha256.ts';
import { isDateKey, monthOf } from './time.ts';

/** The „previous hash“ of the very first stamp. */
export const ZERO_HASH = '0'.repeat(64);

/**
 * The hash of the state of a day (every field that is written), or of the deletion marker when the day
 * is gone. Canonical JSON, so the same state always gives the same hash.
 */
export function dayContentHash(date: DateKey, day: Workday | undefined): string {
  return sha256Hex(
    canonicalJson(
      day
        ? {
            date,
            startMin: day.startMin,
            endMin: day.endMin,
            breaks: day.breaks.map((b) => ({ ...b })),
            origin: day.origin,
            note: day.note,
            recordedAt: day.recordedAt,
          }
        : { date, deleted: true },
    ),
  );
}

/** The hash of a stamp: SHA-256 of the canonical form of all its other fields. */
export function stampHash(s: Omit<Stamp, 'hash'>): string {
  return sha256Hex(
    canonicalJson({
      n: s.n,
      at: s.at,
      kind: s.kind,
      date: s.date,
      contentHash: s.contentHash,
      prev: s.prev,
      skew: s.skew,
    }),
  );
}

/** The newest link of the chain: the last stamp, else the base, else nothing. */
export function chainHead(book: Pick<TimeBook, 'stamps' | 'stampBase'>): StampBase | null {
  const last = book.stamps.at(-1);
  return last ? { n: last.n, hash: last.hash, at: last.at } : book.stampBase;
}

/**
 * Appends one stamp for the state `book.days[date]` has now (or the deletion). A clock that went back
 * does not stop it: the stamp is appended and marked `skew`. A full chain is refused, never trimmed.
 */
export function appendStamp(
  book: TimeBook,
  kind: StampKind,
  date: DateKey,
  nowIso: string,
): Result<TimeBook> {
  if (book.stamps.length >= LIMITS.maxStamps) return fail('too-many-stamps');
  const head = chainHead(book);
  const partial = {
    n: (head?.n ?? 0) + 1,
    at: nowIso,
    kind,
    date,
    contentHash: dayContentHash(date, book.days[date]),
    prev: head?.hash ?? ZERO_HASH,
    skew: head !== null && Date.parse(nowIso) < Date.parse(head.at),
  };
  return ok({ ...book, stamps: [...book.stamps, { ...partial, hash: stampHash(partial) }] });
}

/**
 * One `seal` stamp for every day that has ended (date before today, with a departure) and has none yet.
 * A running day is sealed once it is closed. Nothing changes when there is nothing to seal.
 */
export function sealElapsedDays(book: TimeBook, today: DateKey, nowIso: string): Result<TimeBook> {
  const sealed = new Set(book.stamps.filter((s) => s.kind === 'seal').map((s) => s.date));
  const due = Object.values(book.days)
    .filter((d) => d.date < today && d.endMin !== null && !sealed.has(d.date))
    .map((d) => d.date)
    .sort();
  let next = book;
  for (const date of due) {
    const r = appendStamp(next, 'seal', date, nowIso);
    if (!r.ok) return r;
    next = r.value;
  }
  return ok(next);
}

/**
 * The days that do not match the stamp chain (sorted). The chain holds, for every write to a day, the
 * hash of that day's state (`dayContentHash`); the newest stamp of a date must therefore carry the hash
 * of the day as it is now. A mismatch is:
 * - a day whose newest stamp has another content hash (a time, a break, the note … changed outside the app);
 * - a day without any stamp that was recorded after the chain began (`recordedAt` at or after the time of
 *   the base, else of the first stamp): days from before the chain (a book of version 1 or 2) have none;
 * - a date whose newest stamp is not the deletion marker although the day is gone, unless its month was
 *   exported (purging after an export deletes days without a stamp).
 * Pure; nothing is changed. Used when the book is loaded (a note) and on a backup import (refused).
 */
export function checkDaysAgainstChain(
  book: Pick<TimeBook, 'days' | 'stamps' | 'stampBase' | 'exportedMonths'>,
): DateKey[] {
  const newest = new Map<DateKey, Stamp>();
  for (const s of book.stamps) newest.set(s.date, s);
  const startIso = book.stampBase?.at ?? book.stamps[0]?.at;
  const start = startIso === undefined ? undefined : Date.parse(startIso);
  const bad = new Set<DateKey>();
  for (const [date, day] of Object.entries(book.days)) {
    const stamp = newest.get(date);
    if (stamp) {
      if (stamp.contentHash !== dayContentHash(date, day)) bad.add(date);
    } else if (start !== undefined && !(Date.parse(day.recordedAt) < start)) {
      bad.add(date);
    }
  }
  for (const [date, stamp] of newest) {
    if (date in book.days) continue;
    if (stamp.contentHash === dayContentHash(date, undefined)) continue;
    if (monthOf(date) in book.exportedMonths) continue;
    bad.add(date);
  }
  return [...bad].sort();
}

/** The stamps made for days of one month. */
export const stampsOfMonth = (book: TimeBook, month: MonthKey): Stamp[] =>
  book.stamps.filter((s) => monthOf(s.date) === month);

export const skewedStamps = (stamps: readonly Stamp[]): Stamp[] => stamps.filter((s) => s.skew);

/**
 * Checks the whole chain: gapless numbers from the base on, every `prev` the hash of the stamp before,
 * every hash recomputed, `skew` consistent with the times. Returns `chain-broken` for a break and
 * `bad-backup` for a stamp that is not even well formed.
 */
export function checkChain(stamps: readonly Stamp[], base: StampBase | null): Reason | null {
  if (stamps.length > LIMITS.maxStamps) return 'too-many-stamps';
  let prevN = base?.n ?? 0;
  let prevHash = base?.hash ?? ZERO_HASH;
  let prevAt = base?.at;
  for (const s of stamps) {
    if (
      !Number.isInteger(s.n) ||
      typeof s.at !== 'string' ||
      Number.isNaN(Date.parse(s.at)) ||
      !STAMP_KINDS.includes(s.kind) ||
      !isDateKey(s.date) ||
      !isHash(s.contentHash) ||
      !isHash(s.prev) ||
      !isHash(s.hash) ||
      typeof s.skew !== 'boolean'
    ) {
      return 'bad-backup';
    }
    if (s.n !== prevN + 1 || s.prev !== prevHash) return 'chain-broken';
    if (s.skew !== (prevAt !== undefined && Date.parse(s.at) < Date.parse(prevAt))) {
      return 'chain-broken';
    }
    if (s.hash !== stampHash(s)) return 'chain-broken';
    prevN = s.n;
    prevHash = s.hash;
    prevAt = s.at;
  }
  return null;
}

/**
 * After purging: drops the oldest stamps that belong to months with no day left and are covered by an
 * anchor (or no relay is set, so nothing could ever cover them), and starts the chain from the last
 * dropped one. Only when the chain is long (`stampsCompactAt`); anchors for the dropped part go too.
 * What cannot be dropped stays: the limit then refuses new stamps instead of losing any.
 */
export function compactStamps(book: TimeBook): TimeBook {
  if (book.stamps.length <= LIMITS.stampsCompactAt) return book;
  const monthsWithDays = new Set(Object.keys(book.days).map(monthOf));
  const covered = Math.max(book.stampBase?.n ?? 0, ...book.anchors.map((a) => a.coveredN));
  const relayOff = book.settings.timestampRelay === '';
  let drop = 0;
  for (const s of book.stamps) {
    const free = !monthsWithDays.has(monthOf(s.date)) && (s.n <= covered || relayOff);
    if (!free) break;
    drop += 1;
  }
  if (drop === 0) return book;
  const last = book.stamps[drop - 1] as Stamp;
  const stampBase = { n: last.n, hash: last.hash, at: last.at };
  return {
    ...book,
    stamps: book.stamps.slice(drop),
    stampBase,
    anchors: book.anchors.filter((a) => a.coveredN >= stampBase.n),
  };
}
