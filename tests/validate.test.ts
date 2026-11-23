import { LIMITS, checkSettings, checkWorkday, type Break } from '../src/logic/index.ts';
import { day } from './helpers.ts';

describe('checkWorkday', () => {
  it('accepts a normal day, an overnight shift and a running day', () => {
    expect(checkWorkday(day())).toBeNull();
    expect(checkWorkday(day({ startMin: 22 * 60, endMin: 30 * 60, breaks: [] }))).toBeNull();
    expect(checkWorkday(day({ endMin: null, breaks: [] }))).toBeNull();
  });

  it('refuses bad dates, minutes and origins', () => {
    expect(checkWorkday(day({ date: '2026-02-30' }))).toBe('bad-date');
    expect(checkWorkday(day({ startMin: -1 }))).toBe('bad-minute');
    expect(checkWorkday(day({ startMin: 1440 }))).toBe('bad-minute');
    expect(checkWorkday(day({ startMin: 480.5 }))).toBe('bad-minute');
    expect(checkWorkday(day({ endMin: LIMITS.maxEndMin + 1 }))).toBe('bad-minute');
    expect(checkWorkday(day({ origin: 'x' as 'stamp' }))).toBe('bad-origin');
    expect(checkWorkday(day({ recordedAt: 'gestern' }))).toBe('bad-date');
  });

  it('refuses end not after start and shifts over 24 hours', () => {
    expect(checkWorkday(day({ startMin: 600, endMin: 600 }))).toBe('end-before-start');
    expect(checkWorkday(day({ startMin: 600, endMin: 500 }))).toBe('end-before-start');
    expect(checkWorkday(day({ startMin: 0, endMin: 1440, breaks: [] }))).toBeNull(); // exactly 24 h
    expect(checkWorkday(day({ startMin: 100, endMin: 1541, breaks: [] }))).toBe('too-long');
  });

  it('refuses notes that are too long or carry control characters', () => {
    expect(checkWorkday(day({ note: 'x'.repeat(LIMITS.maxNoteChars) }))).toBeNull();
    expect(checkWorkday(day({ note: 'x'.repeat(LIMITS.maxNoteChars + 1) }))).toBe('bad-note');
    expect(checkWorkday(day({ note: 'a\u0000b' }))).toBe('bad-note');
    expect(checkWorkday(day({ note: 'a\uD800b' }))).toBe('bad-note');
    expect(checkWorkday(day({ note: 'Übung\nzwei' }))).toBe('bad-note');
    expect(checkWorkday(day({ note: 'Ärztin 😀' }))).toBeNull();
  });

  describe('breaks', () => {
    const span = (fromMin: number, toMin: number | null): Break => ({
      kind: 'span',
      fromMin,
      toMin,
    });
    it('accepts lengths and spans inside the day', () => {
      expect(
        checkWorkday(day({ breaks: [span(720, 750), { kind: 'length', minutes: 15 }] })),
      ).toBeNull();
    });
    it('refuses bad lengths', () => {
      expect(checkWorkday(day({ breaks: [{ kind: 'length', minutes: 0 }] }))).toBe('bad-break');
      expect(checkWorkday(day({ breaks: [{ kind: 'length', minutes: 1.5 }] }))).toBe('bad-break');
      expect(
        checkWorkday(
          day({
            startMin: 0,
            endMin: 1440,
            breaks: [{ kind: 'length', minutes: LIMITS.maxBreakLengthMinutes + 1 }],
          }),
        ),
      ).toBe('bad-break');
      expect(checkWorkday(day({ breaks: [{ kind: 'x' } as unknown as Break] }))).toBe('bad-break');
    });
    it('refuses spans outside the day, empty spans and overlaps', () => {
      expect(checkWorkday(day({ breaks: [span(470, 500)] }))).toBe('break-outside');
      expect(checkWorkday(day({ breaks: [span(960, 1000)] }))).toBe('break-outside');
      expect(checkWorkday(day({ breaks: [span(720, 720)] }))).toBe('bad-break');
      expect(checkWorkday(day({ breaks: [span(720, 760), span(750, 780)] }))).toBe('break-overlap');
      expect(checkWorkday(day({ breaks: [span(750, 780), span(720, 750)] }))).toBeNull(); // touching, unsorted
    });
    it('allows one open span only on a running day', () => {
      expect(checkWorkday(day({ endMin: null, breaks: [span(720, null)] }))).toBeNull();
      expect(checkWorkday(day({ endMin: null, breaks: [span(700, null), span(720, null)] }))).toBe(
        'bad-break',
      );
      expect(checkWorkday(day({ breaks: [span(720, null)] }))).toBe('open-break-on-closed-day');
    });
    it('refuses breaks longer than the day and too many breaks', () => {
      expect(
        checkWorkday(
          day({ startMin: 600, endMin: 660, breaks: [{ kind: 'length', minutes: 61 }] }),
        ),
      ).toBe('breaks-too-long');
      expect(
        checkWorkday(
          day({ startMin: 600, endMin: 660, breaks: [{ kind: 'length', minutes: 60 }] }),
        ),
      ).toBeNull();
      const many = Array.from(
        { length: LIMITS.maxBreaksPerDay + 1 },
        () => ({ kind: 'length', minutes: 1 }) as Break,
      );
      expect(checkWorkday(day({ breaks: many }))).toBe('too-many-breaks');
    });
  });
});

describe('checkSettings', () => {
  it('checks label and retention at the boundaries', () => {
    expect(checkSettings({ employeeLabel: '', retentionMonths: 1 })).toBeNull();
    expect(checkSettings({ employeeLabel: '', retentionMonths: 120 })).toBeNull();
    expect(checkSettings({ employeeLabel: '', retentionMonths: 0 })).toBe('bad-retention');
    expect(checkSettings({ employeeLabel: '', retentionMonths: 121 })).toBe('bad-retention');
    expect(checkSettings({ employeeLabel: '', retentionMonths: 2.5 })).toBe('bad-retention');
    expect(checkSettings({ employeeLabel: 'x'.repeat(101), retentionMonths: 24 })).toBe(
      'bad-label',
    );
  });
});
