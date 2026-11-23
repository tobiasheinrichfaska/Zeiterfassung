import { memoryEnvironment } from 'local-vault';
import { BOOK_SLOT, loadBook, serializeBook } from '../src/logic/index.ts';
import { createAppVault } from '../src/ui/vault.ts';
import { bookWith, day } from './helpers.ts';

const STORE_NAME = `zeiterfassung-${BOOK_SLOT}`;

describe('the book in the vault', () => {
  it('starts empty, stores encrypted, and reads the same book after a restart', async () => {
    const env = memoryEnvironment();
    const first = createAppVault(env);
    expect(await first.startVault()).toEqual({ kind: 'open' });
    expect(loadBook(first.readSlot(BOOK_SLOT))).toMatchObject({ kind: 'ok' });

    const book = bookWith(day({ note: 'Geheim' }));
    expect(first.writeSlot(BOOK_SLOT, serializeBook(book))).toBeUndefined();
    await first.saved();

    const stored = env.read(STORE_NAME);
    expect(stored).not.toBeNull();
    expect(stored).not.toContain('Geheim'); // never plain in the browser store

    const second = createAppVault(env);
    expect(await second.startVault()).toEqual({ kind: 'open' });
    expect(loadBook(second.readSlot(BOOK_SLOT))).toEqual({ kind: 'ok', book });
  });

  it('refuses to open a plain (unencrypted) stored book and never overwrites it', async () => {
    const env = memoryEnvironment();
    const plain = serializeBook(bookWith(day()));
    env.write(STORE_NAME, plain);
    const vault = createAppVault(env);
    const started = await vault.startVault();
    expect(started.kind).toBe('error');
    expect(() => vault.readSlot(BOOK_SLOT)).toThrow();
    expect(vault.writeSlot(BOOK_SLOT, serializeBook(bookWith()))).toBeTypeOf('string');
    await vault.saved();
    expect(env.read(STORE_NAME)).toBe(plain);
  });

  it('reports a storage error to the listener', async () => {
    const env = memoryEnvironment();
    const vault = createAppVault({
      ...env,
      write: () => {
        throw new Error('voll');
      },
    });
    await vault.startVault();
    const errors: string[] = [];
    vault.onError((e) => errors.push(e));
    vault.writeSlot(BOOK_SLOT, serializeBook(bookWith(day())));
    await vault.saved();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('voll');
  });
});
