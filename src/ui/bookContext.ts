import { createContext, useContext } from 'react';
import type { Result, TimeBook } from '../logic/index.ts';

export interface BookApi {
  book: TimeBook;
  /** The book as it is right now (also inside a function that was started earlier). */
  getBook(): TimeBook;
  /** Takes the result of a logic action: stores the new book, or shows the refusal. */
  apply(result: Result<TimeBook>): boolean;
  /** A message to show (a refusal or a storage error) until it is dismissed. */
  error: string | undefined;
  /**
   * A storage failure after the fact (the vault's background write): shown as a standing red banner that
   * cannot be dismissed, until a later write of the book is stored.
   */
  unsaved: string | undefined;
  /** Days whose stored state did not match the stamp chain when the book was loaded (`checkDaysAgainstChain`). */
  chainMismatch: readonly string[];
  showError(text: string): void;
  dismissError(): void;
}

export const BookContext = createContext<BookApi | undefined>(undefined);

export function useBookApi(): BookApi {
  const api = useContext(BookContext);
  if (!api) throw new Error('useBookApi outside of BookProvider');
  return api;
}
