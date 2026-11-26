import {
  BOOK_FORMAT,
  BOOK_VERSION,
  CHANGE_KINDS,
  STAMP_KINDS,
  LIMITS,
  fail,
  ok,
  type Break,
  type ChangeEntry,
  type Anchor,
  type ChangeKind,
  type Reason,
  type Stamp,
  type StampBase,
  type StampKind,
  type DaySnapshot,
  type Result,
  type TimeBook,
  type Workday,
} from './model.ts';
import { checkSettings, checkWorkday, textOk } from './validate.ts';
import { isDateKey, isMonthKey } from './time.ts';
import { isHash } from './sha256.ts';
import { checkChain } from './stamps.ts';
import { checkedEvidence } from './anchors.ts';

/** The oldest format version that is still read (its days, log and chain; see `importBackup`). */
const OLDEST_READABLE_VERSION = 1;

/** The whole book as a text a person can keep (the backup file). */
export function exportBackup(book: TimeBook): string {
  return JSON.stringify(book, null, 2);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Strict members: exactly these keys, nothing else. */
function hasOnly(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(o, k));
}

function readBreak(v: unknown): Break | null {
  if (!isObject(v)) return null;
  if (v.kind === 'length' && hasOnly(v, ['kind', 'minutes'])) {
    return { kind: 'length', minutes: v.minutes as number };
  }
  if (v.kind === 'span' && hasOnly(v, ['kind', 'fromMin', 'toMin'])) {
    return { kind: 'span', fromMin: v.fromMin as number, toMin: v.toMin as number | null };
  }
  return null;
}

function readBreaks(v: unknown): Break[] | null {
  if (!Array.isArray(v)) return null;
  const breaks: Break[] = [];
  for (const b of v) {
    const read = readBreak(b);
    if (!read) return null;
    breaks.push(read);
  }
  return breaks;
}

function readDay(key: string, v: unknown): Workday | null {
  if (!isObject(v) || !isDateKey(key)) return null;
  if (!hasOnly(v, ['date', 'startMin', 'endMin', 'breaks', 'origin', 'note', 'recordedAt'])) {
    return null;
  }
  const breaks = readBreaks(v.breaks);
  if (v.date !== key || !breaks) return null;
  const day = { ...v, breaks } as unknown as Workday;
  return checkWorkday(day) === null ? day : null;
}

/** A snapshot must pass the same rules as a day (it is checked as a day of that date). */
function readSnapshot(v: unknown, date: string, at: string): DaySnapshot | null {
  if (!isObject(v) || !hasOnly(v, ['startMin', 'endMin', 'breaks', 'note', 'origin'])) return null;
  const breaks = readBreaks(v.breaks);
  if (!breaks) return null;
  const snapshot = { ...v, breaks } as unknown as DaySnapshot;
  const asDay = { ...snapshot, date, recordedAt: at } as Workday;
  return checkWorkday(asDay) === null ? snapshot : null;
}

const CHANGE_KEYS = ['at', 'date', 'kind', 'before', 'after', 'reason', 'movedTo', 'movedFrom'];

function readChange(v: unknown): ChangeEntry | null {
  if (!isObject(v) || !hasOnly(v, CHANGE_KEYS)) return null;
  const { at, date, kind, reason, movedTo, movedFrom } = v;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  if (!isDateKey(date) || !CHANGE_KINDS.includes(kind as ChangeKind)) return null;
  if (!textOk(reason, LIMITS.maxReasonChars)) return null;
  for (const link of [movedTo, movedFrom]) {
    if (link !== null && (!isDateKey(link) || link === date)) return null;
  }
  const before = v.before === null ? null : readSnapshot(v.before, date, at);
  const after = v.after === null ? null : readSnapshot(v.after, date, at);
  if ((v.before !== null && !before) || (v.after !== null && !after)) return null;
  // the two snapshots must agree with the kind
  if (kind === 'added' && (before !== null || after === null)) return null;
  if (kind === 'removed' && (before === null || after !== null)) return null;
  if (kind === 'changed' && (before === null || after === null)) return null;
  return {
    at,
    date,
    kind: kind as ChangeKind,
    before,
    after,
    reason,
    movedTo: movedTo as string | null,
    movedFrom: movedFrom as string | null,
  };
}

const STAMP_KEYS = ['n', 'at', 'kind', 'date', 'contentHash', 'prev', 'skew', 'hash'];

function readStamp(v: unknown): Stamp | null {
  if (!isObject(v) || !hasOnly(v, STAMP_KEYS)) return null;
  if (!Number.isInteger(v.n) || typeof v.at !== 'string' || typeof v.skew !== 'boolean')
    return null;
  if (!STAMP_KINDS.includes(v.kind as StampKind) || !isDateKey(v.date)) return null;
  if (!isHash(v.contentHash) || !isHash(v.prev) || !isHash(v.hash)) return null;
  return v as unknown as Stamp;
}

const ANCHOR_KEYS = ['coveredN', 'headHash', 'evidence'];

/** An anchor of format 4: covered stamp, its hash, and the evidence for exactly that hash. */
function readAnchor(v: unknown): Anchor | null {
  if (!isObject(v) || !hasOnly(v, ANCHOR_KEYS)) return null;
  if (!Number.isInteger(v.coveredN) || !isHash(v.headHash)) return null;
  const evidence = checkedEvidence(v.evidence, v.headHash);
  if (!evidence) return null;
  return { coveredN: v.coveredN as number, headHash: v.headHash, evidence };
}

/** The chain, its base and the anchors, read strictly; returns a reason when anything is wrong. */
function readChain(
  raw: Record<string, unknown>,
  version: number,
): { stamps: Stamp[]; stampBase: StampBase | null; anchors: Anchor[] } | Reason {
  const { stamps, stampBase, anchors } = raw;
  if (!Array.isArray(stamps) || !Array.isArray(anchors)) return 'bad-backup';
  // anchors of format 3 (token, serial and time as single fields) are not read any more: none exist
  if (version < 4 && anchors.length > 0) return 'old-anchor-format';
  if (stamps.length > LIMITS.maxStamps) return 'too-many-stamps';
  if (anchors.length > LIMITS.maxAnchors) return 'too-many-anchors';
  let base: StampBase | null = null;
  if (stampBase !== null) {
    if (!isObject(stampBase) || !hasOnly(stampBase, ['n', 'hash', 'at'])) return 'bad-backup';
    if (!Number.isInteger(stampBase.n) || (stampBase.n as number) < 1) return 'bad-backup';
    if (!isHash(stampBase.hash) || typeof stampBase.at !== 'string') return 'bad-backup';
    if (Number.isNaN(Date.parse(stampBase.at))) return 'bad-backup';
    base = { n: stampBase.n as number, hash: stampBase.hash, at: stampBase.at };
  }
  const readStamps: Stamp[] = [];
  for (const s of stamps) {
    const stamp = readStamp(s);
    if (!stamp) return 'bad-backup';
    readStamps.push(stamp);
  }
  const broken = checkChain(readStamps, base);
  if (broken) return broken;
  const readAnchors: Anchor[] = [];
  // the first anchor may cover the base itself (compaction keeps it), so it only has to be above base.n - 1
  let last = base ? base.n - 1 : 0;
  for (const a of anchors) {
    const anchor = readAnchor(a);
    if (!anchor) return 'bad-backup';
    // the anchor must cover a stamp of this chain (or the base) with the same hash, in rising order
    const hashAt =
      anchor.coveredN === base?.n
        ? base.hash
        : readStamps.find((s) => s.n === anchor.coveredN)?.hash;
    if (anchor.coveredN <= last || hashAt !== anchor.headHash) return 'bad-backup';
    last = anchor.coveredN;
    readAnchors.push(anchor);
  }
  return { stamps: readStamps, stampBase: base, anchors: readAnchors };
}

/**
 * Reads a backup strictly: an unknown format or version, an unknown member, a day, a log entry, a stamp
 * or an anchor that fails the rules, a broken stamp chain, or two open days is a refusal — nothing is
 * half-taken. Versions 1 and 2 are read and become version 4 (an empty chain and no anchors, the relay
 * off); version 3 is read with its chain, but only without anchors: an anchor of format 3 (before the
 * evidence, 2026-11-25) is refused with `old-anchor-format` (there are none; no migration). Anchors of
 * version 4 hold the evidence of `zeitstempel/client`, read strictly (`checkedEvidence`). The caller decides whether to replace the current book (the UI asks).
 */
export function importBackup(text: string): Result<TimeBook> {
  if (typeof text !== 'string' || text.length > LIMITS.maxBackupChars) return fail('bad-backup');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('bad-backup');
  }
  if (!isObject(raw)) return fail('bad-backup');
  if (raw.format !== BOOK_FORMAT) return fail('bad-backup');
  const version = raw.version;
  if (typeof version !== 'number' || version < OLDEST_READABLE_VERSION || version > BOOK_VERSION) {
    return fail('unknown-version');
  }
  if (!Number.isInteger(version)) return fail('unknown-version');
  const keys = ['format', 'version', 'settings', 'days', 'exportedMonths'];
  if (version >= 2) keys.push('changes');
  if (version >= 3) keys.push('stamps', 'stampBase', 'anchors');
  if (!hasOnly(raw, keys)) return fail('bad-backup');
  const { settings, days, exportedMonths } = raw;
  const settingKeys = ['employeeLabel', 'retentionMonths'];
  if (version >= 3) settingKeys.push('timestampRelay');
  if (!isObject(settings) || !hasOnly(settings, settingKeys)) return fail('bad-backup');
  if (!isObject(days) || !isObject(exportedMonths)) return fail('bad-backup');
  const book: TimeBook = {
    format: BOOK_FORMAT,
    version: BOOK_VERSION,
    settings: {
      employeeLabel: settings.employeeLabel as string,
      retentionMonths: settings.retentionMonths as number,
      timestampRelay: version >= 3 ? (settings.timestampRelay as string) : '',
    },
    days: {},
    exportedMonths: {},
    changes: [],
    stamps: [],
    stampBase: null,
    anchors: [],
  };
  if (checkSettings(book.settings)) return fail('bad-backup');
  const dayKeys = Object.keys(days);
  if (dayKeys.length > LIMITS.maxDays) return fail('too-many-days');
  let open = 0;
  for (const key of dayKeys) {
    const day = readDay(key, days[key]);
    if (!day) return fail('bad-backup');
    if (day.endMin === null) open += 1;
    book.days[key] = day;
  }
  if (open > 1) return fail('second-open-day');
  for (const [month, when] of Object.entries(exportedMonths)) {
    if (!isMonthKey(month) || typeof when !== 'string' || Number.isNaN(Date.parse(when))) {
      return fail('bad-backup');
    }
    book.exportedMonths[month] = when;
  }
  if (version >= 2) {
    const changes = raw.changes;
    if (!Array.isArray(changes)) return fail('bad-backup');
    if (changes.length > LIMITS.maxChanges) return fail('too-many-changes');
    for (const c of changes) {
      const entry = readChange(c);
      if (!entry) return fail('bad-backup');
      book.changes.push(entry);
    }
  }
  if (version >= 3) {
    const chain = readChain(raw, version);
    if (typeof chain === 'string') return fail(chain);
    book.stamps = chain.stamps;
    book.stampBase = chain.stampBase;
    book.anchors = chain.anchors;
  }
  return ok(book);
}
