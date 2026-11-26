import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Vault } from 'local-vault';
import {
  clockFromDate,
  daysToAppend,
  type MonthKey,
  type PdfAssets,
  type PdfSlotPlan,
  type RunningPdfInfo,
} from '../logic/index.ts';
import {
  forgetPdfs,
  pdfInSlot,
  releasePdf,
  updateRunningPdfs,
  type RunningPdfRun,
} from '../io/runningPdfWork.ts';
import { useAnchoring } from './anchorContext.ts';
import { useBookApi } from './bookContext.ts';
import { pdfAssets } from './pdfAssets.ts';
import { RunningPdfContext, type RunningPdfApi } from './runningPdfContext.ts';
import { SavePrompt } from './SavePrompt.tsx';
import { useLatest } from './useLatest.ts';

/** While a state is unstamped, it is tried again this often (the same rhythm as the chain's anchors). */
const RETRY_EVERY_MS = 15 * 60_000;
/** The plan depends on the date (the 8th of a month): it is looked at again this often. */
const PLAN_EVERY_MS = 60 * 60_000;

let fonts: PdfAssets | undefined;
const assets = (): PdfAssets => (fonts ??= pdfAssets());

/**
 * Keeps the running monthly PDFs (in two slots: current month and, for at most a week, previous month)
 * up to date: at the start (moving files of the earlier build once), after every change of the book that
 * ends a day, when the time stamp service becomes available, every 15 minutes while a state is unstamped
 * and every hour (the date may have changed). Runs one after the other, never two at once. Shows the
 * save prompt (forced from the 8th, a reminder before) above the pages.
 */
export function RunningPdfProvider({ vault, children }: { vault: Vault; children: ReactNode }) {
  const { book, getBook, showError } = useBookApi();
  const { service, needsKey } = useAnchoring();
  const [run, setRun] = useState<RunningPdfRun | undefined>();
  const [busy, setBusy] = useState(false);
  const known = useLatest<RunningPdfRun | undefined>(undefined);
  const latestService = useLatest(service);
  const latestNeedsKey = useLatest(needsKey);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef(false);

  const take = useCallback(
    (next: RunningPdfRun) => {
      known.set(next);
      setRun(next);
      if (next.problems.length > 0) showError(next.problems.join(' '));
    },
    [known, showError],
  );

  /** Runs `work` after the run going on (one at a time). */
  const enqueue = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const done = queue.current.then(work);
    queue.current = done.then(
      () => undefined,
      () => undefined,
    );
    return done;
  }, []);

  const refresh = useCallback(() => {
    if (queued.current) return; // the run waiting already reads the newest book when it starts
    queued.current = true;
    void enqueue(async () => {
      queued.current = false;
      setBusy(true);
      try {
        take(
          await updateRunningPdfs(getBook(), {
            vault,
            assets,
            service: latestService.get(),
            needsKey: latestNeedsKey.get(),
            now: () => new Date(),
          }),
        );
      } catch (error) {
        showError(
          `Die laufende Monatsdatei konnte nicht fortgeschrieben werden: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        setBusy(false);
      }
    });
  }, [enqueue, getBook, vault, latestService, latestNeedsKey, take, showError]);

  // at the start and whenever the service changes (set up, or another relay chosen)
  useEffect(() => {
    latestService.set(service);
    latestNeedsKey.set(needsKey);
    refresh();
  }, [service, needsKey, latestService, latestNeedsKey, refresh]);

  // a day that ended (or was entered) and is not in its file yet
  useEffect(() => {
    const last = known.get();
    if (!last) return;
    const today = clockFromDate(new Date()).date;
    const due = [last.plan.previous, last.plan.current].some((use) => {
      if (!use) return false;
      const info = last.infos.find((i) => i.month === use.month);
      return daysToAppend(book, use.month, info?.days ?? [], today).length > 0;
    });
    if (due) refresh();
  }, [book, known, refresh]);

  useEffect(() => {
    const id = setInterval(() => {
      const last = known.get();
      if (last?.infos.some((i) => !i.newestStamped && i.days.length > 0 && !i.tooLarge)) refresh();
    }, RETRY_EVERY_MS);
    const hourly = setInterval(refresh, PLAN_EVERY_MS);
    return () => {
      clearInterval(id);
      clearInterval(hourly);
    };
  }, [known, refresh]);

  const months = useMemo(
    () =>
      Object.fromEntries((run?.infos ?? []).map((i) => [i.month, i])) as Record<
        MonthKey,
        RunningPdfInfo
      >,
    [run],
  );
  const plan: PdfSlotPlan | undefined = run?.plan;

  const api = useMemo<RunningPdfApi>(
    () => ({
      months,
      plan,
      saved: run?.saved ?? [],
      busy,
      refresh,
      file: (slot) => pdfInSlot(vault, slot),
      release: async (slot, month, savedLength) => {
        const refused = await enqueue(() =>
          releasePdf(vault, slot, month, savedLength, new Date().toISOString()),
        );
        refresh();
        return refused;
      },
      forget: async (gone) => {
        const refused = await enqueue(() => forgetPdfs(vault, gone));
        refresh();
        return refused;
      },
    }),
    [months, plan, run, busy, refresh, vault, enqueue],
  );
  return (
    <RunningPdfContext.Provider value={api}>
      {children}
      <SavePrompt />
    </RunningPdfContext.Provider>
  );
}
