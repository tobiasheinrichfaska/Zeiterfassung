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
import {
  FRESHNESS_SLACK_MS,
  RELAY_TIMEOUT_MS,
  createRelayService,
  requestAnchor,
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
      if (String(url).endsWith('/v1/services')) return json(200, { services: [{ id: 'freetsa' }] });
      const next = stamps.shift();
      if (!next) throw new Error('unexpected call');
      return next;
    };
    return { fn, seen };
  }
  const service = (fn: typeof fetch, over: RelayOptions = {}) =>
    createRelayService(RELAY, { fetch: fn, wallNow: () => GEN + 4000, ...over });

  it('signs every stamp request with the device key (header v2.<kid>.<ts>.<sig>), asks solo', async () => {
    const { pkcs8, publicKey } = await makeKey();
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    const r = relay(answer());
    const out = await service(r.fn, { auth: { privateKey, keyId: 'geraet-1' } }).anchor(PROBE_HASH);
    expect(out.ok).toBe(true);
    const post = r.seen[1]!;
    const body = String(post.init.body);
    expect(JSON.parse(body)).toEqual({
      hash: b64url(Buffer.from(PROBE_HASH, 'hex')),
      mode: 'solo',
    });
    const header = (post.init.headers as Record<string, string>)['X-Zeitstempel-Auth']!;
    const [v, kid, ts, sig] = header.split('.');
    expect([v, kid, ts]).toEqual(['v2', 'geraet-1', String(Math.floor((GEN + 4000) / 1000))]);
    const message =
      'zeitstempel-auth-v2\nPOST\n/v1/stamp/freetsa\n' +
      ts +
      '\n' +
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
    // the GET of the service list is never signed, and the key never leaves
    expect(r.seen[0]!.init.headers ?? {}).not.toHaveProperty('X-Zeitstempel-Auth');
    expect(JSON.stringify(r.seen)).not.toContain(b64url(pkcs8));
  });

  it('says that the device key is not accepted on 401 and on 403 solo-not-allowed, no anchor', async () => {
    const { pkcs8 } = await makeKey();
    const auth = { privateKey: pkcs8, keyId: 'unbekannt' };
    const b = emptyBook();
    b.settings = { ...b.settings, timestampRelay: RELAY };
    const book = val(stampIn(b, { date: '2026-11-20', minute: 480 }, '2026-11-20T08:00:00.000Z'));
    const date = new Date(GEN + 4000).toUTCString(); // the relay's clock agrees: no second try
    const r401 = relay(json(401, { error: 'unauthorized' }, { Date: date }));
    expect(await requestAnchor(book, service(r401.fn, { auth }))).toEqual({
      kind: 'failed',
      text: 'Geräteschlüssel wird vom Zeitstempeldienst nicht angenommen. (Status 401, unauthorized)',
    });
    const r403 = relay(json(403, { error: 'solo-not-allowed' }));
    expect(await service(r403.fn, { auth }).anchor(PROBE_HASH)).toEqual({
      ok: false,
      reason: 'unauthorized',
      detail: 'Status 403, Schlüssel ohne Solo-Erlaubnis',
    });
  });

  it('refuses a token older than the sending minus 60 s (back-dated), and one from the future', async () => {
    const late = relay(answer());
    expect(
      await service(late.fn, { wallNow: () => GEN + FRESHNESS_SLACK_MS + 5000 }).anchor(PROBE_HASH),
    ).toEqual({
      ok: false,
      reason: 'not-verified',
      detail: 'die bestätigte Zeit liegt vor der Anfrage (rückdatiert)',
    });
    const inTime = relay(answer());
    expect(
      (
        await service(inTime.fn, { wallNow: () => GEN + FRESHNESS_SLACK_MS - 5000 }).anchor(
          PROBE_HASH,
        )
      ).ok,
    ).toBe(true);
    const early = relay(answer());
    expect(
      await service(early.fn, { wallNow: () => GEN - 10 * 60_000 }).anchor(PROBE_HASH),
    ).toMatchObject({ ok: false, reason: 'not-verified' });
  });

  it('judges freshness by the relay’s clock when the device clock is off by more than 30 s', async () => {
    const dated = (date: number) => {
      const seen: string[] = [];
      const fn: typeof fetch = async (url) => {
        seen.push(String(url));
        const headers = { Date: new Date(date).toUTCString() };
        return String(url).endsWith('/v1/services')
          ? json(200, { services: [{ id: 'freetsa' }] }, headers)
          : new Response((await answer().text()) as string, { status: 200, headers });
      };
      return fn;
    };
    const ahead = () => GEN + 2 * 3_600_000; // the device clock runs two hours ahead
    // without the relay's Date the genuine token looks back-dated
    expect(await service(relay(answer()).fn, { wallNow: ahead }).anchor(PROBE_HASH)).toMatchObject({
      ok: false,
      detail: 'die bestätigte Zeit liegt vor der Anfrage (rückdatiert)',
    });
    // with it, the window is the relay's: accepted
    expect((await service(dated(GEN + 3000), { wallNow: ahead }).anchor(PROBE_HASH)).ok).toBe(true);
    // a back-dated token stays refused when the relay's clock says it is old
    expect(
      await service(dated(GEN + 5 * 60_000), { wallNow: ahead }).anchor(PROBE_HASH),
    ).toMatchObject({
      ok: false,
      detail: 'die bestätigte Zeit liegt vor der Anfrage (rückdatiert)',
    });
  });

  it('waits long enough for the relay (its own waits are up to 47 s in single operation)', () => {
    expect(RELAY_TIMEOUT_MS).toBeGreaterThanOrEqual(47_000 + 30_000);
  });
});
