import type { Vault } from 'local-vault';
import { appendDocTimeStamp, findDocTimeStamps, type Stamper } from 'pdf-fortschreiben';
import {
  ANCHOR_FAILURE_TEXTS,
  RUNNING_PDF_TEXTS,
  RUNNING_STAMP_RESERVES,
  appendRunningDay,
  clockFromDate,
  daysToAppend,
  reasonText,
  runningPdfMonths,
  runningPdfState,
  startRunningPdf,
  type MonthKey,
  type PdfAssets,
  type RunningPdfInfo,
  type TimeBook,
} from '../logic/index.ts';
import type { AnchorService } from './anchorService.ts';
import { readRunningPdf, writeRunningPdf } from './runningPdfStore.ts';
import { tokenTime } from './zeitstempel.ts';

/**
 * Brings the running monthly PDFs up to date: for the previous and the current month, the file is made
 * when it is missing, every ended day not yet in it is appended in date order (saved after each day),
 * and then the newest state gets one document time stamp. A failed stamp leaves the unstamped state
 * saved; an appended day is never lost. Everything outside (vault, fonts, service, clock) is passed in.
 */
export interface RunningPdfDeps {
  vault: Pick<Vault, 'readSlot' | 'writeSlot'>;
  assets: () => PdfAssets;
  /** The time stamp service; undefined when none is set up in this build. */
  service: AnchorService | undefined;
  now: () => Date;
}

class StampFailure extends Error {}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** A `pdf-fortschreiben` stamper over the app's service: digest → verified token bytes. */
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
    return outcome.value.token;
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
  pdf: Uint8Array,
  problem: string | null,
): Promise<RunningPdfInfo> {
  const state = await runningPdfState(pdf);
  if (!state.ok) {
    return {
      month,
      days: [],
      timeStamps: 0,
      newestStamped: false,
      lastStampAt: null,
      changedAttachments: [],
      problem: problem ?? reasonText(state.reason),
    };
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
    days: state.value.days,
    timeStamps: state.value.timeStamps,
    newestStamped: state.value.newestStamped,
    lastStampAt,
    changedAttachments: state.value.attachmentChanges.map((c) => c.name),
    problem,
  };
}

/** Reads a month's stored file and describes it (undefined: there is none). */
export async function readRunningInfo(
  vault: Pick<Vault, 'readSlot'>,
  month: MonthKey,
): Promise<RunningPdfInfo | undefined> {
  const read = readRunningPdf(vault, month);
  if (read.kind === 'none') return undefined;
  if (read.kind === 'pdf') return describeRunningPdf(month, read.pdf, null);
  return {
    month,
    days: [],
    timeStamps: 0,
    newestStamped: false,
    lastStampAt: null,
    changedAttachments: [],
    problem: `${RUNNING_PDF_TEXTS.unreadable}${read.kind === 'error' ? ` (${read.text})` : ''}`,
  };
}

/** Brings one month's file up to date; undefined when the month has no file and nothing to append. */
export async function updateRunningMonth(
  book: TimeBook,
  month: MonthKey,
  deps: RunningPdfDeps,
): Promise<RunningPdfInfo | undefined> {
  const read = readRunningPdf(deps.vault, month);
  if (read.kind === 'unreadable' || read.kind === 'error') {
    return readRunningInfo(deps.vault, month);
  }
  const today = clockFromDate(deps.now()).date;
  let pdf: Uint8Array | undefined = read.kind === 'pdf' ? read.pdf : undefined;
  let inPdf: string[] = [];
  if (pdf) {
    const state = await runningPdfState(pdf);
    if (!state.ok) return describeRunningPdf(month, pdf, RUNNING_PDF_TEXTS.unreadable);
    inPdf = state.value.days;
  }
  const due = daysToAppend(book, month, inPdf, today);
  if (!pdf && due.length === 0) return undefined;

  const problems: string[] = [];
  const failed = (text: string): RunningPdfInfo => ({
    month,
    days: [],
    timeStamps: 0,
    newestStamped: false,
    lastStampAt: null,
    changedAttachments: [],
    problem: text,
  });
  if (!pdf) {
    const started = await startRunningPdf(book, month, deps.assets(), {
      createdIso: deps.now().toISOString(),
    });
    if (!started.ok) return failed(`${RUNNING_PDF_TEXTS.failed}: ${reasonText(started.reason)}`);
    const refused = writeRunningPdf(deps.vault, month, started.value);
    if (refused !== undefined) return failed(`${RUNNING_PDF_TEXTS.failed}: ${refused}`);
    pdf = started.value;
  }
  // each day is saved before the next one is drawn: a later failure keeps the days before it
  for (const date of due) {
    const next = await appendRunningDay(pdf, book, date, deps.assets(), deps.now().toISOString());
    if (!next.ok) {
      problems.push(`${RUNNING_PDF_TEXTS.failed} (${date}): ${reasonText(next.reason)}`);
      break;
    }
    const refused = writeRunningPdf(deps.vault, month, next.value);
    if (refused !== undefined) {
      problems.push(`${RUNNING_PDF_TEXTS.failed} (${date}): ${refused}`);
      break;
    }
    pdf = next.value;
  }
  // one document time stamp over the newest state (also one left unstamped by an earlier run)
  const state = await runningPdfState(pdf);
  if (state.ok && !state.value.newestStamped) {
    if (!deps.service) problems.push(RUNNING_PDF_TEXTS.noRelay);
    else {
      const stamped = await stampRunningPdf(pdf, deps.service);
      if (!stamped.ok) problems.push(stamped.text);
      else {
        const refused = writeRunningPdf(deps.vault, month, stamped.pdf);
        if (refused !== undefined) problems.push(`${RUNNING_PDF_TEXTS.stampFailed}: ${refused}`);
        else pdf = stamped.pdf;
      }
    }
  }
  return describeRunningPdf(month, pdf, problems.length > 0 ? problems.join(' ') : null);
}

/** Brings every month the app looks after up to date (one after the other). */
export async function updateRunningPdfs(
  book: TimeBook,
  deps: RunningPdfDeps,
): Promise<RunningPdfInfo[]> {
  const today = clockFromDate(deps.now()).date;
  const months = runningPdfMonths(
    book,
    today,
    (m) => readRunningPdf(deps.vault, m).kind !== 'none',
  );
  const out: RunningPdfInfo[] = [];
  for (const month of months) {
    const info = await updateRunningMonth(book, month, deps);
    if (info) out.push(info);
  }
  return out;
}
