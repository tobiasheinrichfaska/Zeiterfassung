import { useState, type ChangeEvent } from 'react';
import {
  BACKUP_CRYPTO,
  backupFileName,
  checkNewPassword,
  clockFromDate,
  exportBackup,
  isEncryptedBackup,
  monthLabel,
  ok as okResult,
  purgeExpired,
  readBackupFile,
  reasonText,
  replaceQuestion,
  retentionReport,
  sealBackup,
} from '../logic/index.ts';
import { downloadFile, readFileText } from '../io/files.ts';
import { useBookApi } from './bookContext.ts';
import { useRunningPdf } from './runningPdfContext.ts';
import { styles } from './styles.ts';

const randomBytes = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length));

/** A file chosen for restoring that is encrypted and waits for its password. */
interface WaitingFile {
  name: string;
  text: string;
}

export function BackupPage() {
  const { book, apply, showError } = useBookApi();
  const runningPdf = useRunningPdf();
  const [info, setInfo] = useState<string | undefined>();
  const [encrypt, setEncrypt] = useState(true);
  const [password, setPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<WaitingFile | undefined>();
  const [restorePassword, setRestorePassword] = useState('');
  const today = clockFromDate(new Date()).date;
  const report = retentionReport(book, today);

  const saveFile = (name: string, text: string) => {
    downloadFile(name, 'application/json', text);
    setInfo(
      `Gespeichert als ${name} (Ordner „Downloads“). Bitte an einem sicheren Ort aufbewahren.`,
    );
  };

  const download = async () => {
    if (!encrypt) {
      if (
        !confirm(
          'Die Sicherung wird unverschlüsselt gespeichert: Wer die Datei findet, kann alle Zeiten lesen. Trotzdem unverschlüsselt speichern?',
        )
      ) {
        return;
      }
      return saveFile(backupFileName(today, false), exportBackup(book));
    }
    const problem = checkNewPassword(password, repeated);
    if (problem) return showError(reasonText(problem));
    setBusy(true);
    try {
      const sealed = await sealBackup(exportBackup(book), password, randomBytes);
      if (!sealed.ok) return showError(reasonText(sealed.reason));
      saveFile(backupFileName(today, true), sealed.value);
      setPassword('');
      setRepeated('');
    } catch (error) {
      showError(
        `Die Sicherung konnte nicht verschlüsselt werden: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  /** Reads the file (asks for the password first when it is encrypted) and, after a question, replaces the data. */
  const restoreFrom = async (name: string, text: string, pw?: string) => {
    setBusy(true);
    try {
      const read = await readBackupFile(text, pw);
      if (!read.ok) {
        if (read.reason === 'password-required') return setWaiting({ name, text });
        if (read.reason === 'wrong-password') setWaiting({ name, text });
        return showError(
          `Die Datei „${name}“ kann nicht eingespielt werden: ${reasonText(read.reason)}`,
        );
      }
      setWaiting(undefined);
      setRestorePassword('');
      if (!confirm(replaceQuestion(book, read.value))) return;
      if (apply(okResult(read.value))) setInfo('Die Sicherung wurde eingespielt.');
    } catch (error) {
      showError(
        `Die Datei konnte nicht gelesen werden: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const text = await readFileText(file);
      if (isEncryptedBackup(text)) {
        setWaiting({ name: file.name, text });
        setRestorePassword('');
      } else {
        await restoreFrom(file.name, text);
      }
    } catch (error) {
      showError(
        `Die Datei konnte nicht gelesen werden: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const purge = () => {
    const names = report.purgeable.map(monthLabel).join(', ');
    if (!confirm(`Diese exportierten Monate jetzt von diesem Gerät löschen: ${names}?`)) return;
    if (!apply(okResult(purgeExpired(book, today)))) return;
    // the running monthly PDFs of these months go with them
    const refused = runningPdf.forget(report.purgeable);
    if (refused !== undefined) return showError(refused);
    setInfo('Die Monate wurden gelöscht.');
  };

  return (
    <div style={styles.page}>
      <h2>Sicherung</h2>
      <section style={styles.card}>
        <h3>Sicherung speichern</h3>
        <label style={{ ...styles.row, margin: '0 0 0.5rem' }}>
          <input type="radio" name="art" checked={encrypt} onChange={() => setEncrypt(true)} />
          Mit Passwort verschlüsseln (empfohlen)
        </label>
        {encrypt && (
          <>
            <label style={styles.label}>
              Passwort (mindestens {BACKUP_CRYPTO.minPasswordChars} Zeichen)
              <input
                style={styles.field}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label style={styles.label}>
              Passwort wiederholen
              <input
                style={styles.field}
                type="password"
                autoComplete="new-password"
                value={repeated}
                onChange={(e) => setRepeated(e.target.value)}
              />
            </label>
            <p>
              Ohne das Passwort lässt sich die Sicherung nicht öffnen. Es wird nirgends gespeichert.
            </p>
          </>
        )}
        <label style={{ ...styles.row, margin: '0 0 0.5rem' }}>
          <input type="radio" name="art" checked={!encrypt} onChange={() => setEncrypt(false)} />
          Unverschlüsselt speichern
        </label>
        {!encrypt && (
          <p role="note" style={styles.error}>
            Achtung: Eine unverschlüsselte Sicherung enthält alle Zeiten im Klartext.
          </p>
        )}
        <button type="button" style={styles.button} disabled={busy} onClick={() => void download()}>
          Sicherung speichern
        </button>
        {info && <p role="status">{info}</p>}
      </section>

      <section style={styles.card}>
        <h3>Sicherung einspielen</h3>
        <label style={styles.button}>
          Datei wählen …
          <input
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => void choose(e)}
          />
        </label>
        {waiting && (
          <form
            style={{ marginTop: '0.75rem' }}
            onSubmit={(e) => {
              e.preventDefault();
              void restoreFrom(waiting.name, waiting.text, restorePassword);
            }}
          >
            <p>Die Datei „{waiting.name}“ ist verschlüsselt. Bitte das Passwort eingeben.</p>
            <label style={styles.label}>
              Passwort
              <input
                style={styles.field}
                type="password"
                autoComplete="current-password"
                value={restorePassword}
                onChange={(e) => setRestorePassword(e.target.value)}
              />
            </label>
            <div style={styles.row}>
              <button type="submit" style={styles.button} disabled={busy}>
                Öffnen und einspielen
              </button>
              <button type="button" style={styles.button} onClick={() => setWaiting(undefined)}>
                Abbrechen
              </button>
            </div>
          </form>
        )}
      </section>

      <section style={styles.card}>
        <h3>Aufbewahrung</h3>
        {report.blocked.length > 0 && (
          <p role="note" style={styles.error}>
            Fällig, aber nicht (vollständig) exportiert, bleiben erhalten:{' '}
            {report.blocked.map(monthLabel).join(', ')}.
            {report.stale.length > 0 &&
              ` Nach dem Export verändert: ${report.stale.map(monthLabel).join(', ')}.`}{' '}
            Bitte im Bereich „Monat“ als PDF speichern.
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
