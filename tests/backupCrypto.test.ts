import {
  BACKUP_CRYPTO,
  checkNewPassword,
  emptyBook,
  exportBackup,
  fromBase64Url,
  importBackup,
  isEncryptedBackup,
  openBackup,
  readBackupFile,
  sealBackup,
  toBase64Url,
} from '../src/logic/index.ts';
import { bookWith, day, val } from './helpers.ts';

/** Few rounds keep the tests fast; the reader accepts anything from `minIterations` up. */
const ROUNDS = 1000;
const PASSWORD = 'korrektes Pferd';

/** Deterministic „random“ bytes for the tests: salt first, then nonce. */
function fixedRandom() {
  let n = 0;
  return (length: number) => {
    n += 1;
    return Uint8Array.from({ length }, (_, i) => (n * 31 + i * 7 + 1) & 0xff);
  };
}

const book = () => bookWith(day({ note: 'Ärztin – geheim' }));
const sealed = async (password = PASSWORD) =>
  val(await sealBackup(exportBackup(book()), password, fixedRandom(), ROUNDS));

/** Rebuilds the text with one member of the header changed. */
const change = (text: string, edit: (o: Record<string, unknown>) => void): string => {
  const o = JSON.parse(text) as Record<string, unknown>;
  edit(o);
  return JSON.stringify(o);
};

describe('base64url', () => {
  it('round-trips and refuses other spellings', () => {
    for (const bytes of [[], [0], [255, 254], [1, 2, 3], [250, 251, 252, 253]]) {
      const text = toBase64Url(Uint8Array.from(bytes));
      expect(text).not.toMatch(/[+/=]/);
      expect([...(fromBase64Url(text) ?? [])]).toEqual(bytes);
    }
    expect(fromBase64Url('AQID')).toEqual(Uint8Array.from([1, 2, 3]));
    expect(fromBase64Url('AQID=')).toBeNull(); // padding
    expect(fromBase64Url('AQI+')).toBeNull(); // standard alphabet
    expect(fromBase64Url('A')).toBeNull(); // impossible length
    expect(fromBase64Url('AQJ')).toBeNull(); // not the canonical form of its bytes (last bits set)
    expect(fromBase64Url('AQ ID')).toBeNull();
  });
});

describe('password rule', () => {
  it('needs 8 to 256 characters and two equal entries', () => {
    expect(checkNewPassword('1234567', '1234567')).toBe('weak-password');
    expect(checkNewPassword('12345678', '12345678')).toBeNull();
    expect(checkNewPassword('x'.repeat(256), 'x'.repeat(256))).toBeNull();
    expect(checkNewPassword('x'.repeat(257), 'x'.repeat(257))).toBe('weak-password');
    expect(checkNewPassword('12345678', '12345679')).toBe('passwords-differ');
    expect(checkNewPassword('', '')).toBe('weak-password');
  });
  it('counts characters, not UTF-16 units', () => {
    expect(checkNewPassword('😀😀😀😀😀😀😀😀', '😀😀😀😀😀😀😀😀')).toBeNull(); // 8 characters
  });
});

describe('sealing and opening', () => {
  it('writes a header in our format and hides the content', async () => {
    const text = await sealed();
    const o = JSON.parse(text);
    expect(Object.keys(o).sort()).toEqual([
      'cipher',
      'data',
      'format',
      'iterations',
      'iv',
      'kdf',
      'salt',
      'version',
    ]);
    expect(o).toMatchObject({
      format: BACKUP_CRYPTO.format,
      version: 1,
      kdf: 'PBKDF2-SHA256',
      cipher: 'AES-256-GCM',
      iterations: ROUNDS,
    });
    expect(text).not.toContain('geheim');
    expect(text).not.toContain('Ärztin');
    expect(isEncryptedBackup(text)).toBe(true);
    expect(isEncryptedBackup(exportBackup(book()))).toBe(false);
    expect(isEncryptedBackup('kein JSON')).toBe(false);
  });

  it('opens with the right password and gives the same text back', async () => {
    const plain = exportBackup(book());
    const text = val(await sealBackup(plain, PASSWORD, fixedRandom(), ROUNDS));
    expect(val(await openBackup(text, PASSWORD))).toBe(plain);
  });

  it('uses a fresh salt and nonce each time it is given random bytes', async () => {
    const random = fixedRandom();
    const a = val(await sealBackup('x', PASSWORD, random, ROUNDS));
    const b = val(await sealBackup('x', PASSWORD, random, ROUNDS));
    expect(JSON.parse(a).salt).not.toBe(JSON.parse(b).salt);
    expect(JSON.parse(a).data).not.toBe(JSON.parse(b).data);
  });

  it('does not open with a wrong password, a changed one or an empty one', async () => {
    const text = await sealed();
    for (const bad of ['falsches Pferd', PASSWORD + ' ', PASSWORD.toUpperCase(), '']) {
      expect(await openBackup(text, bad)).toEqual({ ok: false, reason: 'wrong-password' });
    }
  });

  it('treats the same password in another Unicode form as equal (NFC)', async () => {
    const decomposed = 'Pässwort-Übung'; // ä as a + combining diaeresis
    const text = val(await sealBackup('x', decomposed, fixedRandom(), ROUNDS));
    expect(val(await openBackup(text, decomposed.normalize('NFC')))).toBe('x');
  });

  it('refuses a weak password and silly rounds when sealing', async () => {
    expect(await sealBackup('x', 'kurz', fixedRandom(), ROUNDS)).toEqual({
      ok: false,
      reason: 'weak-password',
    });
    expect(await sealBackup('x', PASSWORD, fixedRandom(), BACKUP_CRYPTO.minIterations - 1)).toEqual(
      { ok: false, reason: 'bad-backup' },
    );
    expect(await sealBackup('x', PASSWORD, fixedRandom(), BACKUP_CRYPTO.maxIterations + 1)).toEqual(
      { ok: false, reason: 'bad-backup' },
    );
  });

  it('uses 600000 rounds by default (the number of a new file)', () => {
    expect(BACKUP_CRYPTO.iterations).toBe(600_000);
  });
});

describe('manipulation', () => {
  it('refuses every changed header member with the password still right', async () => {
    const text = await sealed();
    const edits: [string, (o: Record<string, unknown>) => void][] = [
      ['iterations', (o) => (o.iterations = ROUNDS + 1)],
      ['salt', (o) => (o.salt = toBase64Url(new Uint8Array(BACKUP_CRYPTO.saltBytes).fill(9)))],
      ['iv', (o) => (o.iv = toBase64Url(new Uint8Array(BACKUP_CRYPTO.ivBytes).fill(9)))],
    ];
    for (const [name, edit] of edits) {
      expect(await openBackup(change(text, edit), PASSWORD), name).toEqual({
        ok: false,
        reason: 'wrong-password',
      });
    }
  });

  it('refuses a flipped bit anywhere in the data, tag included', async () => {
    const text = await sealed();
    const data = fromBase64Url(JSON.parse(text).data) as Uint8Array;
    for (const at of [
      0,
      1,
      Math.floor(data.length / 2),
      data.length - 17,
      data.length - 16,
      data.length - 1,
    ]) {
      const bad = Uint8Array.from(data);
      bad[at] = (bad[at] ?? 0) ^ 0x01;
      const changed = change(text, (o) => (o.data = toBase64Url(bad)));
      expect(await openBackup(changed, PASSWORD), `byte ${at}`).toEqual({
        ok: false,
        reason: 'wrong-password',
      });
    }
  });

  it('refuses a truncated or extended data part', async () => {
    const text = await sealed();
    const data = fromBase64Url(JSON.parse(text).data) as Uint8Array;
    expect(
      await openBackup(
        change(text, (o) => (o.data = toBase64Url(data.slice(0, data.length - 1)))),
        PASSWORD,
      ),
    ).toEqual({ ok: false, reason: 'wrong-password' });
    expect(
      await openBackup(
        change(text, (o) => (o.data = toBase64Url(Uint8Array.from([...data, 0])))),
        PASSWORD,
      ),
    ).toEqual({ ok: false, reason: 'wrong-password' });
    expect(
      await openBackup(
        change(text, (o) => (o.data = toBase64Url(data.slice(0, 8)))),
        PASSWORD,
      ),
    ).toEqual({ ok: false, reason: 'bad-backup' }); // shorter than a tag
  });

  it('reads the header strictly', async () => {
    const text = await sealed();
    const bad: [string, (o: Record<string, unknown>) => void][] = [
      ['extra member', (o) => (o.extra = 1)],
      ['missing member', (o) => delete o.iv],
      ['other format', (o) => (o.format = 'x')],
      ['other version', (o) => (o.version = 2)],
      ['other kdf', (o) => (o.kdf = 'PBKDF2-SHA1')],
      ['other cipher', (o) => (o.cipher = 'AES-128-GCM')],
      ['rounds below the floor', (o) => (o.iterations = BACKUP_CRYPTO.minIterations - 1)],
      ['rounds above the ceiling', (o) => (o.iterations = BACKUP_CRYPTO.maxIterations + 1)],
      ['rounds not an integer', (o) => (o.iterations = 1000.5)],
      ['rounds as text', (o) => (o.iterations = '1000')],
      ['short salt', (o) => (o.salt = toBase64Url(new Uint8Array(8)))],
      ['salt in another alphabet', (o) => (o.salt = `${String(o.salt).slice(0, -1)}+`)],
      ['short nonce', (o) => (o.iv = toBase64Url(new Uint8Array(8)))],
      ['data not a string', (o) => (o.data = 5)],
    ];
    for (const [name, edit] of bad) {
      expect(await openBackup(change(text, edit), PASSWORD), name).toEqual({
        ok: false,
        reason: 'bad-backup',
      });
    }
    expect(await openBackup('{', PASSWORD)).toEqual({ ok: false, reason: 'bad-backup' });
    expect(await openBackup('[]', PASSWORD)).toEqual({ ok: false, reason: 'bad-backup' });
    expect(await openBackup(' '.repeat(BACKUP_CRYPTO.maxChars + 1), PASSWORD)).toEqual({
      ok: false,
      reason: 'bad-backup',
    });
  });
});

describe('readBackupFile (both forms)', () => {
  it('reads a plain file as before', async () => {
    const b = book();
    expect(val(await readBackupFile(exportBackup(b)))).toEqual(b);
    expect(val(await readBackupFile(exportBackup(emptyBook()), 'ignored'))).toEqual(emptyBook());
  });

  it('reads an encrypted file with the password', async () => {
    const text = await sealed();
    expect(val(await readBackupFile(text, PASSWORD))).toEqual(book());
  });

  it('asks for the password when an encrypted file comes without one', async () => {
    const text = await sealed();
    expect(await readBackupFile(text)).toEqual({ ok: false, reason: 'password-required' });
    expect(await readBackupFile(text, '')).toEqual({ ok: false, reason: 'password-required' });
  });

  it('says wrong password for a wrong one, and refuses a decrypted text that is not a book', async () => {
    const text = await sealed();
    expect(await readBackupFile(text, 'nicht das Passwort')).toEqual({
      ok: false,
      reason: 'wrong-password',
    });
    const notBook = val(await sealBackup('{"hello": 1}', PASSWORD, fixedRandom(), ROUNDS));
    expect(await readBackupFile(notBook, PASSWORD)).toEqual({ ok: false, reason: 'bad-backup' });
  });

  it('refuses files that are far too large', async () => {
    expect(await readBackupFile('x'.repeat(10_000_000))).toEqual({
      ok: false,
      reason: 'bad-backup',
    });
  });

  it('keeps the plain reader unchanged (a book that was migrated still reads)', () => {
    expect(importBackup(exportBackup(book())).ok).toBe(true);
  });
});
