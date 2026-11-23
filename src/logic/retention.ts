import { fail, ok, type DateKey, type MonthKey, type Result, type TimeBook } from './model.ts';
import { isMonthKey, monthIndex, monthOf } from './time.ts';

/** Records that a month's summary was exported (the precondition for purging it). */
export function markExported(book: TimeBook, month: MonthKey, whenIso: string): Result<TimeBook> {
  if (!isMonthKey(month)) return fail('bad-month');
  return ok({ ...book, exportedMonths: { ...book.exportedMonths, [month]: whenIso } });
}

export interface RetentionReport {
  /** Past the retention time and exported: may be deleted. */
  purgeable: MonthKey[];
  /** Past the retention time but NOT exported: kept, and the user is told. */
  blocked: MonthKey[];
}

/** A month is due when more than `retentionMonths` months have passed since its end. */
export function retentionReport(book: TimeBook, today: DateKey): RetentionReport {
  const now = monthIndex(monthOf(today));
  const due = [...new Set(Object.keys(book.days).map(monthOf))]
    .filter((m) => now - monthIndex(m) > book.settings.retentionMonths)
    .sort();
  return {
    purgeable: due.filter((m) => m in book.exportedMonths),
    blocked: due.filter((m) => !(m in book.exportedMonths)),
  };
}

/** Deletes the purgeable months' days; never touches an unexported month or a running day. */
export function purgeExpired(book: TimeBook, today: DateKey): TimeBook {
  const gone = new Set(retentionReport(book, today).purgeable);
  const days = Object.fromEntries(
    Object.entries(book.days).filter(([date, d]) => !gone.has(monthOf(date)) || d.endMin === null),
  );
  return { ...book, days };
}
