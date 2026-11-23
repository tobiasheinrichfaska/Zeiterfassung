import { LIMITS, type Break, type Reason, type Settings, type Workday } from './model.ts';
import { isDateKey } from './time.ts';

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/**
 * Free text must be one plain line: no control characters (they would break the report),
 * no lone surrogates, no noncharacters. Written with char codes, not escapes in a regex.
 */
function plainText(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0xfffe || c === 0xffff) return false;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function textOk(text: unknown, max: number): text is string {
  return typeof text === 'string' && text.length <= max && plainText(text);
}

/** Length of a break in minutes; an open span counts 0 (its end is not known yet). */
export function breakMinutes(b: Break): number {
  if (b.kind === 'length') return b.minutes;
  return b.toMin === null ? 0 : b.toMin - b.fromMin;
}

/** Checks one working day on its own. Returns the first reason, or null when it is fine. */
export function checkWorkday(day: Workday): Reason | null {
  if (!isDateKey(day.date)) return 'bad-date';
  if (day.origin !== 'stamp' && day.origin !== 'manual') return 'bad-origin';
  if (!textOk(day.note, LIMITS.maxNoteChars)) return 'bad-note';
  if (typeof day.recordedAt !== 'string' || Number.isNaN(Date.parse(day.recordedAt))) {
    return 'bad-date';
  }
  if (!isInt(day.startMin) || day.startMin < 0 || day.startMin >= LIMITS.minutesPerDay) {
    return 'bad-minute';
  }
  const open = day.endMin === null;
  if (!open) {
    if (!isInt(day.endMin) || day.endMin > LIMITS.maxEndMin) return 'bad-minute';
    if (day.endMin <= day.startMin) return 'end-before-start';
    if (day.endMin - day.startMin > LIMITS.minutesPerDay) return 'too-long';
  }
  if (!Array.isArray(day.breaks) || day.breaks.length > LIMITS.maxBreaksPerDay) {
    return 'too-many-breaks';
  }
  const spans: { from: number; to: number }[] = [];
  let openSpans = 0;
  let total = 0;
  for (const b of day.breaks) {
    if (b?.kind === 'length') {
      if (!isInt(b.minutes) || b.minutes < 1 || b.minutes > LIMITS.maxBreakLengthMinutes) {
        return 'bad-break';
      }
      total += b.minutes;
    } else if (b?.kind === 'span') {
      if (!isInt(b.fromMin) || b.fromMin < day.startMin) return 'break-outside';
      if (b.toMin === null) {
        openSpans += 1;
        if (!open) return 'open-break-on-closed-day';
        if (openSpans > 1) return 'bad-break';
        spans.push({ from: b.fromMin, to: Infinity });
      } else {
        if (!isInt(b.toMin) || b.toMin <= b.fromMin) return 'bad-break';
        if (!open && b.toMin > (day.endMin as number)) return 'break-outside';
        spans.push({ from: b.fromMin, to: b.toMin });
        total += b.toMin - b.fromMin;
      }
    } else {
      return 'bad-break';
    }
  }
  spans.sort((a, b) => a.from - b.from);
  for (let i = 1; i < spans.length; i += 1) {
    if ((spans[i] as { from: number }).from < (spans[i - 1] as { to: number }).to) {
      return 'break-overlap';
    }
  }
  if (!open && total > (day.endMin as number) - day.startMin) return 'breaks-too-long';
  return null;
}

export function checkSettings(s: Settings): Reason | null {
  if (!textOk(s.employeeLabel, LIMITS.maxLabelChars)) return 'bad-label';
  if (
    !isInt(s.retentionMonths) ||
    s.retentionMonths < LIMITS.retentionMonthsMin ||
    s.retentionMonths > LIMITS.retentionMonthsMax
  ) {
    return 'bad-retention';
  }
  return null;
}
