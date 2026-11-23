import {
  ANCHOR_FAILURE_TEXTS,
  LIMITS,
  addAnchor,
  anchorFromOutcome,
  anchorRequest,
  anchorStatus,
  appendStamp,
  base64ToBytes,
  bytesToBase64,
  coveredUpTo,
  emptyBook,
  exportBackup,
  importBackup,
  parseServiceAnswer,
  stampIn,
  stampOut,
  type Anchor,
  type TimeBook,
} from '../src/logic/index.ts';
import { val } from './helpers.ts';

const RELAY = 'https://relay.example/stamp';
const iso = (day: number, h = 8, m = 0, s = 0) =>
  `2026-11-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`;
const at = (date: string, h: number, m = 0) => ({ date, minute: h * 60 + m });

/** A book with the relay set and two stamps (08:00 and 16:00 on the 20th). */
const book = (relay = RELAY): TimeBook => {
  let b = emptyBook();
  b.settings = { ...b.settings, timestampRelay: relay };
  b = val(stampIn(b, at('2026-11-20', 8), iso(20, 8)));
  return val(stampOut(b, at('2026-11-20', 16), iso(20, 16)));
};

const anchorFor = (b: TimeBook, n: number, over: Partial<Anchor> = {}): Anchor => ({
  tsaId: 'test-tsa',
  genTime: iso(20, 16, 1),
  coveredN: n,
  headHash: b.stamps[n - 1]?.hash ?? '0'.repeat(64),
  token: bytesToBase64(Uint8Array.from([1, 2, 3, 4, 5])),
  ...over,
});

describe('anchorStatus', () => {
  it('is off without a relay, with the counts still given', () => {
    const s = anchorStatus(book(''), iso(20, 17));
    expect(s).toMatchObject({
      state: 'off',
      unanchored: 2,
      headN: 2,
      coveredN: 0,
      lastAnchorGenTime: null,
    });
  });

  it('is nothing for an empty chain, ok when every stamp is covered', () => {
    expect(
      anchorStatus(
        {
          ...emptyBook(),
          settings: { employeeLabel: '', retentionMonths: 24, timestampRelay: RELAY },
        },
        iso(20),
      ).state,
    ).toBe('nothing');
    const b = book();
    const covered = val(addAnchor(b, anchorFor(b, 2), iso(20, 16, 2)));
    expect(anchorStatus(covered, iso(21, 8))).toMatchObject({
      state: 'ok',
      unanchored: 0,
      oldestUnanchoredAt: null,
      lastAnchorGenTime: iso(20, 16, 1),
      coveredN: 2,
    });
  });

  it('is due while the oldest stamp without an anchor is at most 24 hours old, overdue after', () => {
    const b = book();
    expect(anchorStatus(b, iso(20, 8, 0, 1))).toMatchObject({
      state: 'due',
      unanchored: 2,
      oldestUnanchoredAt: iso(20, 8),
    });
    expect(anchorStatus(b, iso(21, 8))).toMatchObject({ state: 'due' }); // exactly 24 hours
    expect(anchorStatus(b, '2026-11-21T08:00:00.001Z').state).toBe('overdue'); // 24 hours and a moment
    expect(anchorStatus(b, iso(25)).state).toBe('overdue');
    expect(anchorStatus(b, iso(19)).state).toBe('due'); // a clock before the stamp is not overdue
  });

  it('counts only the stamps after the last anchor, and the age is the oldest of those', () => {
    const b = book();
    let c = val(addAnchor(b, anchorFor(b, 1, { genTime: iso(20, 8, 1) }), iso(20, 8, 2))); // covers only stamp 1
    c = { ...c };
    expect(anchorStatus(c, iso(20, 17))).toMatchObject({
      state: 'due',
      unanchored: 1,
      oldestUnanchoredAt: iso(20, 16),
      coveredN: 1,
    });
    const more = val(appendStamp(c, 'change', '2026-11-20', iso(22, 9)));
    expect(anchorStatus(more, iso(22, 10))).toMatchObject({
      unanchored: 2,
      oldestUnanchoredAt: iso(20, 16),
      state: 'overdue',
    });
  });

  it('uses the Limit as data', () => {
    expect(LIMITS.anchorMaxAgeHours).toBe(24);
  });
});

describe('anchorRequest', () => {
  it('is the head of the chain, and nothing when the head is covered or there is no chain', () => {
    const b = book();
    expect(anchorRequest(b)).toEqual({ hash: b.stamps[1]!.hash, coveredN: 2 });
    expect(anchorRequest(emptyBook())).toBeUndefined();
    const covered = val(addAnchor(b, anchorFor(b, 2), iso(20, 16, 2)));
    expect(anchorRequest(covered)).toBeUndefined();
    expect(anchorRequest(val(appendStamp(covered, 'seal', '2026-11-20', iso(21))))?.coveredN).toBe(
      3,
    );
  });
});

describe('addAnchor', () => {
  const b = book();
  const now = iso(20, 16, 5);

  it('takes a good anchor and keeps the book otherwise as it was', () => {
    const r = val(addAnchor(b, anchorFor(b, 2), now));
    expect(r.anchors).toEqual([anchorFor(b, 2)]);
    expect(r.stamps).toBe(b.stamps);
    expect(b.anchors).toEqual([]);
    expect(coveredUpTo(r)).toBe(2);
  });

  it('refuses an anchor that covers nothing new, an unknown stamp or a wrong hash', () => {
    expect(addAnchor(b, anchorFor(b, 0), now)).toEqual({ ok: false, reason: 'bad-anchor' });
    expect(addAnchor(b, anchorFor(b, 3, { headHash: b.stamps[1]!.hash }), now)).toEqual({
      ok: false,
      reason: 'bad-anchor',
    });
    expect(addAnchor(b, anchorFor(b, 2, { headHash: b.stamps[0]!.hash }), now)).toEqual({
      ok: false,
      reason: 'bad-anchor',
    });
    const first = val(addAnchor(b, anchorFor(b, 2), now));
    expect(addAnchor(first, anchorFor(b, 2), now)).toEqual({ ok: false, reason: 'bad-anchor' });
    expect(addAnchor(first, anchorFor(b, 1), now)).toEqual({ ok: false, reason: 'bad-anchor' });
  });

  it('refuses a token that is empty, not Base64, not padded to four, or too long', () => {
    for (const token of ['', '!!!!', 'abc', 'ab=c', 'A'.repeat(LIMITS.maxAnchorTokenChars + 4)]) {
      expect(addAnchor(b, anchorFor(b, 2, { token }), now), token.slice(0, 8)).toEqual({
        ok: false,
        reason: 'bad-anchor',
      });
    }
    expect(
      addAnchor(b, anchorFor(b, 2, { token: 'A'.repeat(LIMITS.maxAnchorTokenChars) }), now).ok,
    ).toBe(true);
  });

  it('refuses a bad service name and a bad time', () => {
    expect(addAnchor(b, anchorFor(b, 2, { tsaId: '' }), now).ok).toBe(false);
    expect(
      addAnchor(b, anchorFor(b, 2, { tsaId: 'x'.repeat(LIMITS.maxTsaIdChars + 1) }), now).ok,
    ).toBe(false);
    expect(addAnchor(b, anchorFor(b, 2, { tsaId: 'a\nb' }), now).ok).toBe(false);
    expect(addAnchor(b, anchorFor(b, 2, { genTime: 'gestern' }), now)).toEqual({
      ok: false,
      reason: 'bad-anchor',
    });
  });

  it('refuses a token time that does not fit the device clock (before the stamp, in the future)', () => {
    expect(LIMITS.anchorSkewMinutes).toBe(15);
    expect(addAnchor(b, anchorFor(b, 2, { genTime: '2026-11-20T15:45:00.000Z' }), now).ok).toBe(
      true,
    ); // 15 min before: at the edge
    expect(addAnchor(b, anchorFor(b, 2, { genTime: '2026-11-20T15:44:59.000Z' }), now)).toEqual({
      ok: false,
      reason: 'anchor-skew',
    });
    expect(addAnchor(b, anchorFor(b, 2, { genTime: '2026-11-20T16:20:00.000Z' }), now).ok).toBe(
      true,
    ); // 15 min after now: at the edge
    expect(addAnchor(b, anchorFor(b, 2, { genTime: '2026-11-20T16:20:01.000Z' }), now)).toEqual({
      ok: false,
      reason: 'anchor-skew',
    });
  });

  it('refuses when the book already holds the most anchors', () => {
    const full: TimeBook = {
      ...b,
      anchors: Array.from({ length: LIMITS.maxAnchors }, (_, i) =>
        anchorFor(b, 1, { coveredN: -i }),
      ),
    };
    expect(addAnchor(full, anchorFor(b, 2), now)).toEqual({
      ok: false,
      reason: 'too-many-anchors',
    });
  });
});

describe('anchors in the backup', () => {
  const b = book();
  const withAnchor = val(addAnchor(b, anchorFor(b, 1, { genTime: iso(20, 8, 2) }), iso(20, 8, 5)));
  const two = val(
    addAnchor(withAnchor, anchorFor(b, 2, { genTime: iso(20, 16, 1) }), iso(20, 16, 5)),
  );
  const edit = (f: (o: Record<string, any>) => void) => {
    const o = JSON.parse(exportBackup(two));
    f(o);
    return importBackup(JSON.stringify(o));
  };

  it('round-trips', () => {
    expect(val(importBackup(exportBackup(two)))).toEqual(two);
  });

  it('refuses an anchor that does not match the chain, repeats a number, goes back, or has other members', () => {
    expect(edit((o) => (o.anchors[1].headHash = o.stamps[0].hash))).toEqual({
      ok: false,
      reason: 'bad-backup',
    });
    expect(edit((o) => (o.anchors[1].coveredN = 1))).toEqual({ ok: false, reason: 'bad-backup' });
    expect(edit((o) => o.anchors.reverse())).toEqual({ ok: false, reason: 'bad-backup' });
    expect(edit((o) => (o.anchors[0].coveredN = 9))).toEqual({ ok: false, reason: 'bad-backup' });
    expect(edit((o) => (o.anchors[0].extra = 1))).toEqual({ ok: false, reason: 'bad-backup' });
    expect(edit((o) => (o.anchors = 'x'))).toEqual({ ok: false, reason: 'bad-backup' });
  });

  it('refuses more anchors than the limit', () => {
    expect(
      edit((o) => (o.anchors = Array.from({ length: LIMITS.maxAnchors + 1 }, () => o.anchors[0]))),
    ).toEqual({ ok: false, reason: 'too-many-anchors' });
  });

  it('refuses a relay address that is not an address', () => {
    expect(edit((o) => (o.settings.timestampRelay = 'ftp://x')).ok).toBe(false);
    expect(edit((o) => (o.settings.timestampRelay = 'nicht erlaubt')).ok).toBe(false);
    expect(edit((o) => (o.settings.timestampRelay = 'http://example.com/x')).ok).toBe(false); // http only for the own machine
    expect(edit((o) => (o.settings.timestampRelay = 'http://localhost:8787/x')).ok).toBe(true);
    expect(edit((o) => (o.settings.timestampRelay = '')).ok).toBe(true);
  });
});

describe('the service answer', () => {
  const good = {
    tsaId: 'tsa',
    genTime: iso(20, 16, 1),
    token: bytesToBase64(Uint8Array.from([9, 8, 7])),
  };

  it('reads exactly tsaId, genTime and token', () => {
    const r = parseServiceAnswer(good);
    expect(r.ok && [...r.value.token]).toEqual([9, 8, 7]);
    expect(r.ok && r.value.tsaId).toBe('tsa');
  });

  it('is a bad response for anything else', () => {
    for (const bad of [
      null,
      [],
      'x',
      5,
      { ...good, extra: 1 },
      { tsaId: 'a', genTime: good.genTime },
      { ...good, tsaId: '' },
      { ...good, tsaId: 5 },
      { ...good, genTime: 'x' },
      { ...good, token: '' },
      { ...good, token: '***' },
      { ...good, token: 'A'.repeat(LIMITS.maxAnchorTokenChars + 4) },
    ]) {
      const r = parseServiceAnswer(bad);
      expect(r.ok, JSON.stringify(bad)?.slice(0, 40)).toBe(false);
      expect(!r.ok && r.reason).toBe('bad-response');
    }
  });

  it('turns the answer into the anchor of the request', () => {
    const b2 = book();
    const req = anchorRequest(b2)!;
    const r = parseServiceAnswer(good);
    if (!r.ok) throw new Error('unexpected');
    const anchor = anchorFromOutcome(req, r.value);
    expect(anchor).toEqual({
      tsaId: 'tsa',
      genTime: good.genTime,
      coveredN: 2,
      headHash: req.hash,
      token: good.token,
    });
    expect(addAnchor(b2, anchor, iso(20, 16, 5)).ok).toBe(true);
  });

  it('has a German text for every failure kind', () => {
    for (const [kind, text] of Object.entries(ANCHOR_FAILURE_TEXTS))
      expect(text.length, kind).toBeGreaterThan(10);
  });

  it('converts Base64 both ways', () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 13) & 0xff);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(base64ToBytes('abc')).toBeNull();
    expect(base64ToBytes('')).toBeNull();
  });
});
