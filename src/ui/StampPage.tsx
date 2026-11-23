import {
  breakEnd,
  breakStart,
  clockFromDate,
  stampEnabled,
  stampIn,
  stampOut,
  stampState,
  stampStatus,
  type Result,
  type TimeBook,
} from '../logic/index.ts';
import { useBookApi } from './bookContext.ts';
import { styles } from './styles.ts';

type Action = (
  book: TimeBook,
  clock: ReturnType<typeof clockFromDate>,
  nowIso: string,
) => Result<TimeBook>;

/** Button label and logic function per stamp action (data, so a new action is a new row). */
const BUTTONS: { key: 'in' | 'breakStart' | 'breakEnd' | 'out'; label: string; run: Action }[] = [
  { key: 'in', label: 'Kommen', run: stampIn },
  { key: 'breakStart', label: 'Pause Beginn', run: breakStart },
  { key: 'breakEnd', label: 'Pause Ende', run: breakEnd },
  { key: 'out', label: 'Gehen', run: stampOut },
];

export function StampPage() {
  const { book, apply } = useBookApi();
  const now = new Date();
  const clock = clockFromDate(now);
  const enabled = stampEnabled(book, clock);
  const state = stampState(book);

  return (
    <div style={styles.page}>
      <h2>Stempeln</h2>
      <p aria-live="polite" data-state={state}>
        {stampStatus(book, clock)}
      </p>
      <div style={{ ...styles.row, gap: '0.75rem' }}>
        {BUTTONS.map(({ key, label, run }) => (
          <button
            key={key}
            type="button"
            style={{ ...styles.button, minWidth: '9rem', opacity: enabled[key] ? 1 : 0.4 }}
            disabled={!enabled[key]}
            onClick={() => {
              const at = new Date();
              apply(run(book, clockFromDate(at), at.toISOString()));
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <p style={{ marginTop: '1rem' }}>
        Die Uhrzeit kommt von der Uhr dieses Geräts. Vergessen zu stempeln? Im Bereich „Tag
        eingeben“ lässt sich jeder Tag eintragen oder korrigieren.
      </p>
    </div>
  );
}
