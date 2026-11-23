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
  return ok({ ...book, days: { ...book.days, [day.date]: day } });
}

/** Stamp clock: arrival. One workday per date; stamping again on a finished day is refused. */
export function stampIn(book: TimeBook, clock: Clock, nowIso: string): Result<TimeBook> {
  if (openDay(book)) return fail('already-running');
  if (clock.date in book.days) return fail('day-exists');
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

/** Entry form: creates or replaces the working day of that date. */
export function setWorkday(book: TimeBook, input: WorkdayInput, nowIso: string): Result<TimeBook> {
  return withDay(book, { ...input, origin: 'manual', recordedAt: nowIso });
}

export function removeWorkday(book: TimeBook, date: DateKey): Result<TimeBook> {
  if (!(date in book.days)) return fail('no-such-day');
  const days = Object.fromEntries(Object.entries(book.days).filter(([key]) => key !== date));
  return ok({ ...book, days });
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
