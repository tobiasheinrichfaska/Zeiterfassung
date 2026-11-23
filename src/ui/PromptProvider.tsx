import { useCallback, useState, type ReactNode } from 'react';
import { LIMITS } from '../logic/index.ts';
import { PromptContext, type AskReason } from './promptContext.ts';
import { Z, styles } from './styles.ts';

interface Pending {
  notice: string;
  resolve: (answer: { reason: string } | null) => void;
}

/** The question before a change to a day that is over: the notice and an optional reason. */
export function PromptProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | undefined>();
  const [reason, setReason] = useState('');

  const ask = useCallback<AskReason>(
    (notice) =>
      new Promise((resolve) => {
        setReason('');
        setPending({ notice, resolve });
      }),
    [],
  );

  const answer = (value: { reason: string } | null) => {
    pending?.resolve(value);
    setPending(undefined);
  };

  return (
    <PromptContext.Provider value={ask}>
      {children}
      {pending && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Änderung eines abgelaufenen Tages"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: Z.prompt,
            background: 'rgba(0,0,0,0.5)',
            display: 'grid',
            placeItems: 'center',
            padding: '1rem',
          }}
        >
          <form
            style={{ ...styles.card, background: 'Canvas', color: 'CanvasText', maxWidth: '30rem' }}
            onSubmit={(e) => {
              e.preventDefault();
              answer({ reason: reason.trim() });
            }}
          >
            <p>
              <strong>{pending.notice}</strong>
            </p>
            <label style={styles.label}>
              Begründung (freiwillig, höchstens {LIMITS.maxReasonChars} Zeichen)
              <input
                style={styles.field}
                type="text"
                maxLength={LIMITS.maxReasonChars}
                value={reason}
                autoFocus
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div style={styles.row}>
              <button type="submit" style={styles.button}>
                Änderung speichern
              </button>
              <button type="button" style={styles.button} onClick={() => answer(null)}>
                Abbrechen
              </button>
            </div>
          </form>
        </div>
      )}
    </PromptContext.Provider>
  );
}
