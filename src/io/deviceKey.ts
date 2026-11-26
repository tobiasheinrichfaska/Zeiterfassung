import type { Vault } from 'local-vault';
import {
  DEVICE_KEY_SLOT,
  DEVICE_KEY_TEXTS,
  deviceKeyMarker,
  parseDeviceKey,
  readDeviceKeyMarker,
  reasonText,
  type DeviceKeyText,
} from '../logic/index.ts';
import type { DeviceAuth } from './anchorService.ts';
import type { DeviceKeyStore } from './keyStore.ts';

/** The device key as the app holds it: the key id (the only part ever shown) and the non-extractable key. */
export interface DeviceKey extends DeviceAuth {
  privateKey: CryptoKey;
}

export type DeviceKeyLoad =
  | { kind: 'none' }
  | { kind: 'key'; key: DeviceKey }
  /** A stored key that cannot be used (any more): the person is told to enter the key again. */
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

/** A key read back from the store that is what the app put there: ECDSA P-256, signing, not extractable. */
const usable = (k: CryptoKey | undefined): k is CryptoKey =>
  k !== undefined &&
  k.type === 'private' &&
  !k.extractable &&
  k.usages.includes('sign') &&
  k.algorithm.name === 'ECDSA' &&
  (k.algorithm as EcKeyAlgorithm).namedCurve === 'P-256';

/**
 * Reads the stored key: the slot names the key id (`kid:<kennung>`), the key comes from `store`. An empty
 * slot is `none`. A slot of the earlier form (the whole `<kennung>.<schlüssel>` text) is migrated once:
 * imported, the key stored in `store`, then the slot overwritten with the key id only (if storing fails, the
 * slot stays as it was and the key is used for this session). Never throws.
 */
export async function loadDeviceKey(
  vault: Pick<Vault, 'readSlot' | 'writeSlot'>,
  store: DeviceKeyStore,
): Promise<DeviceKeyLoad> {
  let stored: string | null;
  try {
    stored = vault.readSlot(DEVICE_KEY_SLOT);
  } catch {
    return { kind: 'unusable', text: DEVICE_KEY_TEXTS.unreadable };
  }
  if (stored === null || stored === '') return { kind: 'none' };
  const keyId = readDeviceKeyMarker(stored);
  if (keyId !== null) {
    let key: CryptoKey | undefined;
    try {
      key = await store.read();
    } catch {
      key = undefined;
    }
    return usable(key)
      ? { kind: 'key', key: { keyId, privateKey: key } }
      : { kind: 'unusable', text: DEVICE_KEY_TEXTS.unreadable };
  }
  // the earlier form: the text itself in the slot
  const parsed = parseDeviceKey(stored);
  if (!parsed.ok) return { kind: 'unusable', text: DEVICE_KEY_TEXTS.unreadable };
  const imported = await importDeviceKey(parsed.value);
  if (!imported.ok) {
    return { kind: 'unusable', text: `${DEVICE_KEY_TEXTS.unreadable} ${imported.text}` };
  }
  try {
    await store.write(imported.key.privateKey);
    vault.writeSlot(DEVICE_KEY_SLOT, deviceKeyMarker(parsed.value.keyId));
  } catch {
    // not migrated this time: the key still works now, the next start tries again
  }
  return { kind: 'key', key: imported.key };
}

/**
 * Checks a pasted text, imports it (so a key that WebCrypto refuses is never stored), keeps the
 * non-extractable key in `store` and only its id in the vault slot. The text itself is stored nowhere.
 * Returns the key, or the German reason; nothing is kept on failure.
 */
export async function storeDeviceKey(
  vault: Pick<Vault, 'writeSlot'>,
  store: DeviceKeyStore,
  input: string,
): Promise<{ ok: true; key: DeviceKey } | { ok: false; text: string }> {
  const parsed = parseDeviceKey(input);
  if (!parsed.ok) return { ok: false, text: reasonText(parsed.reason) };
  const imported = await importDeviceKey(parsed.value);
  if (!imported.ok) return imported;
  try {
    await store.write(imported.key.privateKey);
  } catch {
    return { ok: false, text: DEVICE_KEY_TEXTS.storeFailed };
  }
  const refused = vault.writeSlot(DEVICE_KEY_SLOT, deviceKeyMarker(parsed.value.keyId));
  if (refused !== undefined) {
    await store.clear().catch(() => undefined);
    return { ok: false, text: refused };
  }
  return imported;
}

/** Empties the slot and deletes the stored key; returns a refusal text, or undefined. */
export async function removeDeviceKey(
  vault: Pick<Vault, 'writeSlot'>,
  store: DeviceKeyStore,
): Promise<string | undefined> {
  const refused = vault.writeSlot(DEVICE_KEY_SLOT, '');
  if (refused !== undefined) return refused;
  try {
    await store.clear();
  } catch {
    return DEVICE_KEY_TEXTS.storeFailed;
  }
  return undefined;
}
