import { createContext, useContext } from 'react';
import type { AnchorStatus } from '../logic/index.ts';
import type { AnchorService } from '../io/anchorService.ts';

export interface AnchorApi {
  /** Where the chain stands against the external service (renewed every minute). */
  status: AnchorStatus;
  /** Whether this build can reach the service that is set up. */
  serviceAvailable: boolean;
  /** The service itself (one client for the whole app, so a 429 pause holds for every caller). */
  service: AnchorService | undefined;
  busy: boolean;
  /** Asks the service for a time stamp now; every failure is shown to the person. */
  anchorNow(): Promise<'anchor' | 'off' | 'nothing' | 'failed'>;
  /** Seals the days that have ended (also done every minute and at the start). */
  sealNow(): void;
}

export const AnchorContext = createContext<AnchorApi | undefined>(undefined);

export function useAnchoring(): AnchorApi {
  const api = useContext(AnchorContext);
  if (!api) throw new Error('useAnchoring outside of AnchorProvider');
  return api;
}
