import { useState } from 'react';
import {
  LOG_NOTICE,
  anchorStatusText,
  evidenceSerial,
  formatIsoDateTime,
  stampsOfMonth,
  changedDates,
  changeText,
  changesOfMonth,
  clockFromDate,
  dayToForm,
  formatDuration,
  formatIsoDate,
  markExported,
  DEVICE_KEY_TEXTS,
  monthLabel,
  monthOf,
  monthSummary,
  monthToPdf,
  moveWorkday,
  pdfFileName,
  reasonText,
  removeWorkday,
  rowTexts,
  runningPdfFileName,
  runningPdfLines,
  SAVE_TEXTS,
  shiftMonth,
  type WorkdayInput,
  willBeLogged,
} from '../logic/index.ts';
import { canShareFile, downloadFile, shareFile } from '../io/files.ts';
import { useBookApi } from './bookContext.ts';
import { DayForm } from './DayForm.tsx';
import { useDrafts } from './draftContext.ts';
import { useAnchoring } from './anchorContext.ts';
import { ClockWarning } from './ClockWarning.tsx';
import { useRunningPdf } from './runningPdfContext.ts';
import { useAskReason } from './promptContext.ts';
import { pdfAssets } from './pdfAssets.ts';
import { styles } from './styles.ts';

export function MonthPage() {
  const { book, getBook, apply, showError } = useBookApi();
  const anchoring = useAnchoring();
  const runningPdf = useRunningPdf();
  const askReason = useAskReason();
  const { drafts, setMonthDraft } = useDrafts();
  // a correction that was started before the page was left opens again where it was
  const resumed = drafts.monat && drafts.monat.date in book.days ? drafts.monat.date : undefined;
  const [month, setMonth] = useState(() => monthOf(resumed ?? clockFromDate(new Date()).date));
  const [editing, setEditingState] = useState<string | undefined>(resumed);
  const setEditing = (date: string | undefined) => {
    setEditingState(date);
    if (date === undefined) setMonthDraft(undefined);
  };
  const [info, setInfo] = useState<string | undefined>();
  const summary = monthSummary(book, month);
  const exportedAt = book.exportedMonths[month];
  const changed = changedDates(book, month);
  const monthChanges = changesOfMonth(book, month);
  const monthStamps = stampsOfMonth(book, month);
  const editingDay = editing === undefined ? undefined : book.days[editing];

  const running = runningPdf.months[month];
  const savedOut = runningPdf.saved.find((s) => s.month === month);

  /** Saves or shares the running monthly PDF as it is stored (nothing is added on the way). */
  const saveRunning = async (share: boolean) => {
    const pdf = running ? runningPdf.file(running.slot) : undefined;
    if (!pdf) return showError(SAVE_TEXTS.gone);
    const name = runningPdfFileName(month);
    try {
      if (share) {
        const file = new File([pdf as BlobPart], name, { type: 'application/pdf' });
        if (await shareFile(file, `Arbeitszeit ${monthLabel(month)} (laufend)`)) {
          setInfo('Die laufende Monatsdatei wurde weitergegeben.');
        }
      } else {
        downloadFile(name, 'application/pdf', pdf);
        setInfo(`Gespeichert als ${name} (Ordner „Downloads“).`);
      }
    } catch (error) {
      showError(
        `Die Datei konnte nicht weitergegeben werden: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const go = (delta: number) => {
    setMonth(shiftMonth(month, delta));
    setEditing(undefined);
    setInfo(undefined);
  };

  /** Asks for a reason when a day that is over is touched; null = cancelled. */
  const reasonFor = async (dates: string[]): Promise<{ today: string; reason?: string } | null> => {
    const today = clockFromDate(new Date()).date;
    if (!willBeLogged(dates, today)) return { today };
    const answer = await askReason(LOG_NOTICE);
    if (!answer) return null;
    return { today, ...(answer.reason ? { reason: answer.reason } : {}) };
  };

  const save = async (input: WorkdayInput): Promise<boolean> => {
    if (editing === undefined) return false;
    if (input.date !== editing && input.date in book.days) {
      if (!confirm(`Für den ${input.date} gibt es schon einen Eintrag. Ersetzen?`)) return false;
    }
    const ctx = await reasonFor([editing, input.date]);
    if (!ctx) return false;
    const ok = apply(moveWorkday(book, editing, input, new Date().toISOString(), ctx));
    if (ok) setEditing(undefined);
    return ok;
  };

  const remove = async (date: string) => {
    if (!confirm(`Den Eintrag vom ${date} löschen?`)) return;
    const ctx = await reasonFor([date]);
    if (ctx && apply(removeWorkday(book, date, new Date().toISOString(), ctx))) {
      setEditing(undefined);
    }
  };

  /** Makes the PDF, saves it (or shares it) and only then notes the month as exported. */
  const exportPdf = async (share: boolean) => {
    if (
      summary.openDays > 0 &&
      !confirm(
        `${summary.openDays} Tag(e) laufen noch und sind nicht in der Summe. Trotzdem exportieren?`,
      )
    ) {
      return;
    }
    // first the days that ended are sealed and a fresh external time stamp is tried; if that is not
    // possible the export goes on and the report says how things stand
    anchoring.sealNow();
    const round = await anchoring.anchorNow();
    const nowIso = new Date().toISOString();
    try {
      const pdf = await monthToPdf(getBook(), month, nowIso, pdfAssets());
      if (!pdf.ok) return showError(reasonText(pdf.reason));
      const name = pdfFileName(month);
      if (share) {
        const file = new File([pdf.value as BlobPart], name, { type: 'application/pdf' });
        if (!(await shareFile(file, `Arbeitszeit ${monthLabel(month)}`))) return;
      } else {
        downloadFile(name, 'application/pdf', pdf.value);
      }
      if (apply(markExported(getBook(), month, nowIso))) {
        const done = share
          ? 'Die Datei wurde weitergegeben.'
          : `Gespeichert als ${name} (Ordner „Downloads“).`;
        setInfo(
          round === 'failed'
            ? `${done} Es gab keinen frischen externen Zeitstempel; der Bericht nennt den Stand.`
            : done,
        );
      }
    } catch (error) {
      showError(
        `Der Export ist fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const canShare = canShareFile(new File([''], pdfFileName(month), { type: 'application/pdf' }));

  return (
    <div style={styles.page}>
      <h2>Monat</h2>
      <div style={styles.row}>
        <button type="button" style={styles.button} onClick={() => go(-1)}>
          ◀ Vormonat
        </button>
        <strong aria-live="polite">{monthLabel(month)}</strong>
        <button type="button" style={styles.button} onClick={() => go(1)}>
          Nächster Monat ▶
        </button>
      </div>

      {summary.rows.length === 0 ? (
        <p>Keine Einträge in diesem Monat.</p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              {['Datum', 'Kommen', 'Gehen', 'Pause', 'Arbeitszeit', 'Erfassung', ''].map((h, i) => (
                <th key={i} style={styles.cell}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => {
              const t = rowTexts(row);
              return (
                <tr key={row.date}>
                  <td style={styles.cell}>
                    {t.date}
                    {changed.has(row.date) && <em> (nachträglich geändert)</em>}
                  </td>
                  <td style={styles.cell}>{t.start}</td>
                  <td style={styles.cell}>{t.end}</td>
                  <td style={styles.cell}>{t.breaks}</td>
                  <td style={styles.cell}>{t.work}</td>
                  <td style={styles.cell}>{t.origin}</td>
                  <td style={styles.cell}>
                    <button
                      type="button"
                      style={styles.button}
                      onClick={() => setEditing(row.date)}
                    >
                      Bearbeiten
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p>
        <strong>Summe: {formatDuration(summary.workMinutes)} Std.</strong>
        {summary.openDays > 0 && ` (${summary.openDays} laufende(r) Tag(e) nicht enthalten)`}
      </p>

      {editingDay && (
        <section style={styles.card} aria-label="Tag bearbeiten">
          <h3>Tag bearbeiten</h3>
          <DayForm
            key={editingDay.date}
            value={
              drafts.monat?.date === editingDay.date ? drafts.monat.fields : dayToForm(editingDay)
            }
            onChange={(fields) => setMonthDraft({ date: editingDay.date, fields })}
            saveLabel="Änderung speichern"
            onSave={save}
            onCancel={() => setEditing(undefined)}
          />
          <p>
            <button
              type="button"
              style={styles.button}
              onClick={() => void remove(editingDay.date)}
            >
              Eintrag löschen
            </button>
          </p>
        </section>
      )}

      {monthChanges.length > 0 && (
        <section style={styles.card} aria-label="Nachträgliche Änderungen">
          <h3>Nachträgliche Änderungen</h3>
          <ul>
            {monthChanges.map((c, i) => {
              const t = changeText(c);
              return (
                <li key={i}>
                  <strong>{t.date}</strong> – {t.kind} am {t.when}
                  {t.link && ` (${t.link})`}
                  <br />
                  vorher: {t.before}
                  <br />
                  nachher: {t.after}
                  {t.reason && (
                    <>
                      <br />
                      Begründung: {t.reason}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section style={styles.card} aria-label="Zeitstempel">
        <h3>Zeitstempel</h3>
        <p data-state={anchoring.status.state} role="status">
          {anchorStatusText(anchoring.status)}
        </p>
        <ClockWarning />
        {anchoring.needsKey && (
          <p role="alert" data-device-key="missing">
            {DEVICE_KEY_TEXTS.missing} Den Geräteschlüssel tragen Sie unter „Einstellungen“ ein.
          </p>
        )}
        <p>
          Die internen Stempel stammen von der Geräteuhr und belegen keine Zeit; nur die externen
          Zeitstempel belegen sie. Die App kann nur stempeln lassen, solange sie geöffnet und online
          ist.
        </p>
        <button
          type="button"
          style={styles.button}
          disabled={!anchoring.serviceAvailable || anchoring.busy}
          onClick={() => void anchoring.anchorNow()}
        >
          Jetzt extern stempeln
        </button>
        <details style={{ marginTop: '0.75rem' }}>
          <summary>Stempelkette dieses Monats ({monthStamps.length})</summary>
          {monthStamps.length === 0 ? (
            <p>Keine Stempel in diesem Monat.</p>
          ) : (
            <div style={styles.scrollX}>
              <table style={{ ...styles.table, fontSize: '0.85em' }}>
                <thead>
                  <tr>
                    {['Nr.', 'Zeit (Geräteuhr), Art', 'Tag', 'Prüfsumme'].map((h) => (
                      <th key={h} style={styles.cell}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthStamps.map((s) => (
                    <tr key={s.n}>
                      <td style={styles.cell}>{s.n}</td>
                      <td style={styles.cell}>
                        {formatIsoDateTime(s.at)}
                        {s.skew && <em> (Uhr zurückgestellt)</em>}
                        <br />
                        {s.kind === 'seal' ? 'Abschluss' : 'Änderung'}
                      </td>
                      <td style={styles.cell}>{s.date}</td>
                      <td style={{ ...styles.cell, wordBreak: 'break-all' }}>
                        {s.hash.slice(0, 12)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
        <details style={{ marginTop: '0.75rem' }}>
          <summary>Externe Zeitstempel ({book.anchors.length})</summary>
          {book.anchors.length === 0 ? (
            <p>Noch kein externer Zeitstempel.</p>
          ) : (
            <div style={styles.scrollX}>
              <table style={{ ...styles.table, fontSize: '0.85em' }}>
                <thead>
                  <tr>
                    {['Dienst', 'Zeit laut Token (UTC)', 'bis Stempel', 'Seriennr.'].map((h) => (
                      <th key={h} style={styles.cell}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {book.anchors.map((a) => (
                    <tr key={a.coveredN}>
                      <td style={styles.cell}>{a.evidence.service}</td>
                      <td style={styles.cell}>{formatIsoDateTime(a.evidence.genTime)}</td>
                      <td style={styles.cell}>Nr. {a.coveredN}</td>
                      <td style={{ ...styles.cell, wordBreak: 'break-all' }}>
                        {evidenceSerial(a.evidence) ?? '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      </section>

      <section style={styles.card} aria-label="Laufendes Monats-PDF">
        <h3>Laufendes Monats-PDF</h3>
        <ClockWarning />
        <p>
          Nach jedem „Gehen“ (oder beim nächsten Start) bekommt die Monatsdatei eine neue Seite mit
          dem Stand bis zu diesem Tag und einen neuen Anhang; danach wird der neue Stand extern
          gestempelt. Frühere Seiten werden nie geändert. Die App behält nur die Datei des laufenden
          Monats und, bis zum 7. des Folgemonats, die des Vormonats; danach muss sie gespeichert
          werden (zum Beispiel für die Personalakte).
        </p>
        {savedOut && !running && <p>{SAVE_TEXTS.savedOut(savedOut.at)}</p>}
        <ul role="status">
          {runningPdfLines(running).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {running?.problem && (
          <p role="alert" style={styles.error}>
            {running.problem}
          </p>
        )}
        {running && running.changedAttachments.length > 0 && (
          <p role="alert" style={{ ...styles.error, color: '#c62828' }}>
            Achtung: Frühere Anhänge der Datei wurden entfernt oder verändert:{' '}
            {running.changedAttachments.join(', ')}. Die Datei ist so nicht mehr verlässlich.
          </p>
        )}
        {runningPdf.busy && <p>Die laufende Monatsdatei wird fortgeschrieben …</p>}
        {running && (
          <div style={styles.row}>
            <button type="button" style={styles.button} onClick={() => void saveRunning(false)}>
              Laufendes PDF speichern
            </button>
            {canShare && (
              <button type="button" style={styles.button} onClick={() => void saveRunning(true)}>
                Laufendes PDF teilen …
              </button>
            )}
          </div>
        )}
      </section>

      <section style={styles.card}>
        <h3>Für die Personalakte</h3>
        <p>
          Das PDF enthält die Tabelle, die nachträglichen Änderungen des Monats und, als Anhang,
          dieselben Daten als JSON zur Bestätigung (die Prüfsumme steht im PDF). Aus der App lässt
          sich keine Datei an eine E-Mail anhängen: bitte die gespeicherte Datei selbst mailen.
        </p>
        <div style={styles.row}>
          <button type="button" style={styles.button} onClick={() => void exportPdf(false)}>
            Monat als PDF speichern
          </button>
          {canShare && (
            <button type="button" style={styles.button} onClick={() => void exportPdf(true)}>
              PDF teilen …
            </button>
          )}
        </div>
        {info && <p role="status">{info}</p>}
        <p>
          {exportedAt
            ? `Dieser Monat wurde am ${formatIsoDate(exportedAt)} exportiert.`
            : 'Dieser Monat wurde noch nicht exportiert.'}
        </p>
      </section>
    </div>
  );
}
