import {
  BOOK_FORMAT,
  BOOK_VERSION,
  CHANGE_KINDS,
  LIMITS,
  fail,
  ok,
  type Break,
  type ChangeEntry,
  type ChangeKind,
  type DaySnapshot,
  type Result,
  type TimeBook,
  type Workday,
} from './model.ts';
import { checkSettings, checkWorkday, textOk } from './validate.ts';
import { isDateKey, isMonthKey } from './time.ts';

/** The older format version that is still read (and migrated without loss). */
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

/**
 * Reads a backup strictly: an unknown format or version, an unknown member, a day or a log entry
 * that fails the rules, or two open days is a refusal — nothing is half-taken. Version 1 (no change
 * log) is read and becomes version 2 with an empty log; nothing else changes. The caller decides
 * whether to replace the current book (the UI asks first).
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
  if (version !== BOOK_VERSION && version !== OLDEST_READABLE_VERSION)
    return fail('unknown-version');
  const keys = ['format', 'version', 'settings', 'days', 'exportedMonths'];
  if (!hasOnly(raw, version === BOOK_VERSION ? [...keys, 'changes'] : keys)) {
    return fail('bad-backup');
  }
  const { settings, days, exportedMonths } = raw;
  if (!isObject(settings) || !hasOnly(settings, ['employeeLabel', 'retentionMonths'])) {
    return fail('bad-backup');
  }
  if (!isObject(days) || !isObject(exportedMonths)) return fail('bad-backup');
  const book: TimeBook = {
    format: BOOK_FORMAT,
    version: BOOK_VERSION,
    settings: {
      employeeLabel: settings.employeeLabel as string,
      retentionMonths: settings.retentionMonths as number,
    },
    days: {},
    exportedMonths: {},
    changes: [],
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
  if (version === BOOK_VERSION) {
    const changes = raw.changes;
    if (!Array.isArray(changes)) return fail('bad-backup');
    if (changes.length > LIMITS.maxChanges) return fail('too-many-changes');
    for (const c of changes) {
      const entry = readChange(c);
      if (!entry) return fail('bad-backup');
      book.changes.push(entry);
    }
  }
  return ok(book);
}
