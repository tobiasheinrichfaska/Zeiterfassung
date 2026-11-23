import { emptyBook, monthSummary, workMinutes } from '../src/logic/index.ts';
import { bookWith, day } from './helpers.ts';

describe('monthSummary', () => {
  it('sums finished days of the month, sorted, and counts running days apart', () => {
    const book = bookWith(
      day({ date: '2026-11-24' }), // 480
      day({ date: '2026-11-02', startMin: 480, endMin: 720, breaks: [] }), // 240
      day({ date: '2026-10-31' }), // other month
      day({ date: '2026-11-25', endMin: null, breaks: [] }),
    );
    const s = monthSummary(book, '2026-11');
    expect(s.rows.map((r) => r.date)).toEqual(['2026-11-02', '2026-11-24', '2026-11-25']);
    expect(s.workMinutes).toBe(720);
    expect(s.openDays).toBe(1);
    expect(s.rows[2]!.workMinutes).toBeNull();
  });

  it('is empty for a month without days', () => {
    expect(monthSummary(emptyBook(), '2026-11')).toEqual({
      month: '2026-11',
      rows: [],
      workMinutes: 0,
      openDays: 0,
    });
  });

  it('subtracts length and span breaks, and counts an open span as 0', () => {
    const d = day({
      breaks: [
        { kind: 'length', minutes: 10 },
        { kind: 'span', fromMin: 720, toMin: 735 },
      ],
    });
    expect(workMinutes(d)).toBe(8 * 60 + 30 - 25);
    expect(
      workMinutes(day({ endMin: null, breaks: [{ kind: 'span', fromMin: 700, toMin: null }] })),
    ).toBeNull();
  });
});
