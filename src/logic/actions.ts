import {
  fail,
  LIMITS,
  ok,
  type Break,
  type DateKey,
  type Result,
  type Settings,
  type TimeBook,
  type Workday,
} from './model.ts';
import { checkSettings, checkWorkday } from './validate.ts';
import { addChanges, changeEntry, reasonOk, type ChangeContext } from './changes.ts';
import { appendStamp } from './stamps.ts';
import { dayDiff, type Clock } from './time.ts';

/** The one day that is still running (no departure yet), if any. */
export function openDay(book: TimeBook): Workday | undefined {
  return Object.values(book.days).find((d) => d.endMin === null);
}

/** Minute of `clock` counted from the local midnight of `day.date` (above 1440 on later days). */
function minuteOn(day: Workday, clock: Clock): number {
  return dayDiff(day.date, clock.date) * 1440 + clock.minute;
}

function withDay(book: TimeBook, day: Workday): Result<TimeBook> {
  const reason = checkWorkday(day);
  if (reason) return fail(reason);
  if (!(day.date in book.days) && Object.keys(book.days).length >= LIMITS.maxDays) {
    return fail('too-many-days');
  }
  if (day.endMin === null) {
    const other = openDay(book);
    if (other && other.date !== day.date) return fail('second-open-day');
  }
  // every finished write is stamped (a hash chain; the time of the stamp is the record time)
  return appendStamp(
    { ...book, days: { ...book.days, [day.date]: day } },
    'change',
    day.date,
    day.recordedAt,
  );
}

export interface StampInOptions {
  /** Allows „Kommen“ on a day that already ended today: the day reopens (see `reopenDay`). */
  confirmReopen?: boolean;
}

/**
 * Stamp clock: arrival. One workday per date; on a finished day it is refused (`day-exists`) unless
 * `confirmReopen` says the person was asked and agreed.
 */
export function stampIn(
  book: TimeBook,
  clock: Clock,
  nowIso: string,
  options: StampInOptions = {},
): Result<TimeBook> {
  if (openDay(book)) return fail('already-running');
  const existing = book.days[clock.date];
  if (existing) {
    return options.confirmReopen ? reopenDay(book, existing, clock, nowIso) : fail('day-exists');
  }
  return withDay(book, {
    date: clock.date,
    startMin: clock.minute,
    endMin: null,
    breaks: [],
    origin: 'stamp',
    note: '',
    recordedAt: nowIso,
  });
}

/**
 * The day that ended earlier today starts again: no departure, and the time from the old departure
 * to now is a break span (it does not count as working time). Same minute: no gap, no break.
 * A clock before the old departure is refused. This is the same day, not a later change.
 */
function reopenDay(book: TimeBook, day: Workday, clock: Clock, nowIso: string): Result<TimeBook> {
  const end = day.endMin as number; // a day without departure would have been the open day
  const now = minuteOn(day, clock);
  if (now < end) return fail('clock-before-end');
  const breaks: Break[] =
    now > end ? [...day.breaks, { kind: 'span', fromMin: end, toMin: now }] : day.breaks;
  return withDay(book, { ...day, endMin: null, breaks, recordedAt: nowIso });
}

/** Stamp clock: break begins. */
export function breakStart(book: TimeBook, clock: Clock, nowIso: string): Result<TimeBook> {
  const day = openDay(book);
  if (!day) return fail('not-running');
  if (hasOpenBreak(day)) return fail('break-running');
  const from = minuteOn(day, clock);
  const span: Break = { kind: 'span', fromMin: from, toMin: null };
  return withDay(book, { ...day, breaks: [...day.breaks, span], recordedAt: nowIso });
}

/** Stamp clock: break ends. */
export function breakEnd(book: TimeBook, clock: Clock, nowIso: string): Result<TimeBook> {
  const day = openDay(book);
  if (!day) return fail('not-running');
  if (!hasOpenBreak(day)) return fail('no-break-running');
  const to = minuteOn(day, clock);
  return withDay(book, {
    ...day,
    breaks: closeOpenBreak(day.breaks, to),
    recordedAt: nowIso,
  });
}

/** Stamp clock: departure. A break that is still running ends at the same moment. */
export function stampOut(book: TimeBook, clock: Clock, nowIso: string): Result<TimeBook> {
  const day = openDay(book);
  if (!day) return fail('not-running');
  const end = minuteOn(day, clock);
  return withDay(book, {
    ...day,
    endMin: end,
    breaks: closeOpenBreak(day.breaks, end),
    recordedAt: nowIso,
  });
}

/** What a person types in the entry form. */
export interface WorkdayInput {
  date: DateKey;
  startMin: number;
  endMin: number | null;
  breaks: Break[];
  note: string;
}

/**
 * Entry form: creates or replaces the working day of that date. A day that is already over (its date
 * before `ctx.today`) is logged in the change log.
 */
export function setWorkday(
  book: TimeBook,
  input: WorkdayInput,
  nowIso: string,
  ctx: ChangeContext,
): Result<TimeBook> {
  if (!reasonOk(ctx.reason)) return fail('bad-reason');
  const placed = withDay(book, { ...input, origin: 'manual', recordedAt: nowIso });
  if (!placed.ok) return placed;
  const entry = changeEntry(
    book.days[input.date],
    placed.value.days[input.date],
    input.date,
    nowIso,
    ctx,
  );
  return entry ? addChanges(placed.value, [entry]) : placed;
}

/**
 * Corrects the day that stood at `oldDate`: replaces it by the input, and when the input has another
 * date, the old date's entry is removed in the same step (nothing is half-done). A move is logged as
 * a removal plus an addition that point at each other.
 */
export function moveWorkday(
  book: TimeBook,
  oldDate: DateKey,
  input: WorkdayInput,
  nowIso: string,
  ctx: ChangeContext,
): Result<TimeBook> {
  const old = book.days[oldDate];
  if (!old) return fail('no-such-day');
  if (oldDate === input.date) return setWorkday(book, input, nowIso, ctx);
  if (!reasonOk(ctx.reason)) return fail('bad-reason');
  const removed = appendStamp(
    {
      ...book,
      days: Object.fromEntries(Object.entries(book.days).filter(([key]) => key !== oldDate)),
    },
    'change',
    oldDate,
    nowIso,
  );
  if (!removed.ok) return removed;
  const placed = withDay(removed.value, { ...input, origin: 'manual', recordedAt: nowIso });
  if (!placed.ok) return placed;
  const entries = [
    changeEntry(old, undefined, oldDate, nowIso, ctx, { movedTo: input.date }),
    changeEntry(book.days[input.date], placed.value.days[input.date], input.date, nowIso, ctx, {
      movedFrom: oldDate,
    }),
  ].filter((e) => e !== undefined);
  return addChanges(placed.value, entries);
}

export function removeWorkday(
  book: TimeBook,
  date: DateKey,
  nowIso: string,
  ctx: ChangeContext,
): Result<TimeBook> {
  const old = book.days[date];
  if (!old) return fail('no-such-day');
  if (!reasonOk(ctx.reason)) return fail('bad-reason');
  const days = Object.fromEntries(Object.entries(book.days).filter(([key]) => key !== date));
  const stamped = appendStamp({ ...book, days }, 'change', date, nowIso);
  if (!stamped.ok) return stamped;
  const entry = changeEntry(old, undefined, date, nowIso, ctx);
  return addChanges(stamped.value, entry ? [entry] : []);
}

export function updateSettings(book: TimeBook, settings: Settings): Result<TimeBook> {
  const reason = checkSettings(settings);
  return reason ? fail(reason) : ok({ ...book, settings: { ...settings } });
}

function hasOpenBreak(day: Workday): boolean {
  return day.breaks.some((b) => b.kind === 'span' && b.toMin === null);
}

function closeOpenBreak(breaks: Break[], to: number): Break[] {
  return breaks.map((b) => (b.kind === 'span' && b.toMin === null ? { ...b, toMin: to } : b));
}
