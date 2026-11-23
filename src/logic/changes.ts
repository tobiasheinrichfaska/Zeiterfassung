import {
  LIMITS,
  fail,
  ok,
  type ChangeEntry,
  type ChangeKind,
  type DateKey,
  type DaySnapshot,
  type MonthKey,
  type Result,
  type TimeBook,
  type Workday,
} from './model.ts';
import { breakMinutes, textOk } from './validate.ts';
import { dateLabel, formatClock, formatDuration, formatIsoDateTime, monthOf } from './time.ts';

/** What the change functions need besides the data: the local date of today and an optional reason. */
export interface ChangeContext {
  today: DateKey;
  reason?: string;
}

/** A day is over when its date is before today's local date (date keys sort as text). */
export const isElapsed = (date: DateKey, today: DateKey): boolean => date < today;

export function snapshotOf(day: Workday): DaySnapshot {
  return {
    startMin: day.startMin,
    endMin: day.endMin,
    breaks: day.breaks.map((b) => ({ ...b })),
    note: day.note,
    origin: day.origin,
  };
}

const sameSnapshot = (a: DaySnapshot, b: DaySnapshot): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** An absent reason is fine; a given one follows the text rules (one plain line, 200 characters). */
export const reasonOk = (reason: string | undefined): boolean =>
  reason === undefined || textOk(reason, LIMITS.maxReasonChars);

export interface Links {
  movedTo?: DateKey;
  movedFrom?: DateKey;
}

/**
 * The log entry for a change of the day at `date`, or undefined when nothing has to be logged: the day
 * is not over yet, or its times did not change.
 */
export function changeEntry(
  before: Workday | undefined,
  after: Workday | undefined,
  date: DateKey,
  nowIso: string,
  ctx: ChangeContext,
  links: Links = {},
): ChangeEntry | undefined {
  if (!isElapsed(date, ctx.today) || (!before && !after)) return undefined;
  const b = before ? snapshotOf(before) : null;
  const a = after ? snapshotOf(after) : null;
  if (b && a && sameSnapshot(b, a)) return undefined;
  const kind: ChangeKind = !b ? 'added' : !a ? 'removed' : 'changed';
  return {
    at: nowIso,
    date,
    kind,
    before: b,
    after: a,
    reason: (ctx.reason ?? '').trim(),
    movedTo: links.movedTo ?? null,
    movedFrom: links.movedFrom ?? null,
  };
}

/** Appends entries to the log; the log never drops entries on its own (full = refusal). */
export function addChanges(book: TimeBook, entries: ChangeEntry[]): Result<TimeBook> {
  if (entries.length === 0) return ok(book);
  if (book.changes.length + entries.length > LIMITS.maxChanges) return fail('too-many-changes');
  return ok({ ...book, changes: [...book.changes, ...entries] });
}

export const changesOfMonth = (book: TimeBook, month: MonthKey): ChangeEntry[] =>
  book.changes.filter((c) => monthOf(c.date) === month);

/** The dates of a month that carry at least one logged change. */
export const changedDates = (book: TimeBook, month: MonthKey): Set<DateKey> =>
  new Set(changesOfMonth(book, month).map((c) => c.date));

/** The times of a snapshot in one line, e.g. `08:00–16:30, Pause 0:30, Eingabe`. */
export function describeSnapshot(s: DaySnapshot | null): string {
  if (!s) return '–';
  const end =
    s.endMin === null ? 'läuft' : formatClock(s.endMin) + (s.endMin >= 1440 ? ' (+1)' : '');
  const pause = s.breaks.reduce((sum, b) => sum + breakMinutes(b), 0);
  return (
    `${formatClock(s.startMin)}–${end}, Pause ${formatDuration(pause)}, ` +
    `${s.origin === 'stamp' ? 'Stempel' : 'Eingabe'}` +
    (s.note ? `, Notiz „${s.note}“` : '')
  );
}

export const CHANGE_KIND_TEXT: Record<ChangeKind, string> = {
  added: 'Nachgetragen',
  changed: 'Geändert',
  removed: 'Gelöscht',
};

/** One entry as German texts, for the month page and the report. */
export interface ChangeText {
  date: string;
  when: string;
  kind: string;
  before: string;
  after: string;
  reason: string;
  /** „verschoben nach …“ / „verschoben von …“ or empty. */
  link: string;
}

export function changeText(e: ChangeEntry): ChangeText {
  return {
    date: dateLabel(e.date),
    when: formatIsoDateTime(e.at),
    kind: CHANGE_KIND_TEXT[e.kind],
    before: describeSnapshot(e.before),
    after: describeSnapshot(e.after),
    reason: e.reason,
    link: e.movedTo
      ? `verschoben nach ${dateLabel(e.movedTo)}`
      : e.movedFrom
        ? `verschoben von ${dateLabel(e.movedFrom)}`
        : '',
  };
}

/** Whether saving or deleting these dates will be logged (so the person is told first). */
export const willBeLogged = (dates: DateKey[], today: DateKey): boolean =>
  dates.some((d) => isElapsed(d, today));

export const LOG_NOTICE = 'Dieser Tag ist abgelaufen. Die Änderung wird protokolliert.';
