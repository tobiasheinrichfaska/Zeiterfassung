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
