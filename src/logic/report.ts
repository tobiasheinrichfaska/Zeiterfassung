import { fail, ok, type MonthKey, type Result, type TimeBook } from './model.ts';
import { changesOfMonth } from './changes.ts';
import { monthSummary } from './summary.ts';
import { formatClock, isMonthKey } from './time.ts';
import { canonicalJson, type Json } from './canonical.ts';

/** Format marker and version of the monthly data file (the attachment of the PDF). */
export const REPORT_FORMAT = 'zeiterfassung-monat';
export const REPORT_VERSION = 1;

/** File name of the attached data file. */
export const attachmentName = (month: MonthKey): string => `zeiterfassung-${month}.json`;

/**
 * The monthly data as the attached file: format and version, employee label, creation time, the days
 * with their sums, the open days and the logged changes of the month.
 */
export function monthToJson(book: TimeBook, month: MonthKey, createdIso: string): Result<string> {
  if (!isMonthKey(month)) return fail('bad-month');
  const s = monthSummary(book, month);
  const days: Json[] = s.rows.map((r) => {
    const day = book.days[r.date];
    return {
      date: r.date,
      startMin: r.startMin,
      endMin: r.endMin,
      start: formatClock(r.startMin),
      end: r.endMin === null ? null : formatClock(r.endMin),
      endNextDay: r.endMin !== null && r.endMin >= 1440,
      breaks: (day?.breaks ?? []).map((b) => ({ ...b })),
      breakMinutes: r.breakMinutes,
      workMinutes: r.workMinutes,
      origin: r.origin,
      note: r.note,
    };
  });
  const changes: Json[] = changesOfMonth(book, month).map((c) => ({
    at: c.at,
    date: c.date,
    kind: c.kind,
    before: c.before ? { ...c.before, breaks: c.before.breaks.map((b) => ({ ...b })) } : null,
    after: c.after ? { ...c.after, breaks: c.after.breaks.map((b) => ({ ...b })) } : null,
    reason: c.reason,
    movedTo: c.movedTo,
    movedFrom: c.movedFrom,
  }));
  return ok(
    canonicalJson({
      format: REPORT_FORMAT,
      version: REPORT_VERSION,
      month,
      created: createdIso,
      employee: book.settings.employeeLabel,
      days,
      totalWorkMinutes: s.workMinutes,
      openDays: s.openDays,
      changes,
    }),
  );
}
