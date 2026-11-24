import {
  RUNNING_PDF_SLOTS,
  decodeRunningPdf,
  daysToAppend,
  encodeRunningPdf,
  runningPdfFileName,
  runningPdfLines,
  runningPdfMonths,
  runningPdfSlot,
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
  it('one vault slot per month of the span, none outside', () => {
    expect(runningPdfSlot('2026-11')).toBe('monatspdf-2026-11');
    expect(runningPdfSlot('2025-12')).toBeNull();
    expect(runningPdfSlot('2041-01')).toBeNull();
    expect(runningPdfSlot('2026-13')).toBeNull();
    expect(RUNNING_PDF_SLOTS).toHaveLength(15 * 12);
    expect(RUNNING_PDF_SLOTS[0]).toBe('monatspdf-2026-01');
    expect(RUNNING_PDF_SLOTS.at(-1)).toBe('monatspdf-2040-12');
    expect(new Set(RUNNING_PDF_SLOTS).size).toBe(RUNNING_PDF_SLOTS.length);
    expect(runningPdfFileName('2026-11')).toBe('zeiterfassung-2026-11-laufend.pdf');
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

  it('looks after the previous and the current month when they have days or a file', () => {
    expect(runningPdfMonths(book(), '2026-11-05', () => false)).toEqual(['2026-10', '2026-11']);
    expect(runningPdfMonths(book(), '2026-12-01', () => false)).toEqual(['2026-11']);
    expect(runningPdfMonths(book(), '2026-12-01', (m) => m === '2026-12')).toEqual([
      '2026-11',
      '2026-12',
    ]);
    expect(runningPdfMonths(bookWith(), '2027-01-10', () => false)).toEqual([]);
  });

  it('stores the file as Base64 and refuses what is no PDF', () => {
    const pdf = new TextEncoder().encode('%PDF-1.7\nx');
    const text = encodeRunningPdf(pdf);
    expect(decodeRunningPdf(text)).toEqual({ kind: 'pdf', pdf });
    expect(decodeRunningPdf(null)).toEqual({ kind: 'none' });
    expect(decodeRunningPdf('')).toEqual({ kind: 'none' });
    expect(decodeRunningPdf('kein Base64!')).toEqual({ kind: 'unreadable' });
    expect(decodeRunningPdf(btoa('<html>'))).toEqual({ kind: 'unreadable' });
  });

  it('says how the file stands', () => {
    expect(runningPdfLines(undefined)).toEqual([
      'Für diesen Monat gibt es noch keine laufende Monatsdatei.',
    ]);
    const info: RunningPdfInfo = {
      month: '2026-11',
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
