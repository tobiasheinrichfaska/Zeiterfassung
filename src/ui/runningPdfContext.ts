import { createContext, useContext } from 'react';
import type { MonthKey, RunningPdfInfo } from '../logic/index.ts';

export interface RunningPdfApi {
  /** How each month's running PDF stands, as far as the app has looked (by month). */
  months: Readonly<Record<MonthKey, RunningPdfInfo>>;
  /** A run is going on (appending or stamping). */
  busy: boolean;
  /** Starts a run now (after the one going on). */
  refresh(): void;
  /** The stored file of a month, or undefined. */
  file(month: MonthKey): Uint8Array | undefined;
  /** Deletes the files of purged months (only the purge calls this); returns a refusal text or undefined. */
  forget(months: readonly MonthKey[]): string | undefined;
  /** Reads a month the app does not look after itself (an older month opened on the month page). */
  look(month: MonthKey): void;
}

export const RunningPdfContext = createContext<RunningPdfApi | undefined>(undefined);

export function useRunningPdf(): RunningPdfApi {
  const api = useContext(RunningPdfContext);
  if (!api) throw new Error('useRunningPdf outside of RunningPdfProvider');
  return api;
}
