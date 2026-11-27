import type { DateKey, MonthKey, Reason, TimeBook } from './model.ts';
import { dateLabel } from './time.ts';
import { reasonText } from './texts.ts';

export const pdfFileName = (month: MonthKey): string => `zeiterfassung-${month}.pdf`;

/** The `.zeiterfassung.json` ending is what `.gitignore` keeps out of a repository. */
export const backupFileName = (date: DateKey, encrypted: boolean): string =>
  `sicherung-${date}.${encrypted ? 'verschluesselt' : 'unverschluesselt'}.zeiterfassung.json`;

export interface BookDescription {
  days: number;
  /** Earliest and latest day, null for an empty book. */
  first: DateKey | null;
  last: DateKey | null;
}

export function describeBook(book: TimeBook): BookDescription {
  const dates = Object.keys(book.days).sort();
  return { days: dates.length, first: dates[0] ?? null, last: dates.at(-1) ?? null };
}

const describeText = (d: BookDescription): string =>
  d.days === 0 || d.first === null || d.last === null
    ? 'keine Arbeitstage'
    : `${d.days} Arbeitstag(e) von ${dateLabel(d.first)} bis ${dateLabel(d.last)}`;

/** The question before a backup replaces the current data. */
export function replaceQuestion(current: TimeBook, incoming: TimeBook): string {
  return (
    `Die Daten auf diesem Gerät (${describeText(describeBook(current))}) werden durch die ` +
    `Sicherung (${describeText(describeBook(incoming))}) ersetzt. Was nur hier steht, geht verloren. Fortfahren?`
  );
}

/**
 * What the restore form does with a refused backup file: whether it keeps asking for the password, and the
 * text to show (null: none). Asking for the password the first time is silent; an empty password entered in
 * the form, a wrong one and every other refusal are said.
 */
export function restoreRefusal(
  reason: Reason,
  passwordEntered: boolean,
  fileName: string,
): { askPassword: boolean; text: string | null } {
  if (reason === 'password-required') {
    return { askPassword: true, text: passwordEntered ? reasonText(reason) : null };
  }
  return {
    askPassword: reason === 'wrong-password',
    text: `Die Datei „${fileName}“ kann nicht eingespielt werden: ${reasonText(reason)}`,
  };
}
