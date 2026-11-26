import { PdfFile, readAttachments } from 'pdf-fortschreiben';
import { addAnchor } from '../src/logic/index.ts';
import {
  LIMITS,
  anchorStatus,
  anchorsForStamps,
  markExported,
  thinAnchors,
  appendRunningDay,
  emptyBook,
  monthTimestamps,
  monthToJson,
  runningDayName,
  startRunningPdf,
  stampIn,
  stampOut,
  timestampLines,
  type TimeBook,
} from '../src/logic/index.ts';
import { evidenceFor, val } from './helpers.ts';
import { ASSETS } from './pdfAssets.ts';

const RELAY = 'https://relay.example/stamp';
const t = (date: string, h: number, m = 0) =>
  `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;

/** Kommen at 8, anchor at 8:01, Gehen at 16, anchor at 16:01: two anchors per day. */
export function workDay(book: TimeBook, date: string, raw = false): TimeBook {
  let b = val(stampIn(book, { date, minute: 480 }, t(date, 8)));
  b = anchorHead(b, t(date, 8, 1), raw);
  b = val(stampOut(b, { date, minute: 960 }, t(date, 16)));
  return anchorHead(b, t(date, 16, 1), raw);
}

/** Anchors the head through `addAnchor` (which thins), or, with `raw`, appends it unthinned (H1 tests). */
export function anchorHead(b: TimeBook, genTime: string, raw = false): TimeBook {
  const head = b.stamps.at(-1)!;
  const anchor = {
    coveredN: head.n,
    headHash: head.hash,
    evidence: evidenceFor(head.hash, { genTime }),
  };
  if (raw) return { ...b, anchors: [...b.anchors, anchor] };
  return val(addAnchor(b, anchor, genTime));
}

export function relayBook(): TimeBook {
  const b = emptyBook();
  b.settings = { ...b.settings, timestampRelay: RELAY };
  return b;
}

/** Three working days in each of September, October and November 2026. */
function threeMonths(): TimeBook {
  let b = relayBook();
  for (const m of ['09', '10', '11'])
    for (const d of ['02', '03', '04']) b = workDay(b, `2026-${m}-${d}`, true);
  return b;
}

describe('H1: a month lists only the anchors of its own stamps', () => {
  it('the October JSON holds October’s anchors and the last one before, not all eighteen', () => {
    const b = threeMonths();
    expect(b.anchors).toHaveLength(18);
    const data = JSON.parse(val(monthToJson(b, '2026-10', '2026-12-01T06:00:00.000Z')));
    const listed = data.timestamps.anchors.map((a: { coveredN: number }) => a.coveredN);
    const octoberStamps = b.stamps.filter((s) => s.date.startsWith('2026-10')).map((s) => s.n);
    // the anchor right before October (last of September) and one per October stamp
    expect(listed).toEqual([6, ...octoberStamps]);
    expect(listed).toHaveLength(7);
  });

  it('the rule: first covering anchor per stamp plus the newest before the first stamp', () => {
    const b = threeMonths();
    const stamps = b.stamps.filter((s) => s.n === 8 || s.n === 9);
    expect(anchorsForStamps(b.anchors, stamps).map((a) => a.coveredN)).toEqual([7, 8, 9]);
    // only a later anchor covers a stamp: that one, not every anchor up to the head
    const sparse = { ...b, anchors: b.anchors.filter((a) => a.coveredN === 2 || a.coveredN >= 16) };
    expect(anchorsForStamps(sparse.anchors, stamps).map((a) => a.coveredN)).toEqual([2, 16]);
    expect(anchorsForStamps(b.anchors, [])).toEqual([]);
  });

  it('the monthly PDF prints only those anchors', () => {
    const b = threeMonths();
    const lines = timestampLines(monthTimestamps(b, '2026-10', '2026-12-01T06:00:00.000Z'));
    expect(lines.filter((l) => l.startsWith('Externer Zeitstempel:'))).toHaveLength(7);
  });

  it('a running PDF’s day file lists only anchors no earlier day file listed', async () => {
    let b = relayBook();
    b = workDay(b, '2026-11-02', true);
    b = workDay(b, '2026-11-03', true);
    let pdf = val(
      await startRunningPdf(b, '2026-11', ASSETS, { createdIso: '2026-11-02T06:00:00.000Z' }),
    );
    pdf = val(await appendRunningDay(pdf, b, '2026-11-02', ASSETS, '2026-11-03T17:00:00.000Z'));
    b = workDay(b, '2026-11-04', true);
    pdf = val(await appendRunningDay(pdf, b, '2026-11-03', ASSETS, '2026-11-04T17:00:00.000Z'));
    const files = await readAttachments(new PdfFile(pdf));
    const anchorsOf = (name: string) => {
      const f = files.find((a) => a.name === name)!;
      const data = JSON.parse(new TextDecoder().decode(f.data));
      return {
        after: data.timestamps.anchorsAfterN,
        listed: data.timestamps.anchors.map((a: { coveredN: number }) => a.coveredN),
      };
    };
    // first day file: the month's anchors as they stood (stamps 1–4)
    expect(anchorsOf(runningDayName('2026-11-02'))).toEqual({ after: 0, listed: [1, 2, 3, 4] });
    // second: only the newer ones (stamps 5 and 6 of the 4th), nothing repeated
    expect(anchorsOf(runningDayName('2026-11-03'))).toEqual({ after: 4, listed: [5, 6] });
  });
});

describe('H2: anchors are thinned when one is added', () => {
  it('keeps only the newest anchor of a calendar day', () => {
    const b = workDay(relayBook(), '2026-11-02');
    expect(b.anchors.map((a) => a.coveredN)).toEqual([2]);
    expect(anchorStatus(b, t('2026-11-02', 17)).state).toBe('ok');
  });

  it('drops the anchors of an exported month that is neither the current nor the previous one', () => {
    let b = relayBook();
    for (const d of ['02', '03', '04']) b = workDay(b, `2026-09-${d}`);
    b = val(markExported(b, '2026-09', '2026-09-30T20:00:00.000Z'));
    for (const d of ['02', '03', '04']) b = workDay(b, `2026-10-${d}`);
    // in October, September is the previous month: still kept
    expect(b.anchors.map((a) => a.coveredN)).toEqual([2, 4, 6, 8, 10, 12]);
    b = workDay(b, '2026-11-02');
    // in November: September's anchors go, except the last one before October (October shows it)
    expect(b.anchors.map((a) => a.coveredN)).toEqual([6, 8, 10, 12, 14]);
  });

  it('keeps an exported month that changed after the export', () => {
    let b = relayBook();
    b = workDay(b, '2026-09-02');
    b = workDay(b, '2026-09-03');
    b = val(markExported(b, '2026-09', '2026-09-02T20:00:00.000Z')); // before the 3rd: not covered
    b = workDay(b, '2026-11-02');
    expect(b.anchors.map((a) => a.coveredN)).toEqual([2, 4, 6]);
  });

  it('never drops the newest anchor, and a year with monthly exports stays far below the limit', () => {
    let b = relayBook();
    for (let m = 1; m <= 12; m += 1) {
      const month = `2026-${String(m).padStart(2, '0')}`;
      for (let d = 1; d <= 20; d += 1) b = workDay(b, `${month}-${String(d).padStart(2, '0')}`);
      b = val(markExported(b, month, `${month}-27T00:00:00.000Z`));
    }
    expect(b.anchors.at(-1)!.coveredN).toBe(b.stamps.at(-1)!.n);
    // November and December, one per day, and the last one before November
    expect(b.anchors).toHaveLength(41);
    expect(b.anchors.length).toBeLessThan(LIMITS.maxAnchors / 4);
  });

  it('the rule in one function: thinAnchors leaves a book of one anchor alone', () => {
    const b = workDay(relayBook(), '2026-11-02', true);
    expect(thinAnchors(b, t('2026-11-02', 17)).map((a) => a.coveredN)).toEqual([2]);
    expect(thinAnchors({ ...b, anchors: [] }, t('2026-11-02', 17))).toEqual([]);
  });
});
