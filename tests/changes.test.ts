import {
  BOOK_VERSION,
  LIMITS,
  breakStart,
  changeText,
  changedDates,
  changesOfMonth,
  describeSnapshot,
  emptyBook,
  exportBackup,
  importBackup,
  markExported,
  moveWorkday,
  purgeExpired,
  removeWorkday,
  retentionReport,
  setWorkday,
  stampIn,
  stampOut,
  willBeLogged,
  type ChangeEntry,
  type TimeBook,
} from '../src/logic/index.ts';
import { CTX, NOW, bookWith, day, val } from './helpers.ts';

/** The tests run on 2026-11-23; earlier dates are „over“. */
const TODAY = '2026-11-23';
const LATER = '2026-11-24T10:00:00.000Z';
const input = { date: '2026-11-20', startMin: 480, endMin: 990, breaks: [], note: '' };
const ctx = { today: TODAY };

describe('what is logged', () => {
  it('logs nothing for today or a later date', () => {
    const b = val(setWorkday(emptyBook(), { ...input, date: TODAY }, NOW, ctx));
    const c = val(setWorkday(b, { ...input, date: '2026-11-25' }, NOW, ctx));
    const d = val(removeWorkday(c, TODAY, NOW, ctx));
    expect(d.changes).toEqual([]);
  });

  it('logs the entry of a missing day as added (Nachtrag), with the state after', () => {
    const b = val(setWorkday(emptyBook(), input, LATER, { ...ctx, reason: '  Vergessen  ' }));
    expect(b.changes).toEqual([
      {
        at: LATER,
        date: '2026-11-20',
        kind: 'added',
        before: null,
        after: { startMin: 480, endMin: 990, breaks: [], note: '', origin: 'manual' },
        reason: 'Vergessen',
        movedTo: null,
        movedFrom: null,
      },
    ]);
  });

  it('logs a change with before and after', () => {
    const b = bookWith(day({ date: '2026-11-20', breaks: [{ kind: 'length', minutes: 30 }] }));
    const r = val(setWorkday(b, { ...input, endMin: 1020, note: 'länger' }, LATER, ctx));
    const [e] = r.changes;
    expect(r.changes).toHaveLength(1);
    expect(e?.kind).toBe('changed');
    expect(e?.before?.endMin).toBe(990);
    expect(e?.before?.breaks).toEqual([{ kind: 'length', minutes: 30 }]);
    expect(e?.after?.endMin).toBe(1020);
    expect(e?.after?.note).toBe('länger');
    expect(e?.reason).toBe('');
  });

  it('logs a deletion with the state before', () => {
    const b = bookWith(day({ date: '2026-11-20' }));
    const r = val(removeWorkday(b, '2026-11-20', LATER, { ...ctx, reason: 'doppelt' }));
    expect(r.days).toEqual({});
    expect(r.changes).toMatchObject([{ kind: 'removed', after: null, reason: 'doppelt' }]);
    expect(r.changes[0]?.before?.startMin).toBe(480);
  });

  it('logs the departure added to a day left open the day before', () => {
    const open = bookWith(day({ date: '2026-11-22', endMin: null, breaks: [] }));
    const r = val(setWorkday(open, { ...input, date: '2026-11-22', endMin: 1000 }, LATER, ctx));
    expect(r.changes).toMatchObject([{ kind: 'changed', date: '2026-11-22' }]);
    expect(r.changes[0]?.before?.endMin).toBeNull();
    expect(r.changes[0]?.after?.endMin).toBe(1000);
  });

  it('logs nothing when the saved times are the same as before', () => {
    const b = bookWith(day({ date: '2026-11-20', breaks: [] }));
    const same = { ...input, breaks: [] };
    expect(val(setWorkday(b, same, LATER, ctx)).changes).toEqual([]);
  });

  it('logs the change of the origin (stamped → typed) as a change', () => {
    const b = bookWith(day({ date: '2026-11-20', origin: 'stamp', breaks: [] }));
    expect(val(setWorkday(b, input, LATER, ctx)).changes).toHaveLength(1);
  });

  it('does not log real-time stamps, also on a day left open (they are not later corrections)', () => {
    let b = val(stampIn(emptyBook(), { date: '2026-11-22', minute: 22 * 60 }, NOW));
    b = val(breakStart(b, { date: '2026-11-23', minute: 30 }, NOW));
    b = val(stampOut(b, { date: '2026-11-23', minute: 120 }, NOW));
    expect(b.changes).toEqual([]);
  });

  it('is decided by the date against today, one day apart', () => {
    expect(willBeLogged(['2026-11-22'], '2026-11-23')).toBe(true);
    expect(willBeLogged(['2026-11-23'], '2026-11-23')).toBe(false);
    expect(willBeLogged(['2026-11-24'], '2026-11-23')).toBe(false);
    expect(willBeLogged(['2026-11-24', '2026-11-01'], '2026-11-23')).toBe(true);
    expect(willBeLogged([], '2026-11-23')).toBe(false);
  });
});

describe('moving a day', () => {
  it('logs removal and addition that point at each other', () => {
    const b = bookWith(day({ date: '2026-11-20', breaks: [] }));
    const r = val(moveWorkday(b, '2026-11-20', { ...input, date: '2026-11-19' }, LATER, ctx));
    expect(r.changes).toHaveLength(2);
    expect(r.changes[0]).toMatchObject({
      kind: 'removed',
      date: '2026-11-20',
      movedTo: '2026-11-19',
      movedFrom: null,
    });
    expect(r.changes[1]).toMatchObject({
      kind: 'added',
      date: '2026-11-19',
      movedFrom: '2026-11-20',
      movedTo: null,
    });
  });

  it('logs only the side that is over (old over, new today)', () => {
    const b = bookWith(day({ date: '2026-11-20', breaks: [] }));
    const r = val(moveWorkday(b, '2026-11-20', { ...input, date: TODAY }, LATER, ctx));
    expect(r.changes).toMatchObject([{ kind: 'removed', date: '2026-11-20', movedTo: TODAY }]);
  });

  it('logs the replaced day on the new date as changed', () => {
    const b = bookWith(day({ date: '2026-11-20' }), day({ date: '2026-11-19', note: 'alt' }));
    const r = val(moveWorkday(b, '2026-11-20', { ...input, date: '2026-11-19' }, LATER, ctx));
    expect(r.changes[1]).toMatchObject({
      kind: 'changed',
      date: '2026-11-19',
      movedFrom: '2026-11-20',
    });
    expect(r.changes[1]?.before?.note).toBe('alt');
  });

  it('on the same date is an ordinary change without links', () => {
    const b = bookWith(day({ date: '2026-11-20', breaks: [] }));
    const r = val(moveWorkday(b, '2026-11-20', { ...input, endMin: 1000 }, LATER, ctx));
    expect(r.changes).toMatchObject([{ kind: 'changed', movedTo: null, movedFrom: null }]);
  });
});

describe('refusals change nothing', () => {
  const b = bookWith(day({ date: '2026-11-20' }));

  it('a day that breaks the rules is not logged', () => {
    const r = setWorkday(b, { ...input, endMin: 100 }, LATER, ctx);
    expect(r).toEqual({ ok: false, reason: 'end-before-start' });
    expect(b.changes).toEqual([]);
  });

  it('a reason that is too long or has control characters is refused', () => {
    expect(
      setWorkday(b, input, LATER, { ...ctx, reason: 'x'.repeat(LIMITS.maxReasonChars + 1) }),
    ).toEqual({ ok: false, reason: 'bad-reason' });
    expect(setWorkday(b, input, LATER, { ...ctx, reason: 'a\tb' })).toEqual({
      ok: false,
      reason: 'bad-reason',
    });
    expect(removeWorkday(b, '2026-11-20', LATER, { ...ctx, reason: 'a\nb' })).toEqual({
      ok: false,
      reason: 'bad-reason',
    });
    expect(
      moveWorkday(b, '2026-11-20', { ...input, date: '2026-11-19' }, LATER, {
        ...ctx,
        reason: '\u0001',
      }),
    ).toEqual({ ok: false, reason: 'bad-reason' });
    expect(
      setWorkday(b, { ...input, endMin: 1000 }, LATER, {
        ...ctx,
        reason: 'x'.repeat(LIMITS.maxReasonChars),
      }).ok,
    ).toBe(true);
  });

  it('a full log refuses the change instead of dropping an entry', () => {
    const entry: ChangeEntry = {
      at: NOW,
      date: '2026-01-02',
      kind: 'added',
      before: null,
      after: { startMin: 1, endMin: 2, breaks: [], note: '', origin: 'manual' },
      reason: '',
      movedTo: null,
      movedFrom: null,
    };
    const nearlyFull: TimeBook = {
      ...b,
      changes: Array.from({ length: LIMITS.maxChanges - 1 }, () => entry),
    };
    const last = val(setWorkday(nearlyFull, { ...input, endMin: 1000 }, LATER, ctx));
    expect(last.changes).toHaveLength(LIMITS.maxChanges);
    expect(setWorkday(last, { ...input, endMin: 1010 }, LATER, ctx)).toEqual({
      ok: false,
      reason: 'too-many-changes',
    });
    // a move needs room for two entries
    expect(
      moveWorkday(nearlyFull, '2026-11-20', { ...input, date: '2026-11-19' }, LATER, ctx),
    ).toEqual({ ok: false, reason: 'too-many-changes' });
    // a change that is not logged still works
    expect(setWorkday(last, { ...input, date: TODAY }, LATER, ctx).ok).toBe(true);
  });

  it('no such day', () => {
    expect(removeWorkday(emptyBook(), '2026-11-20', LATER, CTX)).toEqual({
      ok: false,
      reason: 'no-such-day',
    });
  });
});

describe('reading the log', () => {
  const book = () =>
    val(
      moveWorkday(
        bookWith(day({ date: '2026-11-20', breaks: [] }), day({ date: '2026-10-05', breaks: [] })),
        '2026-11-20',
        { ...input, date: '2026-11-19', note: 'Ärztin' },
        LATER,
        { ...ctx, reason: 'Fehler' },
      ),
    );

  it('picks the entries and dates of a month', () => {
    const b = book();
    expect(changesOfMonth(b, '2026-11')).toHaveLength(2);
    expect(changesOfMonth(b, '2026-10')).toHaveLength(0);
    expect([...changedDates(b, '2026-11')].sort()).toEqual(['2026-11-19', '2026-11-20']);
  });

  it('writes German texts', () => {
    const [removed, added] = book().changes.map(changeText);
    expect(removed).toEqual({
      date: 'Fr 20.11.2026',
      when: '24.11.2026 10:00 UTC',
      kind: 'Gelöscht',
      before: '08:00–16:30, Pause 0:00, Eingabe',
      after: '–',
      reason: 'Fehler',
      link: 'verschoben nach Do 19.11.2026',
    });
    expect(added?.kind).toBe('Nachgetragen');
    expect(added?.after).toBe('08:00–16:30, Pause 0:00, Eingabe, Notiz „Ärztin“');
    expect(added?.link).toBe('verschoben von Fr 20.11.2026');
  });

  it('describes snapshots: running day, past midnight, breaks', () => {
    expect(describeSnapshot(null)).toBe('–');
    expect(
      describeSnapshot({
        startMin: 1320,
        endMin: 1800,
        breaks: [
          { kind: 'length', minutes: 15 },
          { kind: 'span', fromMin: 1400, toMin: 1420 },
        ],
        note: '',
        origin: 'stamp',
      }),
    ).toBe('22:00–06:00 (+1), Pause 0:35, Stempel');
    expect(
      describeSnapshot({
        startMin: 480,
        endMin: null,
        breaks: [{ kind: 'span', fromMin: 500, toMin: null }],
        note: '',
        origin: 'manual',
      }),
    ).toBe('08:00–läuft, Pause 0:00, Eingabe');
  });
});

describe('older versions are read and migrated without loss', () => {
  it('writes version 3 and reads it back unchanged', () => {
    const b = val(setWorkday(bookWith(), input, LATER, { ...ctx, reason: 'x' }));
    expect(b.version).toBe(BOOK_VERSION);
    expect(BOOK_VERSION).toBe(3);
    expect(val(importBackup(exportBackup(b)))).toEqual(b);
  });

  const v1 = () => ({
    format: 'zeiterfassung-buch',
    version: 1,
    settings: { employeeLabel: 'Anna', retentionMonths: 12 },
    days: { '2026-11-20': day({ date: '2026-11-20', note: 'Ärztin' }) },
    exportedMonths: { '2026-10': '2026-11-01T06:00:00.000Z' },
  });

  it('reads a version 1 file and migrates it without loss', () => {
    const old = v1();
    const b = val(importBackup(JSON.stringify(old)));
    expect(b.version).toBe(3);
    expect(b.changes).toEqual([]);
    expect(b.stamps).toEqual([]);
    expect(b.stampBase).toBeNull();
    expect(b.anchors).toEqual([]);
    expect(b.settings).toEqual({ ...old.settings, timestampRelay: '' });
    expect(b.days).toEqual(old.days);
    expect(b.exportedMonths).toEqual(old.exportedMonths);
    expect(val(importBackup(exportBackup(b)))).toEqual(b); // and it is a valid version 3 text
  });

  it('reads a version 2 file (with its log) and migrates it without loss', () => {
    const logged = val(setWorkday(bookWith(), input, LATER, { ...ctx, reason: 'Nachtrag' }));
    const v2 = {
      format: 'zeiterfassung-buch',
      version: 2,
      settings: { employeeLabel: 'Anna', retentionMonths: 12 },
      days: logged.days,
      exportedMonths: {},
      changes: logged.changes,
    };
    const b = val(importBackup(JSON.stringify(v2)));
    expect(b.version).toBe(3);
    expect(b.changes).toEqual(logged.changes);
    expect(b.days).toEqual(logged.days);
    expect(b.settings.timestampRelay).toBe('');
    expect(b.stamps).toEqual([]);
  });

  it('refuses a file whose members do not fit its version, and other versions', () => {
    const base = JSON.parse(exportBackup(emptyBook()));
    expect(importBackup(JSON.stringify({ ...base, version: 1 })).ok).toBe(false); // has the newer members
    expect(importBackup(JSON.stringify({ ...base, version: 2 })).ok).toBe(false);
    const { changes: _ignored, ...withoutLog } = base;
    void _ignored;
    expect(importBackup(JSON.stringify(withoutLog)).ok).toBe(false);
    expect(importBackup(JSON.stringify({ ...base, version: 4 }))).toEqual({
      ok: false,
      reason: 'unknown-version',
    });
    expect(importBackup(JSON.stringify({ ...base, version: 0 }))).toEqual({
      ok: false,
      reason: 'unknown-version',
    });
    expect(importBackup(JSON.stringify({ ...base, version: 2.5 }))).toEqual({
      ok: false,
      reason: 'unknown-version',
    });
  });

  describe('reads the log strictly', () => {
    const entry = () =>
      JSON.parse(JSON.stringify(val(setWorkday(bookWith(), input, LATER, ctx)).changes[0]));
    const read = (e: unknown, more: object = {}) =>
      importBackup(
        JSON.stringify({ ...JSON.parse(exportBackup(emptyBook())), changes: [e], ...more }),
      );

    it('accepts a good entry', () => {
      expect(read(entry()).ok).toBe(true);
    });

    it('refuses unknown or missing members', () => {
      expect(read({ ...entry(), extra: 1 }).ok).toBe(false);
      const { reason: _r, ...noReason } = entry();
      void _r;
      expect(read(noReason).ok).toBe(false);
      const e = entry();
      e.after.extra = 1;
      expect(read(e).ok).toBe(false);
    });

    it('refuses a kind that does not fit the snapshots', () => {
      expect(read({ ...entry(), kind: 'changed' }).ok).toBe(false); // before is null
      expect(read({ ...entry(), kind: 'removed' }).ok).toBe(false);
      expect(read({ ...entry(), kind: 'weird' }).ok).toBe(false);
      expect(read({ ...entry(), kind: 'added', before: entry().after }).ok).toBe(false);
    });

    it('refuses snapshots that break the day rules', () => {
      const e = entry();
      e.after.endMin = 100; // before the start
      expect(read(e).ok).toBe(false);
      const f = entry();
      f.after.breaks = [{ kind: 'length', minutes: 0 }];
      expect(read(f).ok).toBe(false);
    });

    it('refuses bad times, dates, links and reasons', () => {
      expect(read({ ...entry(), at: 'gestern' }).ok).toBe(false);
      expect(read({ ...entry(), date: '2026-02-30' }).ok).toBe(false);
      expect(read({ ...entry(), movedTo: '2026-11-20' }).ok).toBe(false); // the same date
      expect(read({ ...entry(), movedTo: 'x' }).ok).toBe(false);
      expect(read({ ...entry(), reason: 'a\u0000b' }).ok).toBe(false);
      expect(read({ ...entry(), reason: 'x'.repeat(LIMITS.maxReasonChars + 1) }).ok).toBe(false);
      expect(read({ ...entry(), reason: 'x'.repeat(LIMITS.maxReasonChars) }).ok).toBe(true);
    });

    it('refuses a log over the limit', () => {
      const many = Array.from({ length: LIMITS.maxChanges + 1 }, entry);
      expect(
        importBackup(JSON.stringify({ ...JSON.parse(exportBackup(emptyBook())), changes: many })),
      ).toEqual({
        ok: false,
        reason: 'too-many-changes',
      });
      const exact = Array.from({ length: LIMITS.maxChanges }, entry);
      expect(
        importBackup(JSON.stringify({ ...JSON.parse(exportBackup(emptyBook())), changes: exact }))
          .ok,
      ).toBe(true);
    });
  });
});

describe('purging and the log', () => {
  const old = (date: string, recordedAt: string) => day({ date, breaks: [], recordedAt });
  const entryOf = (date: string, at: string): ChangeEntry => ({
    at,
    date,
    kind: 'changed',
    before: { startMin: 480, endMin: 900, breaks: [], note: '', origin: 'manual' },
    after: { startMin: 480, endMin: 960, breaks: [], note: '', origin: 'manual' },
    reason: '',
    movedTo: null,
    movedFrom: null,
  });
  const base = (): TimeBook => {
    const b = bookWith(
      old('2025-01-10', '2025-01-11T08:00:00.000Z'),
      old('2025-02-10', '2025-02-11T08:00:00.000Z'),
      day({ date: '2026-11-23' }),
    );
    b.settings.retentionMonths = 12;
    b.changes = [
      entryOf('2025-01-10', '2025-01-20T08:00:00.000Z'),
      entryOf('2025-02-10', '2025-02-20T08:00:00.000Z'),
    ];
    return b;
  };

  it('removes the log entries of a purged month and keeps the others', () => {
    let b = base();
    b = val(markExported(b, '2025-01', '2025-03-01T00:00:00.000Z'));
    const after = purgeExpired(b, '2026-11-23');
    expect(Object.keys(after.days)).toEqual(['2025-02-10', '2026-11-23']);
    expect(after.changes.map((c) => c.date)).toEqual(['2025-02-10']); // February was never exported
  });

  it('never purges a month that was not exported, log entries included', () => {
    const after = purgeExpired(base(), '2026-11-23');
    expect(after.changes).toHaveLength(2);
    expect(Object.keys(after.days)).toHaveLength(3);
  });

  it('treats a month changed after its export as not exported (stale)', () => {
    let b = base();
    b = val(markExported(b, '2025-01', '2025-01-15T00:00:00.000Z')); // before the entry of 20 Jan
    const r = retentionReport(b, '2026-11-23');
    expect(r.purgeable).toEqual([]);
    expect(r.stale).toEqual(['2025-01']);
    expect(r.blocked).toEqual(['2025-01', '2025-02']);
    expect(purgeExpired(b, '2026-11-23').changes).toHaveLength(2);
  });

  it('treats a month whose day was recorded after the export as stale too', () => {
    let b = base();
    b = val(markExported(b, '2025-01', '2025-01-11T07:00:00.000Z')); // before the day was recorded
    expect(retentionReport(b, '2026-11-23').stale).toEqual(['2025-01']);
  });

  it('counts an export at the very moment of the last record as covering it', () => {
    let b = base();
    b = val(markExported(b, '2025-01', '2025-01-20T08:00:00.000Z'));
    expect(retentionReport(b, '2026-11-23').purgeable).toEqual(['2025-01']);
  });

  it('knows a due month from the log alone (all its days were deleted)', () => {
    const b: TimeBook = {
      ...emptyBook(),
      changes: [entryOf('2025-01-10', '2025-01-20T08:00:00.000Z')],
    };
    b.settings.retentionMonths = 12;
    expect(retentionReport(b, '2026-11-23').blocked).toEqual(['2025-01']);
    const exported = val(markExported(b, '2025-01', '2025-03-01T00:00:00.000Z'));
    expect(purgeExpired(exported, '2026-11-23').changes).toEqual([]);
  });

  it('keeps the entries of a running day even in a purged month', () => {
    let b = bookWith(old('2024-01-10', '2024-01-10T08:00:00.000Z'));
    b = {
      ...b,
      days: { '2024-01-10': { ...b.days['2024-01-10']!, endMin: null } },
      changes: [entryOf('2024-01-10', '2024-01-12T08:00:00.000Z')],
    };
    b.settings.retentionMonths = 12;
    b = val(markExported(b, '2024-01', '2024-02-01T00:00:00.000Z'));
    const after = purgeExpired(b, '2026-11-23');
    expect(Object.keys(after.days)).toEqual(['2024-01-10']);
    expect(after.changes).toHaveLength(1);
  });
});
