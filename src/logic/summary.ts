import type { MonthKey, Origin, TimeBook, Workday } from './model.ts';
import { breakMinutes } from './validate.ts';
import { monthOf } from './time.ts';

export interface DayRow {
  date: string;
  startMin: number;
  endMin: number | null;
  breakMinutes: number;
  /** Null while the day is still running. */
  workMinutes: number | null;
  origin: Origin;
  note: string;
}

export interface MonthSummary {
  month: MonthKey;
  rows: DayRow[];
  /** Sum over the finished days. */
  workMinutes: number;
  /** Days still running: not in the sum, shown so that nothing is silently left out. */
  openDays: number;
}

export function totalBreakMinutes(day: Workday): number {
  return day.breaks.reduce((sum, b) => sum + breakMinutes(b), 0);
}

/** Working time of a finished day: span minus breaks; null while the day runs. */
export function workMinutes(day: Workday): number | null {
  return day.endMin === null ? null : day.endMin - day.startMin - totalBreakMinutes(day);
}

export function monthSummary(book: TimeBook, month: MonthKey): MonthSummary {
  const rows = Object.values(book.days)
    .filter((d) => monthOf(d.date) === month)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d): DayRow => ({
      date: d.date,
      startMin: d.startMin,
      endMin: d.endMin,
      breakMinutes: totalBreakMinutes(d),
      workMinutes: workMinutes(d),
      origin: d.origin,
      note: d.note,
    }));
  return {
    month,
    rows,
    workMinutes: rows.reduce((sum, r) => sum + (r.workMinutes ?? 0), 0),
    openDays: rows.filter((r) => r.endMin === null).length,
  };
}
