/**
 * What the app does with the running monthly PDF, as pure rules (no PDF library, no storage, no network):
 * which months it looks after, which days are still to append, where a month's file is kept in the vault,
 * how the file is held as text, and the German lines the month page shows.
 */
import type { DateKey, MonthKey, TimeBook } from './model.ts';
import { base64ToBytes, bytesToBase64 } from './anchors.ts';
import { dateLabel, formatIsoDateTime, isMonthKey, monthIndex, monthOf } from './time.ts';
import { shiftMonth } from './view.ts';

/**
 * The vault knows its slots from the start (`local-vault` has no slot added at run time), so there is one
 * fixed slot per month for a span of years: `monatspdf-2026-01` … `monatspdf-2040-12`. A month outside
 * the span gets no running PDF (it is told, nothing is written).
 */
export const RUNNING_PDF_FIRST_MONTH: MonthKey = '2026-01';
export const RUNNING_PDF_LAST_MONTH: MonthKey = '2040-12';

/** The vault slot of a month's running PDF, or null outside the span. */
export function runningPdfSlot(month: MonthKey): string | null {
  if (!isMonthKey(month)) return null;
  const i = monthIndex(month);
  if (i < monthIndex(RUNNING_PDF_FIRST_MONTH) || i > monthIndex(RUNNING_PDF_LAST_MONTH))
    return null;
  return `monatspdf-${month}`;
}

/** Every slot of the span, for the vault's configuration. */
export const RUNNING_PDF_SLOTS: readonly string[] = (() => {
  const out: string[] = [];
  const first = monthIndex(RUNNING_PDF_FIRST_MONTH);
  const count = monthIndex(RUNNING_PDF_LAST_MONTH) - first + 1;
  for (let i = 0; i < count; i++) out.push(`monatspdf-${shiftMonth(RUNNING_PDF_FIRST_MONTH, i)}`);
  return out;
})();

/** `zeiterfassung-2026-11-laufend.pdf`. */
export const runningPdfFileName = (month: MonthKey): string => `zeiterfassung-${month}-laufend.pdf`;

/** The stored text of a running PDF: the file as standard Base64 (the vault stores text). */
export const encodeRunningPdf = (pdf: Uint8Array): string => bytesToBase64(pdf);

export type StoredRunningPdf =
  | { kind: 'none' }
  | { kind: 'pdf'; pdf: Uint8Array }
  /** Something is stored but it is no PDF: shown, never overwritten. */
  | { kind: 'unreadable' };

/** Reads a slot's text. Nothing (or the empty text a deleted month leaves) is `none`. */
export function decodeRunningPdf(text: string | null): StoredRunningPdf {
  if (text === null || text === '') return { kind: 'none' };
  const pdf = base64ToBytes(text);
  if (pdf === null || pdf.length < 5) return { kind: 'unreadable' };
  const head = String.fromCharCode(...pdf.subarray(0, 5));
  return head === '%PDF-' ? { kind: 'pdf', pdf } : { kind: 'unreadable' };
}

/**
 * The months the app keeps a running PDF for right now: the previous and the current month, each only if
 * it has a day or already has a file (the previous month is finished at the next start after its end).
 */
export function runningPdfMonths(
  book: TimeBook,
  today: DateKey,
  hasPdf: (month: MonthKey) => boolean,
): MonthKey[] {
  const current = monthOf(today);
  return [shiftMonth(current, -1), current].filter(
    (m) =>
      runningPdfSlot(m) !== null &&
      (hasPdf(m) || Object.keys(book.days).some((d) => monthOf(d) === m)),
  );
}

/**
 * The days of the month still to append, in date order: ended (with „Gehen“), not after today, and not
 * yet in the file. A day that runs, or one dated in the future, waits.
 */
export function daysToAppend(
  book: TimeBook,
  month: MonthKey,
  inPdf: readonly DateKey[],
  today: DateKey,
): DateKey[] {
  const have = new Set(inPdf);
  return Object.values(book.days)
    .filter((d) => monthOf(d.date) === month && d.endMin !== null && d.date <= today)
    .map((d) => d.date)
    .filter((d) => !have.has(d))
    .sort();
}

/** Bytes reserved for the token of a document time stamp; a larger token is tried once more with more. */
export const RUNNING_STAMP_RESERVES = [8192, 16384] as const;

/** How a month's running PDF stands, as the month page shows it. */
export interface RunningPdfInfo {
  month: MonthKey;
  /** The days in the file, in date order. */
  days: DateKey[];
  timeStamps: number;
  newestStamped: boolean;
  /** Time of the newest document time stamp as its token says (ISO), when it could be read. */
  lastStampAt: string | null;
  /** Names of earlier attachments that a later revision removed or changed (should never happen). */
  changedAttachments: string[];
  /** Why the newest state is not stamped, or what went wrong (German), or null. */
  problem: string | null;
}

export const RUNNING_PDF_TEXTS = {
  noRelay:
    'Kein externer Zeitstempeldienst eingerichtet: Der neueste Stand der laufenden Monatsdatei ist nicht gestempelt.',
  stampFailed: 'Der neueste Stand der laufenden Monatsdatei ist nicht gestempelt',
  tokenTooLarge: 'Das Token des Zeitstempeldienstes ist zu groß für den reservierten Platz.',
  unreadable:
    'Die gespeicherte laufende Monatsdatei ist nicht lesbar. Sie bleibt unverändert; es wird nichts angehängt.',
  outOfSpan: 'Für diesen Monat führt diese Fassung keine laufende Monatsdatei.',
  failed: 'Die laufende Monatsdatei konnte nicht fortgeschrieben werden',
} as const;

/** The lines of the section „Laufendes Monats-PDF“ (German). */
export function runningPdfLines(info: RunningPdfInfo | undefined): string[] {
  if (!info) return ['Für diesen Monat gibt es noch keine laufende Monatsdatei.'];
  const lines = [
    info.days.length === 0
      ? 'Noch kein Tag enthalten.'
      : `${info.days.length} Tag(e) enthalten, zuletzt ${dateLabel(info.days.at(-1) ?? '')}.`,
    info.timeStamps === 0
      ? 'Noch kein Dokument-Zeitstempel.'
      : `${info.timeStamps} Dokument-Zeitstempel${
          info.lastStampAt ? `, letzter ${formatIsoDateTime(info.lastStampAt)} (laut Token)` : ''
        }.`,
    info.newestStamped
      ? 'Der neueste Stand ist gestempelt.'
      : 'Der neueste Stand ist noch nicht gestempelt.',
  ];
  return lines;
}
