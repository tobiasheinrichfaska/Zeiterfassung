/**
 * One round at a time, and a caller that comes while a round runs **waits for it** instead of getting an
 * empty answer at once (so an export after „sealed, now stamp“ holds the anchor of the round already on its
 * way). `slot` holds the running round's promise. After waiting, `again(result)` says whether one more
 * round is needed (e.g. stamps came in meanwhile that the joined round did not cover); a round another
 * waiting caller started meanwhile is joined instead of starting a second one.
 */
export async function joinRound<T>(
  slot: { current: Promise<T> | undefined },
  start: () => Promise<T>,
  again: (result: T) => boolean = () => false,
): Promise<T> {
  const running = slot.current;
  if (running) {
    const result = await running;
    if (!again(result)) return result;
    if (slot.current) return slot.current;
  }
  const round: Promise<T> = start().finally(() => {
    if (slot.current === round) slot.current = undefined;
  });
  slot.current = round;
  return round;
}
