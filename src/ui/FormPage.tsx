import { useState } from 'react';
import {
  clockFromDate,
  dayToForm,
  emptyForm,
  openDay,
  setWorkday,
  type WorkdayInput,
} from '../logic/index.ts';
import { useBookApi } from './bookContext.ts';
import { DayForm } from './DayForm.tsx';
import { styles } from './styles.ts';

/** Enter or correct one day. Starts on a running day (to fix a forgotten „Gehen“), otherwise on today. */
export function FormPage() {
  const { book, apply } = useBookApi();
  const [saved, setSaved] = useState<string | undefined>();
  const [version, setVersion] = useState(0);
  const running = openDay(book);
  const today = clockFromDate(new Date()).date;
  const initial = running ? dayToForm(running) : emptyForm(today);

  const save = (input: WorkdayInput): boolean => {
    const exists = input.date in book.days;
    if (exists && !confirm(`Für den ${input.date} gibt es schon einen Eintrag. Ersetzen?`)) {
      return false;
    }
    const ok = apply(setWorkday(book, input, new Date().toISOString()));
    if (ok) {
      setSaved(`Gespeichert: ${input.date}`);
      setVersion((v) => v + 1);
    }
    return ok;
  };

  return (
    <div style={styles.page}>
      <h2>Tag eingeben</h2>
      {running && (
        <p>Der Tag vom {running.date} läuft noch. Hier lässt er sich beenden oder korrigieren.</p>
      )}
      {saved && <p role="status">{saved}</p>}
      <DayForm key={version} initial={initial} saveLabel="Speichern" onSave={save} />
    </div>
  );
}
