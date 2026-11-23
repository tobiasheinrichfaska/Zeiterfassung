import {
  BOOK_VERSION,
  LIMITS,
  emptyBook,
  exportBackup,
  importBackup,
  markExported,
  purgeExpired,
  retentionReport,
  type TimeBook,
} from '../src/logic/index.ts';
import { bookWith, day, val } from './helpers.ts';

function sample(): TimeBook {
  const b = bookWith(
    day(),
    day({
      date: '2026-11-24',
      endMin: null,
      breaks: [{ kind: 'span', fromMin: 700, toMin: null }],
    }),
  );
  b.settings = { employeeLabel: 'Anna', retentionMonths: 12 };
  b.exportedMonths['2026-10'] = '2026-11-01T06:00:00.000Z';
  return b;
}

describe('backup', () => {
  it('round-trips the whole book', () => {
    const b = sample();
    expect(val(importBackup(exportBackup(b)))).toEqual(b);
    expect(val(importBackup(exportBackup(emptyBook())))).toEqual(emptyBook());
  });

  const mutate = (f: (raw: Record<string, any>) => void): string => {
    const raw = JSON.parse(exportBackup(sample()));
    f(raw);
    return JSON.stringify(raw);
  };

  it('refuses what is not a backup', () => {
    expect(importBackup('')).toEqual({ ok: false, reason: 'bad-backup' });
    expect(importBackup('[]')).toEqual({ ok: false, reason: 'bad-backup' });
    expect(importBackup('{"format":"other"}')).toEqual({ ok: false, reason: 'bad-backup' });
    expect(importBackup('x'.repeat(LIMITS.maxBackupChars + 1))).toEqual({
      ok: false,
      reason: 'bad-backup',
    });
  });

  it('refuses another version', () => {
    expect(importBackup(mutate((r) => (r.version = BOOK_VERSION + 1)))).toEqual({
      ok: false,
      reason: 'unknown-version',
    });
  });

  it('refuses unknown members at every level', () => {
    expect(importBackup(mutate((r) => (r.extra = 1))).ok).toBe(false);
    expect(importBackup(mutate((r) => (r.settings.extra = 1))).ok).toBe(false);
    expect(importBackup(mutate((r) => (r.days['2026-11-23'].extra = 1))).ok).toBe(false);
    expect(importBackup(mutate((r) => (r.days['2026-11-23'].breaks[0].extra = 1))).ok).toBe(false);
  });

  it('refuses days that break the rules or sit under the wrong key', () => {
    expect(importBackup(mutate((r) => (r.days['2026-11-23'].endMin = 100))).ok).toBe(false);
    expect(importBackup(mutate((r) => (r.days['2026-11-23'].date = '2026-11-22'))).ok).toBe(false);
    expect(importBackup(mutate((r) => (r.days['not-a-date'] = r.days['2026-11-23']))).ok).toBe(
      false,
    );
    expect(
      importBackup(mutate((r) => (r.days['2026-11-23'].breaks = [{ kind: 'weird' }]))).ok,
    ).toBe(false);
  });

  it('refuses bad settings and bad export marks', () => {
    expect(importBackup(mutate((r) => (r.settings.retentionMonths = 0))).ok).toBe(false);
    expect(
      importBackup(mutate((r) => (r.exportedMonths['2026-13'] = '2026-11-01T00:00:00Z'))).ok,
    ).toBe(false);
    expect(importBackup(mutate((r) => (r.exportedMonths['2026-10'] = 'gestern'))).ok).toBe(false);
  });

  it('refuses two running days', () => {
    const r = importBackup(
      mutate((raw) => {
        raw.days['2026-11-23'].endMin = null;
        raw.days['2026-11-23'].breaks = [];
      }),
    );
    expect(r).toEqual({ ok: false, reason: 'second-open-day' });
  });

  it('does not let a day called __proto__ pollute anything', () => {
    const text = exportBackup(sample()).replace('"2026-11-23": {', '"__proto__": {');
    expect(importBackup(text).ok).toBe(false);
    expect(({} as Record<string, unknown>).date).toBeUndefined();
  });
});

describe('retention', () => {
  const book = (): TimeBook => {
    const b = bookWith(
      day({ date: '2025-01-10', recordedAt: '2025-01-11T08:00:00.000Z' }), // January 2025
      day({ date: '2025-10-05', recordedAt: '2025-10-06T08:00:00.000Z' }),
      day({ date: '2025-11-30', recordedAt: '2025-12-01T08:00:00.000Z' }),
      day({ date: '2026-11-23' }),
    );
    b.settings.retentionMonths = 12;
    return b;
  };

  it('is due strictly after the retention time (12 months: Nov 2025 is still kept in Nov 2026)', () => {
    const r = retentionReport(book(), '2026-11-23');
    expect(r.blocked).toEqual(['2025-01', '2025-10']);
    expect(r.purgeable).toEqual([]);
    expect(retentionReport(book(), '2026-12-01').blocked).toEqual([
      '2025-01',
      '2025-10',
      '2025-11',
    ]);
  });

  it('purges only exported months and keeps the rest, with a warning list', () => {
    let b = book();
    b = val(markExported(b, '2025-01', '2026-02-01T00:00:00.000Z'));
    const r = retentionReport(b, '2026-11-23');
    expect(r).toEqual({ purgeable: ['2025-01'], blocked: ['2025-10'], stale: [] });
    const after = purgeExpired(b, '2026-11-23');
    expect(Object.keys(after.days)).toEqual(['2025-10-05', '2025-11-30', '2026-11-23']);
    expect(after.exportedMonths['2025-01']).toBeDefined(); // the proof of the export stays
  });

  it('never deletes a running day', () => {
    let b = bookWith(
      day({ date: '2024-01-10', endMin: null, breaks: [], recordedAt: '2024-01-10T08:00:00.000Z' }),
    );
    b = val(markExported(b, '2024-01', '2024-02-01T00:00:00.000Z'));
    expect(Object.keys(purgeExpired(b, '2026-11-23').days)).toEqual(['2024-01-10']);
  });

  it('refuses to mark a bad month and does not change the book', () => {
    const b = book();
    expect(markExported(b, '2025-13', 'x')).toEqual({ ok: false, reason: 'bad-month' });
    expect(purgeExpired(b, '2026-11-23')).toEqual(b);
  });
});
