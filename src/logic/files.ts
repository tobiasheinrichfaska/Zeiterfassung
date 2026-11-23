import type { DateKey, MonthKey, TimeBook } from './model.ts';
import { dateLabel } from './view.ts';

export const pdfFileName = (month: MonthKey): string => `zeiterfassung-${month}.pdf`;

/** The `.zeiterfassung.json` ending is what `.gitignore` keeps out of a repository. */
export const backupFileName = (date: DateKey): string => `sicherung-${date}.zeiterfassung.json`;

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
