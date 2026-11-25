import { memoryEnvironment } from 'local-vault';
import { PdfFile, findDocTimeStamps } from 'pdf-fortschreiben';
import {
  PDF_SLOT_LIMIT,
  encodeRunningPdf,
  forcedSave,
  runningPdfState,
  type AnchorOutcome,
  type TimeBook,
} from '../src/logic/index.ts';
import type { AnchorService } from '../src/io/anchorService.ts';
import { clearPdfSlot, readPdfSlot, writePdfSlot } from '../src/io/runningPdfStore.ts';
import {
  forgetPdfs,
  pdfInSlot,
  releasePdf,
  stampRunningPdf,
  updateRunningPdfs,
  type RunningPdfDeps,
} from '../src/io/runningPdfWork.ts';
import { createAppVault, vaultConfig } from '../src/ui/vault.ts';
import { bookWith, day, evidenceFor, val } from './helpers.ts';
import { ASSETS } from './pdfAssets.ts';

/** A stand-in token of `size` bytes: one DER OCTET STRING (checks the plumbing, proves nothing). */
function token(size: number): Uint8Array {
  const body = size - 4;
  const t = new Uint8Array(size);
  t.set([0x04, 0x82, body >> 8, body & 255]);
  return t;
}

/** A service that answers with the given outcomes in turn (the last one again and again). */
function service(...answers: (number | 'down')[]) {
  const asked: string[] = [];
  const s: AnchorService = {
    async anchor(hashHex) {
      asked.push(hashHex);
      const a = answers[Math.min(asked.length - 1, answers.length - 1)];
      const out: AnchorOutcome =
        a === 'down'
          ? { ok: false, reason: 'unreachable', detail: 'Zeitüberschreitung' }
          : {
              ok: true,
              value: { evidence: evidenceFor(hashHex, { tokenBytes: token(a!) }) },
            };
      return out;
    },
  };
  return { s, asked };
}

async function openVault() {
  const env = memoryEnvironment();
  const vault = createAppVault(env);
  expect(await vault.startVault()).toEqual({ kind: 'open' });
  return { env, vault };
}

const book = (): TimeBook =>
  bookWith(
    day({ date: '2026-10-30' }),
    day({ date: '2026-11-02' }),
    day({ date: '2026-11-03' }),
    day({ date: '2026-11-05', endMin: null, breaks: [] }), // running today
  );

const deps = (
  vault: RunningPdfDeps['vault'],
  s?: AnchorService,
  at = new Date(2026, 10, 5, 12),
) => ({
  vault,
  assets: () => ASSETS,
  service: s,
  now: () => at,
});

describe('running monthly PDF in the app (store and run)', () => {
  it('stores a file in a fixed slot, encrypted, and empties it as an empty text', async () => {
    const { env, vault } = await openVault();
    const pdf = new TextEncoder().encode('%PDF-1.7\nGeheim');
    expect(readPdfSlot(vault, 'monatspdf-a')).toEqual({ kind: 'none' });
    expect(writePdfSlot(vault, 'monatspdf-a', pdf)).toBeUndefined();
    await vault.saved();
    const stored = env.read('zeiterfassung-monatspdf-a');
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(btoa('%PDF-1.7\nGeheim'));
    // after a restart
    const again = createAppVault(env);
    await again.startVault();
    expect(readPdfSlot(again, 'monatspdf-a')).toEqual({ kind: 'pdf', pdf });
    expect(clearPdfSlot(again, 'monatspdf-a')).toBeUndefined();
    expect(readPdfSlot(again, 'monatspdf-a')).toEqual({ kind: 'none' });
  });

  it('the size guard: a file longer than the limit is not written', async () => {
    const { vault } = await openVault();
    const big = new Uint8Array(Math.ceil((PDF_SLOT_LIMIT / 4) * 3) + 3);
    big.set(new TextEncoder().encode('%PDF-'));
    expect(encodeRunningPdf(big).length).toBeGreaterThan(PDF_SLOT_LIMIT);
    expect(writePdfSlot(vault, 'monatspdf-a', big)).toEqual({ tooLarge: true });
    expect(readPdfSlot(vault, 'monatspdf-a')).toEqual({ kind: 'none' });
  });

  it('makes both months in the two slots, appends the ended days and stamps each once', async () => {
    const { vault } = await openVault();
    const { s, asked } = service(3000);
    const run = await updateRunningPdfs(book(), deps(vault, s));
    expect(
      run.infos.map((i) => [i.slot, i.month, i.days, i.timeStamps, i.newestStamped, i.problem]),
    ).toEqual([
      ['monatspdf-a', '2026-11', ['2026-11-02', '2026-11-03'], 1, true, null],
      ['monatspdf-b', '2026-10', ['2026-10-30'], 1, true, null],
    ]);
    expect(run.plan.save).toEqual([
      { slot: 'monatspdf-b', month: '2026-10', mode: 'reminder', why: 'previous' },
    ]);
    expect(asked).toHaveLength(2);
    // nothing new: no work, no request
    const again = await updateRunningPdfs(book(), deps(vault, s));
    expect(again.infos.map((i) => i.days.length)).toEqual([2, 1]);
    expect(asked).toHaveLength(2);
    // „Gehen“ on the 5th: that day is appended and stamped
    const b = book();
    b.days['2026-11-05'] = day({ date: '2026-11-05' });
    const after = await updateRunningPdfs(b, deps(vault, s, new Date(2026, 10, 5, 17)));
    expect(after.infos[0]).toMatchObject({
      days: ['2026-11-02', '2026-11-03', '2026-11-05'],
      timeStamps: 2,
      newestStamped: true,
    });
    expect(asked).toHaveLength(3);
    const read = readPdfSlot(vault, 'monatspdf-a');
    if (read.kind !== 'pdf') throw new Error(read.kind);
    expect(new PdfFile(read.pdf).revisions).toHaveLength(6);
  }, 60_000);

  it('from the 8th the previous month must be saved; only a confirmed save removes it', async () => {
    const { vault } = await openVault();
    await updateRunningPdfs(book(), deps(vault));
    const eighth = new Date(2026, 10, 8, 9);
    const run = await updateRunningPdfs(book(), deps(vault, undefined, eighth));
    expect(forcedSave(run.plan)).toEqual([
      { slot: 'monatspdf-b', month: '2026-10', mode: 'forced', why: 'previous' },
    ]);
    const file = pdfInSlot(vault, 'monatspdf-b')!;
    // a state other than the one saved is not removed
    expect(
      await releasePdf(vault, 'monatspdf-b', '2026-10', file.length - 1, eighth.toISOString()),
    ).toContain('geändert');
    expect(
      await releasePdf(vault, 'monatspdf-a', '2026-10', file.length, eighth.toISOString()),
    ).toContain('geändert');
    expect(
      await releasePdf(vault, 'monatspdf-b', '2026-10', file.length, eighth.toISOString()),
    ).toBeUndefined();
    expect(readPdfSlot(vault, 'monatspdf-b')).toEqual({
      kind: 'saved',
      month: '2026-10',
      at: eighth.toISOString(),
    });
    const done = await updateRunningPdfs(book(), deps(vault, undefined, eighth));
    expect(done.plan.save).toEqual([]);
    expect(done.saved).toEqual([{ month: '2026-10', at: eighth.toISOString() }]);
    expect(done.infos.map((i) => i.month)).toEqual(['2026-11']);
    // the saved month is not started again, even within its week on another run
    const b = book();
    b.days['2026-10-31'] = day({ date: '2026-10-31' });
    const later = await updateRunningPdfs(b, deps(vault, undefined, new Date(2026, 10, 6, 9)));
    expect(later.infos.map((i) => i.month)).toEqual(['2026-11']);
  }, 60_000);

  it('a third month never enters: the new month waits until the older file is saved', async () => {
    const { vault } = await openVault();
    await updateRunningPdfs(book(), deps(vault)); // a = November, b = October
    const dec = book();
    dec.days['2026-12-01'] = day({ date: '2026-12-01' });
    const at = new Date(2026, 11, 2, 9);
    const run = await updateRunningPdfs(dec, deps(vault, undefined, at));
    expect(run.plan.currentWaits).toBe(true);
    expect(forcedSave(run.plan).map((r) => [r.slot, r.month, r.why])).toEqual([
      ['monatspdf-b', '2026-10', 'older'],
    ]);
    expect(run.infos.map((i) => i.month).sort()).toEqual(['2026-10', '2026-11']);
    const oct = pdfInSlot(vault, 'monatspdf-b')!;
    expect(
      await releasePdf(vault, 'monatspdf-b', '2026-10', oct.length, at.toISOString()),
    ).toBeUndefined();
    const next = await updateRunningPdfs(dec, deps(vault, undefined, at));
    expect(next.plan.currentWaits).toBe(false);
    expect(next.infos.find((i) => i.month === '2026-12')).toMatchObject({
      slot: 'monatspdf-b',
      days: ['2026-12-01'],
    });
  }, 60_000);

  it('a state that does not fit is not written; its stored file must be saved', async () => {
    const { vault } = await openVault();
    const { s } = service(3000);
    await updateRunningPdfs(bookWith(day({ date: '2026-11-02' })), deps(vault, s));
    const before = pdfInSlot(vault, 'monatspdf-a')!;
    // the next day would make the file longer than this (small) limit
    const limit = encodeRunningPdf(before).length + 100;
    const b = bookWith(day({ date: '2026-11-02' }), day({ date: '2026-11-03' }));
    const run = await updateRunningPdfs(b, { ...deps(vault, s), slotLimit: limit });
    expect(pdfInSlot(vault, 'monatspdf-a')).toEqual(before); // unchanged
    expect(run.infos[0]).toMatchObject({ month: '2026-11', tooLarge: true, days: ['2026-11-02'] });
    expect(run.infos[0]!.problem).toContain('zu groß für den Speicher');
    expect(forcedSave(run.plan)).toEqual([
      { slot: 'monatspdf-a', month: '2026-11', mode: 'forced', why: 'too-large' },
    ]);
    // after the confirmed save the month is not continued in the app
    await releasePdf(vault, 'monatspdf-a', '2026-11', before.length, '2026-11-05T10:00:00.000Z');
    const after = await updateRunningPdfs(b, deps(vault, s));
    expect(after.plan.currentSaved).toBe(true);
    expect(after.infos).toEqual([]);
    expect(forcedSave(after.plan)).toEqual([]);
  }, 60_000);

  it('keeps the appended days unstamped without a service or when it fails, and stamps later', async () => {
    const { vault } = await openVault();
    const none = await updateRunningPdfs(book(), deps(vault));
    expect(none.infos[0]).toMatchObject({
      month: '2026-11',
      days: ['2026-11-02', '2026-11-03'],
      newestStamped: false,
    });
    expect(none.infos[0]!.problem).toContain('Kein externer Zeitstempeldienst');
    // a relay is set up, but this device has no device key: it says so
    const locked = await updateRunningPdfs(book(), { ...deps(vault), needsKey: true });
    expect(locked.infos[0]!.problem).toContain(
      'Gerät nicht freigeschaltet (Geräteschlüssel fehlt)',
    );
    expect(locked.infos[0]!.newestStamped).toBe(false);

    const down = service('down');
    const failed = await updateRunningPdfs(book(), deps(vault, down.s));
    expect(failed.infos[0]!.newestStamped).toBe(false);
    expect(failed.infos[0]!.problem).toContain('nicht erreichbar');
    expect(failed.infos[0]!.days).toEqual(['2026-11-02', '2026-11-03']); // nothing lost

    const up = service(3000);
    const stamped = await updateRunningPdfs(book(), deps(vault, up.s));
    expect(stamped.infos[0]).toMatchObject({ newestStamped: true, timeStamps: 1, problem: null });
  }, 60_000);

  it('tries a larger reserve once when the token does not fit', async () => {
    const { vault } = await openVault();
    await updateRunningPdfs(bookWith(day({ date: '2026-11-02' })), deps(vault));
    const pdf = pdfInSlot(vault, 'monatspdf-a');
    if (!pdf) throw new Error('no file');

    const big = service(10_000);
    const ok = await stampRunningPdf(pdf, big.s);
    expect(big.asked).toHaveLength(2);
    if (!ok.ok) throw new Error(ok.text);
    expect(findDocTimeStamps(ok.pdf)[0]!.token).toHaveLength(10_000);
    expect(val(await runningPdfState(ok.pdf)).newestStamped).toBe(true);

    const huge = service(20_000);
    const no = await stampRunningPdf(pdf, huge.s);
    expect(huge.asked).toHaveLength(2);
    expect(no).toEqual({
      ok: false,
      text: expect.stringContaining('zu groß für den reservierten Platz'),
    });
  }, 60_000);

  it('takes the token from a single evidence only; a batch evidence is no document time stamp', async () => {
    const { vault } = await openVault();
    await updateRunningPdfs(bookWith(day({ date: '2026-11-02' })), deps(vault));
    const pdf = pdfInSlot(vault, 'monatspdf-a');
    if (!pdf) throw new Error('no file');
    const batch: AnchorService = {
      anchor: async (hashHex) => ({
        ok: true,
        value: { evidence: evidenceFor(hashHex, { kind: 'batch', tokenBytes: token(3000) }) },
      }),
    };
    expect(await stampRunningPdf(pdf, batch)).toEqual({
      ok: false,
      text: expect.stringContaining('Sammelbeleg statt Einzelstempel'),
    });
  }, 60_000);

  it('never overwrites a slot that holds no PDF of this app', async () => {
    const { vault } = await openVault();
    vault.writeSlot('monatspdf-a', btoa('<html>'));
    vault.writeSlot('monatspdf-b', btoa('%PDF-1.7 fremd'));
    const run = await updateRunningPdfs(book(), deps(vault));
    expect(run.plan.unreadable).toEqual(['monatspdf-a', 'monatspdf-b']);
    expect(run.plan.currentWaits).toBe(true);
    expect(vault.readSlot('monatspdf-a')).toBe(btoa('<html>'));
    expect(vault.readSlot('monatspdf-b')).toBe(btoa('%PDF-1.7 fremd'));
  }, 60_000);

  it('declares exactly the book, draft, device key and the two PDF slots (no per-month slots)', () => {
    expect(vaultConfig.slots).toEqual([
      'book',
      'draft',
      'geraeteschluessel',
      'monatspdf-a',
      'monatspdf-b',
    ]);
  });

  it('purging a month removes its file or marker from the slots', async () => {
    const { vault } = await openVault();
    await updateRunningPdfs(book(), deps(vault));
    expect(await forgetPdfs(vault, ['2026-10'])).toBeUndefined();
    expect(readPdfSlot(vault, 'monatspdf-b')).toEqual({ kind: 'none' });
    expect(pdfInSlot(vault, 'monatspdf-a')).toBeDefined();
  }, 60_000);
});
