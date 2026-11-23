import { useState } from 'react';
import {
  clockFromDate,
  dayToForm,
  formatDuration,
  formatIsoDate,
  markExported,
  monthLabel,
  monthOf,
  monthSummary,
  monthToPdf,
  moveWorkday,
  pdfFileName,
  reasonText,
  removeWorkday,
  rowTexts,
  shiftMonth,
  type WorkdayInput,
} from '../logic/index.ts';
import { canShareFile, downloadFile, shareFile } from '../io/files.ts';
import { useBookApi } from './bookContext.ts';
import { DayForm } from './DayForm.tsx';
import { styles } from './styles.ts';

export function MonthPage() {
  const { book, apply, showError } = useBookApi();
  const [month, setMonth] = useState(() => monthOf(clockFromDate(new Date()).date));
  const [editing, setEditing] = useState<string | undefined>();
  const [info, setInfo] = useState<string | undefined>();
  const summary = monthSummary(book, month);
  const exportedAt = book.exportedMonths[month];
  const editingDay = editing === undefined ? undefined : book.days[editing];

  const go = (delta: number) => {
    setMonth(shiftMonth(month, delta));
    setEditing(undefined);
    setInfo(undefined);
  };

  const save = (input: WorkdayInput): boolean => {
    if (editing === undefined) return false;
    if (input.date !== editing && input.date in book.days) {
      if (!confirm(`Für den ${input.date} gibt es schon einen Eintrag. Ersetzen?`)) return false;
    }
    const ok = apply(moveWorkday(book, editing, input, new Date().toISOString()));
    if (ok) setEditing(undefined);
    return ok;
  };

  const remove = (date: string) => {
    if (!confirm(`Den Eintrag vom ${date} löschen?`)) return;
    if (apply(removeWorkday(book, date))) setEditing(undefined);
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
    const nowIso = new Date().toISOString();
    try {
      const pdf = await monthToPdf(book, month, nowIso);
      if (!pdf.ok) return showError(reasonText(pdf.reason));
      const name = pdfFileName(month);
      if (share) {
        const file = new File([pdf.value as BlobPart], name, { type: 'application/pdf' });
        if (!(await shareFile(file, `Arbeitszeit ${monthLabel(month)}`))) return;
      } else {
        downloadFile(name, 'application/pdf', pdf.value);
      }
      if (apply(markExported(book, month, nowIso))) {
        setInfo(
          share
            ? 'Die Datei wurde weitergegeben.'
            : `Gespeichert als ${name} (Ordner „Downloads“).`,
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
                  <td style={styles.cell}>{t.date}</td>
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
            initial={dayToForm(editingDay)}
            saveLabel="Änderung speichern"
            onSave={save}
            onCancel={() => setEditing(undefined)}
          />
          <p>
            <button type="button" style={styles.button} onClick={() => remove(editingDay.date)}>
              Eintrag löschen
            </button>
          </p>
        </section>
      )}

      <section style={styles.card}>
        <h3>Für die Personalakte</h3>
        <p>
          Das PDF enthält die Tabelle und, als Anhang, dieselben Daten als XML zur Bestätigung. Aus
          der App lässt sich keine Datei an eine E-Mail anhängen: bitte die gespeicherte Datei
          selbst mailen.
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
