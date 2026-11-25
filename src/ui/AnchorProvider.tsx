import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addAnchor,
  anchorStatus,
  clockFromDate,
  reasonText,
  relayUsable,
  sealElapsedDays,
} from '../logic/index.ts';
import type { Vault } from 'local-vault';
import { createRelayService, requestAnchor } from '../io/anchorService.ts';
import {
  loadDeviceKey,
  removeDeviceKey as clearDeviceKey,
  storeDeviceKey,
  type DeviceKeyLoad,
} from '../io/deviceKey.ts';
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
 * only while the app is open and online. Failures are shown, never swallowed. The device key (vault slot
 * `geraeteschluessel`) unlocks the device for the authenticated relay; without it nothing is sent.
 */
export function AnchorProvider({ vault, children }: { vault: Vault; children: ReactNode }) {
  const { book, getBook, apply, showError } = useBookApi();
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [deviceKey, setDeviceKey] = useState<DeviceKeyLoad | { kind: 'loading' }>({
    kind: 'loading',
  });
  const relay = book.settings.timestampRelay;
  const relayAvailable = relayUsable(relay, ALLOWED_RELAYS);
  const key = deviceKey.kind === 'key' ? deviceKey.key : undefined;
  const service = useMemo(
    () =>
      relayAvailable && key
        ? createRelayService(relay, { auth: key, onClockOffset: setClockOffsetMs })
        : undefined,
    [relayAvailable, relay, key],
  );

  useEffect(() => {
    let live = true;
    void loadDeviceKey(vault).then((loaded) => {
      if (live) setDeviceKey(loaded);
    });
    return () => {
      live = false;
    };
  }, [vault]);

  const enterDeviceKey = useCallback(
    async (text: string) => {
      const stored = await storeDeviceKey(vault, text);
      if (!stored.ok) return stored.text;
      setDeviceKey({ kind: 'key', key: stored.key });
      return undefined;
    },
    [vault],
  );

  const removeDeviceKey = useCallback(() => {
    const refused = clearDeviceKey(vault);
    if (refused === undefined) setDeviceKey({ kind: 'none' });
    return refused;
  }, [vault]);

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
    serviceAvailable: service !== undefined,
    needsKey: relayAvailable && !key,
    deviceKeyId: key?.keyId ?? null,
    deviceKeyProblem: deviceKey.kind === 'unusable' ? deviceKey.text : null,
    enterDeviceKey,
    removeDeviceKey,
    service,
    clockOffsetMs,
    busy,
    anchorNow,
    sealNow,
  };
  // the pages wait for the stored device key (a moment): so the running PDF never reports „not unlocked“
  // for a device that is
  if (deviceKey.kind === 'loading') return null;
  return <AnchorContext.Provider value={api}>{children}</AnchorContext.Provider>;
}
