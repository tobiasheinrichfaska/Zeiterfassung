import {
  LIMITS,
  fail,
  ok,
  type Anchor,
  type MonthKey,
  type Result,
  type Stamp,
  type TimeBook,
} from './model.ts';
import { chainHead, stampsOfMonth } from './stamps.ts';
import { exportCovers } from './retention.ts';
import { monthIndex, monthOf } from './time.ts';
import { isHash } from './sha256.ts';
import { evidenceToken, hexToBase64Url, readEvidence, type Evidence } from './evidence.ts';

/**
 * Where the stamp chain stands against the external time stamping service:
 * - `off`: no service is set up (the counts are still given);
 * - `nothing`: the chain has no stamps at all;
 * - `ok`: every stamp is covered by an anchor;
 * - `due`: stamps without an anchor, the oldest of them is not yet 24 hours old;
 * - `overdue`: the oldest stamp without an anchor is older than 24 hours.
 */
export type AnchorState = 'off' | 'nothing' | 'ok' | 'due' | 'overdue';

export interface AnchorStatus {
  state: AnchorState;
  /** Stamps no anchor covers yet. */
  unanchored: number;
  /** Device time of the oldest of them. */
  oldestUnanchoredAt: string | null;
  /** The newest anchor's time (from its token), if any. */
  lastAnchorGenTime: string | null;
  /** The last stamp number an anchor covers (0 = none). */
  coveredN: number;
  /** Number of the newest stamp (0 = none). */
  headN: number;
}

/** The highest stamp number that an anchor (or the dropped part of the chain) covers. */
export const coveredUpTo = (book: Pick<TimeBook, 'anchors' | 'stampBase'>): number =>
  Math.max(book.stampBase?.n ?? 0, ...book.anchors.map((a) => a.coveredN));

export function anchorStatus(book: TimeBook, nowIso: string): AnchorStatus {
  const covered = coveredUpTo(book);
  const head = chainHead(book);
  const open = book.stamps.filter((s) => s.n > covered);
  const oldest = open[0]?.at ?? null;
  const base = {
    unanchored: open.length,
    oldestUnanchoredAt: oldest,
    lastAnchorGenTime: book.anchors.at(-1)?.evidence.genTime ?? null,
    coveredN: covered,
    headN: head?.n ?? 0,
  };
  if (book.settings.timestampRelay === '') return { state: 'off', ...base };
  if (head === null) return { state: 'nothing', ...base };
  if (open.length === 0) return { state: 'ok', ...base };
  const age = oldest === null ? 0 : Date.parse(nowIso) - Date.parse(oldest);
  const limit = LIMITS.anchorMaxAgeHours * 3_600_000;
  return { state: age > limit ? 'overdue' : 'due', ...base };
}

export interface AnchorRequest {
  /** What is to be stamped: the head of the chain. */
  hash: string;
  coveredN: number;
}

/** The hash to send to the service, or undefined when there is nothing new to cover. */
export function anchorRequest(book: TimeBook): AnchorRequest | undefined {
  const head = chainHead(book);
  if (head === null || head.n <= coveredUpTo(book)) return undefined;
  return { hash: head.hash, coveredN: head.n };
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * The evidence of an anchor, read strictly (`readEvidence` of `zeitstempel/client`, a fresh copy), with the
 * app's own rules on top: its hash is exactly `headHash`, its token is readable and within the size limit.
 * Null when anything fails. Shared by `addAnchor` and the backup reader.
 */
export function checkedEvidence(evidence: unknown, headHash: unknown): Evidence | null {
  if (typeof headHash !== 'string') return null;
  const read = readEvidence(evidence);
  if (!read.ok) return null;
  const e = read.value;
  if (e.hash !== hexToBase64Url(headHash)) return null;
  if (e.token.length > LIMITS.maxAnchorTokenChars || evidenceToken(e) === null) return null;
  return e;
}

/**
 * Takes an anchor into the book after checking it strictly: it must cover a stamp that exists and is newer
 * than what is covered, its evidence must pass `checkedEvidence` (strict form, the hash is that stamp's
 * hash, token within the size limit), and the time of the token must fit the device clock within the
 * tolerance (not long before the stamp it covers, not in the future). A refused anchor changes nothing.
 * After adding, the anchors are thinned (`thinAnchors`); the new one, the newest, always stays.
 */
export function addAnchor(book: TimeBook, anchor: Anchor, nowIso: string): Result<TimeBook> {
  if (book.anchors.length >= LIMITS.maxAnchors) return fail('too-many-anchors');
  if (!Number.isInteger(anchor.coveredN) || !isHash(anchor.headHash)) return fail('bad-anchor');
  const evidence = checkedEvidence(anchor.evidence, anchor.headHash);
  if (!evidence) return fail('bad-anchor');
  if (anchor.coveredN <= coveredUpTo(book)) return fail('bad-anchor');
  const covered = book.stamps.find((s) => s.n === anchor.coveredN);
  if (!covered || covered.hash !== anchor.headHash) return fail('bad-anchor');
  const tolerance = LIMITS.anchorSkewMinutes * 60_000;
  const gen = Date.parse(evidence.genTime);
  if (gen < Date.parse(covered.at) - tolerance || gen > Date.parse(nowIso) + tolerance) {
    return fail('anchor-skew');
  }
  const added = {
    ...book,
    anchors: [...book.anchors, { coveredN: anchor.coveredN, headHash: anchor.headHash, evidence }],
  };
  // older anchors that nothing needs any more go (`thinAnchors`): the book stays small
  return ok({ ...added, anchors: thinAnchors(added, nowIso) });
}

/**
 * The anchors a month's report shows: for every given stamp the **first** anchor that covers it (the
 * oldest with `coveredN >= n`; a later anchor covers the whole chain up to its own stamp, so this is the
 * earliest proof for that stamp), plus the newest anchor **before** the first of the stamps (it shows the
 * state of the chain before the month). Each anchor once, in the book's order (rising `coveredN`). No
 * stamps: no anchors.
 */
export function anchorsForStamps(anchors: readonly Anchor[], stamps: readonly Stamp[]): Anchor[] {
  if (stamps.length === 0) return [];
  const pick = new Set<number>();
  const first = Math.min(...stamps.map((s) => s.n));
  let before = -1;
  for (const [i, a] of anchors.entries()) if (a.coveredN < first) before = i;
  if (before >= 0) pick.add(before);
  for (const s of stamps) {
    const i = anchors.findIndex((a) => a.coveredN >= s.n);
    if (i >= 0) pick.add(i);
  }
  return anchors.filter((_, i) => pick.has(i));
}

const monthAt = (index: number): MonthKey =>
  `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;

/**
 * Which anchors the book keeps (applied by `addAnchor`). A later anchor covers the whole chain up to its own
 * stamp, so older ones only add how **early** a stamp existed. Kept are:
 * 1. per calendar day of the token's time (UTC date of `genTime`) only the **newest** anchor of that day;
 * 2. of those, only the ones a month still needs to show (`anchorsForStamps` over that month's stamps), for
 *    the months with stamps that are the current or the previous month (UTC month of `nowIso`) or that an
 *    export does not cover (never exported, or changed after the export): an exported month's anchors are
 *    in its exported PDF;
 * 3. always the newest anchor of all (it holds `coveredUpTo`, so the status never changes).
 * Order is kept; nothing is added.
 */
export function thinAnchors(book: TimeBook, nowIso: string): Anchor[] {
  const anchors = book.anchors;
  if (anchors.length <= 1) return anchors;
  const lastOfDay = new Map<string, number>();
  for (const [i, a] of anchors.entries()) lastOfDay.set(a.evidence.genTime.slice(0, 10), i);
  const newestOfDay = new Set(lastOfDay.values());
  const daily = anchors.filter((_, i) => newestOfDay.has(i));
  const now = monthIndex(monthOf(nowIso.slice(0, 10)));
  const recent = new Set([monthAt(now), monthAt(now - 1)]);
  const months = new Set(book.stamps.map((s) => monthOf(s.date)));
  const keep = new Set<Anchor>([anchors[anchors.length - 1] as Anchor]);
  for (const month of months) {
    if (!recent.has(month) && exportCovers(book, month)) continue;
    for (const a of anchorsForStamps(daily, stampsOfMonth(book, month))) keep.add(a);
  }
  return anchors.filter((a) => keep.has(a));
}

/** The answer of the stamping service for a hash (or why there is none). */
export type AnchorFailure =
  | 'not-configured'
  | 'unreachable'
  | 'refused'
  | 'rate-limited'
  | 'bad-response'
  | 'not-verified'
  | 'unauthorized'
  /** The app's own time stamp setup is wrong (trust anchors, services, client options), not the token. */
  | 'misconfigured';

/**
 * What a verified answer gives: the evidence of `zeitstempel/client` (its time is that of the checked
 * token, not the relay's claim).
 */
export interface AnchorValue {
  evidence: Evidence;
}

export type AnchorOutcome =
  { ok: true; value: AnchorValue } | { ok: false; reason: AnchorFailure; detail: string };

export const ANCHOR_FAILURE_TEXTS: Record<AnchorFailure, string> = {
  'not-configured': 'Kein externer Zeitstempeldienst eingerichtet.',
  unreachable: 'Der Zeitstempeldienst ist nicht erreichbar.',
  refused: 'Der Zeitstempeldienst hat die Anfrage abgelehnt.',
  'rate-limited': 'Der Zeitstempeldienst nimmt vorerst keine weitere Anfrage an.',
  'bad-response': 'Die Antwort des Zeitstempeldienstes ist ungültig.',
  'not-verified': 'Das Token des Zeitstempeldienstes hat die Prüfung nicht bestanden.',
  unauthorized: 'Geräteschlüssel wird vom Zeitstempeldienst nicht angenommen.',
  misconfigured: 'Die Zeitstempel-Einrichtung dieses Builds ist fehlerhaft.',
};

/** Standard Base64 with padding. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** The anchor to add for a service's answer. */
export function anchorFromOutcome(request: AnchorRequest, value: AnchorValue): Anchor {
  return { coveredN: request.coveredN, headHash: request.hash, evidence: value.evidence };
}

/** Standard Base64 → bytes, or null when it is not valid Base64. */
export function base64ToBytes(text: string): Uint8Array | null {
  if (text.length === 0 || text.length % 4 !== 0 || !BASE64.test(text)) return null;
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** A hash of 64 hex digits → its 32 bytes, or null. */
export function hexToBytes(hex: string): Uint8Array | null {
  if (!isHash(hex)) return null;
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
}
