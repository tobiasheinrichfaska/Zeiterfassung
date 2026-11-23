import {
  LIMITS,
  breakEnd,
  breakStart,
  emptyBook,
  openDay,
  removeWorkday,
  setWorkday,
  stampIn,
  stampOut,
  updateSettings,
  workMinutes,
} from '../src/logic/index.ts';
import { NOW, bookWith, day, val } from './helpers.ts';

const at = (date: string, h: number, m = 0) => ({ date, minute: h * 60 + m });

describe('stamp clock', () => {
  it('runs a whole day: in, break, back, out', () => {
    let b = val(stampIn(emptyBook(), at('2026-11-23', 8), NOW));
    expect(openDay(b)?.origin).toBe('stamp');
    b = val(breakStart(b, at('2026-11-23', 12), NOW));
    b = val(breakEnd(b, at('2026-11-23', 12, 30), NOW));
    b = val(stampOut(b, at('2026-11-23', 16, 30), NOW));
    const d = b.days['2026-11-23']!;
    expect(d.endMin).toBe(990);
    expect(d.breaks).toEqual([{ kind: 'span', fromMin: 720, toMin: 750 }]);
    expect(workMinutes(d)).toBe(480);
    expect(openDay(b)).toBeUndefined();
  });

  it('refuses a second arrival while running and a second stamp on a finished day', () => {
    const b = val(stampIn(emptyBook(), at('2026-11-23', 8), NOW));
    expect(stampIn(b, at('2026-11-23', 9), NOW)).toEqual({ ok: false, reason: 'already-running' });
    const done = val(stampOut(b, at('2026-11-23', 12), NOW));
    expect(stampIn(done, at('2026-11-23', 13), NOW)).toEqual({ ok: false, reason: 'day-exists' });
  });

  it('refuses out, break start and break end without a running day', () => {
    const b = emptyBook();
    expect(stampOut(b, at('2026-11-23', 8), NOW)).toEqual({ ok: false, reason: 'not-running' });
    expect(breakStart(b, at('2026-11-23', 8), NOW)).toEqual({ ok: false, reason: 'not-running' });
    expect(breakEnd(b, at('2026-11-23', 8), NOW)).toEqual({ ok: false, reason: 'not-running' });
  });

  it('refuses break end without a running break and a second break start', () => {
    let b = val(stampIn(emptyBook(), at('2026-11-23', 8), NOW));
    expect(breakEnd(b, at('2026-11-23', 9), NOW)).toEqual({
      ok: false,
      reason: 'no-break-running',
    });
    b = val(breakStart(b, at('2026-11-23', 9), NOW));
    expect(breakStart(b, at('2026-11-23', 10), NOW)).toEqual({
      ok: false,
      reason: 'break-running',
    });
  });

  it('refuses a break that ends in the minute it began, and a departure in the arrival minute', () => {
    let b = val(stampIn(emptyBook(), at('2026-11-23', 8), NOW));
    expect(stampOut(b, at('2026-11-23', 8), NOW)).toEqual({
      ok: false,
      reason: 'end-before-start',
    });
    b = val(breakStart(b, at('2026-11-23', 9), NOW));
    expect(breakEnd(b, at('2026-11-23', 9), NOW)).toEqual({ ok: false, reason: 'bad-break' });
  });

  it('ends a running break together with the departure', () => {
    let b = val(stampIn(emptyBook(), at('2026-11-23', 8), NOW));
    b = val(breakStart(b, at('2026-11-23', 15), NOW));
    b = val(stampOut(b, at('2026-11-23', 16), NOW));
    expect(b.days['2026-11-23']!.breaks).toEqual([{ kind: 'span', fromMin: 900, toMin: 960 }]);
  });

  it('counts minutes past midnight onto the arrival day', () => {
    let b = val(stampIn(emptyBook(), at('2026-11-23', 22), NOW));
    b = val(breakStart(b, at('2026-11-24', 0, 15), NOW));
    b = val(breakEnd(b, at('2026-11-24', 0, 45), NOW));
    b = val(stampOut(b, at('2026-11-24', 6), NOW));
    const d = b.days['2026-11-23']!;
    expect(d.endMin).toBe(30 * 60);
    expect(d.breaks).toEqual([{ kind: 'span', fromMin: 1455, toMin: 1485 }]);
    expect(workMinutes(d)).toBe(8 * 60 - 30);
  });

  it('refuses a shift over 24 hours (forgotten stamp-out)', () => {
    const b = val(stampIn(emptyBook(), at('2026-11-23', 8), NOW));
    expect(stampOut(b, at('2026-11-24', 9), NOW)).toEqual({ ok: false, reason: 'too-long' });
    expect(stampOut(b, at('2026-11-25', 9), NOW)).toEqual({ ok: false, reason: 'bad-minute' });
    expect(openDay(b)).toBeDefined(); // unchanged: the person corrects it in the entry form
  });

  it('does not change the book it was given', () => {
    const b = emptyBook();
    stampIn(b, at('2026-11-23', 8), NOW);
    expect(b.days).toEqual({});
  });
});

describe('„Kommen“ on a finished day (reopen)', () => {
  const finished = () => {
    let b = val(stampIn(emptyBook(), at('2026-11-23', 8), NOW));
    b = val(breakStart(b, at('2026-11-23', 10), NOW));
    b = val(breakEnd(b, at('2026-11-23', 10, 15), NOW));
    return val(stampOut(b, at('2026-11-23', 12), NOW));
  };
  const reopen = { confirmReopen: true };

  it('refuses without the confirmation', () => {
    expect(stampIn(finished(), at('2026-11-23', 13), NOW)).toEqual({
      ok: false,
      reason: 'day-exists',
    });
    expect(stampIn(finished(), at('2026-11-23', 13), NOW, { confirmReopen: false })).toEqual({
      ok: false,
      reason: 'day-exists',
    });
  });

  it('reopens the day: no departure, the gap is a break span, the old break stays', () => {
    const b = val(stampIn(finished(), at('2026-11-23', 13), NOW, reopen));
    const d = b.days['2026-11-23']!;
    expect(d.endMin).toBeNull();
    expect(d.startMin).toBe(480);
    expect(d.breaks).toEqual([
      { kind: 'span', fromMin: 600, toMin: 615 },
      { kind: 'span', fromMin: 720, toMin: 780 },
    ]);
    expect(openDay(b)?.date).toBe('2026-11-23');
  });

  it('does not count the gap as working time', () => {
    let b = val(stampIn(finished(), at('2026-11-23', 13), NOW, reopen));
    b = val(stampOut(b, at('2026-11-23', 17), NOW));
    // 8:00-17:00 = 9 h, minus 15 min and 60 min of breaks
    expect(workMinutes(b.days['2026-11-23']!)).toBe(9 * 60 - 15 - 60);
  });

  it('keeps the origin and takes the new record time', () => {
    const later = '2026-11-23T12:00:00.000Z';
    const b = val(stampIn(finished(), at('2026-11-23', 13), later, reopen));
    expect(b.days['2026-11-23']!.origin).toBe('stamp');
    expect(b.days['2026-11-23']!.recordedAt).toBe(later);
  });

  it('adds no break when stamping in the very minute of the departure', () => {
    const b = val(stampIn(finished(), at('2026-11-23', 12), NOW, reopen));
    expect(b.days['2026-11-23']!.breaks).toEqual([{ kind: 'span', fromMin: 600, toMin: 615 }]);
  });

  it('refuses a clock before the departure (nothing changes)', () => {
    const before = finished();
    expect(stampIn(before, at('2026-11-23', 11, 59), NOW, reopen)).toEqual({
      ok: false,
      reason: 'clock-before-end',
    });
    expect(before.days['2026-11-23']!.endMin).toBe(720);
  });

  it('allows the last minute of the day as the end of the gap', () => {
    const b = val(stampIn(finished(), at('2026-11-23', 23, 59), NOW, reopen));
    expect(b.days['2026-11-23']!.breaks.at(-1)).toEqual({
      kind: 'span',
      fromMin: 720,
      toMin: 1439,
    });
  });

  it('then runs to the end of a shift past midnight, the gap counted as break', () => {
    let b = val(stampIn(finished(), at('2026-11-23', 22), NOW, reopen));
    b = val(stampOut(b, at('2026-11-24', 2), NOW)); // 8:00 .. 26:00 = 18 h
    const d = b.days['2026-11-23']!;
    expect(d.endMin).toBe(26 * 60);
    expect(workMinutes(d)).toBe(18 * 60 - 15 - 10 * 60); // breaks 15 min + gap 12:00-22:00
  });

  it('refuses when the stretched shift would pass 24 hours', () => {
    const b = val(stampIn(finished(), at('2026-11-23', 22), NOW, reopen));
    expect(stampOut(b, at('2026-11-24', 9), NOW)).toEqual({ ok: false, reason: 'too-long' });
  });

  it('refuses when the day already has 20 breaks', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      kind: 'span' as const,
      fromMin: 500 + i * 10,
      toMin: 505 + i * 10,
    }));
    const b = bookWith(day({ startMin: 480, endMin: 720, breaks: many }));
    expect(stampIn(b, at('2026-11-23', 13), NOW, reopen)).toEqual({
      ok: false,
      reason: 'too-many-breaks',
    });
  });

  it('reopens a day that was typed in the form as well (length breaks stay)', () => {
    const b = bookWith(
      day({ startMin: 480, endMin: 990, breaks: [{ kind: 'length', minutes: 30 }] }),
    );
    const r = val(stampIn(b, at('2026-11-23', 18), NOW, reopen));
    expect(r.days['2026-11-23']!.breaks).toEqual([
      { kind: 'length', minutes: 30 },
      { kind: 'span', fromMin: 990, toMin: 1080 },
    ]);
  });

  it('a stamp after midnight is a new day, not a reopen (the shift ended past midnight)', () => {
    const night = bookWith(day({ startMin: 22 * 60, endMin: 26 * 60, breaks: [] })); // keyed the 23rd
    const r = val(stampIn(night, at('2026-11-24', 3), NOW));
    expect(Object.keys(r.days).sort()).toEqual(['2026-11-23', '2026-11-24']);
  });

  it('refuses while a day runs', () => {
    const running = val(stampIn(emptyBook(), at('2026-11-23', 8), NOW));
    expect(stampIn(running, at('2026-11-23', 9), NOW, reopen)).toEqual({
      ok: false,
      reason: 'already-running',
    });
  });
});

describe('entry form', () => {
  const input = { date: '2026-11-23', startMin: 480, endMin: 990, breaks: [], note: '' };

  it('creates and replaces a day as manual', () => {
    let b = val(setWorkday(emptyBook(), input, NOW));
    expect(b.days['2026-11-23']!.origin).toBe('manual');
    b = val(setWorkday(b, { ...input, endMin: 1000 }, '2026-11-24T08:00:00.000Z'));
    expect(b.days['2026-11-23']!.endMin).toBe(1000);
    expect(b.days['2026-11-23']!.recordedAt).toBe('2026-11-24T08:00:00.000Z');
  });

  it('refuses invalid input without changing anything', () => {
    const b = emptyBook();
    expect(setWorkday(b, { ...input, endMin: 400 }, NOW)).toEqual({
      ok: false,
      reason: 'end-before-start',
    });
  });

  it('allows only one running day', () => {
    const running = val(setWorkday(emptyBook(), { ...input, endMin: null }, NOW));
    expect(setWorkday(running, { ...input, date: '2026-11-24', endMin: null }, NOW)).toEqual({
      ok: false,
      reason: 'second-open-day',
    });
    expect(setWorkday(running, { ...input, endMin: null, note: 'neu' }, NOW).ok).toBe(true); // same day
  });

  it('refuses more days than the limit', () => {
    const days = Object.fromEntries(
      Array.from({ length: LIMITS.maxDays }, (_, i) => {
        const date = new Date(Date.UTC(2000, 0, 1 + i)).toISOString().slice(0, 10);
        return [date, day({ date })];
      }),
    );
    const full = { ...emptyBook(), days };
    expect(setWorkday(full, { ...input, date: '2026-11-23' }, NOW)).toEqual({
      ok: false,
      reason: 'too-many-days',
    });
    const existing = Object.keys(days)[0]!;
    expect(setWorkday(full, { ...input, date: existing }, NOW).ok).toBe(true); // replacing is fine
  });

  it('removes a day, or says there is none', () => {
    const b = bookWith(day());
    expect(val(removeWorkday(b, '2026-11-23')).days).toEqual({});
    expect(removeWorkday(b, '2026-11-24')).toEqual({ ok: false, reason: 'no-such-day' });
  });
});

describe('settings', () => {
  it('stores valid settings and refuses invalid ones', () => {
    const b = val(
      updateSettings(emptyBook(), { employeeLabel: 'Pers.-Nr. 17', retentionMonths: 36 }),
    );
    expect(b.settings).toEqual({ employeeLabel: 'Pers.-Nr. 17', retentionMonths: 36 });
    expect(updateSettings(b, { employeeLabel: '', retentionMonths: 0 })).toEqual({
      ok: false,
      reason: 'bad-retention',
    });
  });
});
