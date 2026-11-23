import { parseRelayList } from '../logic/index.ts';

/**
 * The relay addresses this build may talk to (build variable `VITE_TIMESTAMP_RELAY`, set when the file
 * is built; the page's Content-Security-Policy allows exactly their origins). Empty = the build cannot
 * reach any service, whatever is typed into the settings.
 */
export const ALLOWED_RELAYS: readonly string[] = parseRelayList(
  import.meta.env.VITE_TIMESTAMP_RELAY as string | undefined,
);
