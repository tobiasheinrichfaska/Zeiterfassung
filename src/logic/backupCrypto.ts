import { LIMITS, fail, ok, type Reason, type Result, type TimeBook } from './model.ts';
import { importBackup } from './backup.ts';

/** The parameters of the encrypted backup, as data (the header of every file carries its own copy). */
export const BACKUP_CRYPTO = {
  format: 'zeiterfassung-sicherung',
  version: 1,
  kdf: 'PBKDF2-SHA256',
  cipher: 'AES-256-GCM',
  /** Rounds for new files. */
  iterations: 600_000,
  /** What a header may ask for when reading: not so low that it is no protection, not so high that it hangs. */
  minIterations: 1000,
  maxIterations: 5_000_000,
  saltBytes: 16,
  ivBytes: 12,
  tagBytes: 16,
  minPasswordChars: 8,
  maxPasswordChars: 256,
  /** Largest encrypted file read (the plain limit plus Base64 and header). */
  maxChars: 8_000_000,
} as const;

const HEADER_KEYS = ['format', 'version', 'kdf', 'iterations', 'salt', 'cipher', 'iv', 'data'];

const ALPHABET = /^[A-Za-z0-9_-]*$/;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Strict: only the alphabet, no padding, and the text must be the canonical form of its bytes. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (!ALPHABET.test(text) || text.length % 4 === 1) return null;
  try {
    const padded =
      text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return toBase64Url(bytes) === text ? bytes : null;
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The password rule for a new encrypted backup; null when it is fine. */
export function checkNewPassword(password: string, repeated: string): Reason | null {
  const length = [...password].length;
  if (length < BACKUP_CRYPTO.minPasswordChars || length > BACKUP_CRYPTO.maxPasswordChars) {
    return 'weak-password';
  }
  return password === repeated ? null : 'passwords-differ';
}

const aad = (h: Header): Uint8Array =>
  new TextEncoder().encode(
    [h.format, h.version, h.kdf, h.iterations, h.salt, h.cipher, h.iv].join('|'),
  );

interface Header {
  format: string;
  version: number;
  kdf: string;
  iterations: number;
  salt: string;
  cipher: string;
  iv: string;
}

async function keyFrom(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password.normalize('NFC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Whether a text is an encrypted backup (by its format marker; the rest is read strictly on opening). */
export function isEncryptedBackup(text: string): boolean {
  try {
    const raw: unknown = JSON.parse(text);
    return isObject(raw) && raw.format === BACKUP_CRYPTO.format;
  } catch {
    return false;
  }
}

/**
 * Encrypts the backup text with a password: PBKDF2-SHA-256 (rounds in the header) → AES-256-GCM, the
 * header bound as authenticated data. `random` supplies salt and nonce (the browser passes
 * `crypto.getRandomValues`; tests pass fixed bytes). The password is not stored anywhere.
 */
export async function sealBackup(
  plain: string,
  password: string,
  random: (length: number) => Uint8Array,
  iterations: number = BACKUP_CRYPTO.iterations,
): Promise<Result<string>> {
  const weak = checkNewPassword(password, password);
  if (weak) return fail(weak);
  if (iterations < BACKUP_CRYPTO.minIterations || iterations > BACKUP_CRYPTO.maxIterations) {
    return fail('bad-backup');
  }
  const salt = random(BACKUP_CRYPTO.saltBytes);
  const iv = random(BACKUP_CRYPTO.ivBytes);
  const header: Header = {
    format: BACKUP_CRYPTO.format,
    version: BACKUP_CRYPTO.version,
    kdf: BACKUP_CRYPTO.kdf,
    iterations,
    salt: toBase64Url(salt),
    cipher: BACKUP_CRYPTO.cipher,
    iv: toBase64Url(iv),
  };
  const key = await keyFrom(password, salt, iterations);
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad(header) as BufferSource },
    key,
    new TextEncoder().encode(plain),
  );
  return ok(JSON.stringify({ ...header, data: toBase64Url(new Uint8Array(sealed)) }, null, 2));
}

function readHeader(
  text: string,
): { header: Header; salt: Uint8Array; iv: Uint8Array; data: Uint8Array } | null {
  if (text.length > BACKUP_CRYPTO.maxChars) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length !== HEADER_KEYS.length || !HEADER_KEYS.every((k) => Object.hasOwn(raw, k)))
    return null;
  const { format, version, kdf, iterations, salt, cipher, iv, data } = raw;
  if (format !== BACKUP_CRYPTO.format || version !== BACKUP_CRYPTO.version) return null;
  if (kdf !== BACKUP_CRYPTO.kdf || cipher !== BACKUP_CRYPTO.cipher) return null;
  if (
    typeof iterations !== 'number' ||
    !Number.isInteger(iterations) ||
    iterations < BACKUP_CRYPTO.minIterations ||
    iterations > BACKUP_CRYPTO.maxIterations
  ) {
    return null;
  }
  if (typeof salt !== 'string' || typeof iv !== 'string' || typeof data !== 'string') return null;
  const saltBytes = fromBase64Url(salt);
  const ivBytes = fromBase64Url(iv);
  const dataBytes = fromBase64Url(data);
  if (!saltBytes || saltBytes.length !== BACKUP_CRYPTO.saltBytes) return null;
  if (!ivBytes || ivBytes.length !== BACKUP_CRYPTO.ivBytes) return null;
  if (!dataBytes || dataBytes.length < BACKUP_CRYPTO.tagBytes) return null;
  return {
    header: { format, version, kdf, iterations, salt, cipher, iv },
    salt: saltBytes,
    iv: ivBytes,
    data: dataBytes,
  };
}

/**
 * Decrypts an encrypted backup. A header that is not exactly ours is `bad-backup`; a wrong password and
 * a changed file cannot be told apart (both fail the authentication) and are `wrong-password`.
 */
export async function openBackup(text: string, password: string): Promise<Result<string>> {
  const read = readHeader(text);
  if (!read) return fail('bad-backup');
  try {
    const key = await keyFrom(password, read.salt, read.header.iterations);
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: read.iv as BufferSource,
        additionalData: aad(read.header) as BufferSource,
      },
      key,
      read.data as BufferSource,
    );
    return ok(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  } catch {
    return fail('wrong-password');
  }
}

/**
 * Reads a backup file of either form. A plain file is read as before; an encrypted one needs the
 * password (`password-required` when none was given).
 */
export async function readBackupFile(text: string, password?: string): Promise<Result<TimeBook>> {
  if (
    typeof text !== 'string' ||
    text.length > Math.max(LIMITS.maxBackupChars, BACKUP_CRYPTO.maxChars)
  ) {
    return fail('bad-backup');
  }
  if (!isEncryptedBackup(text)) return importBackup(text);
  if (password === undefined || password === '') return fail('password-required');
  const plain = await openBackup(text, password);
  return plain.ok ? importBackup(plain.value) : plain;
}
