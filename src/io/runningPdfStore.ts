import type { Vault } from 'local-vault';
import {
  decodeRunningPdf,
  encodeRunningPdf,
  runningPdfSlot,
  RUNNING_PDF_TEXTS,
  type MonthKey,
  type StoredRunningPdf,
} from '../logic/index.ts';

/**
 * The running monthly PDFs in the vault: one slot per month (`monatspdf-JJJJ-MM`), the file as Base64,
 * encrypted like every slot. `local-vault` cannot remove a slot, so a deleted month is an empty text.
 */
export type RunningPdfRead = StoredRunningPdf | { kind: 'error'; text: string };

/** Reads a month's file; a slot the vault could not open (or a month outside the span) is an error. */
export function readRunningPdf(vault: Pick<Vault, 'readSlot'>, month: MonthKey): RunningPdfRead {
  const slot = runningPdfSlot(month);
  if (slot === null) return { kind: 'none' };
  try {
    return decodeRunningPdf(vault.readSlot(slot));
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
  }
}

/** Writes a month's file; returns the vault's refusal text, or undefined. */
export function writeRunningPdf(
  vault: Pick<Vault, 'writeSlot'>,
  month: MonthKey,
  pdf: Uint8Array,
): string | undefined {
  const slot = runningPdfSlot(month);
  if (slot === null) return RUNNING_PDF_TEXTS.outOfSpan;
  return vault.writeSlot(slot, encodeRunningPdf(pdf));
}

/** Deletes a month's file (an empty slot); returns the vault's refusal text, or undefined. */
export function deleteRunningPdf(
  vault: Pick<Vault, 'writeSlot' | 'readSlot'>,
  month: MonthKey,
): string | undefined {
  const slot = runningPdfSlot(month);
  if (slot === null) return undefined;
  if (readRunningPdf(vault, month).kind === 'none') return undefined;
  return vault.writeSlot(slot, '');
}
