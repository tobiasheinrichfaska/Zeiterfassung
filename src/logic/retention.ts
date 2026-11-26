import { fail, ok, type DateKey, type MonthKey, type Result, type TimeBook } from './model.ts';
import { isMonthKey, monthIndex, monthOf } from './time.ts';
import { compactStamps } from './stamps.ts';

/** Records that a month's summary was exported (the precondition for purging it). */
export function markExported(book: TimeBook, month: MonthKey, whenIso: string): Result<TimeBook> {
  if (!isMonthKey(month)) return fail('bad-month');
  return ok({ ...book, exportedMonths: { ...book.exportedMonths, [month]: whenIso } });
}

/**
 * Whether the export of a month still covers everything in it: nothing was recorded or changed in
 * that month after the export (a later change would be missing from the report that left the device).
 */
export function exportCovers(book: TimeBook, month: MonthKey): boolean {
  const exported = book.exportedMonths[month];
  if (exported === undefined) return false;
  const at = Date.parse(exported);
  const later = (iso: string) => Date.parse(iso) > at;
  return !(
    Object.values(book.days).some((d) => monthOf(d.date) === month && later(d.recordedAt)) ||
    book.changes.some((c) => monthOf(c.date) === month && later(c.at)) ||
    book.stamps.some((s) => monthOf(s.date) === month && later(s.at))
  );
}

export interface RetentionReport {
  /** Past the retention time and exported (and not changed since): may be deleted. */
  purgeable: MonthKey[];
  /** Past the retention time but not (completely) exported: kept, and the user is told. */
  blocked: MonthKey[];
  /** The part of `blocked` that was exported but changed afterwards: export again. */
  stale: MonthKey[];
}

/** A month is due when more than `retentionMonths` months have passed since its end. */
export function retentionReport(book: TimeBook, today: DateKey): RetentionReport {
  const now = monthIndex(monthOf(today));
  const months = [
    ...Object.keys(book.days).map(monthOf),
    ...book.changes.map((c) => monthOf(c.date)),
  ];
  const due = [...new Set(months)]
    .filter((m) => now - monthIndex(m) > book.settings.retentionMonths)
    .sort();
  const blocked = due.filter((m) => !exportCovers(book, m));
  return {
    purgeable: due.filter((m) => exportCovers(book, m)),
    blocked,
    stale: blocked.filter((m) => m in book.exportedMonths),
  };
}

/**
 * Deletes the purgeable months: their days (never a running day) and their change-log entries (an
 * entry stays while its day is still there). A month that is not exported, or changed since, is
 * never touched.
 */
export function purgeExpired(book: TimeBook, today: DateKey): TimeBook {
  const gone = new Set(retentionReport(book, today).purgeable);
  const days = Object.fromEntries(
    Object.entries(book.days).filter(([date, d]) => !gone.has(monthOf(date)) || d.endMin === null),
  );
  const changes = book.changes.filter((c) => !gone.has(monthOf(c.date)) || c.date in days);
  // the stamp chain stays (hashes only, no content); it is shortened only when it grows long
  return compactStamps({ ...book, days, changes });
}
