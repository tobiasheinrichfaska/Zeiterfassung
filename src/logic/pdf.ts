import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { fail, ok, type MonthKey, type Result, type TimeBook } from './model.ts';
import { changeText, changesOfMonth, type ChangeText } from './changes.ts';
import { monthSummary } from './summary.ts';
import { formatDuration, formatIsoDate, isMonthKey } from './time.ts';
import { attachmentName, monthToJson, sha256Hex } from './report.ts';
import { monthLabel, rowTexts } from './view.ts';

/** What the pages show, as plain texts (testable without drawing). */
export interface MonthLayout {
  title: string;
  employee: string;
  header: string[];
  rows: string[][];
  total: string;
  openNote: string | null;
  changesTitle: string;
  changes: ChangeText[];
  attachmentNote: string;
  hashLine: string;
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

export function monthLayout(
  book: TimeBook,
  month: MonthKey,
  createdIso: string,
  hash: string,
): MonthLayout {
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
    changesTitle: 'Nachträgliche Änderungen',
    changes: changesOfMonth(book, month).map(changeText),
    attachmentNote: `Die angehängte Datei ${attachmentName(month)} enthält dieselben Angaben maschinenlesbar und dient nur der Bestätigung der lesbaren Daten.`,
    hashLine: `Prüfsumme der angehängten Datei (SHA-256): ${hash}`,
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

/** Keeps only characters the font can show (anything else becomes „?“). */
function printable(text: string, font: PDFFont): string {
  const known = new Set(font.getCharacterSet());
  let out = '';
  for (const ch of text) out += known.has(ch.codePointAt(0) ?? -1) ? ch : '?';
  return out;
}

/** Shortens a text with three dots until it fits the width. */
function fit(text: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let cut = text;
  while (cut.length > 0 && font.widthOfTextAtSize(`${cut}...`, size) > width)
    cut = cut.slice(0, -1);
  return `${cut}...`;
}

/** Breaks a text into lines that fit the width (a word longer than a line is cut). */
export function wrapText(text: string, width: number, measure: (t: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  const push = () => {
    if (line) lines.push(line);
    line = '';
  };
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word;
    while (measure(rest) > width) {
      let cut = rest.length - 1;
      while (cut > 1 && measure(rest.slice(0, cut)) > width) cut -= 1;
      push();
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    const next = line ? `${line} ${rest}` : rest;
    if (measure(next) <= width) line = next;
    else {
      push();
      line = rest;
    }
  }
  push();
  return lines.length > 0 ? lines : [''];
}

/**
 * The monthly summary as a PDF: the readable table, the logged changes of the month, and the JSON of
 * `monthToJson` embedded as an attachment that only serves to confirm the readable data (its SHA-256
 * is printed on the last page). Neutral metadata (no tool names).
 */
export async function monthToPdf(
  book: TimeBook,
  month: MonthKey,
  createdIso: string,
): Promise<Result<Uint8Array>> {
  if (!isMonthKey(month)) return fail('bad-month');
  const json = monthToJson(book, month, createdIso);
  if (!json.ok) return json;
  const hash = await sha256Hex(json.value);
  const layout = monthLayout(book, month, createdIso, hash);
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
  const contentWidth = A4.width - 2 * MARGIN;

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = doc.addPage([A4.width, A4.height]);
    pages.push(page);
    y = A4.height - MARGIN;
  };
  /** Starts a new page when `height` points do not fit above the bottom margin. */
  const ensure = (height: number) => {
    if (y - height < MARGIN + 24) newPage();
  };
  const line = (t: string, size = SIZE, f: PDFFont = font, indent = 0) => {
    ensure(size + 4);
    page.drawText(text(t), { x: MARGIN + indent, y, size, font: f });
    y -= size + 4;
  };
  const paragraph = (t: string, size = SIZE, f: PDFFont = font, indent = 0) => {
    const lines = wrapText(text(t), contentWidth - indent, (s) => f.widthOfTextAtSize(s, size));
    lines.forEach((l) => line(l, size, f, indent));
  };

  newPage();
  page.drawText(text(layout.title), { x: MARGIN, y, size: 16, font: bold });
  y -= 20;
  if (layout.employee) {
    line(`Mitarbeiter/in: ${layout.employee}`, 10);
    y -= 2;
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
    ensure(ROW_HEIGHT);
    row.forEach((cell, i) => {
      const width = i < WIDTHS.length ? (WIDTHS[i] as number) - 4 : noteWidth;
      page.drawText(fit(text(cell), font, SIZE, width), {
        x: xs[i] ?? MARGIN,
        y,
        size: SIZE,
        font,
      });
    });
    y -= ROW_HEIGHT;
  }
  if (layout.rows.length === 0) line(NO_ENTRIES);

  y -= 8;
  line(layout.total, 11, bold);
  y -= 4;
  if (layout.openNote) line(layout.openNote);

  if (layout.changes.length > 0) {
    y -= 10;
    ensure(60);
    line(layout.changesTitle, 11, bold);
    for (const c of layout.changes) {
      ensure(48);
      y -= 3;
      line(`${c.date} – ${c.kind} am ${c.when}${c.link ? ` (${c.link})` : ''}`, SIZE, bold);
      paragraph(`vorher: ${c.before}`, SIZE, font, 8);
      paragraph(`nachher: ${c.after}`, SIZE, font, 8);
      if (c.reason) paragraph(`Begründung: ${c.reason}`, SIZE, font, 8);
    }
  }

  y -= 10;
  ensure(60);
  paragraph(layout.attachmentNote, 8);
  line(layout.hashLine, 8);
  line(layout.created, 8);

  pages.forEach((p, i) =>
    p.drawText(text(`Seite ${i + 1} von ${pages.length}`), {
      x: A4.width - MARGIN - 60,
      y: 24,
      size: 8,
      font,
    }),
  );

  await doc.attach(new TextEncoder().encode(json.value), attachmentName(month), {
    mimeType: 'application/json',
    description: `Maschinenlesbare Daten zur Bestätigung der lesbaren Angaben. SHA-256: ${hash}`,
    creationDate: created,
    modificationDate: created,
  });
  // plain objects (no object streams): the attachment stays visible to simple readers and archives
  return ok(await doc.save({ useObjectStreams: false }));
}
