import { memoryEnvironment } from 'local-vault';
import {
  LIMITS,
  addAnchor,
  encodeRunningPdf,
  forcedSave,
  emptyBook,
  pdfSlotPlan,
  roomToFree,
  savePromptView,
  savedMarker,
  slotPlanNotes,
  stampIn,
  stampOut,
  thinAnchors,
  type AnchorOutcome,
  type PdfSlotContent,
  type TimeBook,
} from '../src/logic/index.ts';
import type { AnchorService } from '../src/io/anchorService.ts';
import { joinRound } from '../src/io/joinRound.ts';
import { savedPdfs } from '../src/io/runningPdfStore.ts';
import { pdfInSlot, updateRunningPdfs } from '../src/io/runningPdfWork.ts';
import { createAppVault } from '../src/ui/vault.ts';
import { bookWith, day, evidenceFor, val } from './helpers.ts';
import { ASSETS } from './pdfAssets.ts';

const t = (date: string, h: number, m = 0) =>
  `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;

function relayBook(): TimeBook {
  const b = emptyBook();
  b.settings = { ...b.settings, timestampRelay: 'https://relay.example/stamp' };
  return b;
}

/** Anchors the head through `addAnchor` (which thins), or, with `raw`, appends it unthinned. */
function anchorHead(b: TimeBook, genTime: string, raw = false): TimeBook {
  const head = b.stamps.at(-1)!;
  const anchor = {
    coveredN: head.n,
    headHash: head.hash,
    evidence: evidenceFor(head.hash, { genTime }),
  };
  if (raw) return { ...b, anchors: [...b.anchors, anchor] };
  return val(addAnchor(b, anchor, genTime));
}

/** Kommen at 8, anchor at 8:01, Gehen at 16, anchor at 16:01. */
function workDay(book: TimeBook, date: string, raw = false): TimeBook {
  let b = val(stampIn(book, { date, minute: 480 }, t(date, 8)));
  b = anchorHead(b, t(date, 8, 1), raw);
  b = val(stampOut(b, { date, minute: 960 }, t(date, 16)));
  return anchorHead(b, t(date, 16, 1), raw);
}

const slots = (a: PdfSlotContent, b: PdfSlotContent = { kind: 'empty' }) => ({
  'monatspdf-a': a,
  'monatspdf-b': b,
});

describe('1: the plan notes appear outside the forced overlay too', () => {
  it('a reminder carries the notes (a waiting current month)', () => {
    // previous month in its week, an unreadable second slot: no slot for December, no forced save
    const plan = pdfSlotPlan(
      '2026-12-03',
      slots({ kind: 'pdf', month: '2026-11' }, { kind: 'unreadable' }),
    );
    expect(forcedSave(plan)).toEqual([]);
    const view = savePromptView(plan);
    expect(view.kind).toBe('reminder');
    expect(view.kind !== 'none' && view.notes).toEqual(slotPlanNotes(plan));
    expect(view.kind !== 'none' && view.notes.join(' ')).toContain('kein Platz frei');
  });

  it('notes alone still show a banner (a file dated after today)', () => {
    const plan = pdfSlotPlan('2026-11-10', slots({ kind: 'pdf', month: '2026-12' }));
    expect(plan.save).toEqual([]);
    const view = savePromptView(plan);
    expect(view).toEqual({ kind: 'notes', notes: slotPlanNotes(plan) });
    expect(slotPlanNotes(plan)[0]).toContain('noch nicht begonnen');
    expect(savePromptView(pdfSlotPlan('2026-11-10', slots({ kind: 'empty' })))).toEqual({
      kind: 'none',
    });
    expect(savePromptView(undefined)).toEqual({ kind: 'none' });
  });
});

const dates = (n: number): string[] =>
  Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
  );

describe('2a: the cap is checked after thinning', () => {
  it('a new anchor that replaces today’s own is taken at the cap; one more needed anchor is refused', () => {
    let b = relayBook();
    // one needed anchor per day, months never exported: all of them stay
    for (const d of dates(LIMITS.maxAnchors)) b = workDay(b, d, true);
    b = { ...b, anchors: b.anchors.filter((_, i) => i % 2 === 1) };
    expect(b.anchors).toHaveLength(LIMITS.maxAnchors);
    const last = dates(LIMITS.maxAnchors).at(-1)!;
    const now = `${last}T17:00:00.000Z`;
    expect(thinAnchors(b, now)).toHaveLength(LIMITS.maxAnchors);
    // a later stamp of the last day and its anchor: it replaces that day's anchor, so the cap holds
    const again = anchorAfterStamp(b, `${last}T16:30:00.000Z`);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.anchors).toHaveLength(LIMITS.maxAnchors);
    // one more day: one more needed anchor than the cap allows
    const next = dates(LIMITS.maxAnchors + 1).at(-1)!;
    const more = workDay(b, next, true);
    const pre = { ...more, anchors: more.anchors.slice(0, -2) };
    const head2 = pre.stamps.at(-1)!;
    expect(
      addAnchor(
        pre,
        {
          coveredN: head2.n,
          headHash: head2.hash,
          evidence: evidenceFor(head2.hash, { genTime: `${next}T16:01:00.000Z` }),
        },
        `${next}T16:01:00.000Z`,
      ),
    ).toEqual({ ok: false, reason: 'too-many-anchors' });
  }, 60_000);
});

/** Adds a stamp (a note change is not needed: a later stamp of the same day) and anchors it via addAnchor. */
function anchorAfterStamp(b: TimeBook, genTime: string) {
  const last = b.stamps.at(-1)!;
  const stamp = {
    ...last,
    n: last.n + 1,
    prev: last.hash,
    hash: 'f'.repeat(64),
    at: genTime,
  };
  const withStamp = { ...b, stamps: [...b.stamps, stamp] };
  return addAnchor(
    withStamp,
    {
      coveredN: stamp.n,
      headHash: stamp.hash,
      evidence: evidenceFor(stamp.hash, { genTime }),
    },
    genTime,
  );
}

describe('2b: a month whose running PDF was saved out counts as covered for thinning', () => {
  function book(): TimeBook {
    let b = relayBook();
    for (const d of ['02', '03', '04']) b = workDay(b, `2026-09-${d}`);
    for (const d of ['02', '03', '04']) b = workDay(b, `2026-10-${d}`);
    return b;
  }

  it('drops September’s anchors in November when its running PDF was saved out', () => {
    const b = book();
    const nov = workDay(b, '2026-11-02');
    // never exported, never saved: September keeps its anchors
    expect(nov.anchors.map((a) => a.coveredN)).toEqual([2, 4, 6, 8, 10, 12, 14]);
    const saved = [{ month: '2026-09', at: '2026-10-05T10:00:00.000Z' }];
    expect(thinAnchors(nov, '2026-11-02T17:00:00.000Z', saved).map((a) => a.coveredN)).toEqual([
      6, 8, 10, 12, 14,
    ]);
  });

  it('a change after the save keeps the month’s anchors', () => {
    const nov = workDay(book(), '2026-11-02');
    const saved = [{ month: '2026-09', at: '2026-09-03T10:00:00.000Z' }]; // before the 3rd and 4th
    expect(thinAnchors(nov, '2026-11-02T17:00:00.000Z', saved)).toHaveLength(7);
  });

  it('addAnchor takes the saved months; the vault markers give them', async () => {
    const vault = createAppVault(memoryEnvironment());
    await vault.startVault();
    vault.writeSlot('monatspdf-b', savedMarker('2026-09', '2026-10-05T10:00:00.000Z'));
    vault.writeSlot('monatspdf-a', encodeRunningPdf(new TextEncoder().encode('%PDF-1.7 x')));
    expect(savedPdfs(vault)).toEqual([{ month: '2026-09', at: '2026-10-05T10:00:00.000Z' }]);
    let b = book();
    b = workDay(b, '2026-11-02', true);
    const head = b.stamps.at(-1)!;
    const added = addAnchor(
      { ...b, anchors: b.anchors.slice(0, -1) },
      {
        coveredN: head.n,
        headHash: head.hash,
        evidence: evidenceFor(head.hash, { genTime: '2026-11-02T16:01:00.000Z' }),
      },
      '2026-11-02T16:01:00.000Z',
      savedPdfs(vault),
    );
    expect(added.ok && added.value.anchors.map((a) => a.coveredN)).toEqual([6, 8, 10, 12, 14]);
  });
});

describe('3: a vault budget refusal first forces the previous month’s file out', () => {
  it('the rule', () => {
    expect(roomToFree('monatspdf-b', 1000, { slot: 'monatspdf-a', chars: 5000 })).toEqual({
      slot: 'monatspdf-a',
      why: 'room',
    });
    expect(roomToFree('monatspdf-b', 5000, { slot: 'monatspdf-a', chars: 5000 })).toEqual({
      slot: 'monatspdf-b',
      why: 'too-large',
    });
    expect(roomToFree('monatspdf-a', 10, { slot: 'monatspdf-a', chars: 5000 }).why).toBe(
      'too-large',
    );
    expect(roomToFree('monatspdf-b', 10, null).why).toBe('too-large');
  });

  function service(): AnchorService {
    return {
      async anchor(hashHex): Promise<AnchorOutcome> {
        const t = new Uint8Array(3000);
        t.set([0x30, 0x82, (3000 - 4) >> 8, (3000 - 4) & 255]);
        return { ok: true, value: { evidence: evidenceFor(hashHex, { tokenBytes: t }) } };
      },
    };
  }

  it('in the previous month’s week the November file is forced out, December goes on afterwards', async () => {
    const vault = createAppVault(memoryEnvironment());
    await vault.startVault();
    const b = bookWith(
      day({ date: '2026-11-26' }),
      day({ date: '2026-11-27' }),
      day({ date: '2026-12-01' }),
    );
    const dep = (at: Date, vaultBudget = 3_500_000) => ({
      vault,
      assets: () => ASSETS,
      service: service(),
      now: () => at,
      vaultBudget,
    });
    await updateRunningPdfs(b, dep(new Date(2026, 10, 27, 18)));
    const nov = pdfInSlot(vault, 'monatspdf-a')!;
    const novChars = encodeRunningPdf(nov).length;
    // room for November and a little more: December's start does not fit
    const run = await updateRunningPdfs(b, dep(new Date(2026, 11, 2, 9), novChars + 2000));
    expect(forcedSave(run.plan)).toEqual([
      { slot: 'monatspdf-a', month: '2026-11', mode: 'forced', why: 'room' },
    ]);
    const dec = run.infos.find((i) => i.month === '2026-12')!;
    expect(dec.tooLarge).toBe(false);
    expect(dec.problem).toContain('November 2026');
    expect(pdfInSlot(vault, 'monatspdf-b')).toBeUndefined();
  }, 60_000);
});

describe('4: a call while a round runs waits for that round', () => {
  it('joins the running round, and runs once more only when asked to', async () => {
    const slot: { current: Promise<string> | undefined } = { current: undefined };
    let release: (v: string) => void = () => undefined;
    let started = 0;
    const start = () => {
      started += 1;
      return new Promise<string>((r) => (release = r));
    };
    const first = joinRound(slot, start);
    const second = joinRound(slot, start);
    release('anchor');
    expect(await first).toBe('anchor');
    expect(await second).toBe('anchor');
    expect(started).toBe(1);
    expect(slot.current).toBeUndefined();
    // again: the joined round left something open
    const a = joinRound(slot, start);
    const b = joinRound(slot, start, (r) => r === 'anchor');
    release('anchor');
    await a;
    await Promise.resolve();
    release('nothing');
    expect(await b).toBe('nothing');
    expect(started).toBe(3);
  });
});
