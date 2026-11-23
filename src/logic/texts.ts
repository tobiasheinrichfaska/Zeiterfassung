import type { Reason } from './model.ts';

/** German message for every error code (product text; the logic layer only returns codes). */
export const REASON_TEXTS: Record<Reason, string> = {
  'bad-date': 'Das Datum oder der Zeitpunkt ist ungültig.',
  'bad-month': 'Der Monat ist ungültig.',
  'bad-minute': 'Die Uhrzeit liegt außerhalb des erlaubten Bereichs.',
  'end-before-start': 'Gehen muss nach Kommen liegen.',
  'too-long': 'Ein Arbeitstag darf nicht länger als 24 Stunden dauern.',
  'bad-break': 'Eine Pause ist ungültig (Länge 1 bis 720 Minuten, Ende nach Beginn).',
  'too-many-breaks': 'Es sind höchstens 20 Pausen pro Tag möglich.',
  'break-overlap': 'Zwei Pausen überlappen sich.',
  'break-outside': 'Eine Pause liegt außerhalb der Arbeitszeit.',
  'breaks-too-long': 'Die Pausen sind länger als die Arbeitszeit.',
  'open-break-on-closed-day': 'Eine laufende Pause gibt es nur an einem laufenden Tag.',
  'bad-note': 'Die Notiz ist zu lang (höchstens 200 Zeichen) oder enthält Steuerzeichen.',
  'bad-label': 'Die Bezeichnung ist zu lang (höchstens 100 Zeichen) oder enthält Steuerzeichen.',
  'bad-reason': 'Die Begründung ist zu lang (höchstens 200 Zeichen) oder enthält Steuerzeichen.',
  'too-many-changes':
    'Das Änderungsprotokoll ist voll (2000 Einträge). Bitte erst Monate exportieren und löschen.',
  'bad-retention': 'Die Aufbewahrung muss zwischen 1 und 120 Monaten liegen.',
  'bad-origin': 'Die Herkunft des Eintrags ist unbekannt.',
  'already-running': 'Es läuft schon ein Arbeitstag. Bitte zuerst „Gehen“ stempeln.',
  'not-running': 'Es läuft kein Arbeitstag. Bitte zuerst „Kommen“ stempeln.',
  'break-running': 'Eine Pause läuft schon.',
  'no-break-running': 'Es läuft keine Pause.',
  'day-exists': 'Für heute gibt es schon einen beendeten Arbeitstag. Bitte im Formular ändern.',
  'clock-before-end': 'Die Uhr zeigt eine frühere Zeit als das letzte „Gehen“ dieses Tages.',
  'no-such-day': 'Für dieses Datum gibt es keinen Eintrag.',
  'second-open-day': 'Es kann nur einen laufenden Arbeitstag geben.',
  'too-many-days': 'Es sind höchstens 4000 Arbeitstage möglich.',
  'bad-backup': 'Die Daten sind nicht lesbar oder entsprechen nicht dem erwarteten Format.',
  'unknown-version':
    'Die Daten haben eine unbekannte Formatversion (vermutlich von einer neueren App).',
};

/** Text for a code; falls back to the code itself so an error is never silent. */
export const reasonText = (reason: Reason): string => REASON_TEXTS[reason] ?? reason;
