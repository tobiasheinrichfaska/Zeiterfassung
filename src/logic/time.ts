import type { DateKey, MonthKey } from './model.ts';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return (
    t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && y >= 1900
  );
}

export function isMonthKey(value: unknown): value is MonthKey {
  if (typeof value !== 'string') return false;
  const m = MONTH_RE.exec(value);
  return !!m && Number(m[1]) >= 1900 && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

/** Days since 1970-01-01 of a valid date key. */
export function dayNumber(date: DateKey): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new TypeError('not a date key');
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function dayDiff(a: DateKey, b: DateKey): number {
  return dayNumber(b) - dayNumber(a);
}

export function monthOf(date: DateKey): MonthKey {
  return date.slice(0, 7);
}

/** Number of months since year 0 — for comparing months. */
export function monthIndex(month: MonthKey): number {
  const m = MONTH_RE.exec(month);
  if (!m) throw new TypeError('not a month key');
  return Number(m[1]) * 12 + Number(m[2]) - 1;
}

/** The local wall clock at one moment: the day and the minute of that day. */
export interface Clock {
  date: DateKey;
  minute: number;
}

/** Reads the wall clock of the device (local time zone) from a `Date`. */
export function clockFromDate(d: Date): Clock {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return {
    date: `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    minute: d.getHours() * 60 + d.getMinutes(),
  };
}

/** `H:MM` for a length of time (also above 24 hours). */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(minutes);
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

/** `HH:MM` of a minute count since midnight (past midnight wraps to the next day's clock). */
export function formatClock(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** `HH:MM` → minutes, or null. */
export function parseClock(text: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
