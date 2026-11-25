import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CLIENT_LIMITS, readTimestampResponse } from 'zeitstempel';
import { trustedServices } from '../src/io/zeitstempel.ts';
import {
  addAnchor,
  appendStamp,
  bytesToBase64,
  hexToBytes,
  emptyBook,
  parseRelayList,
  relayOk,
  relayOrigin,
  relayUsable,
  stampIn,
  type AnchorOutcome,
  type TimeBook,
} from '../src/logic/index.ts';
import {
  createRelayService,
  requestAnchor,
  type AnchorService,
  type RelayOptions,
} from '../src/io/anchorService.ts';
import { val } from './helpers.ts';

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
  const relayService = (base: string, options: RelayOptions = {}) =>
    createRelayService(base, { wallNow: () => TOKEN_WALL, ...options });

  const answer = (over: Record<string, unknown> = {}) => ({
    service: 'freetsa',
    genTime: '2026-11-23T13:05:56.000Z',
    accuracyMs: null,
    serial: '',
    token: bytesToBase64Url(TOKEN),
    ...over,
  });
  /** The serial inside the recorded token (the relay would send the same). */
  const realSerial = (() => {
    const t = readTimestampResponse(
      new Uint8Array(readFileSync(new URL('./fixtures/freetsa.tsr', import.meta.url))),
    );
    return t.ok ? t.value.info.serial : '';
  })();
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers });
  const services = (...ids: string[]) => json(200, { services: ids.map((id) => ({ id })) });

  interface Seen {
    url: string;
    init: RequestInit;
  }
  /** A relay stand-in: the services list and the answer(s) to the stamp calls, in order. */
  function relay(list: Response, ...stamps: Response[]) {
    const seen: Seen[] = [];
    const fn: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith('/v1/services')) return list.clone();
      const next = stamps.shift();
      if (!next) throw new Error('unexpected call ' + String(url));
      return next;
    };
    return { fn, seen };
  }

  it('asks for the services, then posts only the hash, without cookies, referrer or redirects, and verifies', async () => {
    const r = relay(services('freetsa'), json(200, answer({ serial: realSerial })));
    const out = await relayService(RELAY + '/', { fetch: r.fn }).anchor(PROBE_HASH);
    expect(out.ok && out.value).toMatchObject({ tsaId: 'freetsa', serial: realSerial });
    expect(out.ok && out.value.genTime).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(out.ok && [...out.value.token]).toEqual([...TOKEN]);
    expect(r.seen.map((s) => s.url)).toEqual([
      'https://relay.example/v1/services',
      'https://relay.example/v1/stamp/freetsa',
    ]);
    for (const s of r.seen) {
      expect(s.init).toMatchObject({
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        redirect: 'error',
      });
    }
    expect(r.seen[0]!.init.method).toBe('GET');
    expect(r.seen[1]!.init.method).toBe('POST');
    expect(r.seen[1]!.init.headers).toEqual({ 'Content-Type': 'application/json' });
    // only the hash leaves: 32 bytes as Base64url without padding
    expect(JSON.parse(String(r.seen[1]!.init.body))).toEqual({
      hash: bytesToBase64Url(hexToBytes(PROBE_HASH)!),
      mode: 'solo',
    });
    expect(String(r.seen[1]!.init.body)).not.toMatch(/=/);
  });

  it('takes the time and serial from the verified token, not from the relay', async () => {
    const r = relay(
      services('freetsa'),
      json(200, answer({ serial: realSerial, genTime: '2030-01-01T00:00:00.000Z' })),
    );
    const out = await relayService(RELAY, { fetch: r.fn }).anchor(PROBE_HASH);
    expect(out.ok && out.value.genTime).not.toContain('2030');
  });

  it('refuses a token for another hash, a changed token, a wrong anchor, a serial that differs', async () => {
    const run = async (
      hash: string,
      over: Record<string, unknown>,
      trusted?: Map<string, { anchors: string[] }>,
    ) => {
      const r = relay(services('freetsa'), json(200, answer({ serial: realSerial, ...over })));
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
    expect(await run(PROBE_HASH, { serial: 'ff' })).toMatchObject({
      ok: false,
      reason: 'bad-response',
    });
    // the relay answers for another service than asked
    expect(await run(PROBE_HASH, { service: 'sectigo' })).toMatchObject({
      ok: false,
      reason: 'bad-response',
    });
  });

  it('ignores services of the relay it has no anchors for, and says so when none is left', async () => {
    const r = relay(services('unknown', 'freetsa'), json(200, answer({ serial: realSerial })));
    const out = await relayService(RELAY, { fetch: r.fn }).anchor(PROBE_HASH);
    expect(out.ok).toBe(true);
    expect(r.seen[1]!.url).toBe('https://relay.example/v1/stamp/freetsa');
    expect(
      await relayService(RELAY, { fetch: relay(services('unknown')).fn }).anchor(PROBE_HASH),
    ).toMatchObject({
      ok: false,
      reason: 'refused',
    });
  });

  it('tries the next service on 502 and 504 (at most three), and reports the last when all fail', async () => {
    const r = relay(
      services('digicert', 'certum', 'sectigo', 'freetsa'),
      json(502, { error: 'upstream-failed' }),
      json(504, { error: 'upstream-timeout' }),
      json(502, { error: 'upstream-invalid', reason: 'x' }),
    );
    const out = await relayService(RELAY, { fetch: r.fn }).anchor(PROBE_HASH);
    expect(out).toEqual({
      ok: false,
      reason: 'unreachable',
      detail: 'Status 502, upstream-invalid',
    });
    expect(r.seen.filter((s) => s.init.method === 'POST')).toHaveLength(3);
    const ok = relay(
      services('digicert', 'freetsa'),
      json(504, { error: 'upstream-timeout' }),
      json(200, answer({ serial: realSerial })),
    );
    expect((await relayService(RELAY, { fetch: ok.fn }).anchor(PROBE_HASH)).ok).toBe(true);
  });

  it('pauses after 429 until Retry-After has passed, without asking the relay meanwhile', async () => {
    let now = 1_000_000;
    const r = relay(
      services('freetsa'),
      json(429, { error: 'rate-limited' }, { 'Retry-After': '30' }),
      json(200, answer({ serial: realSerial })),
    );
    const service = relayService(RELAY, { fetch: r.fn, now: () => now });
    expect(await service.anchor(PROBE_HASH)).toEqual({
      ok: false,
      reason: 'rate-limited',
      detail: 'bitte in 30 s erneut versuchen',
    });
    const calls = r.seen.length;
    now += 10_000;
    expect(await service.anchor(PROBE_HASH)).toEqual({
      ok: false,
      reason: 'rate-limited',
      detail: 'bitte in 20 s erneut versuchen',
    });
    expect(r.seen.length).toBe(calls); // nothing was sent during the pause
    now += 20_000;
    expect((await service.anchor(PROBE_HASH)).ok).toBe(true);
  });

  it('does not stretch the pause when the clock goes back (a pause is never longer than an hour)', async () => {
    let now = 5_000_000;
    const r = relay(
      services('freetsa'),
      json(429, {}, { 'Retry-After': '30' }),
      json(200, answer({ serial: realSerial })),
    );
    const service = relayService(RELAY, { fetch: r.fn, now: () => now });
    expect((await service.anchor(PROBE_HASH)).ok).toBe(false);
    now -= 3 * 3_600_000; // the device clock is set back by three hours
    const again = await service.anchor(PROBE_HASH);
    expect(again, JSON.stringify(again)).toMatchObject({ ok: true });
  });

  it('takes a missing or silly Retry-After as 60 seconds and never more than an hour', async () => {
    for (const [header, expected] of [
      [undefined, 60],
      ['soon', 60],
      ['0', 60],
      ['99999', 3600],
    ] as const) {
      const r = relay(services('freetsa'), json(429, {}, header ? { 'Retry-After': header } : {}));
      const out = await relayService(RELAY, { fetch: r.fn }).anchor(PROBE_HASH);
      expect(out, String(header)).toMatchObject({
        reason: 'rate-limited',
        detail: `bitte in ${expected} s erneut versuchen`,
      });
    }
  });

  it('says refused for other error statuses (with the relay’s code), also for the list', async () => {
    const stamp = relay(services('freetsa'), json(400, { error: 'bad-hash' }));
    expect(await relayService(RELAY, { fetch: stamp.fn }).anchor(PROBE_HASH)).toEqual({
      ok: false,
      reason: 'refused',
      detail: 'Status 400, bad-hash',
    });
    expect(
      await relayService(RELAY, { fetch: relay(json(404, 'x')).fn }).anchor(PROBE_HASH),
    ).toMatchObject({ reason: 'refused', detail: 'Status 404' });
  });

  it('says bad response for text that is no JSON and for answers that do not fit', async () => {
    const notJson = relay(services('freetsa'), new Response('kein json', { status: 200 }));
    expect(await relayService(RELAY, { fetch: notJson.fn }).anchor(PROBE_HASH)).toMatchObject({
      reason: 'bad-response',
    });
    const extra = relay(services('freetsa'), json(200, answer({ extra: 1, serial: realSerial })));
    expect(await relayService(RELAY, { fetch: extra.fn }).anchor(PROBE_HASH)).toMatchObject({
      reason: 'bad-response',
    });
    expect(
      await relayService(RELAY, { fetch: relay(json(200, { services: 'x' })).fn }).anchor(
        PROBE_HASH,
      ),
    ).toMatchObject({ reason: 'bad-response' });
    expect(
      await relayService(RELAY, { fetch: relay(services('freetsa')).fn }).anchor('nope'),
    ).toMatchObject({
      reason: 'bad-response',
    });
  });

  it('tries the next service when the network fails for one of them', async () => {
    const seen: string[] = [];
    const fn: typeof fetch = async (url) => {
      seen.push(String(url));
      if (String(url).endsWith('/v1/services')) return services('digicert', 'freetsa');
      if (String(url).endsWith('/digicert')) throw new TypeError('Failed to fetch');
      return json(200, answer({ serial: realSerial }));
    };
    const out = await relayService(RELAY, { fetch: fn }).anchor(PROBE_HASH);
    expect(out.ok && out.value.tsaId).toBe('freetsa');
    expect(seen).toHaveLength(3);
  });

  it('pauses after a 429 on the list of services as well', async () => {
    let now = 1_000_000;
    const r = relay(json(429, { error: 'rate-limited' }, { 'Retry-After': '30' }));
    const service = relayService(RELAY, { fetch: r.fn, now: () => now });
    expect(await service.anchor(PROBE_HASH)).toEqual({
      ok: false,
      reason: 'rate-limited',
      detail: 'bitte in 30 s erneut versuchen',
    });
    const calls = r.seen.length;
    now += 10_000;
    expect(await service.anchor(PROBE_HASH)).toMatchObject({
      reason: 'rate-limited',
      detail: 'bitte in 20 s erneut versuchen',
    });
    expect(r.seen.length).toBe(calls);
  });

  it('says unreachable when the network fails, with the reason', async () => {
    const service = relayService(RELAY, {
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(await service.anchor(PROBE_HASH)).toEqual({
      ok: false,
      reason: 'unreachable',
      detail: 'Failed to fetch',
    });
  });

  it('gives up after the time limit (default longer than the relay’s own 10 seconds)', async () => {
    const hang = (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('abort', 'AbortError')),
        );
      });
    const r = await relayService(RELAY, { fetch: hang, timeoutMs: 20 }).anchor(PROBE_HASH);
    expect(r).toEqual({ ok: false, reason: 'unreachable', detail: 'Zeitüberschreitung' });
    expect(CLIENT_LIMITS.timeoutMs).toBeGreaterThan(12_000);
  });
});

describe('one round with the service', () => {
  const ok: AnchorOutcome = {
    ok: true,
    value: { tsaId: 'tsa', token: Uint8Array.from([7, 7]), genTime: iso(20, 8, 1), serial: '0a' },
  };
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
        {
          tsaId: 't',
          genTime: iso(20, 8, 1),
          serial: '0a',
          coveredN: 1,
          headHash: b.stamps[0]!.hash,
          token: 'AAAA',
        },
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
      tsaId: 'tsa',
      genTime: iso(20, 8, 1),
      serial: '0a',
      coveredN: 1,
      headHash: b.stamps[0]!.hash,
      token: bytesToBase64(Uint8Array.from([7, 7])),
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
