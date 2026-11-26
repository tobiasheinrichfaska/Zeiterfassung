/**
 * Where the device key itself lives: the imported, **non-extractable** `CryptoKey` (P-256, `sign` only) in
 * an IndexedDB database of its own (`zeiterfassung-geraeteschluessel`, store `key`, entry `device`). The
 * browser stores a `CryptoKey` as a structured clone and gives back a key that is still not extractable:
 * the page can sign with it, but nobody can read the private key out (not even this app). The vault slot
 * `geraeteschluessel` keeps only the key id (`kid:<kennung>`, encrypted). Injected, so tests use memory.
 */
export interface DeviceKeyStore {
  read(): Promise<CryptoKey | undefined>;
  write(key: CryptoKey): Promise<void>;
  clear(): Promise<void>;
}

export const DEVICE_KEY_DB = 'zeiterfassung-geraeteschluessel';
const STORE = 'key';
const ENTRY = 'device';

/** The browser's store (IndexedDB). Every call opens and closes the database; errors reject. */
export function indexedDbKeyStore(factory: IDBFactory = globalThis.indexedDB): DeviceKeyStore {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      if (!factory) return reject(new Error('IndexedDB fehlt'));
      const request = factory.open(DEVICE_KEY_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB nicht erreichbar'));
    });
  async function run<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>) {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB-Fehler'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB: nicht gespeichert'));
      });
    } finally {
      db.close();
    }
  }
  return {
    async read() {
      const value: unknown = await run('readonly', (s) => s.get(ENTRY));
      return value instanceof CryptoKey ? value : undefined;
    },
    async write(key) {
      await run('readwrite', (s) => s.put(key, ENTRY));
    },
    async clear() {
      await run('readwrite', (s) => s.delete(ENTRY));
    },
  };
}

/** Tests: the same in memory, through a structured clone like IndexedDB. */
export function memoryKeyStore(): DeviceKeyStore & { held(): CryptoKey | undefined } {
  let held: CryptoKey | undefined;
  return {
    read: async () => (held === undefined ? undefined : structuredClone(held)),
    write: async (key) => void (held = structuredClone(key)),
    clear: async () => void (held = undefined),
    held: () => held,
  };
}
