import {
  fail,
  ok,
  type Break,
  type MonthKey,
  type Result,
  type Settings,
  type TimeBook,
  type Workday,
} from './model.ts';
import { openDay, type WorkdayInput } from './actions.ts';
import { checkSettings } from './validate.ts';
import type { DayRow } from './summary.ts';
import {
  dayNumber,
  formatClock,
  formatDuration,
  isDateKey,
  isMonthKey,
  monthIndex,
  parseClock,
  type Clock,
} from './time.ts';

// ---- stamp clock: which buttons make sense -------------------------------------------------------

export type StampState = 'idle' | 'working' | 'onBreak';
export type StampAction = 'in' | 'breakStart' | 'breakEnd' | 'out';

/** The table that decides which buttons are active in which state (data, not branching). */
export const STAMP_ENABLED: Record<StampState, Record<StampAction, boolean>> = {
  idle: { in: true, breakStart: false, breakEnd: false, out: false },
  working: { in: false, breakStart: true, breakEnd: false, out: true },
  onBreak: { in: false, breakStart: false, breakEnd: true, out: true },
};

/** Which stamp buttons are active now; „Kommen“ is also off when today already has a finished day. */
export function stampEnabled(book: TimeBook, clock: Clock): Record<StampAction, boolean> {
  const enabled = STAMP_ENABLED[stampState(book)];
  return { ...enabled, in: enabled.in && !(clock.date in book.days) };
}

export function stampState(book: TimeBook): StampState {
  const day = openDay(book);
  if (!day) return 'idle';
  return day.breaks.some((b) => b.kind === 'span' && b.toMin === null) ? 'onBreak' : 'working';
}

/** Short status line for the stamp page, e.g. „Seit 08:00 bei der Arbeit“. */
export function stampStatus(book: TimeBook, clock: Clock): string {
  const day = openDay(book);
  if (!day) {
    const today = book.days[clock.date];
    return today ? 'Heute ist der Arbeitstag beendet.' : 'Noch nicht gestempelt.';
  }
  const since = formatClock(day.startMin);
  const onBreak = day.breaks.find((b) => b.kind === 'span' && b.toMin === null);
  return onBreak && onBreak.kind === 'span'
    ? `Seit ${since} bei der Arbeit, Pause seit ${formatClock(onBreak.fromMin)}.`
    : `Seit ${since} bei der Arbeit.`;
}

// ---- entry form: text fields <-> WorkdayInput ----------------------------------------------------

export interface BreakFields {
  kind: 'length' | 'span';
  minutes: string;
  from: string;
  to: string;
}

export interface DayFormFields {
  date: string;
  start: string;
  end: string;
  /** The departure is on the day after the arrival (a shift past midnight). */
  nextDay: boolean;
  breaks: BreakFields[];
  note: string;
}

export function emptyForm(date: string): DayFormFields {
  return { date, start: '', end: '', nextDay: false, breaks: [], note: '' };
}

export function emptyBreak(kind: BreakFields['kind'] = 'length'): BreakFields {
  return { kind, minutes: '', from: '', to: '' };
}

/** Shows a stored day in the form fields (so that any day, also a running one, can be corrected). */
export function dayToForm(day: Workday): DayFormFields {
  return {
    date: day.date,
    start: formatClock(day.startMin),
    end: day.endMin === null ? '' : formatClock(day.endMin),
    nextDay: day.endMin !== null && day.endMin >= 1440,
    breaks: day.breaks.map((b): BreakFields =>
      b.kind === 'length'
        ? { kind: 'length', minutes: String(b.minutes), from: '', to: '' }
        : {
            kind: 'span',
            minutes: '',
            from: formatClock(b.fromMin),
            to: b.toMin === null ? '' : formatClock(b.toMin),
          },
    ),
    note: day.note,
  };
}

/**
 * Reads the form. Only the shape is checked here (a code for what cannot be read at all); the rules
 * (end after start, breaks inside the day, …) are the logic layer's `checkWorkday`, reached through
 * `setWorkday`. A clock time before the arrival belongs to the next day when the shift runs past
 * midnight.
 */
export function parseDayForm(f: DayFormFields): Result<WorkdayInput> {
  if (!isDateKey(f.date)) return fail('bad-date');
  const startMin = parseClock(f.start);
  if (startMin === null) return fail('bad-minute');
  let endMin: number | null = null;
  if (f.end !== '') {
    const clock = parseClock(f.end);
    if (clock === null) return fail('bad-minute');
    endMin = clock + (f.nextDay ? 1440 : 0);
  }
  const breaks: Break[] = [];
  for (const b of f.breaks) {
    if (b.kind === 'length') {
      if (!/^\d{1,4}$/.test(b.minutes)) return fail('bad-break');
      breaks.push({ kind: 'length', minutes: Number(b.minutes) });
      continue;
    }
    const from = parseClock(b.from);
    if (from === null) return fail('bad-break');
    const fromMin = f.nextDay && from < startMin ? from + 1440 : from;
    let toMin: number | null = null;
    if (b.to !== '') {
      const to = parseClock(b.to);
      if (to === null) return fail('bad-break');
      toMin = f.nextDay && to < fromMin ? to + 1440 : to;
    }
    breaks.push({ kind: 'span', fromMin, toMin });
  }
  return ok({ date: f.date, startMin, endMin, breaks, note: f.note.trim() });
}

// ---- settings form -------------------------------------------------------------------------------

/** Reads the settings fields; the value rules (1 to 120 months, label length) are `checkSettings`. */
export function parseSettingsForm(label: string, retention: string): Result<Settings> {
  if (!/^\d{1,4}$/.test(retention)) return fail('bad-retention');
  const settings: Settings = { employeeLabel: label.trim(), retentionMonths: Number(retention) };
  const reason = checkSettings(settings);
  return reason ? fail(reason) : ok(settings);
}

// ---- month view ----------------------------------------------------------------------------------

export const MONTH_NAMES = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
] as const;

export const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;

/** `November 2026`. */
export function monthLabel(month: MonthKey): string {
  if (!isMonthKey(month)) throw new TypeError('not a month key');
  return `${MONTH_NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
}

/** The month `delta` months from `month` (negative = earlier). */
export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const index = monthIndex(month) + delta;
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** `Mo 23.11.2026` (German order, with the weekday). */
export function dateLabel(date: string): string {
  const weekday = WEEKDAYS_SHORT[(((dayNumber(date) + 4) % 7) + 7) % 7];
  return `${weekday} ${date.slice(8)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}

/** The texts of one row of the month table. */
export interface RowTexts {
  date: string;
  start: string;
  end: string;
  breaks: string;
  work: string;
  origin: string;
}

export function rowTexts(row: DayRow): RowTexts {
  return {
    date: dateLabel(row.date),
    start: formatClock(row.startMin),
    end:
      row.endMin === null ? 'läuft' : formatClock(row.endMin) + (row.endMin >= 1440 ? ' (+1)' : ''),
    breaks: formatDuration(row.breakMinutes),
    work: row.workMinutes === null ? '–' : formatDuration(row.workMinutes),
    origin: row.origin === 'stamp' ? 'Stempel' : 'Eingabe',
  };
}
