import type { Vault } from 'local-vault';
import { appendDocTimeStamp, findDocTimeStamps, type Stamper } from 'pdf-fortschreiben';
import {
  ANCHOR_FAILURE_TEXTS,
  DEVICE_KEY_TEXTS,
  PDF_SLOTS,
  RUNNING_PDF_TEXTS,
  RUNNING_STAMP_RESERVES,
  appendRunningDay,
  clockFromDate,
  daysToAppend,
  encodeRunningPdf,
  evidenceToken,
  pdfSlotPlan,
  reasonText,
  roomToFree,
  runningPdfState,
  startRunningPdf,
  type MonthKey,
  type PdfAssets,
  type PdfSlot,
  type PdfSlotContent,
  type PdfSlotPlan,
  type PdfSlotUse,
  type RunningPdfInfo,
  type TimeBook,
} from '../logic/index.ts';
import type { AnchorService } from './anchorService.ts';
import {
  clearPdfSlot,
  markPdfSaved,
  readPdfSlot,
  refusalText,
  writePdfSlot,
  type RunningPdfRead,
} from './runningPdfStore.ts';
import { tokenTime } from './zeitstempel.ts';

/**
 * Brings the running monthly PDFs up to date: for the months the slot plan assigns (the current month and,
 * while it is in the vault, the previous one), the file is made when it is missing, every ended day not yet
 * in it is appended in date order (saved after each day), and then the newest state gets one document time
 * stamp. A failed stamp leaves the unstamped state saved; an appended day is never lost. A state that does
 * not fit into its slot is not written (the stored file must then be saved). Everything outside (vault,
 * fonts, service, clock) is passed in.
 */
export interface RunningPdfDeps {
  vault: Pick<Vault, 'readSlot' | 'writeSlot'> & Partial<Pick<Vault, 'saved' | 'onError'>>;
  assets: () => PdfAssets;
  /** The time stamp service; undefined when none is set up in this build or the device is not unlocked. */
  service: AnchorService | undefined;
  /** A relay is set up, but the device key is missing: say so instead of „no service“. */
  needsKey?: boolean;
  now: () => Date;
  /** Characters a slot may hold; `PDF_SLOT_LIMIT` unless a test sets it. */
  slotLimit?: number;
  /** Characters all slots together may hold when a PDF is written; `VAULT_BUDGET` unless a test sets it. */
  vaultBudget?: number;
}

class StampFailure extends Error {}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * A `pdf-fortschreiben` stamper over the app's service: digest → the token bytes of the verified evidence
 * (`kind: 'single'` only; a batch evidence is refused).
 */
export function stamperFor(service: AnchorService): Stamper {
  return async (digest) => {
    let outcome;
    try {
      outcome = await service.anchor(hex(digest));
    } catch (error) {
      throw new StampFailure(`${ANCHOR_FAILURE_TEXTS.unreachable} (${message(error)})`);
    }
    if (!outcome.ok) {
      throw new StampFailure(`${ANCHOR_FAILURE_TEXTS[outcome.reason]} (${outcome.detail})`);
    }
    // a PAdES document time stamp needs a token over exactly this digest: a collected (batch) one is not
    const { evidence } = outcome.value;
    const token = evidence.kind === 'single' ? evidenceToken(evidence) : null;
    if (!token) {
      throw new StampFailure(
        `${ANCHOR_FAILURE_TEXTS['bad-response']} (${RUNNING_PDF_TEXTS.notSingle})`,
      );
    }
    return token;
  };
}

/**
 * One document time stamp over the file: first with 8192 bytes reserved, once more with 16384 when the
 * token did not fit. Returns the stamped file or the German reason.
 */
export async function stampRunningPdf(
  pdf: Uint8Array,
  service: AnchorService,
): Promise<{ ok: true; pdf: Uint8Array } | { ok: false; text: string }> {
  const stamper = stamperFor(service);
  for (const [i, reserve] of RUNNING_STAMP_RESERVES.entries()) {
    try {
      return { ok: true, pdf: await appendDocTimeStamp(pdf, stamper, { reserve }) };
    } catch (error) {
      if (error instanceof StampFailure) {
        return { ok: false, text: `${RUNNING_PDF_TEXTS.stampFailed}: ${error.message}` };
      }
      if (error instanceof RangeError && /exceeds reserve/.test(error.message)) {
        if (i < RUNNING_STAMP_RESERVES.length - 1) continue;
        return {
          ok: false,
          text: `${RUNNING_PDF_TEXTS.stampFailed}: ${RUNNING_PDF_TEXTS.tokenTooLarge}`,
        };
      }
      return { ok: false, text: `${RUNNING_PDF_TEXTS.stampFailed}: ${message(error)}` };
    }
  }
  return { ok: false, text: RUNNING_PDF_TEXTS.stampFailed };
}

/** What a stored file holds, for the month page. */
export async function describeRunningPdf(
  month: MonthKey,
  slot: string,
  pdf: Uint8Array,
  problem: string | null,
  tooLarge = false,
): Promise<RunningPdfInfo> {
  const state = await runningPdfState(pdf);
  if (!state.ok) {
    return failedInfo(month, slot, problem ?? reasonText(state.reason));
  }
  let lastStampAt: string | null = null;
  try {
    const stamps = findDocTimeStamps(pdf);
    const newest = stamps.reduce<(typeof stamps)[number] | undefined>(
      (a, s) => (a === undefined || (s.revision ?? -1) > (a.revision ?? -1) ? s : a),
      undefined,
    );
    if (newest) lastStampAt = tokenTime(newest.token);
  } catch {
    lastStampAt = null;
  }
  return {
    month,
    slot,
    tooLarge,
    days: state.value.days,
    timeStamps: state.value.timeStamps,
    newestStamped: state.value.newestStamped,
    lastStampAt,
    changedAttachments: state.value.attachmentChanges.map((c) => c.name),
    problem,
  };
}

const failedInfo = (month: MonthKey, slot: string, problem: string): RunningPdfInfo => ({
  month,
  slot,
  tooLarge: false,
  days: [],
  timeStamps: 0,
  newestStamped: false,
  lastStampAt: null,
  changedAttachments: [],
  problem,
});

/** One slot as read: the raw read and what the plan needs (the month of a file comes from the file). */
interface SlotRead {
  read: RunningPdfRead;
  content: PdfSlotContent;
}

async function readSlot(vault: RunningPdfDeps['vault'], slot: string): Promise<SlotRead> {
  const read = readPdfSlot(vault, slot);
  if (read.kind === 'none') return { read, content: { kind: 'empty' } };
  if (read.kind === 'saved') return { read, content: { kind: 'saved', month: read.month } };
  if (read.kind !== 'pdf') return { read, content: { kind: 'unreadable' } };
  const state = await runningPdfState(read.pdf);
  // a PDF that is not a running PDF of this app is never overwritten: it counts as unreadable
  if (!state.ok) return { read, content: { kind: 'unreadable' } };
  return { read, content: { kind: 'pdf', month: state.value.month } };
}

async function readSlots(vault: RunningPdfDeps['vault']): Promise<Record<PdfSlot, SlotRead>> {
  const out = {} as Record<PdfSlot, SlotRead>;
  for (const slot of PDF_SLOTS) out[slot] = await readSlot(vault, slot);
  return out;
}

const contents = (slots: Record<PdfSlot, SlotRead>): Record<PdfSlot, PdfSlotContent> =>
  Object.fromEntries(PDF_SLOTS.map((s) => [s, slots[s].content])) as Record<
    PdfSlot,
    PdfSlotContent
  >;

/**
 * Brings one month's file in its slot up to date; undefined when it has no file and nothing to append.
 * `tooLarge` in the answer: a new state did not fit and was not written.
 */
export async function updateRunningMonth(
  book: TimeBook,
  use: PdfSlotUse,
  deps: RunningPdfDeps,
): Promise<RunningPdfInfo | undefined> {
  const { month, slot } = use;
  const found = await readSlot(deps.vault, slot);
  const read = found.read;
  if (found.content.kind === 'unreadable') {
    return failedInfo(
      month,
      slot,
      `${RUNNING_PDF_TEXTS.unreadable}${read.kind === 'error' ? ` (${read.text})` : ''}`,
    );
  }
  // the slot changed since the plan (another month in it now): nothing is touched
  if (found.content.kind === 'pdf' && found.content.month !== month) return undefined;
  const today = clockFromDate(deps.now()).date;
  let pdf: Uint8Array | undefined = read.kind === 'pdf' ? read.pdf : undefined;
  let inPdf: string[] = [];
  if (pdf) {
    const state = await runningPdfState(pdf);
    if (!state.ok) return describeRunningPdf(month, slot, pdf, RUNNING_PDF_TEXTS.unreadable);
    inPdf = state.value.days;
  }
  const due = daysToAppend(book, month, inPdf, today);
  if (!pdf && due.length === 0) return undefined;

  const problems: string[] = [];
  let tooLarge = false;
  let lacking: number | undefined;
  const write = (next: Uint8Array): string | undefined => {
    const refused = writePdfSlot(deps.vault, slot, next, deps.slotLimit, deps.vaultBudget);
    if (refused === undefined) return undefined;
    if (typeof refused !== 'string') {
      tooLarge = true;
      lacking = refused.lacking;
    }
    return refusalText(refused);
  };
  if (!pdf) {
    const started = await startRunningPdf(book, month, deps.assets(), {
      createdIso: deps.now().toISOString(),
    });
    if (!started.ok) {
      return failedInfo(month, slot, `${RUNNING_PDF_TEXTS.failed}: ${reasonText(started.reason)}`);
    }
    const refused = write(started.value);
    if (refused !== undefined) {
      const info = {
        ...failedInfo(month, slot, `${RUNNING_PDF_TEXTS.failed}: ${refused}`),
        tooLarge,
      };
      return lacking === undefined ? info : { ...info, lacking };
    }
    pdf = started.value;
  }
  // each day is saved before the next one is drawn: a later failure keeps the days before it
  for (const date of due) {
    const next = await appendRunningDay(pdf, book, date, deps.assets(), deps.now().toISOString());
    if (!next.ok) {
      problems.push(`${RUNNING_PDF_TEXTS.failed} (${date}): ${reasonText(next.reason)}`);
      break;
    }
    const refused = write(next.value);
    if (refused !== undefined) {
      problems.push(tooLarge ? refused : `${RUNNING_PDF_TEXTS.failed} (${date}): ${refused}`);
      break;
    }
    pdf = next.value;
  }
  // one document time stamp over the newest state (also one left unstamped by an earlier run)
  const state = await runningPdfState(pdf);
  if (state.ok && !state.value.newestStamped && !tooLarge) {
    if (!deps.service) {
      problems.push(
        deps.needsKey
          ? `${RUNNING_PDF_TEXTS.stampFailed}: ${DEVICE_KEY_TEXTS.missing}`
          : RUNNING_PDF_TEXTS.noRelay,
      );
    } else {
      const stamped = await stampRunningPdf(pdf, deps.service);
      if (!stamped.ok) problems.push(stamped.text);
      else {
        const refused = write(stamped.pdf);
        if (refused !== undefined) {
          problems.push(tooLarge ? refused : `${RUNNING_PDF_TEXTS.stampFailed}: ${refused}`);
        } else pdf = stamped.pdf;
      }
    }
  }
  const info = await describeRunningPdf(
    month,
    slot,
    pdf,
    problems.length > 0 ? problems.join(' ') : null,
    tooLarge,
  );
  return lacking === undefined ? info : { ...info, lacking };
}

/** The result of one run: how each file stands, the slot plan and what was saved out. */
export interface RunningPdfRun {
  /** Every file in the two slots, described. */
  infos: RunningPdfInfo[];
  /** The plan after the run. */
  plan: PdfSlotPlan;
  /** Months whose file was saved out (their markers), with the time of the confirmation. */
  saved: { month: MonthKey; at: string }[];
}

/**
 * One run: plan the slots; bring the previous and
 * the current month up to date; describe every file; plan again with the slots that did not fit.
 */
export async function updateRunningPdfs(
  book: TimeBook,
  deps: RunningPdfDeps,
): Promise<RunningPdfRun> {
  const today = clockFromDate(deps.now()).date;
  const first = pdfSlotPlan(today, contents(await readSlots(deps.vault)));
  const updated = new Map<string, RunningPdfInfo>();
  for (const use of [first.previous, first.current]) {
    if (!use) continue;
    const info = await updateRunningMonth(book, use, deps);
    if (info) updated.set(use.slot, info);
  }
  const slots = await readSlots(deps.vault);
  // a state over the vault's budget: first the previous month's file must go, when that makes the room
  // (`roomToFree`); the file being written is marked too large only when it does not
  const tooLarge: PdfSlot[] = [];
  const room: PdfSlot[] = [];
  const prev = first.previous;
  for (const [slot, info] of updated) {
    if (!info.tooLarge) continue;
    const prevRead = prev ? slots[prev.slot].read : undefined;
    const previous =
      prev && prevRead?.kind === 'pdf'
        ? { slot: prev.slot, chars: encodeRunningPdf(prevRead.pdf).length }
        : null;
    const free =
      info.lacking === undefined
        ? { slot: slot as PdfSlot, why: 'too-large' as const }
        : roomToFree(slot as PdfSlot, info.lacking, previous);
    if (free.why === 'too-large') tooLarge.push(free.slot);
    else {
      room.push(free.slot);
      // this file goes on once the other is saved: not „too large“ (it is stamped and retried as usual)
      updated.set(slot, {
        ...info,
        tooLarge: false,
        problem: RUNNING_PDF_TEXTS.waitsForRoom(prev?.month ?? ''),
      });
    }
  }
  const plan = pdfSlotPlan(today, contents(slots), tooLarge, room);
  const infos: RunningPdfInfo[] = [];
  const saved: RunningPdfRun['saved'] = [];
  for (const slot of PDF_SLOTS) {
    const { read, content } = slots[slot];
    const done = updated.get(slot);
    if (done && (content.kind !== 'pdf' || content.month === done.month)) infos.push(done);
    else if (read.kind === 'pdf' && content.kind === 'pdf')
      infos.push(await describeRunningPdf(content.month, slot, read.pdf, null));
    else if (read.kind === 'saved') saved.push({ month: read.month, at: read.at });
    else if (content.kind === 'unreadable' && done) infos.push(done);
  }
  return { infos, plan, saved };
}

/**
 * After the employee saved a file and confirmed it: its slot keeps only the month's marker. Only when the slot still holds exactly the state that was saved
 * (`savedLength`: the file only grows, so another length is another state); otherwise nothing is changed.
 * Returns a refusal text, or undefined.
 */
export async function releasePdf(
  vault: RunningPdfDeps['vault'],
  slot: string,
  month: MonthKey,
  savedLength: number,
  atIso: string,
): Promise<string | undefined> {
  const found = await readSlot(vault, slot);
  if (
    found.read.kind !== 'pdf' ||
    found.content.kind !== 'pdf' ||
    found.content.month !== month ||
    found.read.pdf.length !== savedLength
  ) {
    return RUNNING_PDF_TEXTS.releaseChanged;
  }
  return (PDF_SLOTS as readonly string[]).includes(slot)
    ? markPdfSaved(vault, slot, month, atIso)
    : RUNNING_PDF_TEXTS.releaseChanged;
}

/** The stored file of a slot, or undefined. */
export function pdfInSlot(vault: RunningPdfDeps['vault'], slot: string): Uint8Array | undefined {
  const read = readPdfSlot(vault, slot);
  return read.kind === 'pdf' ? read.pdf : undefined;
}

/** Empties the slots that hold files (or markers) of purged months; returns a refusal text or undefined. */
export async function forgetPdfs(
  vault: RunningPdfDeps['vault'],
  months: readonly MonthKey[],
): Promise<string | undefined> {
  for (const slot of PDF_SLOTS) {
    const found = await readSlot(vault, slot);
    const c = found.content;
    if ((c.kind === 'pdf' || c.kind === 'saved') && months.includes(c.month)) {
      const refused = clearPdfSlot(vault, slot);
      if (refused !== undefined) return refused;
    }
  }
  return undefined;
}

/**
 * Purging months together with their running PDFs, in the order that cannot leave them out of step: the
 * files go first; only when that worked are the months purged from the book (`purge`, which shows its own
 * refusal). A refused `forget` leaves the book untouched (the months stay purgeable, so it can be tried
 * again). `ok: false` without a text: the book write was refused and already shown.
 */
export async function purgeWithPdfs(
  months: readonly MonthKey[],
  steps: {
    forget: (months: readonly MonthKey[]) => Promise<string | undefined>;
    purge: () => boolean;
  },
): Promise<{ ok: true } | { ok: false; text?: string }> {
  const refused = await steps.forget(months);
  if (refused !== undefined) {
    return {
      ok: false,
      text: `${refused} Es wurde nichts gelöscht; bitte erneut versuchen.`,
    };
  }
  return steps.purge() ? { ok: true } : { ok: false };
}
