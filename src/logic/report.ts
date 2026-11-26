import { fail, ok, type DateKey, type MonthKey, type Result, type TimeBook } from './model.ts';
import { changesOfMonth } from './changes.ts';
import { monthSummary } from './summary.ts';
import { formatClock, isDateKey, isMonthKey, monthOf } from './time.ts';
import { canonicalJson, type Json } from './canonical.ts';
import { anchorStatus, anchorsForStamps, coveredUpTo, type AnchorStatus } from './anchors.ts';
import { chainHead, dayContentHash, skewedStamps, stampsOfMonth } from './stamps.ts';
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
  /** Only the anchors that concern the month's stamps (`anchorsForStamps`), not every anchor of the book. */
  anchors: Anchor[];
  /** Set for a running PDF's day file: anchors up to this stamp number are in an earlier file already. */
  anchorsAfterN?: number;
}

export function monthTimestamps(
  book: TimeBook,
  month: MonthKey,
  createdIso: string,
  anchorsAfterN?: number,
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
    anchors: anchorsForStamps(book.anchors, stamps).filter(
      (a) => anchorsAfterN === undefined || a.coveredN > anchorsAfterN,
    ),
    ...(anchorsAfterN === undefined ? {} : { anchorsAfterN }),
  };
}

/** Format marker and version of the monthly data file (the attachment of the PDF). */
export const REPORT_FORMAT = 'zeiterfassung-monat';
export const REPORT_VERSION = 4;

/** File name of the attached data file. */
export const attachmentName = (month: MonthKey): string => `zeiterfassung-${month}.json`;

/**
 * The book cut off after `upTo`: only the days up to and including that date and only the logged changes
 * of such days. The stamp chain and the anchors stay as they are (they describe the state at creation).
 */
export function bookUpTo(book: TimeBook, upTo: DateKey): TimeBook {
  const days: TimeBook['days'] = {};
  for (const [date, day] of Object.entries(book.days)) if (date <= upTo) days[date] = day;
  return { ...book, days, changes: book.changes.filter((c) => c.date <= upTo) };
}

/**
 * The monthly data as the attached file: format and version, employee label, creation time, the days
 * with their sums, the open days and the logged changes of the month. With `upTo` (running monthly PDF)
 * only the days and changes up to and including that date, and the field `upTo` says so. With
 * `anchorsAfterN` (running monthly PDF: the highest `coveredN` an earlier file of the same PDF lists) only
 * the anchors above it are listed (`timestamps.anchorsAfterN` says so): the files of one PDF together hold
 * every anchor once, instead of each day file repeating all of them.
 */
export function monthToJson(
  book: TimeBook,
  month: MonthKey,
  createdIso: string,
  upTo?: DateKey,
  anchorsAfterN?: number,
): Result<string> {
  if (!isMonthKey(month)) return fail('bad-month');
  if (anchorsAfterN !== undefined && !(Number.isInteger(anchorsAfterN) && anchorsAfterN >= 0)) {
    return fail('bad-anchor');
  }
  if (upTo !== undefined) {
    if (!isDateKey(upTo) || monthOf(upTo) !== month) return fail('bad-date');
    book = bookUpTo(book, upTo);
  }
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
      // with the fields above exactly the input of `dayContentHash` (version 4): the chain can be checked
      recordedAt: day?.recordedAt ?? null,
      contentHash: day ? dayContentHash(r.date, day) : null,
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
      timestamps: timestampsJson(
        monthTimestamps(book, month, createdIso, anchorsAfterN),
        book.stampBase,
      ),
      ...(upTo === undefined ? {} : { upTo }),
    }),
  );
}

/** The section as data for the attached file: the month's stamps, the month's anchors with their tokens. */
function timestampsJson(t: TimestampSection, base: StampBase | null): Json {
  return {
    note:
      'Internal stamps use the device clock and prove no time; only the anchors prove a time. Each anchor ' +
      'holds the evidence (format v1 of zeitstempel/client): service, hash (base64url of headHash), the ' +
      'time of the checked token and the RFC 3161 DER token as base64url. Check it with verifyEvidence of ' +
      "zeitstempel/client, or decode the token and use openssl ts against the service's root certificate. " +
      'Only the anchors of this month are listed: for each of its stamps the first anchor covering it, and ' +
      'the newest one before the month. Recompute a day: SHA-256 (hex) of the UTF-8 canonical JSON (keys ' +
      'sorted at every level, two-space indent, final line break) of {date, startMin, endMin, breaks, ' +
      'origin, note, recordedAt} of that day equals contentHash of its newest stamp; a removed day hashes ' +
      '{date, deleted: true}. A stamp hash is the same over {n, at, kind, date, contentHash, prev, skew}, ' +
      'and prev is the hash of the stamp before.',
    chainHeadN: t.head?.n ?? 0,
    chainHeadHash: t.head?.hash ?? null,
    chainBase: base ? { n: base.n, hash: base.hash, at: base.at } : null,
    status: { ...t.status },
    monthCovered: t.monthCovered,
    firstUncoveredN: t.firstUncovered?.n ?? null,
    skewNumbers: t.skewNumbers,
    ...(t.anchorsAfterN === undefined ? {} : { anchorsAfterN: t.anchorsAfterN }),
    stamps: t.stamps.map((s) => ({ ...s })),
    anchors: t.anchors.map((a) => ({
      coveredN: a.coveredN,
      headHash: a.headHash,
      // the evidence as `zeitstempel/client` wrote it (format v1): checkable with its `verifyEvidence`
      evidence: JSON.parse(JSON.stringify(a.evidence)) as Json,
    })),
  };
}
