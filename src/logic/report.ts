import { fail, ok, type MonthKey, type Result, type TimeBook } from './model.ts';
import { changesOfMonth } from './changes.ts';
import { monthSummary } from './summary.ts';
import { formatClock, isMonthKey } from './time.ts';
import { canonicalJson, type Json } from './canonical.ts';
import { anchorStatus, coveredUpTo, type AnchorStatus } from './anchors.ts';
import { chainHead, skewedStamps, stampsOfMonth } from './stamps.ts';
import type { Anchor, Stamp, StampBase } from './model.ts';

/** What the report says about the time stamps of one month (the PDF prints it, the JSON carries it). */
export interface TimestampSection {
  /** The month's stamps, oldest first. */
  stamps: Stamp[];
  /** Numbers of the month's stamps made with a clock that had gone back. */
  skewNumbers: number[];
  /** The head of the whole chain when the report was made. */
  head: StampBase | null;
  status: AnchorStatus;
  /** Whether every stamp of the month is covered by an anchor. */
  monthCovered: boolean;
  /** The first stamp of the month no anchor covers (null when all are covered or there are none). */
  firstUncovered: Stamp | null;
  anchors: Anchor[];
}

export function monthTimestamps(
  book: TimeBook,
  month: MonthKey,
  createdIso: string,
): TimestampSection {
  const stamps = stampsOfMonth(book, month);
  const covered = coveredUpTo(book);
  const firstUncovered = stamps.find((s) => s.n > covered) ?? null;
  return {
    stamps,
    skewNumbers: skewedStamps(stamps).map((s) => s.n),
    head: chainHead(book),
    status: anchorStatus(book, createdIso),
    monthCovered: firstUncovered === null,
    firstUncovered,
    anchors: book.anchors,
  };
}

/** Format marker and version of the monthly data file (the attachment of the PDF). */
export const REPORT_FORMAT = 'zeiterfassung-monat';
export const REPORT_VERSION = 2;

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
      timestamps: timestampsJson(monthTimestamps(book, month, createdIso), book.stampBase),
    }),
  );
}

/** The section as data for the attached file: the month's stamps, every anchor with its token. */
function timestampsJson(t: TimestampSection, base: StampBase | null): Json {
  return {
    note:
      'Internal stamps use the device clock and prove no time; only the anchors (time stamp tokens, ' +
      'Base64 of the RFC 3161 DER token, with the time of the service and its serial) prove a time. Check a ' +
      "token against the hash of its stamp and the service's root certificate, for example with openssl ts.",
    chainHeadN: t.head?.n ?? 0,
    chainHeadHash: t.head?.hash ?? null,
    chainBase: base ? { n: base.n, hash: base.hash, at: base.at } : null,
    status: { ...t.status },
    monthCovered: t.monthCovered,
    firstUncoveredN: t.firstUncovered?.n ?? null,
    skewNumbers: t.skewNumbers,
    stamps: t.stamps.map((s) => ({ ...s })),
    anchors: t.anchors.map((a) => ({ ...a })),
  };
}
