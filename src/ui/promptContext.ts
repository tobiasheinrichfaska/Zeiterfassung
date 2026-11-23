import { createContext, useContext } from 'react';

/** Asks for the reason of a change to a day that is over; null = the person cancelled. */
export type AskReason = (notice: string) => Promise<{ reason: string } | null>;

export const PromptContext = createContext<AskReason | undefined>(undefined);

export function useAskReason(): AskReason {
  const ask = useContext(PromptContext);
  if (!ask) throw new Error('useAskReason outside of PromptProvider');
  return ask;
}
