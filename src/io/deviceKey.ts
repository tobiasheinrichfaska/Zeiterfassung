import type { Vault } from 'local-vault';
import {
  DEVICE_KEY_SLOT,
  DEVICE_KEY_TEXTS,
  parseDeviceKey,
  reasonText,
  type DeviceKeyText,
} from '../logic/index.ts';
import type { DeviceAuth } from './anchorService.ts';

/** The device key as the app holds it: the key id (the only part ever shown) and the non-extractable key. */
export interface DeviceKey extends DeviceAuth {
  privateKey: CryptoKey;
}

export type DeviceKeyLoad =
  | { kind: 'none' }
  | { kind: 'key'; key: DeviceKey }
  /** A stored text that cannot be used (any more): the person is told to enter the key again. */
  | { kind: 'unusable'; text: string };

/**
 * Imports the PKCS#8 bytes as a **non-extractable** ECDSA P-256 signing key: after this, the page can use
 * the key but not read it back. Returns the German reason on failure.
 */
export async function importDeviceKey(
  parsed: DeviceKeyText,
  subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
): Promise<{ ok: true; key: DeviceKey } | { ok: false; text: string }> {
  if (!subtle) return { ok: false, text: 'WebCrypto fehlt (Seite nicht über https geöffnet?).' };
  try {
    const privateKey = await subtle.importKey(
      'pkcs8',
      new Uint8Array(parsed.pkcs8),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    return { ok: true, key: { keyId: parsed.keyId, privateKey } };
  } catch {
    return { ok: false, text: reasonText('device-key-unusable') };
  }
}

/** Reads and imports the stored key; an empty slot is `none`. Never throws. */
export async function loadDeviceKey(vault: Pick<Vault, 'readSlot'>): Promise<DeviceKeyLoad> {
  let stored: string | null;
  try {
    stored = vault.readSlot(DEVICE_KEY_SLOT);
  } catch {
    return { kind: 'unusable', text: DEVICE_KEY_TEXTS.unreadable };
  }
  if (stored === null || stored === '') return { kind: 'none' };
  const parsed = parseDeviceKey(stored);
  if (!parsed.ok) return { kind: 'unusable', text: DEVICE_KEY_TEXTS.unreadable };
  const imported = await importDeviceKey(parsed.value);
  return imported.ok
    ? { kind: 'key', key: imported.key }
    : { kind: 'unusable', text: `${DEVICE_KEY_TEXTS.unreadable} ${imported.text}` };
}

/**
 * Checks a pasted text, imports it (so a key that WebCrypto refuses is never stored) and stores the text
 * encrypted in the vault. Returns the key, or the German reason; nothing is stored on failure.
 */
export async function storeDeviceKey(
  vault: Pick<Vault, 'writeSlot'>,
  input: string,
): Promise<{ ok: true; key: DeviceKey } | { ok: false; text: string }> {
  const parsed = parseDeviceKey(input);
  if (!parsed.ok) return { ok: false, text: reasonText(parsed.reason) };
  const imported = await importDeviceKey(parsed.value);
  if (!imported.ok) return imported;
  const refused = vault.writeSlot(DEVICE_KEY_SLOT, parsed.value.text);
  if (refused !== undefined) return { ok: false, text: refused };
  return imported;
}

/** Empties the slot; returns the vault's refusal text, or undefined. */
export function removeDeviceKey(vault: Pick<Vault, 'writeSlot'>): string | undefined {
  return vault.writeSlot(DEVICE_KEY_SLOT, '');
}
