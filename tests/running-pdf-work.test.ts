import { memoryEnvironment } from 'local-vault';
import { PdfFile, findDocTimeStamps } from 'pdf-fortschreiben';
import { runningPdfState, type AnchorOutcome, type TimeBook } from '../src/logic/index.ts';
import type { AnchorService } from '../src/io/anchorService.ts';
import { deleteRunningPdf, readRunningPdf, writeRunningPdf } from '../src/io/runningPdfStore.ts';
import {
  stampRunningPdf,
  updateRunningPdfs,
  type RunningPdfDeps,
} from '../src/io/runningPdfWork.ts';
import { createAppVault } from '../src/ui/vault.ts';
import { bookWith, day, val } from './helpers.ts';
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
              value: { tsaId: 'test', token: token(a!), genTime: '', serial: '1' },
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
  it('stores a month in its own slot, encrypted, and deletes it as an empty text', async () => {
    const { env, vault } = await openVault();
    const pdf = new TextEncoder().encode('%PDF-1.7\nGeheim');
    expect(readRunningPdf(vault, '2026-11')).toEqual({ kind: 'none' });
    expect(writeRunningPdf(vault, '2026-11', pdf)).toBeUndefined();
    await vault.saved();
    const stored = env.read('zeiterfassung-monatspdf-2026-11');
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(btoa('%PDF-1.7\nGeheim'));
    // after a restart
    const again = createAppVault(env);
    await again.startVault();
    expect(readRunningPdf(again, '2026-11')).toEqual({ kind: 'pdf', pdf });
    expect(deleteRunningPdf(again, '2026-11')).toBeUndefined();
    expect(readRunningPdf(again, '2026-11')).toEqual({ kind: 'none' });
    expect(writeRunningPdf(again, '2099-01', pdf)).toBeTypeOf('string');
    expect(readRunningPdf(again, '2099-01')).toEqual({ kind: 'none' });
  });

  it('makes both months, appends the ended days and stamps each month once', async () => {
    const { vault } = await openVault();
    const { s, asked } = service(3000);
    const infos = await updateRunningPdfs(book(), deps(vault, s));
    expect(infos.map((i) => [i.month, i.days, i.timeStamps, i.newestStamped, i.problem])).toEqual([
      ['2026-10', ['2026-10-30'], 1, true, null],
      ['2026-11', ['2026-11-02', '2026-11-03'], 1, true, null],
    ]);
    expect(asked).toHaveLength(2);
    // nothing new: no work, no request
    const again = await updateRunningPdfs(book(), deps(vault, s));
    expect(again.map((i) => i.days.length)).toEqual([1, 2]);
    expect(asked).toHaveLength(2);
    // „Gehen“ on the 5th: that day is appended and stamped
    const b = book();
    b.days['2026-11-05'] = day({ date: '2026-11-05' });
    const after = await updateRunningPdfs(b, deps(vault, s, new Date(2026, 10, 5, 17)));
    expect(after[1]).toMatchObject({
      days: ['2026-11-02', '2026-11-03', '2026-11-05'],
      timeStamps: 2,
      newestStamped: true,
    });
    expect(asked).toHaveLength(3);
    const read = readRunningPdf(vault, '2026-11');
    if (read.kind !== 'pdf') throw new Error(read.kind);
    expect(new PdfFile(read.pdf).revisions).toHaveLength(6);
  }, 60_000);

  it('keeps the appended days unstamped without a service or when it fails, and stamps later', async () => {
    const { vault } = await openVault();
    const none = await updateRunningPdfs(book(), deps(vault));
    expect(none[1]).toMatchObject({ days: ['2026-11-02', '2026-11-03'], newestStamped: false });
    expect(none[1]!.problem).toContain('Kein externer Zeitstempeldienst');

    const down = service('down');
    const failed = await updateRunningPdfs(book(), deps(vault, down.s));
    expect(failed[1]!.newestStamped).toBe(false);
    expect(failed[1]!.problem).toContain('nicht erreichbar');
    expect(failed[1]!.days).toEqual(['2026-11-02', '2026-11-03']); // nothing lost

    const up = service(3000);
    const stamped = await updateRunningPdfs(book(), deps(vault, up.s));
    expect(stamped[1]).toMatchObject({ newestStamped: true, timeStamps: 1, problem: null });
  }, 60_000);

  it('tries a larger reserve once when the token does not fit', async () => {
    const { vault } = await openVault();
    await updateRunningPdfs(bookWith(day({ date: '2026-11-02' })), deps(vault));
    const read = readRunningPdf(vault, '2026-11');
    if (read.kind !== 'pdf') throw new Error(read.kind);

    const big = service(10_000);
    const ok = await stampRunningPdf(read.pdf, big.s);
    expect(big.asked).toHaveLength(2);
    if (!ok.ok) throw new Error(ok.text);
    expect(findDocTimeStamps(ok.pdf)[0]!.token).toHaveLength(10_000);
    expect(val(await runningPdfState(ok.pdf)).newestStamped).toBe(true);

    const huge = service(20_000);
    const no = await stampRunningPdf(read.pdf, huge.s);
    expect(huge.asked).toHaveLength(2);
    expect(no).toEqual({
      ok: false,
      text: expect.stringContaining('zu groß für den reservierten Platz'),
    });
  }, 60_000);

  it('never overwrites a slot that holds no PDF', async () => {
    const { vault } = await openVault();
    vault.writeSlot('monatspdf-2026-11', btoa('<html>'));
    const infos = await updateRunningPdfs(book(), deps(vault));
    expect(infos.find((i) => i.month === '2026-11')!.problem).toContain('nicht lesbar');
    expect(vault.readSlot('monatspdf-2026-11')).toBe(btoa('<html>'));
  }, 60_000);
});
