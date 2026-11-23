import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { fail, ok, type MonthKey, type Result, type TimeBook } from './model.ts';
import { monthSummary } from './summary.ts';
import { formatDuration, formatIsoDate, isMonthKey } from './time.ts';
import { monthToXml } from './xml.ts';
import { monthLabel, rowTexts } from './view.ts';

/** File name of the attached data file. */
export const attachmentName = (month: MonthKey): string => `zeiterfassung-${month}.xml`;

/** What the page shows, as plain texts (testable without drawing). */
export interface MonthLayout {
  title: string;
  employee: string;
  header: string[];
  rows: string[][];
  total: string;
  openNote: string | null;
  attachmentNote: string;
  created: string;
}

export const COLUMN_HEADERS = [
  'Datum',
  'Kommen',
  'Gehen',
  'Pause',
  'Arbeitszeit',
  'Erfassung',
  'Notiz',
];

export function monthLayout(book: TimeBook, month: MonthKey, createdIso: string): MonthLayout {
  const s = monthSummary(book, month);
  return {
    title: `Arbeitszeit ${monthLabel(month)}`,
    employee: book.settings.employeeLabel,
    header: COLUMN_HEADERS,
    rows: s.rows.map((r) => {
      const t = rowTexts(r);
      return [t.date, t.start, t.end, t.breaks, t.work, t.origin, r.note];
    }),
    total: `Summe Arbeitszeit: ${formatDuration(s.workMinutes)} Std. an ${s.rows.length - s.openDays} Tag(en)`,
    openNote:
      s.openDays > 0
        ? `Hinweis: ${s.openDays} Tag(e) laufen noch und sind nicht in der Summe.`
        : null,
    attachmentNote: `Die angehängte Datei ${attachmentName(month)} enthält dieselben Angaben maschinenlesbar und dient nur der Bestätigung der lesbaren Daten.`,
    created: `Erstellt am ${formatIsoDate(createdIso)}`,
  };
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const ROW_HEIGHT = 15;
const SIZE = 9;
const NO_ENTRIES = 'Keine Einträge in diesem Monat.';
/** Column widths in points; the last column (Notiz) takes the rest. */
const WIDTHS = [88, 42, 54, 38, 62, 52];

/** Keeps only characters the standard font can show (anything else becomes „?“). */
function printable(text: string, font: PDFFont): string {
  const known = new Set(font.getCharacterSet());
  let out = '';
  for (const ch of text) out += known.has(ch.codePointAt(0) ?? -1) ? ch : '?';
  return out;
}

/** Shortens a text with „…“ until it fits the width (the ellipsis is not in WinAnsi: three dots). */
function fit(text: string, font: PDFFont, width: number): string {
  if (font.widthOfTextAtSize(text, SIZE) <= width) return text;
  let cut = text;
  while (cut.length > 0 && font.widthOfTextAtSize(`${cut}...`, SIZE) > width)
    cut = cut.slice(0, -1);
  return `${cut}...`;
}

/**
 * The monthly summary as a PDF: the readable table, and the XML of `monthToXml` embedded as an
 * attachment that only serves to confirm the readable data. Neutral metadata (no tool names).
 */
export async function monthToPdf(
  book: TimeBook,
  month: MonthKey,
  createdIso: string,
): Promise<Result<Uint8Array>> {
  if (!isMonthKey(month)) return fail('bad-month');
  const xml = monthToXml(book, month, createdIso);
  if (!xml.ok) return xml;
  const layout = monthLayout(book, month, createdIso);
  const created = new Date(createdIso);

  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(layout.title);
  doc.setSubject('Monatszusammenfassung Arbeitszeit');
  doc.setAuthor('');
  doc.setKeywords([]);
  doc.setCreator('Zeiterfassung');
  doc.setProducer('Zeiterfassung');
  doc.setLanguage('de-DE');
  doc.setCreationDate(created);
  doc.setModificationDate(created);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = (t: string) => printable(t, font);
  const xs = WIDTHS.reduce<number[]>((acc, w) => [...acc, (acc.at(-1) ?? MARGIN) + w], [MARGIN]);
  const noteWidth = A4.width - MARGIN - (xs.at(-1) ?? MARGIN);

  // A month has at most 31 days of one line each, so everything fits on one page.
  const page: PDFPage = doc.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;
  page.drawText(text(layout.title), { x: MARGIN, y, size: 16, font: bold });
  y -= 20;
  if (layout.employee) {
    page.drawText(text(`Mitarbeiter/in: ${layout.employee}`), { x: MARGIN, y, size: 10, font });
    y -= 16;
  }
  y -= 6;
  layout.header.forEach((h, i) =>
    page.drawText(text(h), { x: xs[i] ?? MARGIN, y, size: SIZE, font: bold }),
  );
  y -= 4;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4.width - MARGIN, y },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  y -= ROW_HEIGHT - 3;

  for (const row of layout.rows) {
    row.forEach((cell, i) => {
      const width = i < WIDTHS.length ? (WIDTHS[i] as number) - 4 : noteWidth;
      page.drawText(fit(text(cell), font, width), { x: xs[i] ?? MARGIN, y, size: SIZE, font });
    });
    y -= ROW_HEIGHT;
  }
  if (layout.rows.length === 0) {
    page.drawText(text(NO_ENTRIES), { x: MARGIN, y, size: SIZE, font });
    y -= ROW_HEIGHT;
  }

  y -= 8;
  page.drawText(text(layout.total), { x: MARGIN, y, size: 11, font: bold });
  y -= 16;
  if (layout.openNote) {
    page.drawText(text(layout.openNote), { x: MARGIN, y, size: SIZE, font });
    y -= 14;
  }
  page.drawText(text(layout.attachmentNote), {
    x: MARGIN,
    y,
    size: 8,
    font,
    maxWidth: A4.width - 2 * MARGIN,
    lineHeight: 10,
  });
  y -= 24;
  page.drawText(text(layout.created), { x: MARGIN, y, size: 8, font });

  await doc.attach(new TextEncoder().encode(xml.value), attachmentName(month), {
    mimeType: 'application/xml',
    description: 'Maschinenlesbare Daten zur Bestätigung der lesbaren Angaben',
    creationDate: created,
    modificationDate: created,
  });
  // plain objects (no object streams): the attachment stays visible to simple readers and archives
  return ok(await doc.save({ useObjectStreams: false }));
}
