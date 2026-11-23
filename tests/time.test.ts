import {
  clockFromDate,
  dayDiff,
  formatClock,
  formatDuration,
  formatIsoDate,
  isDateKey,
  isMonthKey,
  monthIndex,
  parseClock,
} from '../src/logic/index.ts';

describe('date keys', () => {
  it('accepts real dates only', () => {
    expect(isDateKey('2026-11-23')).toBe(true);
    expect(isDateKey('2028-02-29')).toBe(true);
    expect(isDateKey('2027-02-29')).toBe(false);
    expect(isDateKey('2026-13-01')).toBe(false);
    expect(isDateKey('2026-1-1')).toBe(false);
    expect(isDateKey('1800-01-01')).toBe(false);
    expect(isDateKey(20261123)).toBe(false);
    expect(isDateKey('__proto__')).toBe(false);
  });
  it('accepts months', () => {
    expect(isMonthKey('2026-12')).toBe(true);
    expect(isMonthKey('2026-00')).toBe(false);
    expect(isMonthKey('2026-13')).toBe(false);
  });
  it('counts days across month and year ends and leap days', () => {
    expect(dayDiff('2026-11-30', '2026-12-01')).toBe(1);
    expect(dayDiff('2026-12-31', '2027-01-01')).toBe(1);
    expect(dayDiff('2028-02-28', '2028-03-01')).toBe(2);
    expect(dayDiff('2026-11-23', '2026-11-20')).toBe(-3);
  });
  it('orders months', () => {
    expect(monthIndex('2027-01') - monthIndex('2026-12')).toBe(1);
  });
});

describe('clock', () => {
  it('reads the local wall clock of a Date', () => {
    expect(clockFromDate(new Date(2026, 10, 3, 7, 5))).toEqual({ date: '2026-11-03', minute: 425 });
    expect(clockFromDate(new Date(2026, 0, 1, 23, 59))).toEqual({
      date: '2026-01-01',
      minute: 1439,
    });
  });
  it('formats and parses', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(1530)).toBe('01:30'); // 25:30 wraps to the next day's clock
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(1500)).toBe('25:00');
    expect(formatDuration(-90)).toBe('-1:30');
    expect(parseClock('08:05')).toBe(485);
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('8:05')).toBeNull();
    expect(parseClock('08:60')).toBeNull();
  });
});

describe('formatIsoDate', () => {
  it('writes the German date of an ISO time', () => {
    expect(formatIsoDate('2026-12-01T06:00:00.000Z')).toBe('01.12.2026');
  });
});
