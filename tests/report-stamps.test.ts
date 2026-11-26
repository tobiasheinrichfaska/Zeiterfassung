import {
  addAnchor,
  anchorStatusText,
  anchorStatus,
  breakStart,
  emptyBook,
  monthTimestamps,
  monthToJson,
  monthToPdf,
  sealElapsedDays,
  stampIn,
  stampOut,
  timestampLines,
  type TimeBook,
} from '../src/logic/index.ts';
import { readFileSync } from 'node:fs';
import { readTimestampResponse } from 'zeitstempel';
import { evidenceFor, val } from './helpers.ts';
import { ASSETS } from './pdfAssets.ts';
import { inspect } from './pdfRead.ts';

const RELAY = 'https://relay.example/stamp';
const iso = (day: number, h = 8, m = 0) =>
  `2026-11-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const at = (date: string, h: number, m = 0) => ({ date, minute: h * 60 + m });
const CREATED = '2026-12-01T06:00:00.000Z';

/** Two days in November, a clock that went back once, sealed on the 25th; the relay is set. */
function book(): TimeBook {
  let b = emptyBook();
  b.settings = { ...b.settings, timestampRelay: RELAY };
  b = val(stampIn(b, at('2026-11-20', 8), iso(20, 8)));
  b = val(breakStart(b, at('2026-11-20', 12), iso(20, 7))); // the clock went back
  b = val(stampOut(b, at('2026-11-20', 16), iso(20, 16)));
  return val(sealElapsedDays(b, '2026-11-25', iso(25)));
}

/** A real token (the recorded FreeTSA answer) as the evidence's token: its serial is read for the report. */
const recorded = readTimestampResponse(
  new Uint8Array(readFileSync(new URL('./fixtures/freetsa.tsr', import.meta.url))),
);
if (!recorded.ok) throw new Error('fixture');
const SERIAL = recorded.value.info.serial;
const evidenceOf = (hash: string, genTime: string) =>
  evidenceFor(hash, { genTime, service: 'test-tsa', tokenBytes: recorded.value.token });
const anchored = (b: TimeBook, n: number, genTime: string, now: string) =>
  val(
    addAnchor(
      b,
      {
        coveredN: n,
        headHash: b.stamps[n - 1]!.hash,
        evidence: evidenceOf(b.stamps[n - 1]!.hash, genTime),
      },
      now,
    ),
  );

describe('the section „Zeitstempel“ in the JSON attachment', () => {
  it('carries the month’s stamps, the head, the status, the skew and every anchor with its evidence', () => {
    const b = anchored(book(), 2, iso(25, 8, 1), iso(25, 8, 5));
    const data = JSON.parse(val(monthToJson(b, '2026-11', CREATED)));
    const t = data.timestamps;
    expect(t.stamps).toHaveLength(4);
    expect(t.stamps.map((s: { n: number }) => s.n)).toEqual([1, 2, 3, 4]);
    expect(t.chainHeadN).toBe(4);
    expect(t.chainHeadHash).toBe(b.stamps[3]!.hash);
    expect(t.skewNumbers).toEqual([2]);
    expect(t.monthCovered).toBe(false);
    expect(t.firstUncoveredN).toBe(3);
    expect(t.status).toMatchObject({ state: 'overdue', unanchored: 2, coveredN: 2, headN: 4 });
    expect(t.anchors).toEqual([
      {
        coveredN: 2,
        headHash: b.stamps[1]!.hash,
        evidence: evidenceOf(b.stamps[1]!.hash, iso(25, 8, 1)),
      },
    ]);
    expect(t.note).toMatch(/device clock/);
    expect(data.version).toBe(3);
  });

  it('only has the stamps of the month asked for and only their anchors, but the head', () => {
    const b = anchored(book(), 2, iso(25, 8, 1), iso(25, 8, 5));
    const t = JSON.parse(val(monthToJson(b, '2026-10', CREATED))).timestamps;
    expect(t.stamps).toEqual([]);
    // no stamp of October: no anchor of November is listed there (H1)
    expect(t.anchors).toHaveLength(0);
    expect(t.chainHeadN).toBe(4);
    expect(t.monthCovered).toBe(true);
  });

  it('is complete for an empty book', () => {
    const t = JSON.parse(val(monthToJson(emptyBook(), '2026-11', CREATED))).timestamps;
    expect(t).toMatchObject({
      chainHeadN: 0,
      chainHeadHash: null,
      chainBase: null,
      stamps: [],
      anchors: [],
      skewNumbers: [],
    });
    expect(t.status.state).toBe('off');
  });

  it('is canonical and the same text for the same data', () => {
    const b = book();
    expect(val(monthToJson(b, '2026-11', CREATED))).toBe(val(monthToJson(b, '2026-11', CREATED)));
  });
});

describe('the lines of the section in the PDF', () => {
  it('says what is covered, what is not, the skew and the anchors', () => {
    const b = anchored(book(), 2, iso(25, 8, 1), iso(25, 8, 5));
    const lines = timestampLines(monthTimestamps(b, '2026-11', CREATED));
    expect(lines[0]).toBe('Interne Stempel in diesem Monat: 4 (Nr. 1 bis 4)');
    expect(lines[1]).toBe('Kettenkopf bei Erstellung dieses Berichts: Nr. 4');
    expect(lines[2]).toBe(`Hash: ${b.stamps[3]!.hash}`);
    expect(lines).toContain(anchorStatusText(anchorStatus(b, CREATED)));
    expect(lines.join('\n')).toContain(
      'Nicht durch einen externen Zeitstempel abgedeckt ab Stempel Nr. 3 (Geräteuhr: 20.11.2026 16:00 UTC).',
    );
    expect(lines).toContain('Stempel mit zurückgestellter Geräteuhr: Nr. 2.');
    expect(lines).toContain(
      'Externer Zeitstempel: test-tsa, 25.11.2026 08:01 UTC, deckt die Stempel bis Nr. 2 ab',
    );
    expect(lines).toContain(`Hash: ${b.stamps[1]!.hash}`);
    expect(lines.at(-1)).toMatch(
      /Geräteuhr und belegen keine Zeit\. Nur die externen Zeitstempel belegen die Zeit/,
    );
  });

  it('says so when everything is covered, and when there is no anchor or no chain', () => {
    const b = anchored(book(), 4, iso(25, 8, 1), iso(25, 8, 5));
    expect(timestampLines(monthTimestamps(b, '2026-11', CREATED))).toContain(
      'Alle Stempel dieses Monats sind durch externe Zeitstempel abgedeckt.',
    );
    const none = timestampLines(monthTimestamps(book(), '2026-11', CREATED));
    expect(none).toContain('Keine externen Zeitstempel vorhanden.');
    const empty = timestampLines(monthTimestamps(emptyBook(), '2026-11', CREATED));
    expect(empty).toContain('Die Stempelkette ist noch leer.');
    expect(empty).toContain('Kein externer Zeitstempeldienst eingerichtet.');
  });

  it('has a German status text for every state', () => {
    const b = book();
    const off = anchorStatusText(
      anchorStatus({ ...b, settings: { ...b.settings, timestampRelay: '' } }, CREATED),
    );
    expect(off).toBe(
      'Kein externer Zeitstempeldienst eingerichtet. Die 4 internen Stempel sind nur durch die Geräteuhr datiert.',
    );
    expect(
      anchorStatusText(
        anchorStatus(
          { ...emptyBook(), settings: { ...emptyBook().settings, timestampRelay: RELAY } },
          CREATED,
        ),
      ),
    ).toBe('Es gibt noch keine Stempel.');
    expect(anchorStatusText(anchorStatus(b, iso(20, 9)))).toBe(
      '4 Stempel warten auf den externen Zeitstempel (der älteste von 20.11.2026 08:00 UTC).',
    );
    expect(anchorStatusText(anchorStatus(b, CREATED))).toMatch(
      /^Überfällig: 4 Stempel sind älter als 24 Stunden/,
    );
    expect(
      anchorStatusText(anchorStatus(anchored(b, 4, iso(25, 8, 1), iso(25, 8, 5)), CREATED)),
    ).toBe(
      'Alle 4 Stempel sind durch externe Zeitstempel abgedeckt (letzter: 25.11.2026 08:01 UTC).',
    );
  });
});

describe('the section in the PDF file', () => {
  it('is drawn on the page, with the hash of the head, and the anchor with its token is in the attachment', async () => {
    const b = anchored(book(), 2, iso(25, 8, 1), iso(25, 8, 5));
    const bytes = val(await monthToPdf(b, '2026-11', CREATED, ASSETS));
    const { streams } = await inspect(bytes);
    expect(streams.shown).toContain('Zeitstempel');
    expect(streams.shown).toContain('Interne Stempel in diesem Monat: 4 (Nr. 1 bis 4)');
    expect(streams.shown).toContain(`Hash: ${b.stamps[3]!.hash}`);
    expect(streams.shown).toContain('Stempel mit zurückgestellter Geräteuhr: Nr. 2.');
    expect(streams.shown).toContain('Überfällig:');
    expect(streams.shown).toContain('Externer Zeitstempel: test-tsa');
    expect(streams.shown).toContain(`Seriennummer des Tokens: ${SERIAL}`);
    expect(JSON.parse(streams.embedded[0]!.text).timestamps.anchors[0].evidence).toEqual(
      b.anchors[0]!.evidence,
    );
  });

  it('says in the report when no service is set up', async () => {
    const b = book();
    b.settings = { ...b.settings, timestampRelay: '' };
    const { streams } = await inspect(val(await monthToPdf(b, '2026-11', CREATED, ASSETS)));
    expect(streams.shown).toContain('Kein externer Zeitstempeldienst eingerichtet.');
  });
});
