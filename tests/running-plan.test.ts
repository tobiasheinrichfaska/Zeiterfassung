import {
  PDF_SLOTS,
  PDF_SLOT_LIMIT,
  decodeRunningPdf,
  daysToAppend,
  encodeRunningPdf,
  forcedSave,
  pdfFitsSlot,
  pdfSlotPlan,
  runningPdfFileName,
  runningPdfLines,
  saveRequestText,
  savedMarker,
  slotPlanNotes,
  type PdfSlotContent,
  type RunningPdfInfo,
} from '../src/logic/index.ts';
import { bookWith, day } from './helpers.ts';

const book = () =>
  bookWith(
    day({ date: '2026-10-30' }),
    day({ date: '2026-11-03' }),
    day({ date: '2026-11-02' }),
    day({ date: '2026-11-04', endMin: null, breaks: [] }), // running
    day({ date: '2026-11-09' }), // entered ahead of time
  );

describe('running monthly PDF: plan', () => {
  it('two fixed slots', () => {
    expect(PDF_SLOTS).toEqual(['monatspdf-a', 'monatspdf-b']);
    expect(runningPdfFileName('2026-11')).toBe('zeiterfassung-2026-11-laufend.pdf');
  });

  it('a slot holds at most PDF_SLOT_LIMIT characters', () => {
    expect(PDF_SLOT_LIMIT).toBe(1_200_000);
    expect(pdfFitsSlot('x'.repeat(PDF_SLOT_LIMIT))).toBe(true);
    expect(pdfFitsSlot('x'.repeat(PDF_SLOT_LIMIT + 1))).toBe(false);
  });

  it('ended days not yet in the file, in date order, none after today', () => {
    expect(daysToAppend(book(), '2026-11', [], '2026-11-05')).toEqual(['2026-11-02', '2026-11-03']);
    expect(daysToAppend(book(), '2026-11', ['2026-11-02'], '2026-11-05')).toEqual(['2026-11-03']);
    expect(daysToAppend(book(), '2026-11', [], '2026-11-30')).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-09',
    ]);
    // today's day counts once „Gehen“ is pressed
    expect(daysToAppend(book(), '2026-11', [], '2026-11-03')).toEqual(['2026-11-02', '2026-11-03']);
    expect(daysToAppend(book(), '2026-10', [], '2026-11-05')).toEqual(['2026-10-30']);
  });

  it('stores the file as Base64 and refuses what is no PDF', () => {
    const pdf = new TextEncoder().encode('%PDF-1.7\nx');
    const text = encodeRunningPdf(pdf);
    expect(decodeRunningPdf(text)).toEqual({ kind: 'pdf', pdf });
    expect(decodeRunningPdf(null)).toEqual({ kind: 'none' });
    expect(decodeRunningPdf('')).toEqual({ kind: 'none' });
    expect(decodeRunningPdf('kein Base64!')).toEqual({ kind: 'unreadable' });
    expect(decodeRunningPdf(btoa('<html>'))).toEqual({ kind: 'unreadable' });
    const marker = savedMarker('2026-10', '2026-11-08T09:00:00.000Z');
    expect(marker).toBe('gespeichert:2026-10:2026-11-08T09:00:00.000Z');
    expect(decodeRunningPdf(marker)).toEqual({
      kind: 'saved',
      month: '2026-10',
      at: '2026-11-08T09:00:00.000Z',
    });
    expect(decodeRunningPdf('gespeichert:2026-13:2026-11-08T09:00:00.000Z')).toEqual({
      kind: 'unreadable',
    });
    expect(decodeRunningPdf('gespeichert:2026-10:gestern')).toEqual({ kind: 'unreadable' });
  });

  it('says how the file stands', () => {
    expect(runningPdfLines(undefined)).toEqual([
      'Für diesen Monat liegt keine laufende Monatsdatei in der App.',
    ]);
    const info: RunningPdfInfo = {
      month: '2026-11',
      slot: 'monatspdf-a',
      tooLarge: false,
      days: ['2026-11-02', '2026-11-03'],
      timeStamps: 1,
      newestStamped: false,
      lastStampAt: '2026-11-02T16:00:05.000Z',
      changedAttachments: [],
      problem: null,
    };
    const lines = runningPdfLines(info);
    expect(lines[0]).toBe('2 Tag(e) enthalten, zuletzt Di 03.11.2026.');
    expect(lines[1]).toMatch(/^1 Dokument-Zeitstempel, letzter .+ \(laut Token\)\.$/);
    expect(lines[2]).toBe('Der neueste Stand ist noch nicht gestempelt.');
    expect(runningPdfLines({ ...info, days: [], timeStamps: 0, newestStamped: true })).toEqual([
      'Noch kein Tag enthalten.',
      'Noch kein Dokument-Zeitstempel.',
      'Der neueste Stand ist gestempelt.',
    ]);
  });
});

const empty: PdfSlotContent = { kind: 'empty' };
const pdf = (month: string): PdfSlotContent => ({ kind: 'pdf', month });
const saved = (month: string): PdfSlotContent => ({ kind: 'saved', month });
const slots = (a: PdfSlotContent, b: PdfSlotContent) => ({ 'monatspdf-a': a, 'monatspdf-b': b });

describe('running monthly PDF: which slot holds what (pdfSlotPlan)', () => {
  it('an empty vault: the current month starts in the first slot, the previous within its week', () => {
    const p = pdfSlotPlan('2026-11-03', slots(empty, empty));
    expect(p.current).toEqual({ month: '2026-11', slot: 'monatspdf-a', exists: false });
    expect(p.previous).toEqual({ month: '2026-10', slot: 'monatspdf-b', exists: false });
    expect(p.save).toEqual([]);
    // after the week the previous month is not started any more
    expect(pdfSlotPlan('2026-11-08', slots(empty, empty)).previous).toBeNull();
  });

  it('month change: the previous month stays with a reminder up to the 7th, forced from the 8th', () => {
    const s = slots(pdf('2026-10'), empty);
    for (const day of ['01', '07']) {
      const p = pdfSlotPlan(`2026-11-${day}`, s);
      expect(p.previous).toEqual({ month: '2026-10', slot: 'monatspdf-a', exists: true });
      expect(p.current).toEqual({ month: '2026-11', slot: 'monatspdf-b', exists: false });
      expect(p.save).toEqual([
        { slot: 'monatspdf-a', month: '2026-10', mode: 'reminder', why: 'previous' },
      ]);
      expect(forcedSave(p)).toEqual([]);
    }
    for (const day of ['08', '30']) {
      const p = pdfSlotPlan(`2026-11-${day}`, s);
      expect(forcedSave(p)).toEqual([
        { slot: 'monatspdf-a', month: '2026-10', mode: 'forced', why: 'previous' },
      ]);
      // recording goes on: the current month has its own slot
      expect(p.current?.slot).toBe('monatspdf-b');
    }
  });

  it('year change: December is the previous month of January', () => {
    const p = pdfSlotPlan('2027-01-02', slots(pdf('2026-12'), pdf('2026-11')));
    expect(p.previous).toEqual({ month: '2026-12', slot: 'monatspdf-a', exists: true });
    expect(p.current).toBeNull();
    expect(p.currentWaits).toBe(true);
    expect(p.save).toEqual([
      { slot: 'monatspdf-b', month: '2026-11', mode: 'forced', why: 'older' },
      { slot: 'monatspdf-a', month: '2026-12', mode: 'reminder', why: 'previous' },
    ]);
    expect(pdfSlotPlan('2027-01-08', slots(pdf('2026-12'), pdf('2027-01'))).save).toEqual([
      { slot: 'monatspdf-a', month: '2026-12', mode: 'forced', why: 'previous' },
    ]);
  });

  it('an unsaved older month is never overwritten: the current month waits for it', () => {
    const p = pdfSlotPlan('2026-12-03', slots(pdf('2026-10'), pdf('2026-11')));
    expect(p.current).toBeNull();
    expect(p.currentWaits).toBe(true);
    expect(forcedSave(p).map((r) => r.month)).toEqual(['2026-10']);
    expect(slotPlanNotes(p)[0]).toContain('kein Platz frei');
    // once it is saved (its marker), the current month gets that slot
    const after = pdfSlotPlan('2026-12-03', slots(saved('2026-10'), pdf('2026-11')));
    expect(after.current).toEqual({ month: '2026-12', slot: 'monatspdf-a', exists: false });
    expect(after.currentWaits).toBe(false);
  });

  it('both slots full with current and previous: nothing to move, only the reminder', () => {
    const p = pdfSlotPlan('2026-12-05', slots(pdf('2026-12'), pdf('2026-11')));
    expect(p.current).toEqual({ month: '2026-12', slot: 'monatspdf-a', exists: true });
    expect(p.previous).toEqual({ month: '2026-11', slot: 'monatspdf-b', exists: true });
    expect(p.save.map((r) => r.mode)).toEqual(['reminder']);
  });

  it('a saved month is not started again; an empty slot is used before a marker', () => {
    const p = pdfSlotPlan('2026-11-03', slots(saved('2026-10'), empty));
    expect(p.previous).toBeNull();
    expect(p.current?.slot).toBe('monatspdf-b');
    // a marker of an old month is a free slot like an empty one
    expect(pdfSlotPlan('2026-11-03', slots(saved('2026-08'), pdf('2026-11'))).previous).toEqual({
      month: '2026-10',
      slot: 'monatspdf-a',
      exists: false,
    });
    // the current month's file was saved out (too large): it is not started again
    const out = pdfSlotPlan('2026-11-20', slots(saved('2026-11'), empty));
    expect(out.current).toBeNull();
    expect(out.currentSaved).toBe(true);
    expect(out.currentWaits).toBe(false);
  });

  it('a state that did not fit makes its file a forced save, also the current month', () => {
    const p = pdfSlotPlan('2026-11-20', slots(pdf('2026-11'), empty), ['monatspdf-a']);
    expect(forcedSave(p)).toEqual([
      { slot: 'monatspdf-a', month: '2026-11', mode: 'forced', why: 'too-large' },
    ]);
    const prev = pdfSlotPlan('2026-11-03', slots(pdf('2026-10'), empty), ['monatspdf-a']);
    expect(prev.save).toEqual([
      { slot: 'monatspdf-a', month: '2026-10', mode: 'forced', why: 'too-large' },
    ]);
  });

  it('unreadable slots and files of a later month are kept and reported, never used', () => {
    const p = pdfSlotPlan('2026-11-10', slots({ kind: 'unreadable' }, pdf('2026-12')));
    expect(p.unreadable).toEqual(['monatspdf-a']);
    expect(p.ahead).toEqual([{ slot: 'monatspdf-b', month: '2026-12' }]);
    expect(p.current).toBeNull();
    expect(p.currentWaits).toBe(true);
    expect(p.save).toEqual([]);
    expect(slotPlanNotes(p)).toHaveLength(3);
  });

  it('the same month twice: the second file must be saved', () => {
    const p = pdfSlotPlan('2026-11-10', slots(pdf('2026-11'), pdf('2026-11')));
    expect(p.current?.slot).toBe('monatspdf-a');
    expect(forcedSave(p)).toEqual([
      { slot: 'monatspdf-b', month: '2026-11', mode: 'forced', why: 'duplicate' },
    ]);
  });

  it('says in German why a file is to be saved', () => {
    const r = { slot: 'monatspdf-a', month: '2026-10', mode: 'reminder', why: 'previous' } as const;
    expect(saveRequestText(r, '2026-11-03')).toContain('bis zum 7. November 2026');
    expect(saveRequestText({ ...r, mode: 'forced' }, '2026-11-08')).toContain(
      'Bitte jetzt speichern',
    );
    expect(saveRequestText({ ...r, why: 'too-large', mode: 'forced' }, '2026-11-08')).toContain(
      'zu groß',
    );
  });
});
