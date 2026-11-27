import { useState } from 'react';
import {
  SAVE_TEXTS,
  monthLabel,
  runningPdfFileName,
  runningPdfLines,
  saveRequestText,
  clockFromDate,
  savePromptView,
  type PdfSaveRequest,
} from '../logic/index.ts';
import { canShareFile, downloadFile, shareFile } from '../io/files.ts';
import { useBookApi } from './bookContext.ts';
import { useRunningPdf } from './runningPdfContext.ts';
import { StampPage } from './StampPage.tsx';
import { Z, styles } from './styles.ts';

/** One file to save: save or share it, then confirm; only the confirmation removes it from the vault. */
function SaveCard({ request }: { request: PdfSaveRequest }) {
  const api = useRunningPdf();
  const { showError } = useBookApi();
  const [savedLength, setSavedLength] = useState<number | undefined>();
  const [info, setInfo] = useState<string | undefined>();
  const today = clockFromDate(new Date()).date;
  const name = runningPdfFileName(request.month);
  const fileInfo = api.months[request.month];
  const shownInfo = fileInfo?.slot === request.slot ? fileInfo : undefined;
  const canShare = canShareFile(new File([''], name, { type: 'application/pdf' }));

  const save = async (share: boolean) => {
    const pdf = api.file(request.slot);
    if (!pdf) return showError(SAVE_TEXTS.gone);
    try {
      if (share) {
        const file = new File([pdf as BlobPart], name, { type: 'application/pdf' });
        if (!(await shareFile(file, `Arbeitszeit ${monthLabel(request.month)} (laufend)`))) return;
        setInfo(SAVE_TEXTS.shared);
      } else {
        downloadFile(name, 'application/pdf', pdf);
        setInfo(SAVE_TEXTS.saved(name));
      }
      setSavedLength(pdf.length);
    } catch (error) {
      showError(
        `Die Datei konnte nicht weitergegeben werden: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const confirmSaved = async () => {
    if (savedLength === undefined) return;
    if (!confirm(SAVE_TEXTS.confirmQuestion(request.month))) return;
    const refused = await api.release(request.slot, request.month, savedLength);
    if (refused !== undefined) {
      setSavedLength(undefined);
      return showError(refused);
    }
    setInfo(SAVE_TEXTS.removed(request.month));
  };

  return (
    <section style={styles.card} aria-label={`Monatsdatei ${monthLabel(request.month)}`}>
      <h3>{monthLabel(request.month)}</h3>
      <p>{saveRequestText(request, today)}</p>
      {shownInfo && (
        <ul>
          {runningPdfLines(shownInfo).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {shownInfo?.problem && (
        <p role="alert" style={styles.error}>
          {shownInfo.problem}
        </p>
      )}
      {api.busy && <p>{SAVE_TEXTS.busy}</p>}
      <div style={styles.row}>
        <button
          type="button"
          style={styles.button}
          disabled={api.busy}
          onClick={() => void save(false)}
        >
          {SAVE_TEXTS.saveButton}
        </button>
        {canShare && (
          <button
            type="button"
            style={styles.button}
            disabled={api.busy}
            onClick={() => void save(true)}
          >
            {SAVE_TEXTS.shareButton}
          </button>
        )}
        <button
          type="button"
          style={styles.button}
          disabled={savedLength === undefined || api.busy}
          onClick={() => void confirmSaved()}
        >
          {SAVE_TEXTS.confirmButton}
        </button>
      </div>
      {savedLength === undefined && <p>{SAVE_TEXTS.confirmHint}</p>}
      {info && <p role="status">{info}</p>}
    </section>
  );
}

const overlay = {
  position: 'fixed',
  inset: 0,
  zIndex: Z.save,
  background: 'Canvas',
  color: 'CanvasText',
  overflowY: 'auto',
  padding: '1rem',
} as const;

/**
 * The save prompt of the monthly files. Forced (a file past its week, an older one, one that grew too
 * large): it covers every page and cannot be closed until the file is saved and confirmed — the stamp
 * clock stays usable inside it, so recording times is never blocked. A reminder (the previous month in
 * its first week): a small banner that opens the same cards and can be put
 * off until the next start.
 */
export function SavePrompt() {
  const { plan } = useRunningPdf();
  const [open, setOpen] = useState(false);
  const [later, setLater] = useState(false);
  const view = savePromptView(plan);
  if (view.kind === 'none') return null;
  const { notes } = view;

  if (view.kind === 'forced') {
    return (
      <div role="dialog" aria-modal="true" aria-label={SAVE_TEXTS.forcedTitle} style={overlay}>
        <div style={styles.page}>
          <h2>{SAVE_TEXTS.forcedTitle}</h2>
          <p>{SAVE_TEXTS.forcedIntro}</p>
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
          {view.requests.map((r) => (
            <SaveCard key={`${r.slot}:${r.month}`} request={r} />
          ))}
        </div>
        <section
          aria-label={SAVE_TEXTS.stampHeading}
          style={{ borderTop: '1px solid currentColor' }}
        >
          <StampPage />
        </section>
      </div>
    );
  }

  if (later) return null;
  const reminders = view.kind === 'reminder' ? view.requests : [];
  if (!open) {
    return (
      <div
        role="status"
        style={{
          ...styles.error,
          border: '2px solid currentColor',
          position: 'fixed',
          left: 8,
          right: 8,
          top: 8,
          zIndex: Z.save,
          background: 'Canvas',
          color: 'CanvasText',
        }}
      >
        {notes.map((n) => (
          <p key={n}>{n}</p>
        ))}
        {reminders.length > 0 && (
          <>
            {SAVE_TEXTS.reminderTitle}: {reminders.map((r) => monthLabel(r.month)).join(', ')}{' '}
            <button type="button" style={styles.button} onClick={() => setOpen(true)}>
              {SAVE_TEXTS.saveButton} …
            </button>{' '}
          </>
        )}
        <button type="button" style={styles.button} onClick={() => setLater(true)}>
          {SAVE_TEXTS.laterButton}
        </button>
      </div>
    );
  }
  return (
    <div role="dialog" aria-label={SAVE_TEXTS.reminderTitle} style={overlay}>
      <div style={styles.page}>
        <h2>{SAVE_TEXTS.reminderTitle}</h2>
        {notes.map((n) => (
          <p key={n}>{n}</p>
        ))}
        {reminders.map((r) => (
          <SaveCard key={`${r.slot}:${r.month}`} request={r} />
        ))}
        <button type="button" style={styles.button} onClick={() => setOpen(false)}>
          {SAVE_TEXTS.closeButton}
        </button>
      </div>
    </div>
  );
}
