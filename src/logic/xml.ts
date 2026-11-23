import { fail, ok, type MonthKey, type Result, type TimeBook } from './model.ts';
import { monthSummary } from './summary.ts';
import { formatClock, isMonthKey } from './time.ts';

/** Namespace of the monthly summary; the version is part of it. */
export const XML_NAMESPACE = 'urn:zeiterfassung:monat:1';

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * The machine-readable monthly summary for the digital personnel file. German element names
 * (the reader is German), minutes as integers, one `tag` per working day.
 */
export function monthToXml(book: TimeBook, month: MonthKey, createdIso: string): Result<string> {
  if (!isMonthKey(month)) return fail('bad-month');
  const s = monthSummary(book, month);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<zeiterfassung-monat xmlns="${XML_NAMESPACE}" monat="${month}" erstellt="${esc(createdIso)}">`,
    `  <mitarbeiter>${esc(book.settings.employeeLabel)}</mitarbeiter>`,
    `  <tage anzahl="${s.rows.length}" summe-arbeitszeit-minuten="${s.workMinutes}" offene-tage="${s.openDays}">`,
  ];
  for (const r of s.rows) {
    const attrs = [
      `datum="${r.date}"`,
      `beginn="${formatClock(r.startMin)}"`,
      ...(r.endMin === null
        ? []
        : [
            `ende="${formatClock(r.endMin)}"`,
            ...(r.endMin >= 1440 ? ['ende-folgetag="true"'] : []),
          ]),
      `pause-minuten="${r.breakMinutes}"`,
      ...(r.workMinutes === null ? [] : [`arbeitszeit-minuten="${r.workMinutes}"`]),
      `erfassung="${r.origin === 'stamp' ? 'stempel' : 'manuell'}"`,
    ].join(' ');
    lines.push(
      r.note ? `    <tag ${attrs}><notiz>${esc(r.note)}</notiz></tag>` : `    <tag ${attrs}/>`,
    );
  }
  lines.push('  </tage>', '</zeiterfassung-monat>', '');
  return ok(lines.join('\n'));
}
