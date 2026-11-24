import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addAnchor,
  anchorStatus,
  clockFromDate,
  reasonText,
  relayUsable,
  sealElapsedDays,
} from '../logic/index.ts';
import { createRelayService, requestAnchor } from '../io/anchorService.ts';
import { AnchorContext, type AnchorApi } from './anchorContext.ts';
import { useBookApi } from './bookContext.ts';
import { ALLOWED_RELAYS } from './relayConfig.ts';

/** How often the app looks again while it is open (seals, status, and a new time stamp when one is due). */
const SEAL_EVERY_MS = 60_000;
const ANCHOR_EVERY_MS = 15 * 60_000;

/**
 * Keeps the stamp chain going: seals every day that has ended (at the start and every minute), and, when
 * an external service is set up, asks it for a time stamp at the start, every 15 minutes while the app is
 * open and on request. A web page cannot do this in the background: „at the latest every 24 hours“ holds
 * only while the app is open and online. Failures are shown, never swallowed.
 */
export function AnchorProvider({ children }: { children: ReactNode }) {
  const { book, getBook, apply, showError } = useBookApi();
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const relay = book.settings.timestampRelay;
  const serviceAvailable = relayUsable(relay, ALLOWED_RELAYS);
  const service = useMemo(
    () => (serviceAvailable ? createRelayService(relay) : undefined),
    [serviceAvailable, relay],
  );

  const sealNow = useCallback(() => {
    const now = new Date();
    const current = getBook();
    const sealed = sealElapsedDays(current, clockFromDate(now).date, now.toISOString());
    if (!sealed.ok) return void showError(reasonText(sealed.reason));
    if (sealed.value !== current) apply(sealed);
  }, [getBook, apply, showError]);

  const anchorNow = useCallback(async () => {
    if (running.current) return 'nothing' as const;
    running.current = true;
    setBusy(true);
    try {
      const round = await requestAnchor(getBook(), service);
      if (round.kind === 'failed') {
        showError(round.text);
        return 'failed' as const;
      }
      if (round.kind === 'anchor') {
        // the book may have changed while the service answered: add to the book as it is now
        return apply(addAnchor(getBook(), round.anchor, new Date().toISOString()))
          ? ('anchor' as const)
          : ('failed' as const);
      }
      return round.kind;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [getBook, apply, showError, service]);

  useEffect(() => {
    sealNow();
    const id = setInterval(() => {
      sealNow();
      setTick((t) => t + 1);
    }, SEAL_EVERY_MS);
    return () => clearInterval(id);
  }, [sealNow]);

  useEffect(() => {
    const due = () => {
      const status = anchorStatus(getBook(), new Date().toISOString());
      if (status.state !== 'off' && status.unanchored > 0) void anchorNow();
    };
    due();
    const id = setInterval(due, ANCHOR_EVERY_MS);
    return () => clearInterval(id);
  }, [anchorNow, getBook]);

  const api: AnchorApi = {
    status: anchorStatus(book, new Date().toISOString()),
    serviceAvailable,
    service,
    busy,
    anchorNow,
    sealNow,
  };
  return <AnchorContext.Provider value={api}>{children}</AnchorContext.Provider>;
}
