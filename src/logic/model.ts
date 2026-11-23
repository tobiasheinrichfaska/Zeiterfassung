/** Data model of the time book. Pure types and constants, no I/O (workspace rule: logic layer). */

/** Local calendar day, `YYYY-MM-DD`. */
export type DateKey = string;
/** Local calendar month, `YYYY-MM`. */
export type MonthKey = string;

/** A pause: a plain length, or a span of the working day (open while `toMin` is null). */
export type Break =
  { kind: 'length'; minutes: number } | { kind: 'span'; fromMin: number; toMin: number | null };

export type Origin = 'stamp' | 'manual';

/**
 * One working day. Times are minutes since LOCAL midnight of `date` (wall clock, no time zone),
 * so a shift past midnight has `endMin` above 1440. `endMin` null = still running.
 */
export interface Workday {
  date: DateKey;
  startMin: number;
  endMin: number | null;
  breaks: Break[];
  origin: Origin;
  note: string;
  /** When this record was last changed (ISO 8601, UTC) — the device clock, not a trusted time. */
  recordedAt: string;
}

export interface Settings {
  /** Free text printed on the summary (a name or a staff number); may be empty. */
  employeeLabel: string;
  /** Exported months are deleted from the device this many months after their end. */
  retentionMonths: number;
}

export interface TimeBook {
  format: typeof BOOK_FORMAT;
  version: typeof BOOK_VERSION;
  settings: Settings;
  days: Record<DateKey, Workday>;
  /** Month → when its summary was exported (ISO). Only exported months may be purged. */
  exportedMonths: Record<MonthKey, string>;
}

export const BOOK_FORMAT = 'zeiterfassung-buch';
export const BOOK_VERSION = 1;

/** Every limit in one place; tests tie their boundaries to it. */
export const LIMITS = {
  minutesPerDay: 1440,
  /** A shift may end on the next day: end minute at most this. */
  maxEndMin: 2879,
  maxBreaksPerDay: 20,
  maxBreakLengthMinutes: 720,
  maxNoteChars: 200,
  maxLabelChars: 100,
  retentionMonthsMin: 1,
  retentionMonthsMax: 120,
  maxDays: 4000,
  maxBackupChars: 5_000_000,
} as const;

export const DEFAULT_SETTINGS: Settings = { employeeLabel: '', retentionMonths: 24 };

export function emptyBook(): TimeBook {
  return {
    format: BOOK_FORMAT,
    version: BOOK_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    days: {},
    exportedMonths: {},
  };
}

/** Error codes (never sentences: the UI owns the words). */
export type Reason =
  | 'bad-date'
  | 'bad-month'
  | 'bad-minute'
  | 'end-before-start'
  | 'too-long'
  | 'bad-break'
  | 'too-many-breaks'
  | 'break-overlap'
  | 'break-outside'
  | 'breaks-too-long'
  | 'open-break-on-closed-day'
  | 'bad-note'
  | 'bad-label'
  | 'bad-retention'
  | 'bad-origin'
  | 'already-running'
  | 'not-running'
  | 'break-running'
  | 'no-break-running'
  | 'day-exists'
  | 'clock-before-end'
  | 'no-such-day'
  | 'second-open-day'
  | 'too-many-days'
  | 'bad-backup'
  | 'unknown-version';

export type Result<T> = { ok: true; value: T } | { ok: false; reason: Reason };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (reason: Reason): { ok: false; reason: Reason } => ({ ok: false, reason });
