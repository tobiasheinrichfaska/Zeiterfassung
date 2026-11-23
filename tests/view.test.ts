import {
  STAMP_ENABLED,
  breakEnd,
  breakStart,
  dateLabel,
  dayToForm,
  emptyBreak,
  emptyBook,
  emptyForm,
  monthLabel,
  parseDayForm,
  rowTexts,
  setWorkday,
  shiftMonth,
  stampIn,
  stampOut,
  stampEnabled,
  stampState,
  stampStatus,
  monthSummary,
  type DayFormFields,
} from '../src/logic/index.ts';
import { NOW, bookWith, day, val } from './helpers.ts';

const at = (date: string, h: number, m = 0) => ({ date, minute: h * 60 + m });

describe('stamp state and buttons', () => {
  it('derives the state from the book', () => {
    let b = emptyBook();
    expect(stampState(b)).toBe('idle');
    b = val(stampIn(b, at('2026-11-23', 8), NOW));
    expect(stampState(b)).toBe('working');
    b = val(breakStart(b, at('2026-11-23', 12), NOW));
    expect(stampState(b)).toBe('onBreak');
    b = val(breakEnd(b, at('2026-11-23', 12, 30), NOW));
    expect(stampState(b)).toBe('working');
    b = val(stampOut(b, at('2026-11-23', 16), NOW));
    expect(stampState(b)).toBe('idle');
  });

  it('enables exactly the buttons the logic would accept', () => {
    // The table must agree with the actions: an enabled button works, a disabled one is refused.
    let b = emptyBook();
    const probe = (book: typeof b, c = at('2026-11-23', 12, 45)) => ({
      in: stampIn(book, c, NOW).ok,
      breakStart: breakStart(book, c, NOW).ok,
      breakEnd: breakEnd(book, c, NOW).ok,
      out: stampOut(book, c, NOW).ok,
    });
    expect(probe(b)).toEqual(STAMP_ENABLED.idle);
    b = val(stampIn(b, at('2026-11-23', 8), NOW));
    expect(probe(b)).toEqual(STAMP_ENABLED.working);
    b = val(breakStart(b, at('2026-11-23', 12), NOW));
    expect(probe(b)).toEqual(STAMP_ENABLED.onBreak);
  });

  it('switches „Kommen“ off after a finished day, exactly where the logic would refuse', () => {
    let b = val(stampIn(emptyBook(), at('2026-11-23', 8), NOW));
    b = val(stampOut(b, at('2026-11-23', 16), NOW));
    expect(stampEnabled(b, at('2026-11-23', 17)).in).toBe(false);
    expect(stampIn(b, at('2026-11-23', 17), NOW).ok).toBe(false);
    expect(stampEnabled(b, at('2026-11-24', 8)).in).toBe(true);
    expect(stampIn(b, at('2026-11-24', 8), NOW).ok).toBe(true);
  });

  it('writes a status line', () => {
    let b = emptyBook();
    expect(stampStatus(b, at('2026-11-23', 9))).toBe('Noch nicht gestempelt.');
    b = val(stampIn(b, at('2026-11-23', 8), NOW));
    expect(stampStatus(b, at('2026-11-23', 9))).toBe('Seit 08:00 bei der Arbeit.');
    b = val(breakStart(b, at('2026-11-23', 12), NOW));
    expect(stampStatus(b, at('2026-11-23', 12, 5))).toBe(
      'Seit 08:00 bei der Arbeit, Pause seit 12:00.',
    );
    b = val(stampOut(b, at('2026-11-23', 16), NOW));
    expect(stampStatus(b, at('2026-11-23', 17))).toBe('Heute ist der Arbeitstag beendet.');
  });
});

describe('parseDayForm', () => {
  const form = (over: Partial<DayFormFields> = {}): DayFormFields => ({
    ...emptyForm('2026-11-23'),
    start: '08:00',
    end: '16:30',
    ...over,
  });

  it('reads a normal day with a length break', () => {
    const r = val(
      parseDayForm(form({ breaks: [{ ...emptyBreak(), minutes: '30' }], note: ' Büro ' })),
    );
    expect(r).toEqual({
      date: '2026-11-23',
      startMin: 480,
      endMin: 990,
      breaks: [{ kind: 'length', minutes: 30 }],
      note: 'Büro',
    });
  });

  it('reads a running day (no departure) and an open break', () => {
    const r = val(
      parseDayForm(form({ end: '', breaks: [{ ...emptyBreak('span'), from: '12:00', to: '' }] })),
    );
    expect(r.endMin).toBeNull();
    expect(r.breaks).toEqual([{ kind: 'span', fromMin: 720, toMin: null }]);
  });

  it('moves clock times before the arrival to the next day when the shift runs past midnight', () => {
    const r = val(
      parseDayForm(
        form({
          start: '22:00',
          end: '06:00',
          nextDay: true,
          breaks: [{ ...emptyBreak('span'), from: '00:15', to: '00:45' }],
        }),
      ),
    );
    expect(r.endMin).toBe(30 * 60);
    expect(r.breaks).toEqual([{ kind: 'span', fromMin: 1455, toMin: 1485 }]);
  });

  it('does not guess the next day without the box: end before start stays an error for the logic', () => {
    const r = val(parseDayForm(form({ start: '22:00', end: '06:00' })));
    expect(r.endMin).toBe(360);
    expect(setWorkday(emptyBook(), r, NOW)).toEqual({ ok: false, reason: 'end-before-start' });
  });

  it('refuses what cannot be read', () => {
    expect(parseDayForm(form({ date: '23.11.2026' }))).toEqual({ ok: false, reason: 'bad-date' });
    expect(parseDayForm(form({ start: '' }))).toEqual({ ok: false, reason: 'bad-minute' });
    expect(parseDayForm(form({ start: '8:00' }))).toEqual({ ok: false, reason: 'bad-minute' });
    expect(parseDayForm(form({ end: '25:00' }))).toEqual({ ok: false, reason: 'bad-minute' });
    expect(parseDayForm(form({ breaks: [{ ...emptyBreak(), minutes: '' }] }))).toEqual({
      ok: false,
      reason: 'bad-break',
    });
    expect(parseDayForm(form({ breaks: [{ ...emptyBreak(), minutes: '-5' }] }))).toEqual({
      ok: false,
      reason: 'bad-break',
    });
    expect(parseDayForm(form({ breaks: [{ ...emptyBreak(), minutes: '1.5' }] }))).toEqual({
      ok: false,
      reason: 'bad-break',
    });
    expect(parseDayForm(form({ breaks: [{ ...emptyBreak('span'), from: 'x', to: '' }] }))).toEqual({
      ok: false,
      reason: 'bad-break',
    });
  });

  it('round-trips a stored day through the form (also past midnight and running)', () => {
    const days = [
      day(),
      day({
        startMin: 22 * 60,
        endMin: 30 * 60,
        breaks: [{ kind: 'span', fromMin: 1455, toMin: 1485 }],
      }),
      day({ endMin: null, breaks: [{ kind: 'span', fromMin: 700, toMin: null }] }),
    ];
    for (const d of days) {
      const parsed = val(parseDayForm(dayToForm(d)));
      expect(parsed).toEqual({
        date: d.date,
        startMin: d.startMin,
        endMin: d.endMin,
        breaks: d.breaks,
        note: d.note,
      });
    }
  });
});

describe('month helpers', () => {
  it('labels and shifts months', () => {
    expect(monthLabel('2026-03')).toBe('März 2026');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', -23)).toBe('2024-12');
    expect(shiftMonth('2026-11', 0)).toBe('2026-11');
  });
  it('labels dates with the right weekday', () => {
    expect(dateLabel('2026-11-23')).toBe('Mo 23.11.2026');
    expect(dateLabel('1970-01-01')).toBe('Do 01.01.1970');
    expect(dateLabel('2028-02-29')).toBe('Di 29.02.2028');
    expect(dateLabel('2026-11-22')).toBe('So 22.11.2026');
  });
  it('writes the texts of a row', () => {
    const b = bookWith(
      day(),
      day({ date: '2026-11-24', endMin: null, breaks: [] }),
      day({ date: '2026-11-25', startMin: 22 * 60, endMin: 30 * 60, breaks: [] }),
    );
    const rows = monthSummary(b, '2026-11').rows.map(rowTexts);
    expect(rows[0]).toEqual({
      date: 'Mo 23.11.2026',
      start: '08:00',
      end: '16:30',
      breaks: '0:30',
      work: '8:00',
      origin: 'Eingabe',
    });
    expect(rows[1]).toMatchObject({ end: 'läuft', work: '–' });
    expect(rows[2]).toMatchObject({ end: '06:00 (+1)', work: '8:00' });
  });
});
