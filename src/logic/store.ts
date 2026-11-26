import { emptyBook, type Reason, type TimeBook } from './model.ts';
import { exportBackup, importBackup } from './backup.ts';
import { DRAFT_SLOT } from './draft.ts';
import { DEVICE_KEY_SLOT } from './deviceKey.ts';
import { PDF_SLOTS } from './runningPlan.ts';

/** The one vault slot that holds the book. */
export const BOOK_SLOT = 'book';

/** Every slot of the app's vault (fixed for good: the vault is configured with exactly these). */
export const VAULT_SLOTS: readonly string[] = [
  BOOK_SLOT,
  DRAFT_SLOT,
  DEVICE_KEY_SLOT,
  ...PDF_SLOTS,
];

/**
 * The most plain characters all slots together may hold when a running PDF is written (book text, both
 * PDF slots, draft, device key slot). The vault stores each slot encrypted as base64url, about 4/3 of
 * the plain text, so 3.5 M plain characters are about 4.7 M stored ones: below the about 5 M characters a
 * browser's local storage holds for one site, with room for the book to grow. A running PDF that would
 * pass it is not written (its stored file must be saved): the book always has room.
 */
export const VAULT_BUDGET = 3_500_000;

/** Whether `next` may go into `slot` when the other slots hold `others` plain characters together. */
export const vaultFits = (others: number, next: string, budget: number = VAULT_BUDGET): boolean =>
  others + next.length <= budget;

export type Loaded =
  | { kind: 'ok'; book: TimeBook }
  /** Stored text that does not pass the rules: shown, never overwritten by an empty book. */
  | { kind: 'unreadable'; reason: Reason };

/** Reads the stored text of the slot (null = nothing stored yet: a fresh, empty book). */
export function loadBook(raw: string | null): Loaded {
  if (raw === null) return { kind: 'ok', book: emptyBook() };
  const read = importBackup(raw);
  return read.ok ? { kind: 'ok', book: read.value } : { kind: 'unreadable', reason: read.reason };
}

/** The text written to the slot; the same format as the backup file. */
export const serializeBook = (book: TimeBook): string => exportBackup(book);
