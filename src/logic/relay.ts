import { relayOk } from './validate.ts';

/**
 * The relay addresses a build allows: the build variable `VITE_TIMESTAMP_RELAY`, addresses separated by
 * commas. Only valid addresses count (https, or http for the own machine); anything else is dropped.
 */
export function parseRelayList(raw: string | undefined): string[] {
  const list = (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '' && relayOk(part));
  return [...new Set(list)];
}

/** The origin of an address (what the page's policy has to allow). */
export const relayOrigin = (url: string): string => new URL(url).origin;

/** Whether the saved setting may be used by this build: empty (off) or exactly one allowed address. */
export const relayUsable = (setting: string, allowed: readonly string[]): boolean =>
  setting !== '' && allowed.includes(setting);
