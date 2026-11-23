import {
  emptyBook,
  monthSummary,
  monthToXml,
  updateSettings,
  workMinutes,
} from '../src/logic/index.ts';
import { bookWith, day, val } from './helpers.ts';

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

describe('monthToXml', () => {
  it('writes the summary with the totals', () => {
    const book = val(
      updateSettings(bookWith(day(), day({ date: '2026-11-24', origin: 'stamp' })), {
        employeeLabel: 'Anna',
        retentionMonths: 24,
      }),
    );
    const xml = val(monthToXml(book, '2026-11', '2026-12-01T06:00:00.000Z'));
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<zeiterfassung-monat xmlns="urn:zeiterfassung:monat:1" monat="2026-11" erstellt="2026-12-01T06:00:00.000Z">',
        '  <mitarbeiter>Anna</mitarbeiter>',
        '  <tage anzahl="2" summe-arbeitszeit-minuten="960" offene-tage="0">',
        '    <tag datum="2026-11-23" beginn="08:00" ende="16:30" pause-minuten="30" arbeitszeit-minuten="480" erfassung="manuell"/>',
        '    <tag datum="2026-11-24" beginn="08:00" ende="16:30" pause-minuten="30" arbeitszeit-minuten="480" erfassung="stempel"/>',
        '  </tage>',
        '</zeiterfassung-monat>',
        '',
      ].join('\n'),
    );
  });

  it('escapes markup in the label and notes', () => {
    const book = val(
      updateSettings(bookWith(day({ note: `a<b>&"c'` })), {
        employeeLabel: '<x & "y">',
        retentionMonths: 24,
      }),
    );
    const xml = val(monthToXml(book, '2026-11', 'T'));
    expect(xml).toContain('<mitarbeiter>&lt;x &amp; &quot;y&quot;&gt;</mitarbeiter>');
    expect(xml).toContain('<notiz>a&lt;b&gt;&amp;&quot;c&apos;</notiz>');
    expect(xml).not.toContain('<b>');
  });

  it('marks a shift past midnight and leaves out the end of a running day', () => {
    const book = bookWith(
      day({ date: '2026-11-23', startMin: 22 * 60, endMin: 30 * 60, breaks: [] }),
      day({ date: '2026-11-24', endMin: null, breaks: [] }),
    );
    const xml = val(monthToXml(book, '2026-11', 'T'));
    expect(xml).toContain(
      'beginn="22:00" ende="06:00" ende-folgetag="true" pause-minuten="0" arbeitszeit-minuten="480"',
    );
    expect(xml).toContain(
      '<tag datum="2026-11-24" beginn="08:00" pause-minuten="0" erfassung="manuell"/>',
    );
    expect(xml).toContain('offene-tage="1"');
  });

  it('refuses a bad month', () => {
    expect(monthToXml(emptyBook(), '2026-13', 'T')).toEqual({ ok: false, reason: 'bad-month' });
  });
});
