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

/** What the relay's `RELAY_AUDIENCE` may be (`zeitstempel` docs/relay.md): printable ASCII, no blank, 1 to 128. */
const AUDIENCE = /^[\x21-\x7e]{1,128}$/;

/** Whether a text is a valid audience (the build variable `VITE_TIMESTAMP_AUDIENCE`). */
export const audienceOk = (value: unknown): value is string =>
  typeof value === 'string' && AUDIENCE.test(value);

/**
 * The audience the app signs for a relay: the build variable `VITE_TIMESTAMP_AUDIENCE` when it is set
 * (one value for every relay of the build), else the relay's origin — the relay's convention
 * („üblich die öffentliche Herkunft“, `RELAY_AUDIENCE`). An invalid value is refused by the build
 * (`vite.config.ts`); here it falls back to the origin.
 */
export function relayAudience(relay: string, configured: string | undefined): string {
  const value = (configured ?? '').trim();
  return audienceOk(value) ? value : relayOrigin(relay);
}
