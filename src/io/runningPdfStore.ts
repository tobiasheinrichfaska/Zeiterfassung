import type { Vault } from 'local-vault';
import {
  RUNNING_PDF_TEXTS,
  decodeRunningPdf,
  encodeRunningPdf,
  pdfFitsSlot,
  savedMarker,
  type MonthKey,
  type StoredRunningPdf,
} from '../logic/index.ts';

/**
 * The running monthly PDFs in the vault: two fixed slots (`monatspdf-a`, `monatspdf-b`), the file as
 * Base64, encrypted like every slot; the file names its month. `local-vault` cannot remove a slot, so an
 * emptied slot is an empty text, and a slot whose file was saved out holds the marker of that month.
 * The slots of the earlier build (`monatspdf-JJJJ-MM`) are read the same way.
 */
export type RunningPdfRead = StoredRunningPdf | { kind: 'error'; text: string };

/** Reads a slot; a slot the vault could not open is an error (it is never written). */
export function readPdfSlot(vault: Pick<Vault, 'readSlot'>, slot: string): RunningPdfRead {
  try {
    return decodeRunningPdf(vault.readSlot(slot));
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Writes a file into a slot, unless its text is longer than `PDF_SLOT_LIMIT` (the book has priority):
 * then nothing is written and `{ tooLarge: true }` comes back. Otherwise the vault's refusal text, or
 * undefined.
 */
export function writePdfSlot(
  vault: Pick<Vault, 'writeSlot'>,
  slot: string,
  pdf: Uint8Array,
  limit?: number,
): string | { tooLarge: true } | undefined {
  const text = encodeRunningPdf(pdf);
  if (!pdfFitsSlot(text, limit)) return { tooLarge: true };
  return vault.writeSlot(slot, text);
}

/** The text of a refusal of `writePdfSlot`. */
export const refusalText = (r: string | { tooLarge: true }): string =>
  typeof r === 'string' ? r : RUNNING_PDF_TEXTS.tooLarge;

/** After the employee saved a month's file: the slot keeps only the marker of that month. */
export function markPdfSaved(
  vault: Pick<Vault, 'writeSlot'>,
  slot: string,
  month: MonthKey,
  atIso: string,
): string | undefined {
  return vault.writeSlot(slot, savedMarker(month, atIso));
}

/** Empties a slot (nothing in it, no marker); returns the vault's refusal text, or undefined. */
export function clearPdfSlot(
  vault: Pick<Vault, 'writeSlot' | 'readSlot'>,
  slot: string,
): string | undefined {
  if (readPdfSlot(vault, slot).kind === 'none') return undefined;
  return vault.writeSlot(slot, '');
}
