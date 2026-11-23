import { createHash, randomBytes } from 'node:crypto';
import { isHash, sha256Bytes, sha256Hex } from '../src/logic/index.ts';

const reference = (data: Uint8Array | string): string =>
  createHash('sha256').update(data).digest('hex');

describe('sha256 against the NIST vectors', () => {
  it('empty message', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('„abc“', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('the 448-bit message', () => {
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });
  it('the 896-bit message', () => {
    expect(
      sha256Hex(
        'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      ),
    ).toBe('cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1');
  });
  it('one million times „a“', () => {
    expect(sha256Hex('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });
});

describe('sha256 against node:crypto', () => {
  it('every length around the padding boundaries (0 to 200 bytes)', () => {
    for (let length = 0; length <= 200; length += 1) {
      const data = Uint8Array.from({ length }, (_, i) => (i * 7 + length) & 0xff);
      expect(Buffer.from(sha256Bytes(data)).toString('hex'), `length ${length}`).toBe(
        reference(data),
      );
    }
  });

  it('many random inputs of random length', () => {
    for (let i = 0; i < 300; i += 1) {
      const data = randomBytes(Math.floor(Math.random() * 1500));
      expect(Buffer.from(sha256Bytes(data)).toString('hex')).toBe(reference(data));
    }
  });

  it('texts with umlauts, emoji and control characters are hashed as UTF-8', () => {
    for (const text of ['Ärztin – Büro ß €', '😀 emoji', 'a\u0000b', 'zeile\nzwei\r\n']) {
      expect(sha256Hex(text)).toBe(reference(text));
    }
  });

  it('does not change its input and gives 32 bytes', () => {
    const data = Uint8Array.from([1, 2, 3]);
    const out = sha256Bytes(data);
    expect(out).toHaveLength(32);
    expect([...data]).toEqual([1, 2, 3]);
  });
});

describe('isHash', () => {
  it('accepts 64 lower-case hex digits only', () => {
    expect(isHash(sha256Hex('x'))).toBe(true);
    expect(isHash('A'.repeat(64))).toBe(false);
    expect(isHash('a'.repeat(63))).toBe(false);
    expect(isHash('a'.repeat(65))).toBe(false);
    expect(isHash('g'.repeat(64))).toBe(false);
    expect(isHash(5)).toBe(false);
  });
});
