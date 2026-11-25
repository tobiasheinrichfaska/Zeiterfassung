import { createHash, createPublicKey, verify as nodeVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { memoryEnvironment } from 'local-vault';
import { readTimestampResponse } from 'zeitstempel';
import {
  DEVICE_KEY_LIMITS,
  DEVICE_KEY_SLOT,
  REASON_TEXTS,
  base64UrlToBytes,
  emptyBook,
  parseDeviceKey,
  stampIn,
} from '../src/logic/index.ts';
import { CLIENT_LIMITS } from 'zeitstempel/client';
import {
  RELAY_TIMEOUT_MS,
  createRelayService,
  requestAnchor,
  type DeviceAuth,
  type RelayOptions,
} from '../src/io/anchorService.ts';
import { loadDeviceKey, removeDeviceKey, storeDeviceKey } from '../src/io/deviceKey.ts';
import { createAppVault, vaultConfig } from '../src/ui/vault.ts';
import { val } from './helpers.ts';

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

async function makeKey(curve: 'P-256' | 'P-384' = 'P-256') {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: curve }, true, [
    'sign',
    'verify',
  ]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { pkcs8, raw, publicKey: pair.publicKey };
}

describe('the device key text (logic)', () => {
  it('reads <kennung>.<schlüssel>, trimmed, and keeps the bytes', async () => {
    const { pkcs8 } = await makeKey();
    const text = `geraet-1.${b64url(pkcs8)}`;
    const read = val(parseDeviceKey(`  ${text}\n`));
    expect(read.keyId).toBe('geraet-1');
    expect(read.text).toBe(text);
    expect([...read.pkcs8]).toEqual([...pkcs8]);
  });

  it('refuses every other form with a code that has a German text', async () => {
    const { pkcs8 } = await makeKey();
    const key = b64url(pkcs8);
    const cases: [string, string][] = [
      ['', 'device-key-format'],
      [key, 'device-key-format'], // only line 1 of make-key, no key id
      [`geraet-1.${key}.x`, 'device-key-format'],
      [`geraet-1 .${key}`, 'device-key-id'],
      [`Geraet.${key}`, 'device-key-id'],
      [`1geraet.${key}`, 'device-key-id'],
      [`${'a'.repeat(33)}.${key}`, 'device-key-id'],
      [`geraet-1.${key.slice(0, 40)}`, 'device-key-format'], // too short
      [`geraet-1.${key}==`, 'device-key-format'], // padding
      [`geraet-1.${key.replace(/.$/, '+')}`, 'device-key-format'],
      [`geraet-1.${b64url(new Uint8Array(100).fill(0x31))}`, 'device-key-format'], // no DER sequence
      [`geraet-1.${b64url(new Uint8Array(300).fill(0x30))}`, 'device-key-format'], // too long
      [`geraet-1.${b64url(new Uint8Array(100).fill(0x30))}`, 'device-key-unusable'], // no P-256
    ];
    for (const [text, code] of cases) {
      const r = parseDeviceKey(text);
      expect(r, text).toEqual({ ok: false, reason: code });
      expect(REASON_TEXTS[code as keyof typeof REASON_TEXTS]).toMatch(/Geräteschlüssel|Kennung/);
    }
    const p384 = await makeKey('P-384');
    expect(parseDeviceKey(`k.${b64url(p384.pkcs8)}`)).toEqual({
      ok: false,
      reason: 'device-key-unusable',
    });
    expect(p384.pkcs8.length).toBeLessThanOrEqual(DEVICE_KEY_LIMITS.maxKeyBytes);
  });

  it('decodes base64url like Node, and only in its canonical form', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
      expect([...(base64UrlToBytes(b64url(bytes)) ?? [0])], String(n)).toEqual(
        n === 0 ? [0] : [...bytes],
      );
    }
    expect(base64UrlToBytes('QQ')).toEqual(Uint8Array.from([65]));
    expect(base64UrlToBytes('QR')).toBeNull(); // spare bits set
    expect(base64UrlToBytes('Q')).toBeNull();
  });
});

describe('the device key in the vault (io)', () => {
  async function openVault() {
    const vault = createAppVault(memoryEnvironment());
    expect(await vault.startVault()).toEqual({ kind: 'open' });
    return vault;
  }

  it('is a slot of the vault, and stored only there, as a key the page cannot read back', async () => {
    expect(vaultConfig.slots).toContain(DEVICE_KEY_SLOT);
    const vault = await openVault();
    expect(await loadDeviceKey(vault)).toEqual({ kind: 'none' });
    const { pkcs8 } = await makeKey();
    const text = `geraet-7.${b64url(pkcs8)}`;
    const stored = await storeDeviceKey(vault, ` ${text} `);
    expect(stored.ok).toBe(true);
    expect(vault.readSlot(DEVICE_KEY_SLOT)).toBe(text);
    const loaded = await loadDeviceKey(vault);
    expect(loaded.kind).toBe('key');
    if (loaded.kind !== 'key') return;
    expect(loaded.key.keyId).toBe('geraet-7');
    expect(loaded.key.privateKey.extractable).toBe(false);
    expect(loaded.key.privateKey.usages).toEqual(['sign']);
    await expect(crypto.subtle.exportKey('pkcs8', loaded.key.privateKey)).rejects.toThrow();

    expect(removeDeviceKey(vault)).toBeUndefined();
    expect(await loadDeviceKey(vault)).toEqual({ kind: 'none' });
  });

  it('stores nothing for a text that is refused, and reports a stored text it cannot use', async () => {
    const vault = await openVault();
    const bad = await storeDeviceKey(vault, 'kein schlüssel');
    expect(bad).toEqual({ ok: false, text: REASON_TEXTS['device-key-format'] });
    expect(vault.readSlot(DEVICE_KEY_SLOT)).toBeNull();
    // the P-256 OID is there, but the bytes are no key: WebCrypto refuses, nothing is stored
    const fake = new Uint8Array(100).fill(0x30);
    fake.set([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07], 20);
    const refused = await storeDeviceKey(vault, `k.${b64url(fake)}`);
    expect(refused).toEqual({ ok: false, text: REASON_TEXTS['device-key-unusable'] });
    expect(vault.readSlot(DEVICE_KEY_SLOT)).toBeNull();

    vault.writeSlot(DEVICE_KEY_SLOT, 'kaputt');
    const loaded = await loadDeviceKey(vault);
    expect(loaded.kind).toBe('unusable');
  });
});

describe('the authenticated relay (adapter)', () => {
  const RELAY = 'https://relay.example';
  const PROBE_HASH = createHash('sha256').update('probe').digest('hex');
  const recorded = readTimestampResponse(
    new Uint8Array(readFileSync(new URL('./fixtures/freetsa.tsr', import.meta.url))),
  );
  if (!recorded.ok) throw new Error('fixture');
  const TOKEN = recorded.value.token;
  const SERIAL = recorded.value.info.serial;
  const GEN = Date.parse('2026-11-23T13:05:56.000Z');
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers });
  const answer = () =>
    json(200, {
      service: 'freetsa',
      genTime: '2026-11-23T13:05:56.000Z',
      accuracyMs: null,
      serial: SERIAL,
      token: b64url(TOKEN),
    });

  function relay(...stamps: Response[]) {
    const seen: { url: string; init: RequestInit }[] = [];
    const fn: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), init: init ?? {} });
      const next = stamps.shift();
      if (!next) throw new Error('unexpected call');
      return next;
    };
    return { fn, seen };
  }
  const service = (fn: typeof fetch, auth: DeviceAuth, over: RelayOptions = {}) =>
    createRelayService(RELAY, auth, { fetch: fn, now: () => GEN + 4000, ...over });
  const text = (body: unknown) => new TextDecoder().decode(body as Uint8Array);

  it('signs every stamp request with the device key (header v3 with audience and jti), asks solo', async () => {
    const { pkcs8, publicKey } = await makeKey();
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    const r = relay(answer());
    const out = await service(
      r.fn,
      { privateKey, keyId: 'geraet-1' },
      {
        audience: 'zeiterfassung-test',
      },
    ).anchor(PROBE_HASH);
    expect(out.ok).toBe(true);
    expect(r.seen).toHaveLength(1); // no list of services: only the stamp
    const post = r.seen[0]!;
    const body = text(post.init.body);
    expect(JSON.parse(body)).toEqual({
      hash: b64url(Buffer.from(PROBE_HASH, 'hex')),
      mode: 'solo',
    });
    const header = (post.init.headers as Record<string, string>)['X-Zeitstempel-Auth']!;
    const [v, kid, ts, jti, sig] = header.split('.');
    expect([v, kid, ts]).toEqual(['v3', 'geraet-1', String(GEN + 4000)]);
    expect(jti).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const message =
      'zeitstempel-auth-v3\nPOST\n/v1/stamp/freetsa\nzeiterfassung-test\n' +
      `${ts}\n${jti}\n` +
      createHash('sha256').update(body).digest('hex');
    const pub = createPublicKey({
      key: (await crypto.subtle.exportKey('jwk', publicKey)) as never,
      format: 'jwk',
    });
    expect(
      nodeVerify(
        'sha256',
        Buffer.from(message),
        { key: pub, dsaEncoding: 'ieee-p1363' },
        Buffer.from(sig!, 'base64url'),
      ),
    ).toBe(true);
    // the key never leaves
    expect(JSON.stringify(r.seen)).not.toContain(b64url(pkcs8));
  });

  it('signs for the relay origin when no audience is given (the relay’s convention)', async () => {
    const { pkcs8, publicKey } = await makeKey();
    const r = relay(answer());
    expect(
      (await service(r.fn, { privateKey: pkcs8, keyId: 'geraet-1' }).anchor(PROBE_HASH)).ok,
    ).toBe(true);
    const post = r.seen[0]!;
    const [, , ts, jti, sig] = (post.init.headers as Record<string, string>)[
      'X-Zeitstempel-Auth'
    ]!.split('.');
    const message =
      `zeitstempel-auth-v3\nPOST\n/v1/stamp/freetsa\n${RELAY}\n${ts}\n${jti}\n` +
      createHash('sha256').update(text(post.init.body)).digest('hex');
    const pub = createPublicKey({
      key: (await crypto.subtle.exportKey('jwk', publicKey)) as never,
      format: 'jwk',
    });
    expect(
      nodeVerify(
        'sha256',
        Buffer.from(message),
        { key: pub, dsaEncoding: 'ieee-p1363' },
        Buffer.from(sig!, 'base64url'),
      ),
    ).toBe(true);
  });

  it('says that the device key is not accepted on 401 and on 403 solo-not-allowed, no anchor', async () => {
    const { pkcs8 } = await makeKey();
    const auth = { privateKey: pkcs8, keyId: 'unbekannt' };
    const b = emptyBook();
    b.settings = { ...b.settings, timestampRelay: RELAY };
    const book = val(stampIn(b, { date: '2026-11-20', minute: 480 }, '2026-11-20T08:00:00.000Z'));
    // the relay's clock agrees: the client still signs once more with its Date (one try), then gives up
    const date = new Date(GEN + 4000).toUTCString();
    const r401 = relay(
      json(401, { error: 'unauthorized' }, { Date: date }),
      json(401, { error: 'unauthorized' }, { Date: date }),
    );
    expect(await requestAnchor(book, service(r401.fn, auth))).toEqual({
      kind: 'failed',
      text: 'Geräteschlüssel wird vom Zeitstempeldienst nicht angenommen. (Status 401)',
    });
    expect(r401.seen).toHaveLength(2);
    const r403 = relay(json(403, { error: 'solo-not-allowed' }));
    expect(await service(r403.fn, auth).anchor(PROBE_HASH)).toEqual({
      ok: false,
      reason: 'unauthorized',
      detail: 'Status 403, Schlüssel ohne Solo-Erlaubnis',
    });
    expect(
      await service(relay().fn, { privateKey: pkcs8, keyId: 'Gerät' }).anchor(PROBE_HASH),
    ).toEqual({ ok: false, reason: 'unauthorized', detail: 'Schlüssel nicht verwendbar' });
  });

  it('refuses a token older than the sending minus 60 s (the client’s freshness), and one from the future', async () => {
    const { pkcs8 } = await makeKey();
    const auth = { privateKey: pkcs8, keyId: 'geraet-1' };
    const late = relay(answer());
    expect(await service(late.fn, auth, { now: () => GEN + 65_000 }).anchor(PROBE_HASH)).toEqual({
      ok: false,
      reason: 'not-verified',
      detail: 'die bestätigte Zeit liegt vor der Anfrage (rückdatiert)',
    });
    const inTime = relay(answer());
    expect(
      (await service(inTime.fn, auth, { now: () => GEN + 55_000 }).anchor(PROBE_HASH)).ok,
    ).toBe(true);
    const early = relay(answer());
    expect(
      await service(early.fn, auth, { now: () => GEN - 10 * 60_000 }).anchor(PROBE_HASH),
    ).toMatchObject({ ok: false, reason: 'not-verified' });
  });

  it('corrects the clock once by the relay’s Date after a 401 (at most 65 s), then the token is fresh', async () => {
    const { pkcs8 } = await makeKey();
    const auth = { privateKey: pkcs8, keyId: 'geraet-1' };
    const device = GEN + 64_000; // 64 s ahead: the token would look back-dated
    const relayDate = new Date(GEN + 3000).toUTCString();
    const r = relay(json(401, { error: 'unauthorized' }, { Date: relayDate }), answer());
    const offsets: number[] = [];
    const out = await service(r.fn, auth, {
      now: () => device,
      onClockOffset: (o) => offsets.push(o),
    }).anchor(PROBE_HASH);
    expect(out.ok).toBe(true);
    expect(r.seen).toHaveLength(2);
    expect(offsets).toEqual([Date.parse(relayDate) - device]); // the clock warning learns it too
    // two hours off: no correction (a relay could move the freshness check), the key looks refused
    const far = relay(json(401, { error: 'unauthorized' }, { Date: relayDate }));
    const warned: number[] = [];
    expect(
      await service(far.fn, auth, {
        now: () => GEN + 2 * 3_600_000,
        onClockOffset: (o) => warned.push(o),
      }).anchor(PROBE_HASH),
    ).toMatchObject({ ok: false, reason: 'unauthorized' });
    expect(far.seen).toHaveLength(1);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toBeLessThan(-7_000_000);
  });

  it('waits as long as the client’s default (the relay’s own waits are up to 47 s in single operation)', () => {
    expect(RELAY_TIMEOUT_MS).toBe(CLIENT_LIMITS.DEFAULT_TIMEOUT_MS);
    expect(RELAY_TIMEOUT_MS).toBeGreaterThanOrEqual(47_000 + 30_000);
  });
});
