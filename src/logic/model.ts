/** Data model of the time book. Pure types and constants, no I/O (workspace rule: logic layer). */

/** Local calendar day, `YYYY-MM-DD`. */
export type DateKey = string;
/** Local calendar month, `YYYY-MM`. */
export type MonthKey = string;

/** A pause: a plain length, or a span of the working day (open while `toMin` is null). */
export type Break =
  { kind: 'length'; minutes: number } | { kind: 'span'; fromMin: number; toMin: number | null };

export type Origin = 'stamp' | 'manual';

/**
 * One working day. Times are minutes since LOCAL midnight of `date` (wall clock, no time zone),
 * so a shift past midnight has `endMin` above 1440. `endMin` null = still running.
 */
export interface Workday {
  date: DateKey;
  startMin: number;
  endMin: number | null;
  breaks: Break[];
  origin: Origin;
  note: string;
  /** When this record was last changed (ISO 8601, UTC) — the device clock, not a trusted time. */
  recordedAt: string;
}

/** The times of a day as they stood before or after a change (compact, no dates). */
export interface DaySnapshot {
  startMin: number;
  endMin: number | null;
  breaks: Break[];
  note: string;
  origin: Origin;
}

export type ChangeKind = 'added' | 'changed' | 'removed';
export const CHANGE_KINDS: readonly ChangeKind[] = ['added', 'changed', 'removed'];

/**
 * One logged change to a day that was already over. A move is two entries (removed + added)
 * that point at each other through `movedTo` / `movedFrom`. Not tamper-proof (no chain, no
 * signature, device clock): see Known Limitations.
 */
export interface ChangeEntry {
  /** When the change was made (ISO 8601, UTC, device clock). */
  at: string;
  /** The affected day. */
  date: DateKey;
  kind: ChangeKind;
  /** Null for `added`. */
  before: DaySnapshot | null;
  /** Null for `removed`. */
  after: DaySnapshot | null;
  /** The person's reason; empty when none was given. */
  reason: string;
  /** For a move: the other date. */
  movedTo: DateKey | null;
  movedFrom: DateKey | null;
}

export type StampKind = 'change' | 'seal';
export const STAMP_KINDS: readonly StampKind[] = ['change', 'seal'];

/**
 * An internal time stamp: one link of a hash chain. Made at every finished write to a day (`change`)
 * and once for every day that has ended (`seal`). It holds a hash of the day's state, not the state.
 * The time `at` is the device clock; only an `Anchor` proves a time.
 */
export interface Stamp {
  /** 1, 2, 3 … without gaps (after a base: base.n + 1 …). */
  n: number;
  at: string;
  kind: StampKind;
  date: DateKey;
  /** SHA-256 of the canonical state of the day, or of the deletion marker for a removed day. */
  contentHash: string;
  /** The `hash` of the stamp before (64 zeros for the first). */
  prev: string;
  /** The clock was earlier than at the stamp before. */
  skew: boolean;
  /** SHA-256 of the canonical form of all the fields above. */
  hash: string;
}

export interface StampBase {
  n: number;
  hash: string;
  at: string;
}

/** The proof of an external time stamping service for the chain head at `coveredN`. */
export interface Anchor {
  tsaId: string;
  /** The time the token says (not the device clock). */
  genTime: string;
  coveredN: number;
  headHash: string;
  /** The time stamp token as Base64 (standard alphabet), for checking with other tools. */
  token: string;
}

export interface Settings {
  /** Free text printed on the summary (a name or a staff number); may be empty. */
  employeeLabel: string;
  /** Exported months are deleted from the device this many months after their end. */
  retentionMonths: number;
  /** Address of the relay for external time stamps; empty = off. Must be one the build allows. */
  timestampRelay: string;
}

export interface TimeBook {
  format: typeof BOOK_FORMAT;
  version: typeof BOOK_VERSION;
  settings: Settings;
  days: Record<DateKey, Workday>;
  /** Month → when its summary was exported (ISO). Only exported months may be purged. */
  exportedMonths: Record<MonthKey, string>;
  /** Every change to a day that was already over (date before today), oldest first. */
  changes: ChangeEntry[];
  /** The hash chain of every written day (see `Stamp`), oldest first; contains no times or notes. */
  stamps: Stamp[];
  /** What the chain starts from when its oldest part was dropped (null = it starts at stamp 1). */
  stampBase: StampBase | null;
  /** External time stamps that cover the chain up to `coveredN`, oldest first. */
  anchors: Anchor[];
}

export const BOOK_FORMAT = 'zeiterfassung-buch';
export const BOOK_VERSION = 3;

/** Every limit in one place; tests tie their boundaries to it. */
export const LIMITS = {
  minutesPerDay: 1440,
  /** A shift may end on the next day: end minute at most this. */
  maxEndMin: 2879,
  maxBreaksPerDay: 20,
  maxBreakLengthMinutes: 720,
  maxNoteChars: 200,
  maxLabelChars: 100,
  retentionMonthsMin: 1,
  retentionMonthsMax: 120,
  maxDays: 4000,
  maxBackupChars: 12_000_000,
  /** The chain may not grow past this; compaction (after purging) frees room, nothing is dropped silently. */
  maxStamps: 6000,
  /** From this length on, purging also shortens the chain (only what is gone and covered). */
  stampsCompactAt: 4500,
  maxAnchors: 400,
  maxAnchorTokenChars: 16_384,
  maxTsaIdChars: 100,
  maxRelayChars: 200,
  /** The head of the chain should be covered by an anchor no older than this. */
  anchorMaxAgeHours: 24,
  /** How far a token's time may differ from the device clock before the token is refused. */
  anchorSkewMinutes: 15,
  maxChanges: 2000,
  maxReasonChars: 200,
} as const;

export const DEFAULT_SETTINGS: Settings = {
  employeeLabel: '',
  retentionMonths: 24,
  timestampRelay: '',
};

export function emptyBook(): TimeBook {
  return {
    format: BOOK_FORMAT,
    version: BOOK_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    days: {},
    exportedMonths: {},
    changes: [],
    stamps: [],
    stampBase: null,
    anchors: [],
  };
}

/** Error codes (never sentences: the UI owns the words). */
export type Reason =
  | 'bad-date'
  | 'bad-month'
  | 'bad-minute'
  | 'end-before-start'
  | 'too-long'
  | 'bad-break'
  | 'too-many-breaks'
  | 'break-overlap'
  | 'break-outside'
  | 'breaks-too-long'
  | 'open-break-on-closed-day'
  | 'bad-note'
  | 'bad-label'
  | 'bad-reason'
  | 'chain-broken'
  | 'too-many-stamps'
  | 'bad-anchor'
  | 'anchor-skew'
  | 'too-many-anchors'
  | 'bad-relay'
  | 'wrong-password'
  | 'password-required'
  | 'weak-password'
  | 'passwords-differ'
  | 'too-many-changes'
  | 'bad-retention'
  | 'bad-origin'
  | 'already-running'
  | 'not-running'
  | 'break-running'
  | 'no-break-running'
  | 'day-exists'
  | 'clock-before-end'
  | 'no-such-day'
  | 'second-open-day'
  | 'too-many-days'
  | 'bad-backup'
  | 'unknown-version';

export type Result<T> = { ok: true; value: T } | { ok: false; reason: Reason };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (reason: Reason): { ok: false; reason: Reason } => ({ ok: false, reason });
