import { useState } from 'react';
import { LockSettings } from 'local-vault';
import { parseSettingsForm, reasonText, updateSettings } from '../logic/index.ts';
import { useBookApi } from './bookContext.ts';
import { styles } from './styles.ts';
import { ALLOWED_RELAYS } from './relayConfig.ts';
import { vault } from './vault.ts';

export function SettingsPage() {
  const { book, apply, showError } = useBookApi();
  const [label, setLabel] = useState(book.settings.employeeLabel);
  const [months, setMonths] = useState(String(book.settings.retentionMonths));
  const [relay, setRelay] = useState(book.settings.timestampRelay);
  const [saved, setSaved] = useState(false);

  const save = () => {
    const parsed = parseSettingsForm(label, months, relay, ALLOWED_RELAYS);
    if (!parsed.ok) return showError(reasonText(parsed.reason));
    setSaved(apply(updateSettings(book, parsed.value)));
  };

  return (
    <div style={styles.page}>
      <h2>Einstellungen</h2>
      <form
        style={styles.card}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label style={styles.label}>
          Name oder Personalnummer (steht auf der Monatsübersicht)
          <input
            style={styles.field}
            type="text"
            maxLength={100}
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setSaved(false);
            }}
          />
        </label>
        <label style={styles.label}>
          Aufbewahrung in Monaten (1 bis 120)
          <input
            style={styles.field}
            type="number"
            inputMode="numeric"
            min={1}
            max={120}
            value={months}
            onChange={(e) => {
              setMonths(e.target.value);
              setSaved(false);
            }}
          />
        </label>
        <label style={styles.label}>
          Externer Zeitstempeldienst (Weiterreicher)
          <select
            style={styles.field}
            value={relay}
            onChange={(e) => {
              setRelay(e.target.value);
              setSaved(false);
            }}
          >
            <option value="">Aus (kein externer Zeitstempel)</option>
            {ALLOWED_RELAYS.map((address) => (
              <option key={address} value={address}>
                {address}
              </option>
            ))}
            {relay !== '' && !ALLOWED_RELAYS.includes(relay) && (
              <option value={relay}>{relay} (in dieser Fassung nicht erlaubt)</option>
            )}
          </select>
        </label>
        {ALLOWED_RELAYS.length === 0 && (
          <p role="note">
            Diese Fassung kennt keinen Weiterreicher: Die Seite darf nichts ins Netz senden, ein
            externer Zeitstempeldienst kann hier nicht eingeschaltet werden.
          </p>
        )}
        <p>
          Der Weiterreicher sieht den Zeitpunkt und die Netzadresse der Anfrage, nie die Zeiten oder
          Notizen (es wird nur eine Prüfsumme gesendet). Zur Auswahl stehen nur Adressen, die beim
          Bauen dieser Fassung erlaubt wurden.
        </p>
        <p>
          Ein Monat wird so viele Monate nach seinem Ende von diesem Gerät gelöscht, aber nur, wenn
          er als PDF exportiert wurde und Sie das Löschen im Bereich „Sicherung“ bestätigen.
        </p>
        <button type="submit" style={styles.button}>
          Speichern
        </button>
        {saved && <p role="status">Gespeichert.</p>}
      </form>
      <LockSettings vault={vault} />
    </div>
  );
}
