import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addAnchor,
  anchorRequest,
  anchorStatus,
  clockFromDate,
  reasonText,
  relayUsable,
  sealElapsedDays,
} from '../logic/index.ts';
import type { Vault } from 'local-vault';
import { createRelayService, requestAnchor } from '../io/anchorService.ts';
import { joinRound } from '../io/joinRound.ts';
import { savedPdfs } from '../io/runningPdfStore.ts';
import {
  loadDeviceKey,
  removeDeviceKey as clearDeviceKey,
  storeDeviceKey,
  type DeviceKeyLoad,
} from '../io/deviceKey.ts';
import { indexedDbKeyStore, type DeviceKeyStore } from '../io/keyStore.ts';
import { AnchorContext, type AnchorApi } from './anchorContext.ts';
import { useBookApi } from './bookContext.ts';
import { ALLOWED_RELAYS, audienceFor } from './relayConfig.ts';

/** How often the app looks again while it is open (seals, status, and a new time stamp when one is due). */
const SEAL_EVERY_MS = 60_000;

type AnchorRoundResult = Awaited<ReturnType<AnchorApi['anchorNow']>>;
const ANCHOR_EVERY_MS = 15 * 60_000;

/**
 * Keeps the stamp chain going: seals every day that has ended (at the start and every minute), and, when
 * an external service is set up, asks it for a time stamp at the start, every 15 minutes while the app is
 * open and on request. A web page cannot do this in the background: „at the latest every 24 hours“ holds
 * only while the app is open and online. Failures are shown, never swallowed. The device key (vault slot
 * `geraeteschluessel`) unlocks the device for the authenticated relay; without it nothing is sent.
 */
export function AnchorProvider({
  vault,
  keyStore,
  children,
}: {
  vault: Vault;
  /** Where the non-extractable device key is kept; IndexedDB unless given. */
  keyStore?: DeviceKeyStore;
  children: ReactNode;
}) {
  const [store] = useState<DeviceKeyStore>(() => keyStore ?? indexedDbKeyStore());
  const { book, getBook, apply, showError } = useBookApi();
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const running = useRef<Promise<AnchorRoundResult> | undefined>(undefined);
  // the offset belongs to the service that learned it: a new service (other relay or key) starts at 0
  const [clock, setClock] = useState<{ owner: object; ms: number } | null>(null);
  const [deviceKey, setDeviceKey] = useState<DeviceKeyLoad | { kind: 'loading' }>({
    kind: 'loading',
  });
  const relay = book.settings.timestampRelay;
  const relayAvailable = relayUsable(relay, ALLOWED_RELAYS);
  const key = deviceKey.kind === 'key' ? deviceKey.key : undefined;
  const made = useMemo(() => {
    const own = {};
    // aborted when this service is replaced (key removed or changed, other relay): a round still running
    // then signs nothing more with the old key
    const retire = new AbortController();
    return {
      owner: own,
      retire,
      service:
        relayAvailable && key
          ? createRelayService(relay, key, {
              audience: audienceFor(relay),
              onClockOffset: (ms: number) => setClock({ owner: own, ms }),
              signal: retire.signal,
            })
          : undefined,
    };
  }, [relayAvailable, relay, key]);
  const { service, owner } = made;
  const clockOffsetMs = clock?.owner === owner ? clock.ms : 0;
  const latestMade = useRef(made);
  useEffect(() => {
    // no cleanup on purpose: StrictMode's second run must not retire the service in use
    if (latestMade.current !== made) latestMade.current.retire.abort();
    latestMade.current = made;
  }, [made]);

  useEffect(() => {
    let live = true;
    void loadDeviceKey(vault, store).then((loaded) => {
      if (live) setDeviceKey(loaded);
    });
    return () => {
      live = false;
    };
  }, [vault, store]);

  const enterDeviceKey = useCallback(
    async (text: string) => {
      const stored = await storeDeviceKey(vault, store, text);
      if (!stored.ok) return stored.text;
      setDeviceKey({ kind: 'key', key: stored.key });
      return undefined;
    },
    [vault, store],
  );

  const removeDeviceKey = useCallback(async () => {
    const refused = await clearDeviceKey(vault, store);
    if (refused === undefined) setDeviceKey({ kind: 'none' });
    return refused;
  }, [vault, store]);

  const sealNow = useCallback(() => {
    const now = new Date();
    const current = getBook();
    const sealed = sealElapsedDays(current, clockFromDate(now).date, now.toISOString());
    if (!sealed.ok) return void showError(reasonText(sealed.reason));
    if (sealed.value !== current) apply(sealed);
  }, [getBook, apply, showError]);

  /** One round with the service (never two at once: `joinRound`). */
  const round = useCallback(async () => {
    setBusy(true);
    try {
      const done = await requestAnchor(getBook(), service);
      if (done.kind === 'failed') {
        // a round of a service retired meanwhile (key removed) ended on purpose: no error for that
        if (latestMade.current.service === service) showError(done.text);
        return 'failed' as const;
      }
      if (done.kind === 'anchor') {
        // the book may have changed while the service answered: add to the book as it is now; a month
        // whose running PDF was saved out keeps its anchors in that file (`thinAnchors`)
        const saved = savedPdfs(vault);
        return apply(addAnchor(getBook(), done.anchor, new Date().toISOString(), saved))
          ? ('anchor' as const)
          : ('failed' as const);
      }
      return done.kind;
    } finally {
      setBusy(false);
    }
  }, [getBook, apply, showError, service, vault]);

  /**
   * A time stamp now. While a round runs, its result is awaited (an export then holds its anchor); one more
   * round follows only when it did not fail and the chain still has stamps no anchor covers.
   */
  const anchorNow = useCallback(
    () =>
      joinRound(running, round, (r) => r !== 'failed' && anchorRequest(getBook()) !== undefined),
    [round, getBook],
  );

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
