import { useState } from 'react';
import {
  emptyBreak,
  parseDayForm,
  reasonText,
  type BreakFields,
  type DayFormFields,
  type WorkdayInput,
} from '../logic/index.ts';
import { useBookApi } from './bookContext.ts';
import { styles } from './styles.ts';

interface Props {
  initial: DayFormFields;
  saveLabel: string;
  /** Takes the day (the page decides what happens next; it may ask first). */
  onSave: (input: WorkdayInput) => unknown;
  onCancel?: () => void;
}

/** The entry form of one working day. Reads fields, shows what cannot be read; the rules are the logic's. */
export function DayForm({ initial, saveLabel, onSave, onCancel }: Props) {
  const { showError } = useBookApi();
  const [f, setF] = useState<DayFormFields>(initial);
  const set = <K extends keyof DayFormFields>(key: K, value: DayFormFields[K]) =>
    setF((old) => ({ ...old, [key]: value }));
  const setBreak = (i: number, change: Partial<BreakFields>) =>
    set(
      'breaks',
      f.breaks.map((b, k) => (k === i ? { ...b, ...change } : b)),
    );

  const submit = () => {
    const parsed = parseDayForm(f);
    if (!parsed.ok) return showError(reasonText(parsed.reason));
    onSave(parsed.value);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label style={styles.label}>
        Datum
        <input
          style={styles.field}
          type="date"
          value={f.date}
          onChange={(e) => set('date', e.target.value)}
        />
      </label>
      <div style={styles.row}>
        <label style={styles.label}>
          Kommen
          <input
            style={styles.field}
            type="time"
            value={f.start}
            onChange={(e) => set('start', e.target.value)}
          />
        </label>
        <label style={styles.label}>
          Gehen (leer, solange der Tag läuft)
          <input
            style={styles.field}
            type="time"
            value={f.end}
            onChange={(e) => set('end', e.target.value)}
          />
        </label>
      </div>
      <label style={{ ...styles.row, margin: '0 0 0.6rem' }}>
        <input
          type="checkbox"
          checked={f.nextDay}
          onChange={(e) => set('nextDay', e.target.checked)}
        />
        Gehen am Folgetag (Schicht über Mitternacht)
      </label>

      <fieldset style={{ ...styles.card, margin: '0 0 0.6rem' }}>
        <legend>Pausen</legend>
        {f.breaks.length === 0 && <p>Keine Pause eingetragen.</p>}
        {f.breaks.map((b, i) => (
          <div key={i} style={{ ...styles.row, margin: '0 0 0.5rem' }}>
            <select
              style={styles.field}
              aria-label={`Pause ${i + 1}: Art`}
              value={b.kind}
              onChange={(e) => setBreak(i, { kind: e.target.value === 'span' ? 'span' : 'length' })}
            >
              <option value="length">Dauer</option>
              <option value="span">Zeitraum</option>
            </select>
            {b.kind === 'length' ? (
              <label>
                Minuten{' '}
                <input
                  style={{ ...styles.field, width: '5rem' }}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={b.minutes}
                  onChange={(e) => setBreak(i, { minutes: e.target.value })}
                />
              </label>
            ) : (
              <>
                <label>
                  von{' '}
                  <input
                    style={styles.field}
                    type="time"
                    value={b.from}
                    onChange={(e) => setBreak(i, { from: e.target.value })}
                  />
                </label>
                <label>
                  bis{' '}
                  <input
                    style={styles.field}
                    type="time"
                    value={b.to}
                    onChange={(e) => setBreak(i, { to: e.target.value })}
                  />
                </label>
              </>
            )}
            <button
              type="button"
              style={styles.button}
              onClick={() =>
                set(
                  'breaks',
                  f.breaks.filter((_, k) => k !== i),
                )
              }
            >
              Pause entfernen
            </button>
          </div>
        ))}
        <button
          type="button"
          style={styles.button}
          onClick={() => set('breaks', [...f.breaks, emptyBreak()])}
        >
          Pause hinzufügen
        </button>
      </fieldset>

      <label style={styles.label}>
        Notiz (höchstens 200 Zeichen)
        <input
          style={styles.field}
          type="text"
          maxLength={200}
          value={f.note}
          onChange={(e) => set('note', e.target.value)}
        />
      </label>
      <div style={styles.row}>
        <button type="submit" style={styles.button}>
          {saveLabel}
        </button>
        {onCancel && (
          <button type="button" style={styles.button} onClick={onCancel}>
            Abbrechen
          </button>
        )}
      </div>
    </form>
  );
}
