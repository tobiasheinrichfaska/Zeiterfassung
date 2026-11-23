import { emptyBook, type Reason, type TimeBook } from './model.ts';
import { exportBackup, importBackup } from './backup.ts';

/** The one vault slot that holds the book. */
export const BOOK_SLOT = 'book';

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
