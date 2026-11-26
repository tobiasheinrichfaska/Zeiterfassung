import { PdfFile, readAttachments } from 'pdf-fortschreiben';
import {
  addAnchor,
  anchorsForStamps,
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
export function workDay(book: TimeBook, date: string): TimeBook {
  let b = val(stampIn(book, { date, minute: 480 }, t(date, 8)));
  b = anchorHead(b, t(date, 8, 1));
  b = val(stampOut(b, { date, minute: 960 }, t(date, 16)));
  return anchorHead(b, t(date, 16, 1));
}

export function anchorHead(b: TimeBook, genTime: string): TimeBook {
  const head = b.stamps.at(-1)!;
  return val(
    addAnchor(
      b,
      { coveredN: head.n, headHash: head.hash, evidence: evidenceFor(head.hash, { genTime }) },
      genTime,
    ),
  );
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
    for (const d of ['02', '03', '04']) b = workDay(b, `2026-${m}-${d}`);
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
    b = workDay(b, '2026-11-02');
    b = workDay(b, '2026-11-03');
    let pdf = val(
      await startRunningPdf(b, '2026-11', ASSETS, { createdIso: '2026-11-02T06:00:00.000Z' }),
    );
    pdf = val(await appendRunningDay(pdf, b, '2026-11-02', ASSETS, '2026-11-03T17:00:00.000Z'));
    b = workDay(b, '2026-11-04');
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
