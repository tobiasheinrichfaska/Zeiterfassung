import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readTimestampResponse } from 'zeitstempel';
import {
  ANCHOR_FAILURE_TEXTS,
  DEVICE_KEY_TEXTS,
  REASON_TEXTS,
  addAnchor,
  anchorCheckNote,
  anchorUnverifiedText,
  deviceKeyView,
  emptyBook,
  exportBackup,
  stampIn,
  type Anchor,
  type TimeBook,
} from '../src/logic/index.ts';
import { createRelayService, outcomeOf } from '../src/io/anchorService.ts';
import { checkAnchors, readVerifiedBackup } from '../src/io/anchorCheck.ts';
import { trustedServices } from '../src/io/zeitstempel.ts';
import { evidenceFor, val } from './helpers.ts';

describe('device key view: an unusable stored key can be removed', () => {
  it('offers removal for a usable key and for an unusable one, not for none', () => {
    expect(deviceKeyView(null, null)).toEqual({ canRemove: false, note: null });
    expect(deviceKeyView('geraet-1', null)).toEqual({ canRemove: true, note: null });
    expect(deviceKeyView(null, DEVICE_KEY_TEXTS.unreadable)).toEqual({
      canRemove: true,
      note: DEVICE_KEY_TEXTS.unusableStored,
    });
  });
});

describe('adapter failure kinds', () => {
  const fail = (reason: string, detail?: string) =>
    outcomeOf({ ok: false, reason, detail } as never, 0);
  it('sets configuration failures apart from token verification failures', () => {
    for (const reason of ['bad-pem', 'bad-options', 'bad-services', 'something-new']) {
      expect(fail(reason), reason).toMatchObject({ ok: false, reason: 'misconfigured' });
    }
    expect(ANCHOR_FAILURE_TEXTS.misconfigured).toContain(
      'Einrichtung dieses Builds ist fehlerhaft',
    );
    for (const reason of [
      'signature-invalid',
      'untrusted-chain',
      'bad-tst-info',
      'unsupported-version',
    ]) {
      expect(fail(reason), reason).toMatchObject({ ok: false, reason: 'not-verified' });
    }
  });

  it('a bad trust anchor of the build is a configuration failure end to end', async () => {
    const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
    ]);
    const service = createRelayService(
      'https://relay.example',
      {
        keyId: 'geraet-1',
        privateKey: new Uint8Array(await crypto.subtle.exportKey('pkcs8', key.privateKey)),
      },
      { trusted: new Map([['freetsa', { anchors: ['not a pem'] }]]) },
    );
    expect(await service.anchor('00'.repeat(32))).toMatchObject({
      ok: false,
      reason: 'misconfigured',
    });
  });
});

const PROBE_HASH = createHash('sha256').update('probe').digest('hex');
const recorded = readTimestampResponse(
  new Uint8Array(readFileSync(new URL('./fixtures/freetsa.tsr', import.meta.url))),
);
if (!recorded.ok) throw new Error('fixture');
const TOKEN_WALL = Date.parse('2026-11-23T13:06:00.000Z');

async function realAnchor(): Promise<Anchor> {
  const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ]);
  const body = {
    service: 'freetsa',
    genTime: '2026-11-23T13:05:56.000Z',
    accuracyMs: null,
    serial: recorded.ok ? recorded.value.info.serial : '',
    token: Buffer.from(recorded.ok ? recorded.value.token : new Uint8Array()).toString('base64url'),
  };
  const service = createRelayService(
    'https://relay.example',
    {
      keyId: 'geraet-1',
      privateKey: new Uint8Array(await crypto.subtle.exportKey('pkcs8', key.privateKey)),
    },
    {
      now: () => TOKEN_WALL,
      monoNow: () => 1,
      fetch: async () => new Response(JSON.stringify(body), { status: 200 }),
    },
  );
  const out = await service.anchor(PROBE_HASH);
  if (!out.ok) throw new Error(JSON.stringify(out));
  return { coveredN: 1, headHash: PROBE_HASH, evidence: out.value.evidence };
}

describe('clock offset reported back under 30 s', () => {
  it('reports the offset, then 0 when the relay clock agrees again', async () => {
    const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
    ]);
    const mk = (date: number) => () =>
      new Response(
        JSON.stringify({
          service: 'freetsa',
          genTime: '2026-11-23T13:05:56.000Z',
          accuracyMs: null,
          serial: recorded.ok ? recorded.value.info.serial : '',
          token: Buffer.from(recorded.ok ? recorded.value.token : new Uint8Array()).toString(
            'base64url',
          ),
        }),
        { status: 200, headers: { Date: new Date(date).toUTCString() } },
      );
    const answers = [mk(TOKEN_WALL + 50_000), mk(TOKEN_WALL + 5_000)];
    const offsets: number[] = [];
    const service = createRelayService(
      'https://relay.example',
      {
        keyId: 'geraet-1',
        privateKey: new Uint8Array(await crypto.subtle.exportKey('pkcs8', key.privateKey)),
      },
      {
        now: () => TOKEN_WALL,
        monoNow: () => 1,
        fetch: async () => answers.shift()!(),
        onClockOffset: (o) => offsets.push(o),
      },
    );
    await service.anchor(PROBE_HASH);
    await service.anchor(PROBE_HASH);
    expect(offsets).toEqual([50_000, 0]);
  });
});

describe('anchors are verified outside the logic layer', () => {
  it('accepts a real recorded token and refuses a stand-in token', async () => {
    const good = await realAnchor();
    expect(await checkAnchors([good])).toEqual({ total: 1, failed: 0 });
    const fake: Anchor = { ...good, evidence: evidenceFor(PROBE_HASH) };
    expect(await checkAnchors([good, fake])).toEqual({ total: 2, failed: 1 });
    // a wrong trust list fails the real one too
    expect(await checkAnchors([good], [...trustedServices().get('sectigo')!.anchors])).toEqual({
      total: 1,
      failed: 1,
    });
  });

  it('refuses a backup with an unverifiable anchor and names the count; passes one without anchors', async () => {
    const stamped = val(
      stampIn(emptyBook(), { date: '2026-11-20', minute: 480 }, '2026-11-20T08:00:00.000Z'),
    );
    const head = stamped.stamps.at(-1)!;
    const forged: TimeBook = val(
      addAnchor(
        stamped,
        { coveredN: head.n, headHash: head.hash, evidence: evidenceFor(head.hash) },
        '2026-11-20T16:00:00.000Z',
      ),
    );
    const refused = await readVerifiedBackup(exportBackup(forged), undefined);
    expect(refused).toEqual({
      ok: false,
      reason: 'backup-anchor-unverified',
      failed: 1,
      total: 1,
    });
    expect(REASON_TEXTS['backup-anchor-unverified']).toBeTruthy();
    expect(anchorUnverifiedText(1, 1)).toContain('1 von 1');
    const clean = await readVerifiedBackup(exportBackup(stamped), undefined);
    expect(clean.ok).toBe(true);
    expect(anchorCheckNote(2)).toContain('2 externe Zeitstempel');
  });
});
