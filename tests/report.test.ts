import { createHash } from 'node:crypto';
import {
  REPORT_FORMAT,
  REPORT_VERSION,
  attachmentName,
  canonicalJson,
  emptyBook,
  moveWorkday,
  monthToJson,
  sha256Hex,
  updateSettings,
} from '../src/logic/index.ts';
import { bookWith, day, val } from './helpers.ts';

describe('canonicalJson', () => {
  it('sorts keys at every level, indents by two spaces and ends with a line break', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: null, y: true }], c: 'x' } })).toBe(
      [
        '{',
        '  "a": {',
        '    "c": "x",',
        '    "d": [',
        '      1,',
        '      {',
        '        "y": true,',
        '        "z": null',
        '      }',
        '    ]',
        '  },',
        '  "b": 1',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('writes empty containers compactly and keeps the order of arrays', () => {
    expect(canonicalJson({ a: [], b: {}, c: [3, 1, 2] })).toBe(
      '{\n  "a": [],\n  "b": {},\n  "c": [\n    3,\n    1,\n    2\n  ]\n}\n',
    );
  });

  it('does not depend on the order the keys were added in', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('only allows integers', () => {
    expect(() => canonicalJson({ a: 1.5 })).toThrow(TypeError);
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(canonicalJson({ a: -3, b: 0 })).toBe('{\n  "a": -3,\n  "b": 0\n}\n');
  });

  it('escapes strings like JSON does (quotes, umlauts, emoji)', () => {
    const text = canonicalJson({ s: 'a"b\\c Ärztin 😀' });
    expect(JSON.parse(text)).toEqual({ s: 'a"b\\c Ärztin 😀' });
  });
});

describe('sha256Hex', () => {
  it('matches the reference implementation', async () => {
    for (const text of ['', 'abc', 'Ärztin 😀 – Büro']) {
      expect(await sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('monthToJson', () => {
  const book = () =>
    val(
      moveWorkday(
        val(
          updateSettings(
            bookWith(
              day({ date: '2026-11-23' }),
              day({
                date: '2026-11-22',
                startMin: 22 * 60,
                endMin: 30 * 60,
                breaks: [],
                origin: 'stamp',
              }),
              day({
                date: '2026-11-24',
                endMin: null,
                breaks: [{ kind: 'span', fromMin: 600, toMin: null }],
              }),
              day({ date: '2026-10-31' }),
            ),
            { employeeLabel: 'Anna', retentionMonths: 24 },
          ),
        ),
        '2026-11-22',
        { date: '2026-11-21', startMin: 22 * 60, endMin: 30 * 60, breaks: [], note: 'Nacht' },
        '2026-11-23T08:00:00.000Z',
        { today: '2026-11-23', reason: 'falsches Datum' },
      ),
    );
  const CREATED = '2026-12-01T06:00:00.000Z';

  it('has the marker, the version, the label, the days, the sums and the changes of the month', () => {
    const data = JSON.parse(val(monthToJson(book(), '2026-11', CREATED)));
    expect(data.format).toBe(REPORT_FORMAT);
    expect(data.version).toBe(REPORT_VERSION);
    expect(data.month).toBe('2026-11');
    expect(data.created).toBe(CREATED);
    expect(data.employee).toBe('Anna');
    expect(data.days.map((d: { date: string }) => d.date)).toEqual([
      '2026-11-21',
      '2026-11-23',
      '2026-11-24',
    ]);
    expect(data.totalWorkMinutes).toBe(480 + 480);
    expect(data.openDays).toBe(1);
    expect(data.changes).toHaveLength(2);
    expect(data.changes[0]).toMatchObject({
      kind: 'removed',
      date: '2026-11-22',
      movedTo: '2026-11-21',
      reason: 'falsches Datum',
    });
  });

  it('describes a day completely, also past midnight and running', () => {
    const data = JSON.parse(val(monthToJson(book(), '2026-11', CREATED)));
    const [night, normal, running] = data.days;
    expect(night).toMatchObject({
      start: '22:00',
      end: '06:00',
      endNextDay: true,
      endMin: 1800,
      workMinutes: 480,
      origin: 'manual',
      note: 'Nacht',
    });
    expect(normal).toMatchObject({
      start: '08:00',
      end: '16:30',
      endNextDay: false,
      breakMinutes: 30,
      workMinutes: 480,
      breaks: [{ kind: 'length', minutes: 30 }],
    });
    expect(running).toMatchObject({
      end: null,
      endMin: null,
      workMinutes: null,
      breaks: [{ kind: 'span', fromMin: 600, toMin: null }],
    });
  });

  it('is canonical: the text is the canonical form of itself, keys sorted, integers only', () => {
    const text = val(monthToJson(book(), '2026-11', CREATED));
    expect(canonicalJson(JSON.parse(text))).toBe(text);
    expect(text.endsWith('}\n')).toBe(true);
    const numbers = [...text.matchAll(/: (-?[\d.]+)[,\n]/g)].map((m) => m[1]);
    expect(numbers.length).toBeGreaterThan(5);
    for (const n of numbers) expect(n).toMatch(/^-?\d+$/);
  });

  it('is the same text for the same data', () => {
    expect(val(monthToJson(book(), '2026-11', CREATED))).toBe(
      val(monthToJson(book(), '2026-11', CREATED)),
    );
  });

  it('is empty but complete for a month without days', () => {
    const data = JSON.parse(val(monthToJson(emptyBook(), '2026-11', CREATED)));
    expect(data).toMatchObject({
      days: [],
      changes: [],
      totalWorkMinutes: 0,
      openDays: 0,
      employee: '',
    });
  });

  it('refuses a bad month and names the file', () => {
    expect(monthToJson(emptyBook(), '2026-13', CREATED)).toEqual({
      ok: false,
      reason: 'bad-month',
    });
    expect(attachmentName('2026-11')).toBe('zeiterfassung-2026-11.json');
  });
});
