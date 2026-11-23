import { useBookApi } from './bookContext.ts';
import { styles } from './styles.ts';

/** Temporary shell until the wheel navigation and the pages follow. */
export function App() {
  const { book, error, dismissError } = useBookApi();
  return (
    <main style={styles.page}>
      <h1>Zeiterfassung</h1>
      {error && (
        <p role="alert" style={styles.error}>
          {error}{' '}
          <button type="button" style={styles.button} onClick={dismissError}>
            Gelesen
          </button>
        </p>
      )}
      <p>{Object.keys(book.days).length} Arbeitstage gespeichert.</p>
    </main>
  );
}
