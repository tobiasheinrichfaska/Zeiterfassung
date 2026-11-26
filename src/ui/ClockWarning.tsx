import { clockWarningText } from '../logic/index.ts';
import { useAnchoring } from './anchorContext.ts';

/** Warns when the device clock differs from the relay's clock by more than 30 s; blocks nothing. */
export function ClockWarning() {
  const text = clockWarningText(useAnchoring().clockOffsetMs);
  return text ? (
    <p aria-live="polite" data-clock-warning="true">
      {text}
    </p>
  ) : null;
}
