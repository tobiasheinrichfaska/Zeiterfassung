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
 * Where the running PDFs live (decision 2026-11-24): PDFs are kept **outside** the app, as files the
 * employee saves. The vault holds at most two: the current month's and the previous month's, in two
 * fixed slots that name no month (`local-vault` knows its slots from the start). Each file says itself
 * which month it is (its start attachment, `runningPdfState`). After the employee saved a file and
 * confirmed it, its slot holds a short marker (`gespeichert:JJJJ-MM:<time>`) instead, so the month is not
 * started again.
 */
export const PDF_SLOTS = ['monatspdf-a', 'monatspdf-b'] as const;
export type PdfSlot = (typeof PDF_SLOTS)[number];

/**
 * The most a slot may hold, in characters of its text (the PDF as Base64; about 900 KB of PDF). The vault
 * keeps everything in the browser's localStorage (about 5 million characters for all of it) and stores a
 * slot encrypted, about a third longer again: two full slots take about 3.2 million, which leaves room for
 * the book (it has priority). A state that would not fit is not written; the stored file must be saved.
 */
export const PDF_SLOT_LIMIT = 1_200_000;

/** Whether the text of a PDF fits into a slot (`limit` only differs in tests). */
export const pdfFitsSlot = (text: string, limit = PDF_SLOT_LIMIT): boolean => text.length <= limit;

/** The last day of the new month on which the previous month's file may stay without a forced save. */
export const PDF_KEEP_DAYS = 7;

const SAVED_RE = /^gespeichert:(\d{4}-\d{2}):(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)$/;

/** The marker of a month whose file was saved by the employee and removed from the vault. */
export const savedMarker = (month: MonthKey, atIso: string): string =>
  `gespeichert:${month}:${atIso}`;

/** `zeiterfassung-2026-11-laufend.pdf`. */
export const runningPdfFileName = (month: MonthKey): string => `zeiterfassung-${month}-laufend.pdf`;

/** The stored text of a running PDF: the file as standard Base64 (the vault stores text). */
export const encodeRunningPdf = (pdf: Uint8Array): string => bytesToBase64(pdf);

export type StoredRunningPdf =
  | { kind: 'none' }
  | { kind: 'pdf'; pdf: Uint8Array }
  /** The employee saved this month's file and confirmed it; the file is no longer here. */
  | { kind: 'saved'; month: MonthKey; at: string }
  /** Something is stored but it is no PDF: shown, never overwritten. */
  | { kind: 'unreadable' };

/** Reads a slot's text. Nothing (or the empty text a deleted month leaves) is `none`. */
export function decodeRunningPdf(text: string | null): StoredRunningPdf {
  if (text === null || text === '') return { kind: 'none' };
  const saved = SAVED_RE.exec(text);
  if (saved && isMonthKey(saved[1] ?? '')) {
    return { kind: 'saved', month: saved[1] ?? '', at: saved[2] ?? '' };
  }
  const pdf = base64ToBytes(text);
  if (pdf === null || pdf.length < 5) return { kind: 'unreadable' };
  const head = String.fromCharCode(...pdf.subarray(0, 5));
  return head === '%PDF-' ? { kind: 'pdf', pdf } : { kind: 'unreadable' };
}

/** What a slot holds, as far as the plan needs it (the I/O layer reads the PDF's month). */
export type PdfSlotContent =
  | { kind: 'empty' }
  | { kind: 'pdf'; month: MonthKey }
  | { kind: 'saved'; month: MonthKey }
  | { kind: 'unreadable' };

/** A file the employee must (forced) or should (reminder) save before it leaves the vault. */
export interface PdfSaveRequest {
  slot: string;
  month: MonthKey;
  mode: 'reminder' | 'forced';
  /** Why: the previous month's week is over or running, an older month, a second file of a month, or a state that did not fit. */
  why: 'previous' | 'older' | 'too-large' | 'duplicate';
}

/** Where a month's file is kept: an existing file, or the slot to start it in. */
export interface PdfSlotUse {
  month: MonthKey;
  slot: PdfSlot;
  exists: boolean;
}

export interface PdfSlotPlan {
  /** The current month's slot; null when it has none (`currentWaits` or `currentSaved` says why). */
  current: PdfSlotUse | null;
  /** The previous month's slot (its file, or within the first week a free slot to start it in). */
  previous: PdfSlotUse | null;
  /** No free slot for the current month: an unsaved older file is in the way (it is never overwritten). */
  currentWaits: boolean;
  /** The current month's file was already saved out (after it grew too large): it is not started again. */
  currentSaved: boolean;
  /** Files to save, forced ones first. */
  save: PdfSaveRequest[];
  /** Slots that hold something unreadable (never touched). */
  unreadable: PdfSlot[];
  /** Files of a later month than today (device clock set back): kept untouched, not used. */
  ahead: { slot: PdfSlot; month: MonthKey }[];
}

/**
 * Which slot holds what, and what must leave the vault (pure; decision 2026-11-24):
 * - the current month's file stays; the previous month's file stays until the 7th of the new month
 *   (from the 1st a reminder to save it), from the 8th on it must be saved (forced); any older file must be
 *   saved at once (forced);
 * - a free slot is an empty one or one whose file was saved (its marker); a third month never enters:
 *   when the current month needs a slot and none is free, it waits until the older file is saved;
 * - the previous month is started only within its first week, and only when no marker says it was saved;
 * - `tooLarge`: slots whose next state did not fit (`PDF_SLOT_LIMIT`): their stored file must be saved.
 */
export function pdfSlotPlan(
  today: DateKey,
  slots: Readonly<Record<PdfSlot, PdfSlotContent>>,
  tooLarge: readonly PdfSlot[] = [],
): PdfSlotPlan {
  const current = monthOf(today);
  const previous = shiftMonth(current, -1);
  const withinWeek = Number(today.slice(8, 10)) <= PDF_KEEP_DAYS;
  const save: PdfSaveRequest[] = [];
  const unreadable: PdfSlot[] = [];
  const ahead: PdfSlotPlan['ahead'] = [];
  let cur: PdfSlotUse | null = null;
  let prev: PdfSlotUse | null = null;
  const free: { slot: PdfSlot; saved?: MonthKey }[] = [];

  for (const slot of PDF_SLOTS) {
    const c = slots[slot];
    if (c.kind === 'unreadable') unreadable.push(slot);
    else if (c.kind === 'empty') free.push({ slot });
    else if (c.kind === 'saved') free.push({ slot, saved: c.month });
    else if (c.month === current && cur === null) cur = { month: current, slot, exists: true };
    else if (c.month === previous && prev === null) prev = { month: previous, slot, exists: true };
    else if (c.month === current || c.month === previous)
      save.push({ slot, month: c.month, mode: 'forced', why: 'duplicate' });
    else if (monthIndex(c.month) > monthIndex(current)) ahead.push({ slot, month: c.month });
    else save.push({ slot, month: c.month, mode: 'forced', why: 'older' });
  }
  if (prev !== null) {
    save.push({
      slot: prev.slot,
      month: previous,
      mode: withinWeek ? 'reminder' : 'forced',
      why: 'previous',
    });
  }
  for (const slot of tooLarge) {
    const c = slots[slot];
    if (c.kind !== 'pdf') continue;
    const i = save.findIndex((r) => r.slot === slot);
    const request: PdfSaveRequest = { slot, month: c.month, mode: 'forced', why: 'too-large' };
    if (i >= 0) save[i] = request;
    else save.push(request);
  }

  const savedMonths = new Set(free.flatMap((f) => (f.saved ? [f.saved] : [])));
  // a slot without a marker first, then one whose marker names a month that no longer matters
  const rank = (f: (typeof free)[number]) =>
    f.saved === undefined ? 0 : f.saved === previous || f.saved === current ? 2 : 1;
  free.sort((a, b) => rank(a) - rank(b));
  const currentSaved = cur === null && savedMonths.has(current);
  let currentWaits = false;
  if (cur === null && !currentSaved) {
    const f = free.shift();
    if (f) cur = { month: current, slot: f.slot, exists: false };
    else currentWaits = true;
  }
  if (prev === null && withinWeek && !savedMonths.has(previous)) {
    const f = free.find((x) => x.saved !== current);
    if (f) prev = { month: previous, slot: f.slot, exists: false };
  }
  save.sort((a, b) => (a.mode === b.mode ? 0 : a.mode === 'forced' ? -1 : 1));
  return { current: cur, previous: prev, currentWaits, currentSaved, save, unreadable, ahead };
}

/** Whether something must be saved before the app can be used again (the blocking prompt). */
export const forcedSave = (plan: PdfSlotPlan): PdfSaveRequest[] =>
  plan.save.filter((r) => r.mode === 'forced');

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
  /** The slot that holds the file. */
  slot: string;
  /** The next state did not fit into the slot (`PDF_SLOT_LIMIT`): the stored file must be saved. */
  tooLarge: boolean;
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

/** The lines of the section „Laufendes Monats-PDF“ (German). */
export function runningPdfLines(info: RunningPdfInfo | undefined): string[] {
  if (!info) return ['Für diesen Monat liegt keine laufende Monatsdatei in der App.'];
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
