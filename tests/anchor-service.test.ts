import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readTimestampResponse } from 'zeitstempel';
import { CLIENT_LIMITS } from 'zeitstempel/client';
import { trustedServices } from '../src/io/zeitstempel.ts';
import {
  addAnchor,
  appendStamp,
  readEvidence,
  hexToBytes,
  emptyBook,
  parseRelayList,
  relayOk,
  relayOrigin,
  relayUsable,
  relayAudience,
  audienceOk,
  stampIn,
  type AnchorOutcome,
  type TimeBook,
} from '../src/logic/index.ts';
import {
  RELAY_TIMEOUT_MS,
  createRelayService,
  requestAnchor,
  type AnchorService,
  type RelayOptions,
} from '../src/io/anchorService.ts';
import { evidenceFor, val } from './helpers.ts';

/** The device key of these tests (PKCS#8 bytes): a stand-in relay checks no signature. */
const AUTH = {
  keyId: 'geraet-1',
  privateKey: new Uint8Array(
    await crypto.subtle.exportKey(
      'pkcs8',
      (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']))
        .privateKey,
    ),
  ),
};

const RELAY = 'https://relay.example';
const bytesToBase64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');
const iso = (day: number, h = 8, m = 0) =>
  `2026-11-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;

const book = (relay = RELAY): TimeBook => {
  const b = emptyBook();
  b.settings = { ...b.settings, timestampRelay: relay };
  return val(stampIn(b, { date: '2026-11-20', minute: 480 }, iso(20, 8)));
};

describe('relay addresses', () => {
  it('accepts https, http only for the own machine, and empty', () => {
    expect(relayOk('')).toBe(true);
    expect(relayOk('https://relay.example/stamp')).toBe(true);
    expect(relayOk('http://localhost:8787/x')).toBe(true);
    expect(relayOk('http://127.0.0.1/x')).toBe(true);
    for (const bad of [
      'http://relay.example/x',
      'ftp://x',
      'relay.example',
      'https://a b',
      'https://user:pw@x.example/',
      'javascript:alert(1)',
      5,
      null,
      `https://${'a'.repeat(200)}.example`,
    ]) {
      expect(relayOk(bad), String(bad)).toBe(false);
    }
  });

  it('reads the list of the build: trimmed, valid, once each', () => {
    expect(parseRelayList(undefined)).toEqual([]);
    expect(parseRelayList('')).toEqual([]);
    expect(
      parseRelayList(' https://a.example/x , ftp://no , https://a.example/x,http://localhost:1/y '),
    ).toEqual(['https://a.example/x', 'http://localhost:1/y']);
  });

  it('knows the origin and which setting a build may use', () => {
    expect(relayOrigin('https://relay.example/stamp?x=1')).toBe('https://relay.example');
    expect(relayOrigin('http://localhost:8787/x')).toBe('http://localhost:8787');
    expect(relayUsable(RELAY, [RELAY])).toBe(true);
    expect(relayUsable(RELAY, [])).toBe(false); // a typed-in address not named by the build is not used
    expect(relayUsable(RELAY, ['https://other.example/x'])).toBe(false);
    expect(relayUsable('', [RELAY])).toBe(false); // off
  });
});

/** The recorded FreeTSA answer was made for the SHA-256 of the text „probe“. */
const PROBE_HASH = createHash('sha256').update('probe').digest('hex');
const recorded = readTimestampResponse(
  new Uint8Array(readFileSync(new URL('./fixtures/freetsa.tsr', import.meta.url))),
);
if (!recorded.ok) throw new Error('fixture');
const TOKEN = recorded.value.token;

describe('the audience of a relay (build variable VITE_TIMESTAMP_AUDIENCE)', () => {
  it('is the configured value when it is valid, else the relay origin', () => {
    expect(relayAudience('https://relay.example/x', undefined)).toBe('https://relay.example');
    expect(relayAudience('https://relay.example/x', '')).toBe('https://relay.example');
    expect(relayAudience('http://localhost:8790', ' zeiterfassung-test ')).toBe(
      'zeiterfassung-test',
    );
    expect(relayAudience('https://relay.example', 'mit leerzeichen')).toBe('https://relay.example');
    expect(audienceOk('https://relay.example')).toBe(true);
    for (const bad of ['', 'a b', 'ä', 'x'.repeat(129), 5, null]) {
      expect(audienceOk(bad), String(bad)).toBe(false);
    }
    expect(audienceOk('x'.repeat(128))).toBe(true);
  });
});

describe('the trust anchors shipped with the app', () => {
  it('cover every service the library lists, by the id the relay uses', () => {
    const trusted = trustedServices();
    expect([...trusted.keys()].sort()).toEqual(['certum', 'digicert', 'freetsa', 'sectigo']);
    for (const [id, s] of trusted) {
      expect(s.qualified, id).toBe(false);
      expect(s.anchors.length, id).toBeGreaterThan(0);
      for (const pem of s.anchors) expect(pem, id).toContain('BEGIN CERTIFICATE');
    }
  });
});

describe('the relay adapter', () => {
  /** The recorded token was made at 2026-11-23T13:05:56Z: the adapter's wall clock stands just after it. */
  const TOKEN_WALL = Date.parse('2026-11-23T13:06:00.000Z');
  let mono = 1_000_000;
  const relayService = (base: string, options: RelayOptions = {}) =>
    createRelayService(base, AUTH, {
      now: () => TOKEN_WALL,
      monoNow: () => mono,
      timeoutMs: 1000, // a 429 or 503 busy ends the call at once (the wait would pass the deadline)
      ...options,
    });

  /** The serial inside the recorded token (the relay sends the same). */
  const realSerial = recorded.value.info.serial;
  const answer = (over: Record<string, unknown> = {}) => ({
    service: 'freetsa',
    genTime: '2026-11-23T13:05:56.000Z',
    accuracyMs: null,
    serial: realSerial,
    token: bytesToBase64Url(TOKEN),
    ...over,
  });
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers });
  const body = (init: RequestInit) => JSON.parse(new TextDecoder().decode(init.body as Uint8Array));

  interface Seen {
    url: string;
    init: RequestInit;
  }
  /** A relay stand-in: the answers to the stamp calls, in order. */
  function relay(...stamps: (Response | Error)[]) {
    const seen: Seen[] = [];
    const fn: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), init: init ?? {} });
      const next = stamps.shift();
      if (!next) throw new Error('unexpected call ' + String(url));
      if (next instanceof Error) throw next;
      return next;
    };
    return { fn, seen };
  }

  it('posts only the hash (solo), signed, without cookies or redirects, and returns the verified evidence', async () => {
    const r = relay(json(200, answer()));
    const out = await relayService(RELAY + '/', { fetch: r.fn }).anchor(PROBE_HASH);
    if (!out.ok) throw new Error(out.detail);
    const e = out.value.evidence;
    expect(e).toMatchObject({
      v: 1,
      kind: 'single',
      service: 'freetsa',
      hash: bytesToBase64Url(hexToBytes(PROBE_HASH)!),
      hashAlg: 'sha256',
      genTime: '2026-11-23T13:05:56.000Z',
      receivedAtMs: TOKEN_WALL,
    });
    expect(Buffer.from(e.token, 'base64url')).toEqual(Buffer.from(TOKEN));
    expect(val(readEvidence(e))).toEqual(e);
    // the first service of services.json the app has anchors for
    expect(r.seen.map((s) => s.url)).toEqual(['https://relay.example/v1/stamp/freetsa']);
    expect(r.seen[0]!.init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(Object.keys(r.seen[0]!.init.headers as object).sort()).toEqual([
      'Content-Type',
      'X-Zeitstempel-Auth',
    ]);
    expect(body(r.seen[0]!.init)).toEqual({
      hash: bytesToBase64Url(hexToBytes(PROBE_HASH)!),
      mode: 'solo',
    });
  });

  it('reports the relay clock offset when the relay Date differs by more than 30 s', async () => {
    const offsets: number[] = [];
    const later = new Date(TOKEN_WALL + 50_000).toUTCString();
    const r = relay(json(200, answer(), { Date: later }));
    await relayService(RELAY, { fetch: r.fn, onClockOffset: (o) => offsets.push(o) }).anchor(
      PROBE_HASH,
    );
    expect(offsets).toEqual([50_000]);
    const same = new Date(TOKEN_WALL + 10_000).toUTCString();
    const none: number[] = [];
    await relayService(RELAY, {
      fetch: relay(json(200, answer(), { Date: same })).fn,
      onClockOffset: (o) => none.push(o),
    }).anchor(PROBE_HASH);
    expect(none).toEqual([]);
  });

  it('takes the time from the verified token, not from the relay', async () => {
    const r = relay(json(200, answer({ genTime: '2030-01-01T00:00:00.000Z' })));
    const out = await relayService(RELAY, { fetch: r.fn }).anchor(PROBE_HASH);
    expect(out.ok && out.value.evidence.genTime).toBe('2026-11-23T13:05:56.000Z');
  });

  it('refuses a token for another hash, a changed token, a wrong anchor, a serial that differs', async () => {
    const run = async (
      hash: string,
      over: Record<string, unknown>,
      trusted?: Map<string, { anchors: string[] }>,
    ) => {
      const r = relay(json(200, answer(over)));
      return relayService(RELAY, { fetch: r.fn, ...(trusted ? { trusted } : {}) }).anchor(hash);
    };
    // the token was made for „probe“, the app stamped something else
    expect(await run('ab'.repeat(32), {})).toMatchObject({
      ok: false,
      reason: 'not-verified',
      detail: 'der bestätigte Hash ist ein anderer',
    });
    // a byte in the signed part changed
    const changed = Uint8Array.from(TOKEN);
    changed[changed.length - 20] = changed[changed.length - 20]! ^ 1;
    expect(await run(PROBE_HASH, { token: bytesToBase64Url(changed) })).toMatchObject({
      ok: false,
      reason: 'not-verified',
    });
    // cut off
    expect(await run(PROBE_HASH, { token: bytesToBase64Url(TOKEN.slice(0, 200)) })).toMatchObject({
      ok: false,
      reason: 'not-verified',
    });
    // anchors of another service: the chain ends nowhere we trust
    const other = trustedServices().get('sectigo')!;
    expect(await run(PROBE_HASH, {}, new Map([['freetsa', other]]))).toMatchObject({
      ok: false,
      reason: 'not-verified',
      detail: 'die Zertifikatskette endet bei keinem bekannten Anker',
    });
    // the relay names another serial than the token carries
    expect(await run(PROBE_HASH, { serial: 'ff' })).toEqual({
      ok: false,
      reason: 'bad-response',
      detail: 'Seriennummer weicht vom Token ab',
    });
    // the relay answers for another service than asked, or with an extra field
    for (const over of [{ service: 'sectigo' }, { extra: 1 }]) {
      expect(await run(PROBE_HASH, over), JSON.stringify(over)).toMatchObject({
        ok: false,
        reason: 'bad-response',
      });
    }
    // a collected receipt where a direct stamp was asked for
    expect(
      await run(PROBE_HASH, { batch: { v: 1, size: 2, index: 0, salt: 'A'.repeat(43), path: [] } }),
    ).toEqual({ ok: false, reason: 'bad-response', detail: 'Sammelbeleg statt Einzelstempel' });
  });

  it('leaves out a service the relay does not offer or the key may not use, and asks the next', async () => {
    const t = trustedServices();
    // the third service carries FreeTSA's root here, so the recorded token verifies under its id
    const trusted = new Map([
      ['sectigo', t.get('sectigo')!],
      ['certum', t.get('certum')!],
      ['digicert', t.get('freetsa')!],
    ]);
    const r = relay(
      json(404, { error: 'unknown-service' }),
      json(403, { error: 'service-not-allowed' }),
      json(200, answer({ service: 'digicert' })),
      json(200, answer({ service: 'digicert' })),
    );
    const service = relayService(RELAY, { fetch: r.fn, trusted });
    const out = await service.anchor(PROBE_HASH);
    expect(out.ok && out.value.evidence.service).toBe('digicert');
    expect((await service.anchor(PROBE_HASH)).ok).toBe(true);
    expect(r.seen.map((s) => s.url.split('/').pop())).toEqual([
      'sectigo',
      'certum',
      'digicert',
      'digicert', // the next stamp goes to the service that is there
    ]);
    const none = relay(
      ...['freetsa', 'sectigo', 'digicert', 'certum'].map(() =>
        json(404, { error: 'unknown-service' }),
      ),
    );
    expect(await relayService(RELAY, { fetch: none.fn }).anchor(PROBE_HASH)).toEqual({
      ok: false,
      reason: 'refused',
      detail: 'kein Dienst des Weiterreichers ist der App bekannt',
    });
    expect(none.seen).toHaveLength(4);
  });

  it('says so when the app knows no service at all', async () => {
    expect(
      await relayService(RELAY, { fetch: relay().fn, trusted: new Map() }).anchor(PROBE_HASH),
    ).toMatchObject({ ok: false, reason: 'refused' });
  });

  it('tries the next service on 502, 504 and network errors, and reports the last when all fail', async () => {
    const r = relay(
      json(502, { error: 'upstream-failed' }),
      json(504, { error: 'upstream-timeout' }),
      new TypeError('Failed to fetch'),
      json(502, { error: 'upstream-invalid', reason: 'x' }),
    );
    const out = await relayService(RELAY, { fetch: r.fn }).anchor(PROBE_HASH);
    expect(out).toEqual({
      ok: false,
      reason: 'unreachable',
      detail: 'Status 502, upstream-invalid',
    });
    expect(r.seen).toHaveLength(4);
    // the token of the recorded fixture is FreeTSA's, and trust is per service: FreeTSA comes second here
    const all = trustedServices();
    const ok = relay(
      json(504, { error: 'upstream-timeout' }),
      json(200, answer({ service: 'freetsa' })),
    );
    const sectigoFirst = new Map([
      ['sectigo', { anchors: all.get('sectigo')!.anchors }],
      ['freetsa', { anchors: all.get('freetsa')!.anchors }],
    ]);
    expect(
      (await relayService(RELAY, { fetch: ok.fn, trusted: sectigoFirst }).anchor(PROBE_HASH)).ok,
    ).toBe(true);
    expect(ok.seen.map((s) => s.url)).toEqual([
      `${RELAY}/v1/stamp/sectigo`,
      `${RELAY}/v1/stamp/freetsa`,
    ]);
    const down = relayService(RELAY, {
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(await down.anchor(PROBE_HASH)).toEqual({
      ok: false,
      reason: 'unreachable',
      detail: 'keine Antwort',
    });
  });

  it('pauses after 429 (and 503 busy) until Retry-After has passed, without asking the relay meanwhile', async () => {
    for (const refusal of [
      json(429, { error: 'rate-limited' }, { 'Retry-After': '30' }),
      json(503, { error: 'busy' }, { 'Retry-After': '30' }),
    ]) {
      const r = relay(refusal, json(200, answer()));
      const service = relayService(RELAY, { fetch: r.fn });
      expect(await service.anchor(PROBE_HASH)).toEqual({
        ok: false,
        reason: 'rate-limited',
        detail: 'bitte in 30 s erneut versuchen',
      });
      mono += 10_000;
      expect(await service.anchor(PROBE_HASH)).toEqual({
        ok: false,
        reason: 'rate-limited',
        detail: 'bitte in 20 s erneut versuchen',
      });
      expect(r.seen).toHaveLength(1); // nothing was sent during the pause
      mono += 20_000;
      expect((await service.anchor(PROBE_HASH)).ok).toBe(true);
    }
  });

  it('measures the pause on the monotonic clock: a wall clock set back does not stretch it', async () => {
    let wall = TOKEN_WALL;
    const r = relay(json(429, {}, { 'Retry-After': '30' }), json(200, answer()));
    const service = relayService(RELAY, { fetch: r.fn, now: () => wall });
    expect((await service.anchor(PROBE_HASH)).ok).toBe(false);
    wall -= 3 * 3_600_000; // the device clock is set back by three hours …
    mono += 30_000; // … while 30 s pass
    wall = TOKEN_WALL; // (the token needs a wall clock near its time)
    expect((await service.anchor(PROBE_HASH)).ok).toBe(true);
  });

  it('takes a missing Retry-After as one second (the client’s rule)', async () => {
    const r = relay(json(429, {}));
    expect(await relayService(RELAY, { fetch: r.fn }).anchor(PROBE_HASH)).toMatchObject({
      reason: 'rate-limited',
      detail: 'bitte in 1 s erneut versuchen',
    });
    mono += 1000;
  });

  it('says refused for other error statuses, with the relay’s code, and asks no other service', async () => {
    const stamp = relay(json(400, { error: 'bad-hash' }));
    expect(await relayService(RELAY, { fetch: stamp.fn }).anchor(PROBE_HASH)).toEqual({
      ok: false,
      reason: 'refused',
      detail: 'Status 400, bad-hash',
    });
    expect(stamp.seen).toHaveLength(1);
    const notFound = relay(json(404, { error: 'not-found' }));
    expect(await relayService(RELAY, { fetch: notFound.fn }).anchor(PROBE_HASH)).toEqual({
      ok: false,
      reason: 'refused',
      detail: 'Status 404, not-found',
    });
  });

  it('says bad response for text that is no JSON, and for a hash that is no hash', async () => {
    const notJson = relay(new Response('kein json', { status: 200 }));
    expect(await relayService(RELAY, { fetch: notJson.fn }).anchor(PROBE_HASH)).toEqual({
      ok: false,
      reason: 'bad-response',
      detail: 'kein JSON',
    });
    expect(await relayService(RELAY, { fetch: relay().fn }).anchor('nope')).toMatchObject({
      reason: 'bad-response',
    });
  });

  it('gives up after the time limit, and its default is the client’s', async () => {
    const hang = (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('abort', 'AbortError')),
        );
      });
    const r = await relayService(RELAY, { fetch: hang, timeoutMs: 1000 }).anchor(PROBE_HASH);
    expect(r).toEqual({ ok: false, reason: 'unreachable', detail: 'Zeitüberschreitung' });
    expect(RELAY_TIMEOUT_MS).toBe(CLIENT_LIMITS.DEFAULT_TIMEOUT_MS);
  });
});

describe('one round with the service', () => {
  const evidence = (b: TimeBook) => evidenceFor(b.stamps[0]!.hash, { genTime: iso(20, 8, 1) });
  const okFor = (b: TimeBook): AnchorOutcome => ({ ok: true, value: { evidence: evidence(b) } });
  const ok = okFor(book());
  const fixed = (outcome: AnchorOutcome): AnchorService => ({ anchor: async () => outcome });

  it('is off without a relay in the settings or without a service', async () => {
    expect(await requestAnchor(book(''), fixed(ok))).toEqual({ kind: 'off' });
    expect(await requestAnchor(book(), undefined)).toEqual({ kind: 'off' });
  });

  it('has nothing to do when the head is covered', async () => {
    const b = book();
    const covered = val(
      addAnchor(
        b,
        { coveredN: 1, headHash: b.stamps[0]!.hash, evidence: evidence(b) },
        iso(20, 8, 2),
      ),
    );
    expect(await requestAnchor(covered, fixed(ok))).toEqual({ kind: 'nothing' });
  });

  it('sends the hash of the chain head and returns the anchor for the answer', async () => {
    const b = book();
    let sent = '';
    const round = await requestAnchor(b, { anchor: async (h) => ((sent = h), ok) });
    expect(sent).toBe(b.stamps[0]!.hash);
    expect(round.kind === 'anchor' && round.anchor).toEqual({
      coveredN: 1,
      headHash: b.stamps[0]!.hash,
      evidence: evidence(b),
    });
  });

  it('can be added to the book as it is after the service answered, also with stamps made meanwhile', async () => {
    const b = book();
    const round = await requestAnchor(b, fixed(ok));
    if (round.kind !== 'anchor') throw new Error('unexpected');
    const later = val(appendStamp(b, 'change', '2026-11-20', iso(20, 8, 1)));
    const added = val(addAnchor(later, round.anchor, iso(20, 8, 2)));
    expect(added.anchors).toHaveLength(1);
    expect(added.stamps).toHaveLength(2); // the newer stamp is not covered yet
  });

  it('always names a failure, with the reason of the service', async () => {
    const failed = await requestAnchor(
      book(),
      fixed({ ok: false, reason: 'unreachable', detail: 'Zeitüberschreitung' }),
    );
    expect(failed).toEqual({
      kind: 'failed',
      text: 'Der Zeitstempeldienst ist nicht erreichbar. (Zeitüberschreitung)',
    });
    const thrown = await requestAnchor(book(), {
      anchor: async () => {
        throw new Error('kaputt');
      },
    });
    expect(thrown).toEqual({
      kind: 'failed',
      text: 'Der Zeitstempeldienst ist nicht erreichbar. (kaputt)',
    });
    const refused = await requestAnchor(
      book(),
      fixed({ ok: false, reason: 'refused', detail: 'Status 429' }),
    );
    expect(refused.kind === 'failed' && refused.text).toBe(
      'Der Zeitstempeldienst hat die Anfrage abgelehnt. (Status 429)',
    );
  });
});
