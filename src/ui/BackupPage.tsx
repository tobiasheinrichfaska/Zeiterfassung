import { useState, type ChangeEvent } from 'react';
import {
  backupFileName,
  clockFromDate,
  exportBackup,
  importBackup,
  monthLabel,
  ok as okResult,
  purgeExpired,
  reasonText,
  replaceQuestion,
  retentionReport,
} from '../logic/index.ts';
import { downloadFile, readFileText } from '../io/files.ts';
import { useBookApi } from './bookContext.ts';
import { styles } from './styles.ts';

export function BackupPage() {
  const { book, apply, showError } = useBookApi();
  const [info, setInfo] = useState<string | undefined>();
  const today = clockFromDate(new Date()).date;
  const report = retentionReport(book, today);

  const download = () => {
    downloadFile(backupFileName(today), 'application/json', exportBackup(book));
    setInfo(
      `Gespeichert als ${backupFileName(today)} (Ordner „Downloads“). Bitte an einem sicheren Ort aufbewahren.`,
    );
  };

  const restore = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const read = importBackup(await readFileText(file));
      if (!read.ok)
        return showError(
          `Die Datei „${file.name}“ kann nicht eingespielt werden: ${reasonText(read.reason)}`,
        );
      if (!confirm(replaceQuestion(book, read.value))) return;
      if (apply(okResult(read.value))) setInfo('Die Sicherung wurde eingespielt.');
    } catch (error) {
      showError(
        `Die Datei konnte nicht gelesen werden: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const purge = () => {
    const names = report.purgeable.map(monthLabel).join(', ');
    if (!confirm(`Diese exportierten Monate jetzt von diesem Gerät löschen: ${names}?`)) return;
    if (apply(okResult(purgeExpired(book, today)))) setInfo('Die Monate wurden gelöscht.');
  };

  return (
    <div style={styles.page}>
      <h2>Sicherung</h2>
      <section style={styles.card}>
        <h3>Sicherungsdatei</h3>
        <p>
          Die Sicherung enthält alle Zeiten im Klartext. Sie ist nicht verschlüsselt: bitte sicher
          aufbewahren.
        </p>
        <div style={styles.row}>
          <button type="button" style={styles.button} onClick={download}>
            Sicherung speichern
          </button>
          <label style={styles.button}>
            Sicherung einspielen …
            <input
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => void restore(e)}
            />
          </label>
        </div>
        {info && <p role="status">{info}</p>}
      </section>

      <section style={styles.card}>
        <h3>Aufbewahrung</h3>
        {report.blocked.length > 0 && (
          <p role="note" style={styles.error}>
            Fällig, aber nicht exportiert (bleiben erhalten):{' '}
            {report.blocked.map(monthLabel).join(', ')}. Bitte im Bereich „Monat“ als PDF speichern.
          </p>
        )}
        {report.purgeable.length > 0 ? (
          <>
            <p>Fällig und exportiert: {report.purgeable.map(monthLabel).join(', ')}.</p>
            <button type="button" style={styles.button} onClick={purge}>
              Fällige exportierte Monate löschen
            </button>
          </>
        ) : (
          report.blocked.length === 0 && <p>Nichts ist fällig.</p>
        )}
      </section>
    </div>
  );
}
