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
  hexToBytes,
  stampIn,
  stampOut,
  type Anchor,
  type TimeBook,
} from '../src/logic/index.ts';
import { evidenceFor, val } from './helpers.ts';

const RELAY = 'https://relay.example';
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

/** An anchor for stamp n; `genTime`, `token`, `service` … go into its evidence (form only). */
const anchorFor = (
  b: TimeBook,
  n: number,
  over: { coveredN?: number; headHash?: string } & Parameters<typeof evidenceFor>[1] = {},
): Anchor => {
  const { coveredN, headHash, ...ev } = over;
  const hash = headHash ?? b.stamps[n - 1]?.hash ?? '0'.repeat(64);
  return {
    coveredN: coveredN ?? n,
    headHash: hash,
    evidence: evidenceFor(hash, { genTime: iso(20, 16, 1), ...ev }),
  };
};

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

  it('refuses evidence that does not pass the strict reader (form, version, members, base64url)', () => {
    for (const over of [
      { v: 2 },
      { kind: 'tree' },
      { service: 'Free TSA' },
      { hashAlg: 'sha1' },
      { receivedAtMs: 1.5 },
      { token: '' },
      { token: 'AQID=' }, // padding: not base64url
      { token: 'AQI+' }, // standard alphabet
      { genTime: 'gestern' },
      { genTime: '2026-11-20T16:01:00Z' }, // no milliseconds
      { extra: 1 },
    ]) {
      expect(addAnchor(b, anchorFor(b, 2, over), now), JSON.stringify(over)).toEqual({
        ok: false,
        reason: 'bad-anchor',
      });
    }
    const batch = anchorFor(b, 2, { kind: 'batch' }); // batch without its receipt
    expect(addAnchor(b, batch, now)).toEqual({ ok: false, reason: 'bad-anchor' });
    expect(addAnchor(b, { ...anchorFor(b, 2), evidence: 'kein Beleg' as never }, now).ok).toBe(
      false,
    );
  });

  it('refuses evidence for another hash than the covered stamp', () => {
    const other = anchorFor(b, 2);
    other.evidence = evidenceFor(b.stamps[0]!.hash, { genTime: iso(20, 16, 1) });
    expect(addAnchor(b, other, now)).toEqual({ ok: false, reason: 'bad-anchor' });
  });

  it('refuses a token longer than the limit', () => {
    const chars = LIMITS.maxAnchorTokenChars;
    const fits = new Uint8Array((chars / 4) * 3); // exactly `chars` base64url characters
    expect(addAnchor(b, anchorFor(b, 2, { tokenBytes: fits }), now).ok).toBe(true);
    const tooLong = new Uint8Array((chars / 4) * 3 + 3);
    expect(addAnchor(b, anchorFor(b, 2, { tokenBytes: tooLong }), now)).toEqual({
      ok: false,
      reason: 'bad-anchor',
    });
  });

  it('keeps a fresh copy of the evidence (no reference to the caller’s object)', () => {
    const anchor = anchorFor(b, 2);
    const r = val(addAnchor(b, anchor, now));
    expect(r.anchors[0]!.evidence).toEqual(anchor.evidence);
    expect(r.anchors[0]!.evidence).not.toBe(anchor.evidence);
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
    // on the next day: two anchors of one day would be thinned to the newest (`thinAnchors`)
    addAnchor(withAnchor, anchorFor(b, 2, { genTime: iso(21, 8, 1) }), iso(21, 8, 5)),
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

  it('refuses an anchor whose evidence is changed or of the old format', () => {
    expect(edit((o) => (o.anchors[0].evidence.hash = o.anchors[1].evidence.hash))).toEqual({
      ok: false,
      reason: 'bad-backup',
    });
    expect(edit((o) => delete o.anchors[0].evidence.genTime)).toEqual({
      ok: false,
      reason: 'bad-backup',
    });
    expect(
      edit((o) => {
        o.anchors[0] = { tsaId: 'freetsa', genTime: iso(20, 8, 2), serial: '1', token: 'AQID' };
      }),
    ).toEqual({ ok: false, reason: 'bad-backup' });
  });

  it('reads version 3 only without anchors; an anchor of format 3 is refused with its own code', () => {
    const v3 = (anchors: unknown[]) => {
      const o = JSON.parse(exportBackup(b));
      o.version = 3;
      o.anchors = anchors;
      return importBackup(JSON.stringify(o));
    };
    expect(val(v3([]))).toEqual(b);
    const old = {
      tsaId: 'freetsa',
      genTime: iso(20, 8, 2),
      serial: '0a1b',
      coveredN: 1,
      headHash: b.stamps[0]!.hash,
      token: 'AQIDBA==',
    };
    expect(v3([old])).toEqual({ ok: false, reason: 'old-anchor-format' });
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

describe('the anchor of a verified answer', () => {
  it('turns the answer into the anchor of the request', () => {
    const b2 = book();
    const req = anchorRequest(b2)!;
    const evidence = evidenceFor(req.hash, { genTime: iso(20, 16, 1) });
    const anchor = anchorFromOutcome(req, { evidence });
    expect(anchor).toEqual({ coveredN: 2, headHash: req.hash, evidence });
    expect(addAnchor(b2, anchor, iso(20, 16, 5)).ok).toBe(true);
  });

  it('has a German text for every failure kind', () => {
    for (const [kind, text] of Object.entries(ANCHOR_FAILURE_TEXTS))
      expect(text.length, kind).toBeGreaterThan(10);
  });

  it('converts Base64 and hex', () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 13) & 0xff);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(base64ToBytes('abc')).toBeNull();
    expect(base64ToBytes('')).toBeNull();
    expect(hexToBytes('ab'.repeat(32))).toEqual(new Uint8Array(32).fill(0xab));
    expect(hexToBytes('AB'.repeat(32))).toBeNull();
    expect(hexToBytes('ab')).toBeNull();
  });
});
