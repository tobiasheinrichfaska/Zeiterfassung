import type { Vault } from 'local-vault';
import {
  RUNNING_PDF_TEXTS,
  VAULT_SLOTS,
  vaultFits,
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

/** Plain characters the other slots of the vault hold now (an unreadable slot counts as empty). */
export function otherSlotsChars(vault: Pick<Vault, 'readSlot'>, slot: string): number {
  let sum = 0;
  for (const other of VAULT_SLOTS) {
    if (other === slot) continue;
    try {
      sum += vault.readSlot(other)?.length ?? 0;
    } catch {
      // a slot the vault cannot open: its size is not known here
    }
  }
  return sum;
}

/**
 * Writes a file into a slot, unless its text is longer than `PDF_SLOT_LIMIT`, or the whole vault (the
 * other slots plus this text) would pass `VAULT_BUDGET` (the book has priority): then nothing is written
 * and `{ tooLarge: true }` comes back. Otherwise the vault's refusal text, or undefined.
 */
export function writePdfSlot(
  vault: Pick<Vault, 'writeSlot' | 'readSlot'>,
  slot: string,
  pdf: Uint8Array,
  limit?: number,
  budget?: number,
): string | { tooLarge: true } | undefined {
  const text = encodeRunningPdf(pdf);
  if (!pdfFitsSlot(text, limit)) return { tooLarge: true };
  if (!vaultFits(otherSlotsChars(vault, slot), text, budget)) return { tooLarge: true };
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
