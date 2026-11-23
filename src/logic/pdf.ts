import fontkit from '@pdf-lib/fontkit';
import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  rgb,
  type PDFFont,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib';
import { fail, ok, type MonthKey, type Result, type TimeBook } from './model.ts';
import { changeText, changesOfMonth, type ChangeText } from './changes.ts';
import { monthSummary } from './summary.ts';
import { formatDuration, formatIsoDate, isMonthKey } from './time.ts';
import { attachmentName, monthToJson } from './report.ts';
import { sha256Hex } from './sha256.ts';
import { monthLabel, rowTexts } from './view.ts';
import { keepSupported } from './chars.ts';
import { srgbIccProfile } from './icc.ts';

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

/** Text is always painted in DeviceRGB black: the PDF/A output intent is an RGB profile. */
const BLACK = rgb(0, 0, 0);
const drawBlack = (
  page: PDFPage,
  text: string,
  options: Parameters<PDFPage['drawText']>[1],
): void => page.drawText(text, { ...options, color: BLACK });

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const ROW_HEIGHT = 15;
const SIZE = 9;
const NO_ENTRIES = 'Keine Einträge in diesem Monat.';
/** Column widths in points; the last column (Notiz) takes the rest. */
const WIDTHS = [88, 42, 54, 38, 62, 52];

const charsets = new WeakMap<PDFFont, Set<number>>();

/** Characters the embedded font cannot show become „?“ (see `keepSupported`). */
function printable(text: string, font: PDFFont): string {
  let known = charsets.get(font);
  if (!known) {
    known = new Set(font.getCharacterSet());
    charsets.set(font, known);
  }
  const set = known;
  return keepSupported(text, (cp) => set.has(cp));
}

/** Shortens a text with three dots until it fits the width (binary search on the cut position). */
function fit(text: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (font.widthOfTextAtSize(`${text.slice(0, mid)}...`, size) <= width) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low)}...`;
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

/** The font files the PDF embeds (the PDF/A rule: no standard fonts without an embedded copy). */
export interface PdfAssets {
  fontRegular: Uint8Array;
  fontBold: Uint8Array;
}

const xmlEscape = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `2026-12-01T06:00:00.000Z` → `2026-12-01T06:00:00Z` (the XMP date form). */
const xmpDate = (iso: string): string => `${iso.slice(0, 19)}Z`;

/** The XMP packet: PDF/A-3 part and conformance B, and the Info entries again (they must agree). */
export function xmpPacket(info: {
  title: string;
  subject: string;
  producer: string;
  creatorTool: string;
  createdIso: string;
}): string {
  const date = xmpDate(info.createdIso);
  return (
    `<?xpacket begin="${String.fromCharCode(0xfeff)}" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n' +
    ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
    '  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">\n' +
    '   <pdfaid:part>3</pdfaid:part>\n' +
    '   <pdfaid:conformance>B</pdfaid:conformance>\n' +
    '  </rdf:Description>\n' +
    '  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
    `   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(info.title)}</rdf:li></rdf:Alt></dc:title>\n` +
    `   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(info.subject)}</rdf:li></rdf:Alt></dc:description>\n` +
    '   <dc:language><rdf:Bag><rdf:li>de-DE</rdf:li></rdf:Bag></dc:language>\n' +
    '  </rdf:Description>\n' +
    '  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">\n' +
    `   <pdf:Producer>${xmlEscape(info.producer)}</pdf:Producer>\n` +
    '  </rdf:Description>\n' +
    '  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">\n' +
    `   <xmp:CreatorTool>${xmlEscape(info.creatorTool)}</xmp:CreatorTool>\n` +
    `   <xmp:CreateDate>${date}</xmp:CreateDate>\n` +
    `   <xmp:ModifyDate>${date}</xmp:ModifyDate>\n` +
    `   <xmp:MetadataDate>${date}</xmp:MetadataDate>\n` +
    '  </rdf:Description>\n' +
    ' </rdf:RDF>\n' +
    '</x:xmpmeta>\n' +
    '<?xpacket end="w"?>'
  );
}

/** A deterministic 16-byte document ID from what the file is made of (hex, 32 digits). */
function documentId(...parts: string[]): string {
  return sha256Hex(parts.join('\n')).slice(0, 32);
}

/**
 * The monthly summary as a PDF built to PDF/A-3b (embedded fonts, XMP metadata with the PDF/A
 * identification, an sRGB output intent, document ID, the data file as an associated file): the
 * readable table, the logged changes of the month, and the JSON of `monthToJson` embedded as an
 * attachment that only serves to confirm the readable data (its SHA-256 is printed on the last page).
 * Built to the standard, **not validated** by a PDF/A checker. Neutral metadata (no tool names).
 */
export async function monthToPdf(
  book: TimeBook,
  month: MonthKey,
  createdIso: string,
  assets: PdfAssets,
): Promise<Result<Uint8Array>> {
  if (!isMonthKey(month)) return fail('bad-month');
  const json = monthToJson(book, month, createdIso);
  if (!json.ok) return json;
  const hash = sha256Hex(json.value);
  const layout = monthLayout(book, month, createdIso, hash);
  const created = new Date(createdIso);
  const subject = 'Monatszusammenfassung Arbeitszeit';

  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  doc.setTitle(layout.title);
  doc.setSubject(subject);
  doc.setCreator('Zeiterfassung');
  doc.setProducer('Zeiterfassung');
  doc.setLanguage('de-DE');
  doc.setCreationDate(created);
  doc.setModificationDate(created);

  // fixed subset tags (six capital letters + „+“, as the PDF specification asks) keep the file reproducible
  const font = await doc.embedFont(assets.fontRegular, {
    subset: true,
    customName: 'ZEIREG+NotoSans-Regular',
  });
  const bold = await doc.embedFont(assets.fontBold, {
    subset: true,
    customName: 'ZEIBLD+NotoSans-Bold',
  });
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
    drawBlack(page, text(t), { x: MARGIN + indent, y, size, font: f });
    y -= size + 4;
  };
  const paragraph = (t: string, size = SIZE, f: PDFFont = font, indent = 0) => {
    const lines = wrapText(text(t), contentWidth - indent, (s) => f.widthOfTextAtSize(s, size));
    lines.forEach((l) => line(l, size, f, indent));
  };

  newPage();
  drawBlack(page, text(layout.title), { x: MARGIN, y, size: 16, font: bold });
  y -= 20;
  if (layout.employee) {
    line(`Mitarbeiter/in: ${layout.employee}`, 10);
    y -= 2;
  }
  y -= 6;
  layout.header.forEach((h, i) =>
    drawBlack(page, text(h), { x: xs[i] ?? MARGIN, y, size: SIZE, font: bold }),
  );
  y -= 4;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4.width - MARGIN, y },
    thickness: 0.5,
    color: BLACK,
  });
  y -= ROW_HEIGHT - 3;

  for (const row of layout.rows) {
    ensure(ROW_HEIGHT);
    row.forEach((cell, i) => {
      const width = i < WIDTHS.length ? (WIDTHS[i] as number) - 4 : noteWidth;
      drawBlack(page, fit(text(cell), font, SIZE, width), {
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
    drawBlack(p, text(`Seite ${i + 1} von ${pages.length}`), {
      x: A4.width - MARGIN - 60,
      y: 24,
      size: 8,
      font,
    }),
  );

  const { context } = doc;
  const catalog = doc.catalog;

  // the data file as an associated file (PDF/A-3): file specification with the relationship „Data“
  const data = new TextEncoder().encode(json.value);
  const name = attachmentName(month);
  const stream = context.flateStream(data, {
    Type: 'EmbeddedFile',
    Subtype: 'application/json',
    Params: context.obj({
      Size: data.length,
      CreationDate: PDFString.fromDate(created),
      ModDate: PDFString.fromDate(created),
    }),
  });
  const streamRef = context.register(stream);
  const fileSpecRef = context.register(
    context.obj({
      Type: 'Filespec',
      F: PDFString.of(name),
      UF: PDFHexString.fromText(name),
      Desc: PDFHexString.fromText(
        `Maschinenlesbare Daten zur Bestätigung der lesbaren Angaben. SHA-256: ${hash}`,
      ),
      AFRelationship: 'Data',
      EF: { F: streamRef, UF: streamRef },
    }),
  );
  catalog.set(
    PDFName.of('Names'),
    context.obj({ EmbeddedFiles: { Names: [PDFHexString.fromText(name), fileSpecRef] } }),
  );
  catalog.set(PDFName.of('AF'), context.obj([fileSpecRef]));

  // output intent with an embedded sRGB profile
  const profileRef = context.register(
    context.flateStream(srgbIccProfile(), { N: 3, Alternate: 'DeviceRGB' }),
  );
  const intentRef = context.register(
    context.obj({
      Type: 'OutputIntent',
      S: 'GTS_PDFA1',
      OutputConditionIdentifier: PDFString.of('sRGB'),
      Info: PDFString.of('sRGB'),
      RegistryName: PDFString.of('http://www.color.org'),
      DestOutputProfile: profileRef,
    }),
  );
  catalog.set(PDFName.of('OutputIntents'), context.obj([intentRef]));

  // XMP metadata (uncompressed, as PDF/A asks)
  const xmp = new TextEncoder().encode(
    xmpPacket({
      title: layout.title,
      subject,
      producer: 'Zeiterfassung',
      creatorTool: 'Zeiterfassung',
      createdIso,
    }),
  );
  const metadataRef: PDFRef = context.register(
    context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' }),
  );
  catalog.set(PDFName.of('Metadata'), metadataRef);

  // document ID (two equal halves: the file was made once)
  const id = PDFHexString.of(documentId(hash, createdIso, layout.title));
  const ids = PDFArray.withContext(context);
  ids.push(id);
  ids.push(id);
  context.trailerInfo.ID = ids;

  // plain objects (no object streams): the attachment stays visible to simple readers and archives
  return ok(await doc.save({ useObjectStreams: false }));
}
