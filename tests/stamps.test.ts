import {
  LIMITS,
  ZERO_HASH,
  appendStamp,
  breakEnd,
  breakStart,
  chainHead,
  checkChain,
  compactStamps,
  dayContentHash,
  emptyBook,
  exportBackup,
  importBackup,
  markExported,
  moveWorkday,
  purgeExpired,
  removeWorkday,
  retentionReport,
  sealElapsedDays,
  setWorkday,
  skewedStamps,
  stampHash,
  stampIn,
  stampOut,
  stampsOfMonth,
  type Stamp,
  type TimeBook,
} from '../src/logic/index.ts';
import { CTX, bookWith, day, val } from './helpers.ts';

const at = (date: string, h: number, m = 0) => ({ date, minute: h * 60 + m });
const input = { date: '2026-11-23', startMin: 480, endMin: 990, breaks: [], note: '' };
const iso = (day: number, h = 8, m = 0) =>
  `2026-11-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;

describe('content hashes', () => {
  it('are stable, depend on every written field, and differ for a deleted day', () => {
    const d = day();
    const h = dayContentHash(d.date, d);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(dayContentHash(d.date, { ...d })).toBe(h);
    for (const changed of [
      { startMin: 481 },
      { endMin: 991 },
      { note: 'x' },
      { origin: 'stamp' as const },
      { recordedAt: '2026-11-23T09:00:01.000Z' },
      { breaks: [{ kind: 'length' as const, minutes: 31 }] },
    ]) {
      expect(dayContentHash(d.date, { ...d, ...changed }), JSON.stringify(changed)).not.toBe(h);
    }
    expect(dayContentHash(d.date, undefined)).not.toBe(h);
    expect(dayContentHash('2026-11-24', undefined)).not.toBe(dayContentHash(d.date, undefined));
  });
});

describe('the chain', () => {
  it('starts at 1 with 64 zeros and links every stamp to the one before', () => {
    let b = val(stampIn(emptyBook(), at('2026-11-23', 8), iso(23)));
    b = val(stampOut(b, at('2026-11-23', 16), iso(23, 16)));
    const [first, second] = b.stamps as [Stamp, Stamp];
    expect(first).toMatchObject({
      n: 1,
      prev: ZERO_HASH,
      kind: 'change',
      date: '2026-11-23',
      at: iso(23),
      skew: false,
    });
    expect(second).toMatchObject({ n: 2, prev: first.hash, at: iso(23, 16) });
    expect(first.hash).toBe(stampHash(first));
    expect(first.contentHash).toBe(
      dayContentHash(
        '2026-11-23',
        val(stampIn(emptyBook(), at('2026-11-23', 8), iso(23))).days['2026-11-23'],
      ),
    );
    expect(chainHead(b)).toEqual({ n: 2, hash: second.hash, at: iso(23, 16) });
    expect(checkChain(b.stamps, b.stampBase)).toBeNull();
  });

  it('stamps every finished write: arrival, break, departure, form, move, delete, reopen', () => {
    let b = val(stampIn(emptyBook(), at('2026-11-23', 8), iso(23)));
    b = val(breakStart(b, at('2026-11-23', 12), iso(23, 12)));
    b = val(breakEnd(b, at('2026-11-23', 12, 30), iso(23, 12, 30)));
    b = val(stampOut(b, at('2026-11-23', 16), iso(23, 16)));
    expect(b.stamps).toHaveLength(4);
    b = val(stampIn(b, at('2026-11-23', 17), iso(23, 17), { confirmReopen: true })); // reopen
    expect(b.stamps).toHaveLength(5);
    b = val(setWorkday(b, { ...input, date: '2026-11-22', endMin: 900 }, iso(23, 18), CTX));
    expect(b.stamps.at(-1)).toMatchObject({ date: '2026-11-22', kind: 'change' });
    const before = b.stamps.length;
    b = val(moveWorkday(b, '2026-11-22', { ...input, date: '2026-11-21' }, iso(23, 19), CTX));
    expect(b.stamps.slice(before).map((s) => s.date)).toEqual(['2026-11-22', '2026-11-21']); // removal, then the new day
    expect(b.stamps.at(-2)?.contentHash).toBe(dayContentHash('2026-11-22', undefined));
    b = val(removeWorkday(b, '2026-11-21', iso(23, 20), CTX));
    expect(b.stamps.at(-1)).toMatchObject({
      date: '2026-11-21',
      contentHash: dayContentHash('2026-11-21', undefined),
    });
    expect(b.stamps.map((s) => s.n)).toEqual(b.stamps.map((_, i) => i + 1)); // gapless
    expect(checkChain(b.stamps, b.stampBase)).toBeNull();
  });

  it('does not stamp a refused write (the book is unchanged)', () => {
    const b = val(stampIn(emptyBook(), at('2026-11-23', 8), iso(23)));
    expect(stampOut(b, at('2026-11-23', 8), iso(23))).toEqual({
      ok: false,
      reason: 'end-before-start',
    });
    expect(setWorkday(b, { ...input, endMin: 100 }, iso(23), CTX).ok).toBe(false);
    expect(removeWorkday(b, '2026-11-01', iso(23), CTX).ok).toBe(false);
    expect(b.stamps).toHaveLength(1);
  });

  it('marks a clock that went back as skew, and still appends', () => {
    let b = val(stampIn(emptyBook(), at('2026-11-23', 8), iso(23, 8)));
    b = val(breakStart(b, at('2026-11-23', 9), iso(23, 7))); // the device clock went back
    expect(b.stamps[1]).toMatchObject({ n: 2, skew: true });
    expect(skewedStamps(b.stamps).map((s) => s.n)).toEqual([2]);
    expect(checkChain(b.stamps, null)).toBeNull();
    // the same minute is not a step back
    const c = val(stampIn(emptyBook(), at('2026-11-23', 8), iso(23, 8)));
    expect(val(breakStart(c, at('2026-11-23', 9), iso(23, 8))).stamps[1]?.skew).toBe(false);
  });

  it('refuses a stamp when the chain is full (never trims)', () => {
    let b = emptyBook();
    for (let i = 0; i < LIMITS.maxStamps; i += 1)
      b = val(appendStamp(b, 'change', '2026-11-23', iso(23)));
    expect(b.stamps).toHaveLength(LIMITS.maxStamps);
    expect(appendStamp(b, 'change', '2026-11-23', iso(23))).toEqual({
      ok: false,
      reason: 'too-many-stamps',
    });
    expect(stampIn(b, at('2026-11-24', 8), iso(24))).toEqual({
      ok: false,
      reason: 'too-many-stamps',
    });
    expect(checkChain(b.stamps, null)).toBeNull();
  });
});

describe('seals', () => {
  const sealed = (b: TimeBook, today: string) => val(sealElapsedDays(b, today, iso(25)));

  it('seals each ended day once, only when its date is before today and it has a departure', () => {
    const b = bookWith(
      day({ date: '2026-11-20' }),
      day({ date: '2026-11-21' }),
      day({ date: '2026-11-22', endMin: null, breaks: [] }), // running: not yet
      day({ date: '2026-11-25' }), // today
    );
    const s = sealed(b, '2026-11-25');
    expect(s.stamps.map((x) => [x.kind, x.date])).toEqual([
      ['seal', '2026-11-20'],
      ['seal', '2026-11-21'],
    ]);
    expect(s.stamps[0]?.contentHash).toBe(dayContentHash('2026-11-20', b.days['2026-11-20']));
    expect(sealed(s, '2026-11-25')).toBe(s); // nothing more: the same book
  });

  it('seals a running day once it is closed, and does not seal again after a later change', () => {
    let b = sealed(bookWith(day({ date: '2026-11-22', endMin: null, breaks: [] })), '2026-11-25');
    expect(b.stamps).toHaveLength(0);
    b = val(
      setWorkday(b, { ...input, date: '2026-11-22', endMin: 1000 }, iso(25, 9), {
        today: '2026-11-25',
      }),
    );
    b = sealed(b, '2026-11-25');
    expect(b.stamps.map((x) => x.kind)).toEqual(['change', 'seal']);
    b = val(
      setWorkday(b, { ...input, date: '2026-11-22', endMin: 1010 }, iso(25, 10), {
        today: '2026-11-25',
      }),
    );
    expect(sealed(b, '2026-11-26').stamps.map((x) => x.kind)).toEqual(['change', 'seal', 'change']);
  });

  it('refuses everything when the chain has no room for all seals (the book stays as it was)', () => {
    let b = bookWith(day({ date: '2026-11-20' }), day({ date: '2026-11-21' }));
    for (let i = 0; i < LIMITS.maxStamps - 1; i += 1)
      b = val(appendStamp(b, 'change', '2026-11-20', iso(23)));
    expect(sealElapsedDays(b, '2026-11-25', iso(25))).toEqual({
      ok: false,
      reason: 'too-many-stamps',
    });
    expect(b.stamps).toHaveLength(LIMITS.maxStamps - 1);
  });
});

describe('checking the chain', () => {
  const chain = () => {
    let b = val(stampIn(emptyBook(), at('2026-11-23', 8), iso(23)));
    b = val(breakStart(b, at('2026-11-23', 12), iso(23, 12)));
    b = val(stampOut(b, at('2026-11-23', 16), iso(23, 16)));
    return b.stamps;
  };
  const edit = (f: (s: Stamp[]) => void) => {
    const copy = JSON.parse(JSON.stringify(chain())) as Stamp[];
    f(copy);
    return checkChain(copy, null);
  };

  it('accepts a good chain and an empty one', () => {
    expect(checkChain(chain(), null)).toBeNull();
    expect(checkChain([], null)).toBeNull();
  });

  it('finds a changed field in any stamp', () => {
    expect(edit((s) => (s[1]!.date = '2026-11-24'))).toBe('chain-broken');
    expect(edit((s) => (s[0]!.at = iso(24)))).toBe('chain-broken');
    expect(edit((s) => (s[2]!.kind = 'seal'))).toBe('chain-broken');
    expect(edit((s) => (s[1]!.contentHash = 'a'.repeat(64)))).toBe('chain-broken');
    expect(edit((s) => (s[2]!.hash = 'b'.repeat(64)))).toBe('chain-broken');
  });

  it('finds a gap, a removed first stamp, a swap and a wrong predecessor', () => {
    expect(edit((s) => s.splice(1, 1))).toBe('chain-broken');
    expect(edit((s) => s.shift())).toBe('chain-broken');
    expect(edit((s) => ([s[0], s[1]] = [s[1]!, s[0]!]))).toBe('chain-broken');
    expect(edit((s) => (s[1]!.prev = ZERO_HASH))).toBe('chain-broken');
    expect(edit((s) => (s[0]!.n = 2))).toBe('chain-broken');
  });

  it('finds a changed skew mark even when the hash was recomputed for it', () => {
    expect(
      edit((s) => {
        const copy = { ...s[1]!, skew: true };
        s[1] = { ...copy, hash: stampHash(copy) };
      }),
    ).toBe('chain-broken');
  });

  it('calls a stamp that is not even well formed a bad backup', () => {
    expect(edit((s) => ((s[0] as unknown as { n: string }).n = 'x'))).toBe('bad-backup');
    expect(edit((s) => (s[0]!.date = '2026-02-30'))).toBe('bad-backup');
    expect(edit((s) => (s[0]!.hash = 'ABC'))).toBe('bad-backup');
    expect(edit((s) => (s[0]!.at = 'gestern'))).toBe('bad-backup');
  });

  it('starts from the base after the old part was dropped', () => {
    const all = chain();
    const base = { n: all[0]!.n, hash: all[0]!.hash, at: all[0]!.at };
    expect(checkChain(all.slice(1), base)).toBeNull();
    expect(checkChain(all.slice(1), { ...base, hash: 'c'.repeat(64) })).toBe('chain-broken');
    expect(checkChain(all.slice(1), null)).toBe('chain-broken');
    expect(checkChain(all.slice(2), base)).toBe('chain-broken'); // a gap after the base
  });
});

describe('the chain in the backup', () => {
  const book = () => {
    let b = val(stampIn(emptyBook(), at('2026-11-23', 8), iso(23)));
    b = val(stampOut(b, at('2026-11-23', 16), iso(23, 16)));
    return b;
  };
  const text = (edit: (o: Record<string, any>) => void) => {
    const o = JSON.parse(exportBackup(book()));
    edit(o);
    return JSON.stringify(o);
  };

  it('round-trips with its stamps', () => {
    expect(val(importBackup(exportBackup(book())))).toEqual(book());
  });

  it('refuses a changed stamp as a broken chain, and a malformed one as a bad backup', () => {
    expect(importBackup(text((o) => (o.stamps[0].date = '2026-11-24')))).toEqual({
      ok: false,
      reason: 'chain-broken',
    });
    expect(importBackup(text((o) => o.stamps.reverse()))).toEqual({
      ok: false,
      reason: 'chain-broken',
    });
    expect(importBackup(text((o) => (o.stamps[0].extra = 1)))).toEqual({
      ok: false,
      reason: 'bad-backup',
    });
    expect(importBackup(text((o) => delete o.stamps[0].skew))).toEqual({
      ok: false,
      reason: 'bad-backup',
    });
    expect(importBackup(text((o) => (o.stamps = 'x')))).toEqual({
      ok: false,
      reason: 'bad-backup',
    });
    expect(
      importBackup(text((o) => (o.stampBase = { n: 0, hash: ZERO_HASH, at: iso(23) }))),
    ).toEqual({ ok: false, reason: 'bad-backup' });
  });

  it('refuses a chain over the limit', () => {
    const many = Array.from({ length: LIMITS.maxStamps + 1 }, () => book().stamps[0]);
    expect(importBackup(text((o) => (o.stamps = many)))).toEqual({
      ok: false,
      reason: 'too-many-stamps',
    });
  });
});

describe('purging keeps the chain', () => {
  it('keeps every stamp of a purged month (hashes only) so the chain does not break', () => {
    let b = bookWith(day({ date: '2025-01-10', recordedAt: '2025-01-11T08:00:00.000Z' }));
    b.settings.retentionMonths = 12;
    b = val(
      setWorkday(b, { ...input, date: '2025-01-10', endMin: 1000 }, '2025-01-12T08:00:00.000Z', {
        today: '2025-01-12',
      }),
    );
    b = val(sealElapsedDays(b, '2025-01-12', '2025-01-12T09:00:00.000Z'));
    b = val(markExported(b, '2025-01', '2025-02-01T00:00:00.000Z'));
    expect(retentionReport(b, '2026-11-23').purgeable).toEqual(['2025-01']);
    const after = purgeExpired(b, '2026-11-23');
    expect(after.days).toEqual({});
    expect(after.stamps).toEqual(b.stamps);
    expect(JSON.stringify(after.stamps)).not.toMatch(/note|startMin|breaks/); // no content
    expect(checkChain(after.stamps, after.stampBase)).toBeNull();
  });

  it('counts a stamp made after the export as a change of the month (stale)', () => {
    let b = bookWith(day({ date: '2025-01-10', recordedAt: '2025-01-11T08:00:00.000Z' }));
    b.settings.retentionMonths = 12;
    b = val(markExported(b, '2025-01', '2025-02-01T00:00:00.000Z'));
    expect(retentionReport(b, '2026-11-23').purgeable).toEqual(['2025-01']);
    b = val(sealElapsedDays(b, '2025-03-01', '2025-03-01T00:00:00.000Z')); // a seal after the export
    expect(retentionReport(b, '2026-11-23')).toMatchObject({ purgeable: [], stale: ['2025-01'] });
  });

  it('lists the stamps of a month', () => {
    const b = val(
      sealElapsedDays(
        bookWith(day({ date: '2026-10-31' }), day({ date: '2026-11-02' })),
        '2026-12-01',
        iso(25),
      ),
    );
    expect(stampsOfMonth(b, '2026-11').map((s) => s.date)).toEqual(['2026-11-02']);
  });
});

describe('compaction of a long chain', () => {
  /** Many stamps for days of January 2024 and a few for 2026, with a given relay setting. */
  const long = (relay: string) => {
    let b = bookWith(day({ date: '2026-11-23' }));
    b.settings = { employeeLabel: '', retentionMonths: 12, timestampRelay: relay };
    for (let i = 0; i < LIMITS.stampsCompactAt + 10; i += 1) {
      b = val(appendStamp(b, 'change', '2024-01-10', '2024-01-11T08:00:00.000Z'));
    }
    b = val(appendStamp(b, 'change', '2026-11-23', iso(23)));
    return b;
  };

  it('does nothing while the chain is short', () => {
    const b = bookWith(day());
    expect(compactStamps(b)).toBe(b);
  });

  it('with no relay set drops the stamps of months without days and starts from the last dropped one', () => {
    const b = long('');
    const c = compactStamps(b);
    expect(c.stamps).toHaveLength(1); // only the stamp of 2026-11-23 stays
    expect(c.stamps[0]?.date).toBe('2026-11-23');
    expect(c.stampBase).toEqual({
      n: LIMITS.stampsCompactAt + 10,
      hash: b.stamps[LIMITS.stampsCompactAt + 9]!.hash,
      at: b.stamps[LIMITS.stampsCompactAt + 9]!.at,
    });
    expect(checkChain(c.stamps, c.stampBase)).toBeNull();
    expect(val(importBackup(exportBackup(c)))).toEqual(c);
    // and it can go on: the next stamp continues the chain
    expect(val(appendStamp(c, 'change', '2026-11-23', iso(24))).stamps.at(-1)?.n).toBe(
      LIMITS.stampsCompactAt + 12,
    );
  });

  it('with a relay set drops only what an anchor covers, and keeps the rest (never loses an uncovered stamp)', () => {
    const b = long('https://relay.example/stamp');
    expect(compactStamps(b)).toBe(b); // nothing is covered yet
  });

  it('keeps stamps of a month that still has a day', () => {
    const b = long('');
    b.days['2024-01-10'] = day({ date: '2024-01-10' });
    expect(compactStamps(b)).toBe(b);
  });

  it('purgeExpired does it when the chain is long', () => {
    const b = purgeExpired(long(''), '2026-11-23');
    expect(b.stampBase).not.toBeNull();
    expect(b.stamps.length).toBeLessThan(LIMITS.stampsCompactAt);
  });
});
