import { fail, ok, type Result } from './model.ts';

/**
 * The device key („Geräteschlüssel“): one key per device that unlocks it for the authenticated time stamp
 * relay (`zeitstempel`, header `X-Zeitstempel-Auth`). The employee pastes **one text**:
 *
 *     <kennung>.<privater Schlüssel>
 *
 * `kennung` is the key id of the relay's key file (`[a-z][a-z0-9-]{0,31}`, no dot), `privater Schlüssel` is
 * line 1 of `zeitstempel`'s `make-key` (ECDSA P-256, PKCS#8, base64url without padding). Both parts are
 * public-safe characters only, so the dot separates them without ambiguity. The text is stored encrypted in
 * the vault slot `DEVICE_KEY_SLOT` and never shown again in full (only the key id).
 */
export const DEVICE_KEY_SLOT = 'geraeteschluessel';

export const DEVICE_KEY_LIMITS = {
  maxKeyIdChars: 32,
  /** PKCS#8 bytes of a P-256 key: WebCrypto writes 138 (with the public key), other tools fewer. */
  minKeyBytes: 60,
  maxKeyBytes: 256,
} as const;

export interface DeviceKeyText {
  keyId: string;
  /** The whole text as it is stored (trimmed). */
  text: string;
  /** The PKCS#8 bytes (still to be imported; only `src/io/` turns them into a `CryptoKey`). */
  pkcs8: Uint8Array;
}

const KEY_ID = /^[a-z][a-z0-9-]{0,31}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
/** OID 1.2.840.10045.3.1.7 (prime256v1 / P-256), DER-encoded. */
const P256_OID = [0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url without padding → bytes, or null (wrong characters, impossible length, non-zero spare bits). */
export function base64UrlToBytes(text: string): Uint8Array | null {
  if (!B64URL.test(text) || text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let n = 0;
  for (const ch of text) {
    value = (value << 6) | ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (value >> bits) & 0xff;
    }
  }
  if ((value & ((1 << bits) - 1)) !== 0) return null; // not the canonical form
  return out;
}

const contains = (bytes: Uint8Array, part: readonly number[]): boolean => {
  outer: for (let i = 0; i + part.length <= bytes.length; i++) {
    for (let j = 0; j < part.length; j++) if (bytes[i + j] !== part[j]) continue outer;
    return true;
  }
  return false;
};

/**
 * Reads the pasted device key strictly. Blanks and line breaks around the text are dropped (a paste often
 * carries them); inside, nothing but `<kennung>.<schlüssel>` is accepted. Checks the form only: whether the
 * bytes are a usable P-256 key is decided by the import (`device-key-unusable`).
 */
export function parseDeviceKey(input: string): Result<DeviceKeyText> {
  const text = input.trim();
  const dot = text.indexOf('.');
  if (dot < 0 || dot !== text.lastIndexOf('.')) return fail('device-key-format');
  const keyId = text.slice(0, dot);
  const key = text.slice(dot + 1);
  if (!KEY_ID.test(keyId)) return fail('device-key-id');
  const pkcs8 = base64UrlToBytes(key);
  if (
    !pkcs8 ||
    pkcs8.length < DEVICE_KEY_LIMITS.minKeyBytes ||
    pkcs8.length > DEVICE_KEY_LIMITS.maxKeyBytes ||
    pkcs8[0] !== 0x30
  ) {
    return fail('device-key-format');
  }
  if (!contains(pkcs8, P256_OID)) return fail('device-key-unusable');
  return ok({ keyId, text, pkcs8 });
}

/** German texts around the device key (the error codes have theirs in `REASON_TEXTS`). */
export const DEVICE_KEY_TEXTS = {
  missing: 'Gerät nicht freigeschaltet (Geräteschlüssel fehlt).',
  unauthorized: 'Geräteschlüssel wird vom Zeitstempeldienst nicht angenommen.',
  stored: (keyId: string) => `Gerät freigeschaltet mit dem Geräteschlüssel „${keyId}“.`,
  removed: 'Der Geräteschlüssel wurde entfernt. Das Gerät ist nicht mehr freigeschaltet.',
  unreadable:
    'Der gespeicherte Geräteschlüssel ist nicht lesbar. Bitte den Geräteschlüssel neu eingeben.',
  unusableStored:
    'Auf diesem Gerät liegt ein Geräteschlüssel, der nicht verwendet werden kann. Sie können ihn entfernen und einen neuen eingeben.',
} as const;

/**
 * What the settings show for the stored device key: the key id (usable key), or a problem text (stored but
 * unusable). A key that is stored in either way can be removed; only an empty slot cannot.
 */
export function deviceKeyView(
  keyId: string | null,
  problem: string | null,
): { canRemove: boolean; note: string | null } {
  return {
    canRemove: keyId !== null || problem !== null,
    note: keyId === null && problem !== null ? DEVICE_KEY_TEXTS.unusableStored : null,
  };
}
