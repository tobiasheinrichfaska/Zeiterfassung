import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Vault } from 'local-vault';
import {
  BOOK_SLOT,
  checkDaysAgainstChain,
  loadBook,
  reasonText,
  serializeBook,
  type Loaded,
  type Result,
  type TimeBook,
} from '../logic/index.ts';
import { watchSaves } from '../io/saveWatch.ts';
import { BookContext, type BookApi } from './bookContext.ts';
import { styles } from './styles.ts';
import { useLatest } from './useLatest.ts';

/**
 * Holds the book: reads it from the open vault once, writes every change back, and shows every
 * refusal and every storage error. A slot that does not pass the rules is shown and never written.
 */
export function BookProvider({ vault, children }: { vault: Vault; children: ReactNode }) {
  const [loaded] = useState<Loaded>(() => loadBook(vault.readSlot(BOOK_SLOT)));
  const [book, setBook] = useState<TimeBook | undefined>(
    loaded.kind === 'ok' ? loaded.book : undefined,
  );
  const [error, setError] = useState<string | undefined>();
  // checked once on load: the app's own writes keep days and chain in step
  const [chainMismatch] = useState<readonly string[]>(() =>
    loaded.kind === 'ok' ? checkDaysAgainstChain(loaded.book) : [],
  );
  const latest = useLatest<TimeBook | undefined>(book);
  const getBook = latest.get as () => TimeBook;

  // a write that failed after the fact (full storage …): a standing banner until the book is stored again
  const [unsaved, setUnsaved] = useState<string | undefined>();
  const [watch] = useState(() => watchSaves(vault, setUnsaved));
  useEffect(() => watch.start(), [watch]);

  const apply = useCallback(
    (result: Result<TimeBook>): boolean => {
      if (!result.ok) {
        setError(reasonText(result.reason));
        return false;
      }
      const refused = vault.writeSlot(BOOK_SLOT, serializeBook(result.value));
      if (refused !== undefined) {
        setError(refused);
        return false;
      }
      watch.wrote();
      latest.set(result.value);
      setBook(result.value);
      setError(undefined);
      return true;
    },
    [vault, latest, watch],
  );

  const api = useMemo<BookApi | undefined>(
    () =>
      book === undefined
        ? undefined
        : {
            book,
            getBook,
            apply,
            error,
            unsaved,
            chainMismatch,
            showError: setError,
            dismissError: () => setError(undefined),
          },
    [book, getBook, apply, error, unsaved, chainMismatch],
  );

  if (loaded.kind === 'unreadable' || api === undefined) {
    return (
      <main style={styles.page}>
        <h1>Zeiterfassung</h1>
        <p role="alert" style={styles.error}>
          Die gespeicherten Zeiten können nicht gelesen werden:{' '}
          {reasonText(loaded.kind === 'unreadable' ? loaded.reason : 'bad-backup')}
        </p>
        <p>
          Die Daten bleiben unverändert auf diesem Gerät, es wird nichts überschrieben. Bitte die
          App nicht weiter benutzen und die Sicherungsdatei bereithalten.
        </p>
      </main>
    );
  }
  return <BookContext.Provider value={api}>{children}</BookContext.Provider>;
}
