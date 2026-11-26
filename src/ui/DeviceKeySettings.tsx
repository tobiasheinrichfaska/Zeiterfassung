import { useState } from 'react';
import { DEVICE_KEY_TEXTS, deviceKeyView } from '../logic/index.ts';
import { useAnchoring } from './anchorContext.ts';
import { useBookApi } from './bookContext.ts';
import { styles } from './styles.ts';

/**
 * „Geräteschlüssel“: the employee pastes the one text he or she was given (`<kennung>.<schlüssel>`). It is
 * checked, imported as a key the page cannot read back, and stored encrypted in the vault. Afterwards only
 * the key id is shown; the field is emptied and the text is never shown again.
 */
export function DeviceKeySettings() {
  const anchoring = useAnchoring();
  const { showError } = useBookApi();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const view = deviceKeyView(anchoring.deviceKeyId, anchoring.deviceKeyProblem);

  const enter = async () => {
    setBusy(true);
    try {
      const refused = await anchoring.enterDeviceKey(text);
      if (refused !== undefined) {
        setNote(null);
        return showError(refused);
      }
      setText('');
      setNote(null);
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (
      !confirm('Den Geräteschlüssel von diesem Gerät entfernen? Danach wird nicht mehr gestempelt.')
    ) {
      return;
    }
    const refused = anchoring.removeDeviceKey();
    if (refused !== undefined) return showError(refused);
    setNote(DEVICE_KEY_TEXTS.removed);
  };

  return (
    <form
      style={styles.card}
      aria-label="Geräteschlüssel"
      onSubmit={(e) => {
        e.preventDefault();
        void enter();
      }}
    >
      <h3>Geräteschlüssel</h3>
      <p role="status" data-device-key={anchoring.deviceKeyId === null ? 'none' : 'set'}>
        {anchoring.deviceKeyId === null
          ? DEVICE_KEY_TEXTS.missing
          : DEVICE_KEY_TEXTS.stored(anchoring.deviceKeyId)}
      </p>
      {anchoring.deviceKeyProblem && <p role="alert">{anchoring.deviceKeyProblem}</p>}
      {view.note && <p role="status">{view.note}</p>}
      {note && <p role="status">{note}</p>}
      <label style={styles.label}>
        {anchoring.deviceKeyId === null
          ? 'Geräteschlüssel einfügen'
          : 'Anderen Geräteschlüssel einfügen'}
        <input
          style={styles.field}
          type="password"
          name="geraeteschluessel"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p>
        Den Geräteschlüssel erhalten Sie von der Stelle, die den Zeitstempeldienst betreibt: ein
        Text aus Kennung, Punkt und Schlüssel. Er bleibt verschlüsselt auf diesem Gerät und wird
        nach dem Speichern nicht mehr angezeigt. Ohne ihn werden die Zeiten weiter erfasst, aber
        nicht extern gestempelt.
      </p>
      <button type="submit" style={styles.button} disabled={busy || text.trim() === ''}>
        Schlüssel speichern
      </button>{' '}
      {view.canRemove && (
        <button type="button" style={styles.button} onClick={remove}>
          Schlüssel entfernen
        </button>
      )}
    </form>
  );
}
