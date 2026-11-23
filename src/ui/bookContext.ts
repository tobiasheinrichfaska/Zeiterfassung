import { createContext, useContext } from 'react';
import type { Result, TimeBook } from '../logic/index.ts';

export interface BookApi {
  book: TimeBook;
  /** Takes the result of a logic action: stores the new book, or shows the refusal. */
  apply(result: Result<TimeBook>): boolean;
  /** A message to show (a refusal or a storage error) until it is dismissed. */
  error: string | undefined;
  showError(text: string): void;
  dismissError(): void;
}

export const BookContext = createContext<BookApi | undefined>(undefined);

export function useBookApi(): BookApi {
  const api = useContext(BookContext);
  if (!api) throw new Error('useBookApi outside of BookProvider');
  return api;
}
