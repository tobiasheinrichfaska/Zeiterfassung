import {
  BOOK_FORMAT,
  BOOK_VERSION,
  LIMITS,
  fail,
  ok,
  type Break,
  type Result,
  type TimeBook,
  type Workday,
} from './model.ts';
import { checkSettings, checkWorkday } from './validate.ts';
import { isDateKey, isMonthKey } from './time.ts';

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

function readDay(key: string, v: unknown): Workday | null {
  if (!isObject(v) || !isDateKey(key)) return null;
  if (!hasOnly(v, ['date', 'startMin', 'endMin', 'breaks', 'origin', 'note', 'recordedAt'])) {
    return null;
  }
  if (v.date !== key || !Array.isArray(v.breaks)) return null;
  const breaks: Break[] = [];
  for (const b of v.breaks) {
    const read = readBreak(b);
    if (!read) return null;
    breaks.push(read);
  }
  const day = { ...v, breaks } as unknown as Workday;
  return checkWorkday(day) === null ? day : null;
}

/**
 * Reads a backup strictly: an unknown format or version, an unknown member, a day that fails the
 * rules, or two open days is a refusal — nothing is half-taken. The caller decides whether to
 * replace the current book (the UI asks first).
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
  if (raw.version !== BOOK_VERSION) return fail('unknown-version');
  if (!hasOnly(raw, ['format', 'version', 'settings', 'days', 'exportedMonths'])) {
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
  };
  if (checkSettings(book.settings)) return fail('bad-backup');
  const keys = Object.keys(days);
  if (keys.length > LIMITS.maxDays) return fail('too-many-days');
  let open = 0;
  for (const key of keys) {
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
  return ok(book);
}
