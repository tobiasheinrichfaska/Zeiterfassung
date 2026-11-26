import { createContext, useContext } from 'react';
import type { AnchorStatus } from '../logic/index.ts';
import type { AnchorService } from '../io/anchorService.ts';

export interface AnchorApi {
  /** Where the chain stands against the external service (renewed every minute). */
  status: AnchorStatus;
  /** Whether this build can reach the service that is set up and the device is unlocked (device key). */
  serviceAvailable: boolean;
  /** A relay is set up and usable in this build, but the device key is missing or unusable. */
  needsKey: boolean;
  /** The key id of the stored device key (the only part ever shown), or null. */
  deviceKeyId: string | null;
  /** Why a stored device key cannot be used, or null. */
  deviceKeyProblem: string | null;
  /** Checks, imports and stores a pasted device key; returns the German reason on failure. */
  enterDeviceKey(text: string): Promise<string | undefined>;
  /** Removes the device key from this device; returns the vault's refusal, or undefined. */
  removeDeviceKey(): Promise<string | undefined>;
  /** The service itself (one client for the whole app, so a 429 pause holds for every caller). */
  service: AnchorService | undefined;
  /** The relay's clock minus the device clock in ms, as last learned (0 = not known or in agreement). */
  clockOffsetMs: number;
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
