import { createHash } from 'node:crypto';
import {
  checkDaysAgainstChain,
  exportBackup,
  markExported,
  monthToJson,
  purgeExpired,
  readBackupFile,
  REASON_TEXTS,
  chainMismatchNote,
  removeWorkday,
  setWorkday,
  stampIn,
  stampOut,
  emptyBook,
  type TimeBook,
} from '../src/logic/index.ts';
import { bookWith, day, val } from './helpers.ts';

/** Two stamped days in November (Kommen/Gehen) and one entered by the form. */
function stamped(): TimeBook {
  let b = emptyBook();
  for (const date of ['2026-11-02', '2026-11-03']) {
    b = val(stampIn(b, { date, minute: 480 }, `${date}T08:00:00.000Z`));
    b = val(stampOut(b, { date, minute: 990 }, `${date}T16:30:00.000Z`));
  }
  return val(
    setWorkday(
      b,
      {
        date: '2026-11-04',
        startMin: 420,
        endMin: 900,
        breaks: [{ kind: 'length', minutes: 30 }],
        note: 'Büro „ß“',
      },
      '2026-11-04T15:00:00.000Z',
      { today: '2026-11-04' },
    ),
  );
}

/** The recipe of docs/data-model.html, written independently of the app's code. */
function canonical(v: unknown, indent = ''): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  const inner = `${indent}  `;
  if (Array.isArray(v))
    return v.length === 0
      ? '[]'
      : `[\n${v.map((x) => inner + canonical(x, inner)).join(',\n')}\n${indent}]`;
  const keys = Object.keys(v).sort();
  return keys.length === 0
    ? '{}'
    : `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${canonical((v as Record<string, unknown>)[k], inner)}`).join(',\n')}\n${indent}}`;
}
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('H3: the JSON attachment lets anyone recompute the chain', () => {
  it('version 4: each day carries the inputs of its content hash, which equals its newest stamp', () => {
    const b = stamped();
    const data = JSON.parse(val(monthToJson(b, '2026-11', '2026-12-01T06:00:00.000Z')));
    expect(data.version).toBe(4);
    const stamps = data.timestamps.stamps as { date: string; contentHash: string; hash: string }[];
    expect(data.days).toHaveLength(3);
    for (const d of data.days) {
      const { date, startMin, endMin, breaks, origin, note, recordedAt } = d;
      const hash = sha(
        `${canonical({ date, startMin, endMin, breaks, origin, note, recordedAt })}\n`,
      );
      const newest = stamps.filter((s) => s.date === date).at(-1)!;
      expect(hash, date).toBe(newest.contentHash);
      expect(d.contentHash).toBe(hash);
    }
    // and each stamp's hash from its fields
    for (const s of data.timestamps.stamps) {
      const { n, at, kind, date, contentHash, prev, skew } = s;
      expect(sha(`${canonical({ n, at, kind, date, contentHash, prev, skew })}\n`)).toBe(s.hash);
    }
  });
});

describe('H3: days are compared with the chain', () => {
  it('a book the app wrote matches', () => {
    expect(checkDaysAgainstChain(stamped())).toEqual([]);
    // removed through the app: the deletion is stamped
    const removed = val(
      removeWorkday(stamped(), '2026-11-03', '2026-11-05T09:00:00.000Z', {
        today: '2026-11-05',
        reason: 'falsch',
      }),
    );
    expect(checkDaysAgainstChain(removed)).toEqual([]);
  });

  it('a changed time, a day removed or added outside the app is flagged', () => {
    const b = stamped();
    const changed = {
      ...b,
      days: { ...b.days, '2026-11-03': { ...b.days['2026-11-03']!, endMin: 1020 } },
    };
    expect(checkDaysAgainstChain(changed)).toEqual(['2026-11-03']);
    const rest = { ...b.days };
    delete rest['2026-11-02'];
    expect(checkDaysAgainstChain({ ...b, days: rest })).toEqual(['2026-11-02']);
    const added = {
      ...b,
      days: {
        ...b.days,
        '2026-11-05': day({ date: '2026-11-05', recordedAt: '2026-11-05T09:00:00.000Z' }),
      },
    };
    expect(checkDaysAgainstChain(added)).toEqual(['2026-11-05']);
    expect(chainMismatchNote(['2026-11-03'])).toContain('03.11.2026');
  });

  it('days from before the chain (book version 1/2) and purged exported months pass', () => {
    expect(checkDaysAgainstChain(bookWith(day()))).toEqual([]);
    const old = {
      ...stamped(),
      days: {
        ...stamped().days,
        '2026-10-01': day({ date: '2026-10-01', recordedAt: '2026-10-01T16:00:00.000Z' }),
      },
    };
    expect(checkDaysAgainstChain(old)).toEqual([]);
    const exported = val(markExported(stamped(), '2026-11', '2026-12-01T06:00:00.000Z'));
    const purged = purgeExpired(
      { ...exported, settings: { ...exported.settings, retentionMonths: 1 } },
      '2027-01-05',
    );
    expect(Object.keys(purged.days)).toEqual([]);
    expect(checkDaysAgainstChain(purged)).toEqual([]);
  });

  it('a backup with one changed time is refused; the unchanged backup is read', async () => {
    const b = stamped();
    expect((await readBackupFile(exportBackup(b))).ok).toBe(true);
    const o = JSON.parse(exportBackup(b));
    o.days['2026-11-02'].endMin = 1050; // 17:30 instead of 16:30, chain untouched
    expect(await readBackupFile(JSON.stringify(o))).toEqual({
      ok: false,
      reason: 'backup-days-mismatch',
    });
    expect(REASON_TEXTS['backup-days-mismatch']).toMatch(/Stempelkette/);
  });
});
