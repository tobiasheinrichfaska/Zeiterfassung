/**
 * The running monthly PDF (decision 2026-11-24): one PDF per month that is continued, never rebuilt.
 * `startRunningPdf` makes the first revision (title page, PDF/A-3 pieces, a small start attachment);
 * `appendRunningDay` appends one incremental revision per finished day: new page(s) with the month's
 * table up to and including that day and the logged changes of those days, plus a new JSON attachment
 * with its own name (add only). The bytes before a revision never change. The document time stamp
 * after each day is the caller's: `appendDocTimeStamp` of `pdf-fortschreiben` (no network here).
 *
 * Technique: pdf-lib loads the file and draws the new page (with its own font subset); from pdf-lib's
 * context only the **new** objects (numbers from the file's `/Size` on) and the **changed page-tree
 * nodes** are taken, serialized by pdf-lib and appended by `pdf-fortschreiben` as raw objects of one
 * update, together with the attachment. Nothing else pdf-lib may have touched (e.g. `/Info`) is copied.
 */
import fontkit from '@pdf-lib/fontkit';
import {
  CustomFontEmbedder,
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFName,
  PDFString,
  type PDFObject,
} from 'pdf-lib';
import {
  PdfFile,
  PdfReadError,
  Update,
  attachFile,
  attachmentChanges,
  findDocTimeStamps,
  isName,
  name as pdfName,
  raw,
  readAttachments,
  writeUpdate,
  type AttachmentChange,
  type PdfStream,
} from 'pdf-fortschreiben';
import { fail, ok, type DateKey, type MonthKey, type Result, type TimeBook } from './model.ts';
import { canonicalJson } from './canonical.ts';
import { changeText, changesOfMonth } from './changes.ts';
import { bookUpTo, monthToJson } from './report.ts';
import { sha256Hex } from './sha256.ts';
import { monthSummary } from './summary.ts';
import { dateLabel, formatDuration, formatIsoDateTime, isDateKey, isMonthKey } from './time.ts';
import { monthLabel, rowTexts } from './view.ts';
import { COLUMN_HEADERS, addPdfaPieces, documentId, pageWriter, type PdfAssets } from './pdf.ts';

/** Format marker of the start attachment (month, creation time, employee label; no days). */
export const RUNNING_FORMAT = 'zeiterfassung-monat-laufend';
export const RUNNING_VERSION = 1;

/** `zeiterfassung-2026-11-beginn.json`: the attachment of the first revision; names the PDF's month. */
export const runningStartName = (month: MonthKey): string => `zeiterfassung-${month}-beginn.json`;

/** `zeiterfassung-2026-11-tag-23.json`: the attachment of one finished day. */
export const runningDayName = (date: DateKey): string =>
  `zeiterfassung-${date.slice(0, 7)}-tag-${date.slice(8, 10)}.json`;

const START_RE = /^zeiterfassung-(\d{4}-\d{2})-beginn\.json$/;
const DAY_RE = /^zeiterfassung-(\d{4}-\d{2})-tag-(\d{2})\.json$/;

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const isIso = (t: string): boolean => ISO_RE.test(t) && !Number.isNaN(Date.parse(t));

/** `2026-11-24T15:00:00.000Z` → `D:20261124150000Z` (PDF date, UTC). */
export const pdfDate = (iso: string): string =>
  `D:${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;

/**
 * Small files (decision 2026-11-24): one font only, regular, embedded **once and complete** in the first
 * revision (`/BaseFont /NotoSans-Regular`, every glyph, ToUnicode for every glyph); every day page uses
 * that same font object, so a day adds no font data. Headings are drawn in the regular font too.
 */
const SHARED_FONT = 'NotoSans-Regular';

/**
 * The shared font of a loaded running PDF as a pdf-lib font that draws with the file's font object and is
 * never embedded again (it is not registered with the document). Undefined in a file without it.
 */
async function sharedFont(doc: PDFDocument, assets: PdfAssets): Promise<PDFFont | undefined> {
  for (const [ref, o] of doc.context.enumerateIndirectObjects()) {
    if (
      o instanceof PDFDict &&
      o.get(PDFName.of('Type')) === PDFName.of('Font') &&
      o.get(PDFName.of('Subtype')) === PDFName.of('Type0') &&
      o.get(PDFName.of('BaseFont')) === PDFName.of(SHARED_FONT)
    ) {
      const embedder = await CustomFontEmbedder.for(fontkit, assets.fontRegular, SHARED_FONT);
      return PDFFont.of(ref, doc, embedder);
    }
  }
  return undefined;
}

/**
 * The font of a day page: the shared one, or (in a file made before the shared font) a regular subset
 * with its own tag for that day (a subset of another page is another subset; the PDF specification asks
 * for distinct tags).
 */
async function dayFont(doc: PDFDocument, assets: PdfAssets, day: number): Promise<PDFFont> {
  const shared = await sharedFont(doc, assets);
  if (shared) return shared;
  doc.registerFontkit(fontkit);
  const tag = `ZERA${String.fromCharCode(65 + Math.floor(day / 10))}${String.fromCharCode(65 + (day % 10))}`;
  return doc.embedFont(assets.fontRegular, { subset: true, customName: `${tag}+${SHARED_FONT}` });
}

const SUBJECT = 'Laufende Monatsdatei Arbeitszeit';

/** The texts of the title page (testable without drawing). */
export function runningTitleTexts(book: TimeBook, month: MonthKey, createdIso: string): string[] {
  return [
    `Arbeitszeit ${monthLabel(month)}`,
    book.settings.employeeLabel ? `Mitarbeiter/in: ${book.settings.employeeLabel}` : '',
    'Laufende Monatsdatei. Für jeden beendeten Arbeitstag folgt eine neue Seite mit dem Stand des Monats bis einschließlich diesem Tag und eine neue angehängte Datei mit denselben Angaben maschinenlesbar. Frühere Seiten und Anhänge werden nie geändert, nur ergänzt; jeder Stand soll danach einen Dokument-Zeitstempel erhalten.',
    `Begonnen am ${formatIsoDateTime(createdIso)} (Geräteuhr)`,
  ];
}

/**
 * The first revision of a month's running PDF: a title page, the PDF/A-3 pieces (fonts, XMP, output
 * intent, document ID) and the start attachment (no days). Saved with a classic xref table, so that
 * `pdf-fortschreiben` can continue it.
 */
export async function startRunningPdf(
  book: TimeBook,
  month: MonthKey,
  assets: PdfAssets,
  meta: { createdIso: string },
): Promise<Result<Uint8Array>> {
  if (!isMonthKey(month)) return fail('bad-month');
  if (!isIso(meta.createdIso)) return fail('bad-date');
  const createdIso = meta.createdIso;
  const texts = runningTitleTexts(book, month, createdIso);
  const title = texts[0] ?? '';
  const created = new Date(createdIso);

  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(title);
  doc.setSubject(SUBJECT);
  doc.setCreator('Zeiterfassung');
  doc.setProducer('Zeiterfassung');
  doc.setLanguage('de-DE');
  doc.setCreationDate(created);
  doc.setModificationDate(created);
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(assets.fontRegular, { subset: false, customName: SHARED_FONT });
  const w = pageWriter(doc, font, font);
  w.newPage();
  w.title(title);
  if (texts[1]) w.line(texts[1], 10);
  w.gap(8);
  w.paragraph(texts[2] ?? '');
  w.gap(4);
  w.line(texts[3] ?? '', 8);
  w.footers(() => 'Titelseite');

  const json = canonicalJson({
    format: RUNNING_FORMAT,
    version: RUNNING_VERSION,
    month,
    created: createdIso,
    employee: book.settings.employeeLabel,
  });
  const data = new TextEncoder().encode(json);
  const name = runningStartName(month);
  const { context, catalog } = doc;
  const streamRef = context.register(
    context.flateStream(data, {
      Type: 'EmbeddedFile',
      Subtype: 'application/json',
      Params: context.obj({
        Size: data.length,
        CreationDate: PDFString.fromDate(created),
        ModDate: PDFString.fromDate(created),
      }),
    }),
  );
  const specRef = context.register(
    context.obj({
      Type: 'Filespec',
      F: PDFString.of(name),
      UF: PDFHexString.fromText(name),
      Desc: PDFHexString.fromText('Beginn der laufenden Monatsdatei (Monat, Beginn, Bezeichnung).'),
      AFRelationship: 'Data',
      EF: { F: streamRef, UF: streamRef },
    }),
  );
  // tree keys as plain (Latin-1) strings: pdf-fortschreiben compares and sorts them byte by byte
  catalog.set(
    PDFName.of('Names'),
    context.obj({ EmbeddedFiles: { Names: [PDFString.of(name), specRef] } }),
  );
  catalog.set(PDFName.of('AF'), context.obj([specRef]));
  addPdfaPieces(doc, {
    title,
    subject: SUBJECT,
    createdIso,
    id: documentId(sha256Hex(json), createdIso, title),
  });
  return ok(await doc.save({ useObjectStreams: false }));
}

/** What a day page shows, as plain texts (testable without drawing). */
export interface RunningDayLayout {
  title: string;
  employee: string;
  header: string[];
  rows: string[][];
  total: string;
  openNote: string | null;
  changes: ReturnType<typeof changeText>[];
  attachmentNote: string;
  hashLine: string;
  created: string;
}

export function runningDayLayout(
  book: TimeBook,
  date: DateKey,
  createdIso: string,
  hash: string,
  upTo: DateKey = date,
): RunningDayLayout {
  const month = date.slice(0, 7);
  const cut = bookUpTo(book, upTo);
  const s = monthSummary(cut, month);
  return {
    title: `Arbeitszeit ${monthLabel(month)} – Stand ${dateLabel(upTo)}`,
    employee: book.settings.employeeLabel,
    header: COLUMN_HEADERS,
    rows: s.rows.map((r) => {
      const t = rowTexts(r);
      return [t.date, t.start, t.end, t.breaks, t.work, t.origin, r.note];
    }),
    total: `Summe Arbeitszeit bis ${dateLabel(upTo)}: ${formatDuration(s.workMinutes)} Std. an ${s.rows.length - s.openDays} Tag(en)`,
    openNote:
      s.openDays > 0
        ? `Hinweis: ${s.openDays} Tag(e) laufen noch und sind nicht in der Summe.`
        : null,
    changes: changesOfMonth(cut, month).map(changeText),
    attachmentNote: `Die angehängte Datei ${runningDayName(date)} enthält diesen Stand maschinenlesbar und dient nur der Bestätigung der lesbaren Daten.`,
    hashLine: `Prüfsumme der angehängten Datei (SHA-256): ${hash}`,
    created: `Erstellt am ${formatIsoDateTime(createdIso)} (Geräteuhr)`,
  };
}

/** The highest `coveredN` of the anchors a day file lists (0 when none or not readable). */
function anchorsListedIn(data: Uint8Array): number {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(data));
    const anchors = (parsed as { timestamps?: { anchors?: unknown } }).timestamps?.anchors;
    if (!Array.isArray(anchors)) return 0;
    let max = 0;
    for (const a of anchors) {
      const n = (a as { coveredN?: unknown } | null)?.coveredN;
      if (typeof n === 'number' && Number.isInteger(n) && n > max) max = n;
    }
    return max;
  } catch {
    return 0;
  }
}

/**
 * The month of a running PDF (from its start attachment), the days it holds and the highest anchor
 * number its day files list already (`anchorsN`: the next day file lists only newer anchors).
 */
async function readRunning(
  file: PdfFile,
): Promise<{ month: MonthKey; days: DateKey[]; anchorsN: number } | null> {
  let month: MonthKey | null = null;
  const days: DateKey[] = [];
  let anchorsN = 0;
  for (const a of await readAttachments(file)) {
    const start = START_RE.exec(a.name);
    if (start) month = start[1] ?? null;
    const day = DAY_RE.exec(a.name);
    if (day) {
      days.push(`${day[1]}-${day[2]}`);
      anchorsN = Math.max(anchorsN, anchorsListedIn(a.data));
    }
  }
  if (month === null) return null;
  return { month, days: days.filter((d) => d.startsWith(`${month}-`)).sort(), anchorsN };
}

const latin1 = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192)
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
};

/** The bytes pdf-lib writes for an object (between `n 0 obj` and `endobj`). */
function serialize(o: PDFObject): string {
  const buffer = new Uint8Array(o.sizeInBytes());
  o.copyBytesInto(buffer, 0);
  return latin1(buffer);
}

const isStream = (o: unknown): o is PdfStream =>
  typeof o === 'object' && o !== null && (o as { t?: unknown }).t === 'stream';

const isPagesNode = (o: PDFObject): o is PDFDict =>
  o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('Pages');

function openFile(pdf: Uint8Array): PdfFile | null {
  try {
    return new PdfFile(pdf);
  } catch (e) {
    if (e instanceof PdfReadError) return null;
    throw e;
  }
}

/**
 * Appends one revision for the finished day `date`: the day page(s) and the attachment
 * `zeiterfassung-JJJJ-MM-tag-TT.json` (the month's data up to and including that date). Refused when the
 * file is not a running PDF (`bad-pdf`), the date is not in its month (`wrong-month`), the day is already
 * in it (`day-in-pdf`), there is no such day (`no-such-day`) or it still runs (`day-running`).
 * `modified` is now (ISO, device clock): the attachment's date and the creation line of the page.
 */
export async function appendRunningDay(
  pdf: Uint8Array,
  book: TimeBook,
  date: DateKey,
  assets: PdfAssets,
  modified: string,
): Promise<Result<Uint8Array>> {
  if (!isDateKey(date) || !isIso(modified)) return fail('bad-date');
  const file = openFile(pdf);
  if (file === null) return fail('bad-pdf');
  let running: Awaited<ReturnType<typeof readRunning>>;
  try {
    running = await readRunning(file);
  } catch {
    return fail('bad-pdf');
  }
  if (running === null) return fail('bad-pdf');
  if (date.slice(0, 7) !== running.month) return fail('wrong-month');
  if (running.days.includes(date)) return fail('day-in-pdf');
  const day = book.days[date];
  if (!day) return fail('no-such-day');
  if (day.endMin === null) return fail('day-running');

  // a day added late (earlier than a day already in the file) still shows the month up to the newest day
  const newest = running.days[running.days.length - 1];
  const upTo = newest !== undefined && newest > date ? newest : date;
  const json = monthToJson(book, running.month, modified, upTo, running.anchorsN);
  if (!json.ok) return json;
  const hash = sha256Hex(json.value);
  const layout = runningDayLayout(book, date, modified, hash, upTo);

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf, { updateMetadata: false });
  } catch {
    return fail('bad-pdf');
  }
  const { context } = doc;
  const oldSize = file.size;
  // new objects must get exactly the numbers the update will give them
  if (context.largestObjectNumber >= oldSize) return fail('pdf-append-failed');
  context.largestObjectNumber = oldSize - 1;
  const treeBefore = new Map<number, string>();
  for (const [r, o] of context.enumerateIndirectObjects())
    if (isPagesNode(o)) treeBefore.set(r.objectNumber, serialize(o));

  const font = await dayFont(doc, assets, Number(date.slice(8, 10)));
  const w = pageWriter(doc, font, font);
  w.newPage();
  w.title(layout.title);
  if (layout.employee) {
    w.line(`Mitarbeiter/in: ${layout.employee}`, 10);
    w.gap(2);
  }
  w.gap(6);
  w.table(layout.header, layout.rows);
  w.gap(8);
  w.line(layout.total, 11);
  w.gap(4);
  if (layout.openNote) w.line(layout.openNote);
  w.changes('Nachträgliche Änderungen', layout.changes);
  w.gap(10);
  w.ensure(48);
  w.paragraph(layout.attachmentNote, 8);
  w.line(layout.hashLine, 8);
  w.line(layout.created, 8);
  const stand = dateLabel(upTo);
  w.footers((i, n) => `Stand ${stand}, Seite ${i + 1} von ${n}`);
  await doc.flush();

  const update = new Update(file);
  const fresh = context
    .enumerateIndirectObjects()
    .filter(([r]) => r.objectNumber >= oldSize)
    .sort(([a], [b]) => a.objectNumber - b.objectNumber);
  for (const [r, o] of fresh) {
    if (r.generationNumber !== 0) return fail('pdf-append-failed');
    const added = update.add(raw(serialize(o)));
    if (added.num !== r.objectNumber) return fail('pdf-append-failed');
  }
  let treeChanged = 0;
  for (const [r, o] of context.enumerateIndirectObjects()) {
    const before = treeBefore.get(r.objectNumber);
    if (before === undefined || !isPagesNode(o)) continue;
    const now = serialize(o);
    if (now === before) continue;
    update.set({ t: 'ref', num: r.objectNumber, gen: 0 }, raw(now));
    treeChanged += 1;
  }
  if (treeChanged === 0) return fail('pdf-append-failed');

  try {
    const data = new TextEncoder().encode(json.value);
    const before = new Set(update.objects.keys());
    attachFile(file, update, {
      name: runningDayName(date),
      data,
      mimeType: 'application/json',
      // the checksum is printed on the page; it is not repeated here
      description: `Stand bis ${upTo}, maschinenlesbar`,
      modified: pdfDate(modified),
      relationship: 'Data',
    });
    // the library writes the file uncompressed; it is stored with /FlateDecode instead (it reads both)
    let compressed = 0;
    for (const [num, o] of update.objects) {
      if (before.has(num) || !isStream(o) || !isName(o.dict.entries.get('Type'), 'EmbeddedFile'))
        continue;
      const entries = new Map(o.dict.entries);
      entries.set('Filter', pdfName('FlateDecode'));
      update.objects.set(num, {
        t: 'stream',
        dict: { t: 'dict', entries },
        data: context.flateStream(data).getContents(),
      });
      compressed += 1;
    }
    if (compressed !== 1) return fail('pdf-append-failed');
    return ok(writeUpdate(file, update).bytes);
  } catch {
    return fail('pdf-append-failed');
  }
}

export interface RunningPdfState {
  month: MonthKey;
  /** The days that have their attachment, in date order. */
  days: DateKey[];
  /** Number of revisions (1 = only the start). */
  revisions: number;
  /** Number of document time stamps found. */
  timeStamps: number;
  /** The newest revision is covered by a document time stamp whose range is in order. */
  newestStamped: boolean;
  /** Earlier attachments that a later revision removed or changed (empty with add-only writing). */
  attachmentChanges: AttachmentChange[];
}

/** Reads what a running PDF holds. Tokens are not checked here (that is the verifier's job). */
export async function runningPdfState(pdf: Uint8Array): Promise<Result<RunningPdfState>> {
  const file = openFile(pdf);
  if (file === null) return fail('bad-pdf');
  try {
    const running = await readRunning(file);
    if (running === null) return fail('bad-pdf');
    const stamps = findDocTimeStamps(pdf);
    const newest = file.revisions.length - 1;
    return ok({
      month: running.month,
      days: running.days,
      revisions: file.revisions.length,
      timeStamps: stamps.length,
      newestStamped: stamps.some((s) => s.rangeOk && s.revision === newest),
      attachmentChanges: await attachmentChanges(pdf),
    });
  } catch {
    return fail('bad-pdf');
  }
}
