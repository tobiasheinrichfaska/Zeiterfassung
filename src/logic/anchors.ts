import { LIMITS, fail, ok, type Anchor, type Result, type TimeBook } from './model.ts';
import { chainHead } from './stamps.ts';
import { isHash } from './sha256.ts';
import { textOk } from './validate.ts';

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
    lastAnchorGenTime: book.anchors.at(-1)?.genTime ?? null,
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
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const SERIAL = /^[0-9a-f]+$/;
const SERVICE_ID = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * Takes an anchor into the book after checking it strictly: it must cover a stamp that exists and
 * is newer than what is covered, its hash must be that stamp's hash, it carries the serial number of the
 * token (lower-case hex), the token must be Base64 within the
 * size limit, and the time of the token must fit the device clock within the tolerance (not long before
 * the stamp it covers, not in the future). A refused anchor changes nothing.
 */
export function addAnchor(book: TimeBook, anchor: Anchor, nowIso: string): Result<TimeBook> {
  if (book.anchors.length >= LIMITS.maxAnchors) return fail('too-many-anchors');
  if (
    !textOk(anchor.tsaId, LIMITS.maxTsaIdChars) ||
    anchor.tsaId === '' ||
    typeof anchor.genTime !== 'string' ||
    Number.isNaN(Date.parse(anchor.genTime)) ||
    !Number.isInteger(anchor.coveredN) ||
    !isHash(anchor.headHash) ||
    typeof anchor.serial !== 'string' ||
    !SERIAL.test(anchor.serial) ||
    anchor.serial.length > LIMITS.maxSerialChars ||
    typeof anchor.token !== 'string' ||
    anchor.token.length === 0 ||
    anchor.token.length > LIMITS.maxAnchorTokenChars ||
    anchor.token.length % 4 !== 0 ||
    !BASE64.test(anchor.token)
  ) {
    return fail('bad-anchor');
  }
  if (anchor.coveredN <= coveredUpTo(book)) return fail('bad-anchor');
  const covered = book.stamps.find((s) => s.n === anchor.coveredN);
  if (!covered || covered.hash !== anchor.headHash) return fail('bad-anchor');
  const tolerance = LIMITS.anchorSkewMinutes * 60_000;
  const gen = Date.parse(anchor.genTime);
  if (gen < Date.parse(covered.at) - tolerance || gen > Date.parse(nowIso) + tolerance) {
    return fail('anchor-skew');
  }
  return ok({ ...book, anchors: [...book.anchors, { ...anchor }] });
}

/** The answer of the stamping service for a hash (or why there is none). */
export type AnchorFailure =
  'not-configured' | 'unreachable' | 'refused' | 'rate-limited' | 'bad-response' | 'not-verified';

/** What a verified answer gives: the time and serial are those of the checked token, not the relay's. */
export interface AnchorValue {
  tsaId: string;
  token: Uint8Array;
  genTime: string;
  serial: string;
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
};

/** Standard Base64 with padding. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** The anchor to add for a service's answer. */
export function anchorFromOutcome(request: AnchorRequest, value: AnchorValue): Anchor {
  return {
    tsaId: value.tsaId,
    genTime: value.genTime,
    serial: value.serial,
    coveredN: request.coveredN,
    headHash: request.hash,
    token: bytesToBase64(value.token),
  };
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

/** Base64url without padding → bytes (what the relay sends and takes), or null when it is not that. */
export function base64UrlToBytes(text: string): Uint8Array | null {
  if (text.length === 0 || !BASE64URL.test(text) || text.length % 4 === 1) return null;
  const padded =
    text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Bytes → Base64url without padding. */
export const bytesToBase64Url = (bytes: Uint8Array): string =>
  bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A hash of 64 hex digits → its 32 bytes, or null. */
export function hexToBytes(hex: string): Uint8Array | null {
  if (!isHash(hex)) return null;
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
}

/**
 * Reads the relay's answer to `POST /v1/stamp/<id>` strictly: exactly `service`, `genTime`, `accuracyMs`
 * (whole number or null), `serial` (lower-case hex) and `token` (Base64url of the DER token, within the
 * size limit). Anything else is a bad response, never a guess. The values are **not trusted yet**: the
 * token has to be verified against the hash and the shipped trust anchors (`genTime` here is for display
 * only; the verified token's time counts).
 */
export function parseRelayAnswer(value: unknown): AnchorOutcome {
  const bad = (detail: string): AnchorOutcome => ({ ok: false, reason: 'bad-response', detail });
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return bad('kein Objekt');
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(',');
  if (keys !== 'accuracyMs,genTime,serial,service,token') return bad('unerwartete Felder');
  if (typeof o.service !== 'string' || !SERVICE_ID.test(o.service)) return bad('service');
  if (typeof o.genTime !== 'string' || Number.isNaN(Date.parse(o.genTime))) return bad('genTime');
  if (o.accuracyMs !== null && !(Number.isInteger(o.accuracyMs) && (o.accuracyMs as number) >= 0))
    return bad('accuracyMs');
  if (
    typeof o.serial !== 'string' ||
    !SERIAL.test(o.serial) ||
    o.serial.length > LIMITS.maxSerialChars
  )
    return bad('serial');
  // Base64url is shorter than Base64 by a quarter at most: the stored (standard) form must fit as well
  if (typeof o.token !== 'string' || o.token.length > LIMITS.maxAnchorTokenChars * 0.75)
    return bad('token');
  const token = base64UrlToBytes(o.token);
  if (!token) return bad('token');
  return { ok: true, value: { tsaId: o.service, genTime: o.genTime, serial: o.serial, token } };
}

/** The service ids of the relay's `GET /v1/services` answer, in the relay's order (at most 32). */
export function parseServiceList(value: unknown): string[] | null {
  if (typeof value !== 'object' || value === null) return null;
  const list = (value as Record<string, unknown>).services;
  if (!Array.isArray(list) || list.length > 32) return null;
  const ids: string[] = [];
  for (const entry of list) {
    const id = (entry as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !SERVICE_ID.test(id)) return null;
    ids.push(id);
  }
  return ids;
}
