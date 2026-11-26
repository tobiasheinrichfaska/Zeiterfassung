import { parseRelayList, relayAudience } from '../logic/index.ts';

/**
 * The relay addresses this build may talk to (build variable `VITE_TIMESTAMP_RELAY`, set when the file
 * is built; the page's Content-Security-Policy allows exactly their origins). Empty = the build cannot
 * reach any service, whatever is typed into the settings.
 */
export const ALLOWED_RELAYS: readonly string[] = parseRelayList(
  import.meta.env.VITE_TIMESTAMP_RELAY as string | undefined,
);

/**
 * The audience signed for a relay of this build (build variable `VITE_TIMESTAMP_AUDIENCE`, the relay's
 * `RELAY_AUDIENCE`; one value for all relays of the build). Unset: the relay's origin.
 */
export const audienceFor = (relay: string): string =>
  relayAudience(relay, import.meta.env.VITE_TIMESTAMP_AUDIENCE as string | undefined);
