import { LIMITS, type DateKey } from './model.ts';
import type { BreakFields, DayFormFields } from './view.ts';
import { isDateKey } from './time.ts';

/** The one vault slot that holds unsaved form input. */
export const DRAFT_SLOT = 'draft';

export type DraftKey = 'tag' | 'monat';

/**
 * What a person has typed but not saved. `tag` is the entry form; `monat` is the form of a day being
 * corrected in the month view (that day's date is kept so the form reopens on it).
 */
export interface Drafts {
  version: 1;
  tag?: DayFormFields;
  monat?: { date: DateKey; fields: DayFormFields };
}

export const emptyDrafts = (): Drafts => ({ version: 1 });

export const isEmptyDrafts = (d: Drafts): boolean => d.tag === undefined && d.monat === undefined;

/** A copy with one draft set, or removed when `value` is undefined. */
export function withDraft(drafts: Drafts, key: 'tag', value: DayFormFields | undefined): Drafts;
export function withDraft(
  drafts: Drafts,
  key: 'monat',
  value: { date: DateKey; fields: DayFormFields } | undefined,
): Drafts;
export function withDraft(drafts: Drafts, key: DraftKey, value: unknown): Drafts {
  const { [key]: _removed, ...rest } = drafts;
  void _removed;
  return (value === undefined ? rest : { ...rest, [key]: value }) as Drafts;
}

export const serializeDrafts = (drafts: Drafts): string => JSON.stringify(drafts);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const only = (o: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));

const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

function readBreakFields(v: unknown): BreakFields | null {
  if (!isObject(v) || !only(v, ['kind', 'minutes', 'from', 'to'])) return null;
  if (v.kind !== 'length' && v.kind !== 'span') return null;
  if (!text(v.minutes, 4) || !text(v.from, 5) || !text(v.to, 5)) return null;
  return { kind: v.kind, minutes: v.minutes, from: v.from, to: v.to };
}

/** Strict: exactly the members of a form, short texts, at most the number of breaks of a day. */
export function readFormFields(v: unknown): DayFormFields | null {
  if (!isObject(v) || !only(v, ['date', 'start', 'end', 'nextDay', 'breaks', 'note'])) return null;
  if (!text(v.date, 10) || !text(v.start, 5) || !text(v.end, 5)) return null;
  if (!text(v.note, LIMITS.maxNoteChars) || typeof v.nextDay !== 'boolean') return null;
  if (!Array.isArray(v.breaks) || v.breaks.length > LIMITS.maxBreaksPerDay) return null;
  const breaks: BreakFields[] = [];
  for (const b of v.breaks) {
    const read = readBreakFields(b);
    if (!read) return null;
    breaks.push(read);
  }
  return { date: v.date, start: v.start, end: v.end, nextDay: v.nextDay, breaks, note: v.note };
}

/**
 * Reads the stored drafts. A draft is not data worth refusing over: whatever does not pass is dropped
 * and the person starts that form afresh (the saved times are never affected).
 */
export function parseDrafts(raw: string | null): Drafts {
  if (raw === null || raw.length > 100_000) return emptyDrafts();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return emptyDrafts();
  }
  if (!isObject(value) || value.version !== 1) return emptyDrafts();
  let drafts = emptyDrafts();
  const tag = readFormFields(value.tag);
  if (tag) drafts = withDraft(drafts, 'tag', tag);
  const monat = value.monat;
  if (isObject(monat) && only(monat, ['date', 'fields']) && isDateKey(monat.date)) {
    const fields = readFormFields(monat.fields);
    if (fields) drafts = withDraft(drafts, 'monat', { date: monat.date, fields });
  }
  return drafts;
}
