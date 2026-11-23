import { createContext, useContext } from 'react';
import type { DateKey, DayFormFields, Drafts } from '../logic/index.ts';

export interface DraftApi {
  drafts: Drafts;
  setTagDraft(value: DayFormFields | undefined): void;
  setMonthDraft(value: { date: DateKey; fields: DayFormFields } | undefined): void;
}

export const DraftContext = createContext<DraftApi | undefined>(undefined);

export function useDrafts(): DraftApi {
  const api = useContext(DraftContext);
  if (!api) throw new Error('useDrafts outside of DraftProvider');
  return api;
}
