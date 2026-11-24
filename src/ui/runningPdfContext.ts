import { createContext, useContext } from 'react';
import type { MonthKey, PdfSlotPlan, RunningPdfInfo } from '../logic/index.ts';

export interface RunningPdfApi {
  /** How each running PDF in the vault stands (by month). */
  months: Readonly<Record<MonthKey, RunningPdfInfo>>;
  /** The slot plan of the last run (undefined before the first run ended). */
  plan: PdfSlotPlan | undefined;
  /** Months whose file the employee saved and removed from the vault (marker time). */
  saved: readonly { month: MonthKey; at: string }[];
  /** A run is going on (appending or stamping). */
  busy: boolean;
  /** Starts a run now (after the one going on). */
  refresh(): void;
  /** The stored file of a slot, or undefined. */
  file(slot: string): Uint8Array | undefined;
  /**
   * The employee saved the file (`savedLength` bytes) and confirmed it: it leaves the vault (after the
   * run going on). Returns a refusal text or undefined.
   */
  release(slot: string, month: MonthKey, savedLength: number): Promise<string | undefined>;
  /** Removes the files of purged months (only the purge calls this); returns a refusal text or undefined. */
  forget(months: readonly MonthKey[]): Promise<string | undefined>;
}

export const RunningPdfContext = createContext<RunningPdfApi | undefined>(undefined);

export function useRunningPdf(): RunningPdfApi {
  const api = useContext(RunningPdfContext);
  if (!api) throw new Error('useRunningPdf outside of RunningPdfProvider');
  return api;
}
