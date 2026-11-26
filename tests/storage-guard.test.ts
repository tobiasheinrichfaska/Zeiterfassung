import { memoryEnvironment } from 'local-vault';
import { BOOK_SLOT, VAULT_BUDGET, unsavedText } from '../src/logic/index.ts';
import { readPdfSlot, writePdfSlot } from '../src/io/runningPdfStore.ts';
import { watchSaves } from '../src/io/saveWatch.ts';
import { createAppVault } from '../src/ui/vault.ts';

async function openVault(env = memoryEnvironment()) {
  const vault = createAppVault(env);
  await vault.startVault();
  return vault;
}

const pdfOf = (chars: number): Uint8Array => {
  const bytes = new Uint8Array(Math.floor((chars / 4) * 3));
  bytes.set(new TextEncoder().encode('%PDF-'));
  return bytes;
};

describe('H2: the whole vault stays within its budget when a running PDF is written', () => {
  it('refuses a PDF that would push the book, the other slot and the draft past the budget', async () => {
    const vault = await openVault();
    // a large book and a full other slot
    vault.writeSlot(BOOK_SLOT, 'x'.repeat(2_600_000));
    vault.writeSlot('monatspdf-b', 'A'.repeat(800_000));
    // 200 000 characters would fit the slot limit, but not the whole vault
    expect(writePdfSlot(vault, 'monatspdf-a', pdfOf(200_000))).toEqual({ tooLarge: true });
    expect(readPdfSlot(vault, 'monatspdf-a')).toEqual({ kind: 'none' });
    // the same file fits when the book is small
    vault.writeSlot(BOOK_SLOT, 'x'.repeat(1000));
    expect(writePdfSlot(vault, 'monatspdf-a', pdfOf(200_000))).toBeUndefined();
    expect(VAULT_BUDGET).toBe(3_500_000);
  });

  it('counts the slot being written only once (its old content is replaced)', async () => {
    const vault = await openVault();
    vault.writeSlot('monatspdf-a', 'A'.repeat(1_000_000));
    vault.writeSlot(BOOK_SLOT, 'x'.repeat(2_400_000));
    expect(writePdfSlot(vault, 'monatspdf-a', pdfOf(1_000_000))).toBeUndefined();
  });
});

describe('H2: a failed background write stands until the book is stored again', () => {
  it('reports the failure as a standing problem and clears it after a stored write', async () => {
    const env = memoryEnvironment();
    let full = true;
    const vault = await openVault({
      ...env,
      write: (name: string, value: string) => {
        if (full && name.endsWith(BOOK_SLOT)) throw new Error('QuotaExceededError');
        env.write(name, value);
      },
    });
    const seen: (string | undefined)[] = [];
    const watch = watchSaves(vault, (p) => seen.push(p));
    const stop = watch.start();
    vault.writeSlot(BOOK_SLOT, 'a');
    watch.wrote();
    await vault.saved();
    await Promise.resolve();
    expect(watch.problem()).toMatch(/QuotaExceededError/);
    expect(unsavedText(watch.problem()!)).toMatch(/möglicherweise nicht gespeichert/);
    // a further failing write keeps it
    vault.writeSlot(BOOK_SLOT, 'b');
    watch.wrote();
    await vault.saved();
    await Promise.resolve();
    expect(watch.problem()).toBeDefined();
    // storage free again: the next stored write of the book clears it
    full = false;
    vault.writeSlot(BOOK_SLOT, 'c');
    watch.wrote();
    await vault.saved();
    await Promise.resolve();
    expect(watch.problem()).toBeUndefined();
    expect(seen.at(-1)).toBeUndefined();
    stop();
  });
});
