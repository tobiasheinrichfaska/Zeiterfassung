import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Vault } from 'local-vault';
import {
  clockFromDate,
  daysToAppend,
  runningPdfMonths,
  type MonthKey,
  type PdfAssets,
  type RunningPdfInfo,
} from '../logic/index.ts';
import { readRunningInfo, updateRunningPdfs } from '../io/runningPdfWork.ts';
import { deleteRunningPdf, readRunningPdf } from '../io/runningPdfStore.ts';
import { useAnchoring } from './anchorContext.ts';
import { useBookApi } from './bookContext.ts';
import { pdfAssets } from './pdfAssets.ts';
import { RunningPdfContext, type RunningPdfApi } from './runningPdfContext.ts';
import { useLatest } from './useLatest.ts';

/** While a state is unstamped, it is tried again this often (the same rhythm as the chain's anchors). */
const RETRY_EVERY_MS = 15 * 60_000;

let fonts: PdfAssets | undefined;
const assets = (): PdfAssets => (fonts ??= pdfAssets());

/**
 * Keeps the running monthly PDFs (previous and current month) up to date: at the start, after every
 * change of the book that ends a day („Gehen“, or a day entered in the form), when the time stamp service
 * becomes available, and every 15 minutes while a state is unstamped. Runs one after the other, never two
 * at once. A failure is kept with the month and shown on the month page; an appended day stays saved.
 */
export function RunningPdfProvider({ vault, children }: { vault: Vault; children: ReactNode }) {
  const { book, getBook, showError } = useBookApi();
  const { service } = useAnchoring();
  const [months, setMonths] = useState<Record<MonthKey, RunningPdfInfo>>({});
  const [busy, setBusy] = useState(false);
  const known = useLatest<Record<MonthKey, RunningPdfInfo>>({});
  const latestService = useLatest(service);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef(false);

  const take = useCallback(
    (infos: readonly RunningPdfInfo[], gone: readonly MonthKey[] = []) => {
      const next = Object.fromEntries(
        Object.entries(known.get()).filter(([month]) => !gone.includes(month)),
      );
      for (const info of infos) next[info.month] = info;
      known.set(next);
      setMonths(next);
    },
    [known],
  );

  const refresh = useCallback(() => {
    if (queued.current) return; // the run waiting already reads the newest book when it starts
    queued.current = true;
    queue.current = queue.current.then(async () => {
      queued.current = false;
      setBusy(true);
      try {
        take(
          await updateRunningPdfs(getBook(), {
            vault,
            assets,
            service: latestService.get(),
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
  }, [getBook, vault, latestService, take, showError]);

  // at the start and whenever the service changes (set up, or another relay chosen)
  useEffect(() => {
    latestService.set(service);
    refresh();
  }, [service, latestService, refresh]);

  // a day that ended (or was entered) and is not in the file yet
  useEffect(() => {
    const today = clockFromDate(new Date()).date;
    const seen = known.get();
    const due = runningPdfMonths(book, today, (m) => m in seen).some(
      (m) => daysToAppend(book, m, seen[m]?.days ?? [], today).length > 0,
    );
    if (due) refresh();
  }, [book, known, refresh]);

  useEffect(() => {
    const id = setInterval(() => {
      const today = clockFromDate(new Date()).date;
      const seen = known.get();
      const unstamped = runningPdfMonths(getBook(), today, (m) => m in seen).some(
        (m) => seen[m] !== undefined && !seen[m].newestStamped && seen[m].days.length > 0,
      );
      if (unstamped) refresh();
    }, RETRY_EVERY_MS);
    return () => clearInterval(id);
  }, [known, refresh, getBook]);

  const api = useMemo<RunningPdfApi>(
    () => ({
      months,
      busy,
      refresh,
      file: (month) => {
        const read = readRunningPdf(vault, month);
        return read.kind === 'pdf' ? read.pdf : undefined;
      },
      forget: (gone) => {
        for (const month of gone) {
          const refused = deleteRunningPdf(vault, month);
          if (refused !== undefined) return refused;
        }
        take([], gone);
        return undefined;
      },
      look: (month) => {
        if (month in known.get()) return;
        void readRunningInfo(vault, month).then((info) => {
          if (info && !(month in known.get())) take([info]);
        });
      },
    }),
    [months, busy, refresh, vault, take, known],
  );
  return <RunningPdfContext.Provider value={api}>{children}</RunningPdfContext.Provider>;
}
