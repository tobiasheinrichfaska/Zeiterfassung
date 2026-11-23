import {
  addAnchor,
  appendStamp,
  bytesToBase64,
  emptyBook,
  parseRelayList,
  relayOk,
  relayOrigin,
  relayUsable,
  stampIn,
  type AnchorOutcome,
  type TimeBook,
} from '../src/logic/index.ts';
import { createRelayService, requestAnchor, type AnchorService } from '../src/io/anchorService.ts';
import { val } from './helpers.ts';

const RELAY = 'https://relay.example/stamp';
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

describe('the relay adapter', () => {
  const answer = {
    tsaId: 'tsa',
    genTime: iso(20, 8, 1),
    token: bytesToBase64(Uint8Array.from([1, 2, 3])),
  };
  const reply = (status: number, body: unknown) => async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

  it('posts only the hash, without cookies, referrer or redirects, and reads the answer', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const service = createRelayService(RELAY, async (url, init) => {
      seen = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify(answer));
    });
    const r = await service.anchor('a'.repeat(64));
    expect(r.ok && r.value.tsaId).toBe('tsa');
    expect(seen?.url).toBe(RELAY);
    expect(seen?.init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(JSON.parse(String(seen?.init.body))).toEqual({ hash: 'a'.repeat(64) });
  });

  it('says refused for an error status, with the status', async () => {
    const r = await createRelayService(RELAY, reply(503, {})).anchor('a'.repeat(64));
    expect(r).toEqual({ ok: false, reason: 'refused', detail: 'Status 503' });
  });

  it('says bad response for text that is no JSON and for an answer that does not fit', async () => {
    expect(await createRelayService(RELAY, reply(200, 'kein json')).anchor('a')).toMatchObject({
      ok: false,
      reason: 'bad-response',
    });
    expect(
      await createRelayService(RELAY, reply(200, { ...answer, extra: 1 })).anchor('a'),
    ).toMatchObject({ ok: false, reason: 'bad-response' });
    expect(
      await createRelayService(RELAY, reply(200, { ...answer, token: '' })).anchor('a'),
    ).toMatchObject({ ok: false, reason: 'bad-response' });
  });

  it('says unreachable when the network fails, with the reason', async () => {
    const service = createRelayService(RELAY, async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await service.anchor('a')).toEqual({
      ok: false,
      reason: 'unreachable',
      detail: 'Failed to fetch',
    });
  });

  it('gives up after the time limit', async () => {
    const hang = (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('abort', 'AbortError')),
        );
      });
    const r = await createRelayService(RELAY, hang, 20).anchor('a');
    expect(r).toEqual({ ok: false, reason: 'unreachable', detail: 'Zeitüberschreitung' });
  });
});

describe('one round with the service', () => {
  const ok: AnchorOutcome = {
    ok: true,
    value: { tsaId: 'tsa', token: Uint8Array.from([7, 7]), genTime: iso(20, 8, 1) },
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
