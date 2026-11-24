import { PDFDocument } from 'pdf-lib';
import {
  PdfFile,
  appendDocTimeStamp,
  attachmentChanges,
  findDocTimeStamps,
  readAttachments,
} from 'pdf-fortschreiben';
import {
  addChanges,
  appendRunningDay,
  bookUpTo,
  monthToJson,
  runningDayLayout,
  runningDayName,
  runningPdfState,
  runningStartName,
  startRunningPdf,
  updateSettings,
  type TimeBook,
} from '../src/logic/index.ts';
import { bookWith, day, val } from './helpers.ts';
import { ASSETS } from './pdfAssets.ts';
import { inspect } from './pdfRead.ts';

const START = '2026-11-02T06:00:00.000Z';
const at = (date: string) => `${date}T16:00:00.000Z`;
const DAYS = ['2026-11-02', '2026-11-03', '2026-11-04'];

function november(): TimeBook {
  const book = val(
    updateSettings(
      bookWith(
        day({ date: '2026-11-02' }),
        day({ date: '2026-11-03', startMin: 420, endMin: 900, note: 'Büro ß' }),
        day({ date: '2026-11-04', startMin: 480, endMin: 720, breaks: [] }),
        day({ date: '2026-11-05', endMin: null, breaks: [] }), // running
        day({ date: '2026-10-30' }), // other month
      ),
      { employeeLabel: 'Erika Muster', retentionMonths: 24, timestampRelay: '' },
    ),
  );
  // a logged change of 3 November (made on the 4th): only from that day's page on
  return val(
    addChanges(book, [
      {
        at: '2026-11-04T09:00:00.000Z',
        date: '2026-11-03',
        kind: 'changed',
        before: { startMin: 450, endMin: 900, breaks: [], note: '', origin: 'manual' },
        after: { startMin: 420, endMin: 900, breaks: [], note: 'Büro ß', origin: 'manual' },
        reason: 'Beginn vergessen',
        movedTo: null,
        movedFrom: null,
      },
    ]),
  );
}

/** A stand-in token: one DER OCTET STRING holding the digest (checks the plumbing, proves nothing). */
const fakeStamper = (seen: Uint8Array[]) => async (digest: Uint8Array) => {
  seen.push(digest);
  return Uint8Array.from([0x04, digest.length, ...digest]);
};

const isPrefix = (a: Uint8Array, b: Uint8Array) =>
  b.length > a.length && a.every((x, i) => b[i] === x);

const DAY_ROW = /^(Mo|Di|Mi|Do|Fr|Sa|So) \d\d\.11\.2026$/gm;

describe('running monthly PDF', () => {
  it('start + three days with a document time stamp after each day', async () => {
    const book = november();
    const states: Uint8Array[] = [];
    let pdf = val(await startRunningPdf(book, '2026-11', ASSETS, { createdIso: START }));
    states.push(pdf);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
    const startState = val(await runningPdfState(pdf));
    expect(startState).toMatchObject({ month: '2026-11', days: [], revisions: 1, timeStamps: 0 });
    expect(startState.newestStamped).toBe(false);

    const digests: Uint8Array[] = [];
    const sizes: number[] = [pdf.length];
    for (const date of DAYS) {
      const before = pdf;
      pdf = val(await appendRunningDay(pdf, book, date, ASSETS, at(date)));
      expect(isPrefix(before, pdf)).toBe(true);
      states.push(pdf);
      expect(val(await runningPdfState(pdf)).newestStamped).toBe(false);
      const stamped = await appendDocTimeStamp(pdf, fakeStamper(digests), { reserve: 1024 });
      expect(isPrefix(pdf, stamped)).toBe(true);
      pdf = stamped;
      states.push(pdf);
      sizes.push(pdf.length);
    }
    // per day: one page revision + one stamp revision
    const state = val(await runningPdfState(pdf));
    expect(state).toMatchObject({
      month: '2026-11',
      days: DAYS,
      revisions: 7,
      timeStamps: 3,
      newestStamped: true,
      attachmentChanges: [],
    });
    expect(await attachmentChanges(pdf)).toEqual([]);

    // every intermediate state loads with pdf-lib and has the right number of pages
    for (const [i, s] of states.entries()) {
      const doc = await PDFDocument.load(s, { updateMetadata: false });
      expect(doc.getPageCount(), `state ${i}`).toBe(1 + Math.ceil(i / 2));
    }

    // attachments: the start file and one per day, with the month's data up to that day
    const found = await readAttachments(new PdfFile(pdf));
    expect(found.map((a) => a.name)).toEqual([
      runningStartName('2026-11'),
      ...DAYS.map(runningDayName),
    ]);
    expect(runningDayName('2026-11-03')).toBe('zeiterfassung-2026-11-tag-03.json');
    for (const date of DAYS) {
      const a = found.find((f) => f.name === runningDayName(date))!;
      const text = new TextDecoder().decode(a.data);
      expect(text).toBe(val(monthToJson(book, '2026-11', at(date), date)));
      const parsed = JSON.parse(text);
      expect(parsed.upTo).toBe(date);
      expect(parsed.days.map((d: { date: string }) => d.date)).toEqual(
        DAYS.filter((d) => d <= date),
      );
      expect(a.relationship).toBe('Data');
      expect(a.mimeType).toBe('application/json');
    }
    const start = JSON.parse(new TextDecoder().decode(found[0]!.data));
    expect(start).toEqual({
      created: START,
      employee: 'Erika Muster',
      format: 'zeiterfassung-monat-laufend',
      month: '2026-11',
      version: 1,
    });

    // time stamps: ranges in order, each over the revision of its day, digest = what was stamped
    const stamps = findDocTimeStamps(pdf);
    expect(stamps).toHaveLength(3);
    stamps.forEach((s, i) => {
      expect(s.rangeOk).toBe(true);
      expect(s.revision).toBe(2 + 2 * i);
      expect(s.digest).toEqual(digests[i]);
      expect(s.token.subarray(2)).toEqual(s.digest);
    });
    // a stamp covers its day: the bytes of the day's revision are inside its range
    const file = new PdfFile(pdf);
    stamps.forEach((s, i) => {
      expect(s.byteRange[1]!).toBeGreaterThan(file.revisions[1 + 2 * i]!.end);
    });

    // page texts: day N shows N rows, its total and (from the 3rd on) the change
    const { streams } = await inspect(pdf);
    expect(streams.pages).toHaveLength(4);
    expect(streams.pages[0]).toContain('Arbeitszeit November 2026');
    expect(streams.pages[0]).toContain('Laufende Monatsdatei.');
    expect(streams.pages[0]!.match(DAY_ROW)).toBeNull();
    DAYS.forEach((date, i) => {
      const page = streams.pages[i + 1]!;
      expect(page.match(DAY_ROW), date).toHaveLength(i + 1);
      expect(page).toContain(`Stand ${['Mo', 'Di', 'Mi'][i]} ${date.slice(8)}.11.2026`);
      expect(page).toContain(runningDayName(date));
      expect(page.includes('Nachträgliche Änderungen'), date).toBe(i >= 1);
    });
    expect(streams.pages[3]).toContain(
      'Summe Arbeitszeit bis Mi 04.11.2026: 19:30 Std. an 3 Tag(en)',
    );

    // size: about 15 KB to start, about 18 KB per day (page, two font subsets, attachment, 1 KB stamp reserve)
    expect(sizes[0]).toBeLessThan(25_000);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]! - sizes[i - 1]!).toBeLessThan(30_000);
  }, 30_000);

  it('refuses the same day twice, a running day, another month, a missing day and a foreign PDF', async () => {
    const book = november();
    const pdf0 = val(await startRunningPdf(book, '2026-11', ASSETS, { createdIso: START }));
    const pdf1 = val(await appendRunningDay(pdf0, book, '2026-11-02', ASSETS, at('2026-11-02')));
    const stamped = await appendDocTimeStamp(pdf1, fakeStamper([]), { reserve: 1024 });
    expect(await appendRunningDay(stamped, book, '2026-11-02', ASSETS, at('2026-11-02'))).toEqual({
      ok: false,
      reason: 'day-in-pdf',
    });
    expect(await appendRunningDay(stamped, book, '2026-11-05', ASSETS, at('2026-11-05'))).toEqual({
      ok: false,
      reason: 'day-running',
    });
    expect(await appendRunningDay(stamped, book, '2026-10-30', ASSETS, at('2026-10-30'))).toEqual({
      ok: false,
      reason: 'wrong-month',
    });
    expect(await appendRunningDay(stamped, book, '2026-11-06', ASSETS, at('2026-11-06'))).toEqual({
      ok: false,
      reason: 'no-such-day',
    });
    expect(await appendRunningDay(stamped, book, '2026-11-31', ASSETS, at('2026-11-06'))).toEqual({
      ok: false,
      reason: 'bad-date',
    });
    expect(await appendRunningDay(stamped, book, '2026-11-03', ASSETS, 'gestern')).toEqual({
      ok: false,
      reason: 'bad-date',
    });
    // a PDF that is not a running monthly PDF (no start attachment), and one with object streams
    const other = await PDFDocument.create();
    other.addPage();
    const plain = await other.save({ useObjectStreams: false });
    expect(await appendRunningDay(plain, book, '2026-11-03', ASSETS, at('2026-11-03'))).toEqual({
      ok: false,
      reason: 'bad-pdf',
    });
    const streamsPdf = await other.save({ useObjectStreams: true });
    expect(
      await appendRunningDay(streamsPdf, book, '2026-11-03', ASSETS, at('2026-11-03')),
    ).toEqual({ ok: false, reason: 'bad-pdf' });
    expect(await runningPdfState(plain)).toEqual({ ok: false, reason: 'bad-pdf' });
    expect(await runningPdfState(new TextEncoder().encode('kein PDF'))).toEqual({
      ok: false,
      reason: 'bad-pdf',
    });
    expect(await startRunningPdf(book, '2026-13', ASSETS, { createdIso: START })).toEqual({
      ok: false,
      reason: 'bad-month',
    });
  }, 30_000);

  it('catches up a later day first and an earlier one after it (no order is forced)', async () => {
    const book = november();
    let pdf = val(await startRunningPdf(book, '2026-11', ASSETS, { createdIso: START }));
    pdf = val(await appendRunningDay(pdf, book, '2026-11-04', ASSETS, at('2026-11-05')));
    pdf = val(await appendRunningDay(pdf, book, '2026-11-02', ASSETS, at('2026-11-05')));
    const state = val(await runningPdfState(pdf));
    expect(state.days).toEqual(['2026-11-02', '2026-11-04']);
    expect(state.revisions).toBe(3);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(3);
  }, 30_000);
});

describe('runningDayLayout and bookUpTo', () => {
  it('cuts the month after the day', () => {
    const book = november();
    const cut = bookUpTo(book, '2026-11-02');
    expect(Object.keys(cut.days).sort()).toEqual(['2026-10-30', '2026-11-02']);
    expect(cut.changes).toEqual([]);
    const l = runningDayLayout(book, '2026-11-03', at('2026-11-03'), 'abc');
    expect(l.title).toBe('Arbeitszeit November 2026 – Stand Di 03.11.2026');
    expect(l.rows).toHaveLength(2);
    expect(l.changes).toHaveLength(1);
    expect(l.openNote).toBeNull();
    expect(l.hashLine).toContain('abc');
  });

  it('monthToJson refuses a cut-off outside the month', () => {
    expect(monthToJson(november(), '2026-11', START, '2026-12-01')).toEqual({
      ok: false,
      reason: 'bad-date',
    });
  });
});
