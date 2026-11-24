import type { Reason } from './model.ts';
import type { AnchorStatus } from './anchors.ts';
import { formatIsoDateTime } from './time.ts';

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
  'wrong-password': 'Das Passwort ist falsch, oder die Datei wurde verändert oder ist beschädigt.',
  'password-required': 'Diese Sicherung ist verschlüsselt. Bitte das Passwort eingeben.',
  'weak-password': 'Das Passwort braucht 8 bis 256 Zeichen.',
  'passwords-differ': 'Die beiden Passwörter sind verschieden.',
  'chain-broken':
    'Die Stempelkette ist unterbrochen oder verändert (Lücke, falsche Prüfsumme oder falscher Vorgänger). Die Daten wurden nicht angenommen.',
  'too-many-stamps':
    'Die Stempelkette ist voll (6000 Stempel). Bitte alte, exportierte und extern gestempelte Monate löschen.',
  'bad-anchor': 'Der externe Zeitstempel ist ungültig oder passt nicht zur Stempelkette.',
  'anchor-skew':
    'Die Zeit des externen Zeitstempels passt nicht zur Geräteuhr. Bitte die Uhr des Geräts prüfen.',
  'too-many-anchors': 'Es sind höchstens 400 externe Zeitstempel möglich.',
  'bad-relay': 'Diese Adresse des Weiterreichers ist in dieser Fassung nicht erlaubt.',
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
  'bad-pdf': 'Die Datei ist keine lesbare laufende Monatsdatei (PDF) dieser App.',
  'wrong-month': 'Dieser Tag gehört nicht zum Monat der laufenden Monatsdatei.',
  'day-in-pdf':
    'Dieser Tag steht schon in der laufenden Monatsdatei; er wird nicht ein zweites Mal angehängt.',
  'day-running':
    'Der Tag läuft noch. Er wird erst nach „Gehen“ in die laufende Monatsdatei geschrieben.',
  'pdf-append-failed':
    'Die laufende Monatsdatei konnte nicht fortgeschrieben werden. Die bisherige Datei bleibt unverändert.',
};

/** Text for a code; falls back to the code itself so an error is never silent. */
export const reasonText = (reason: Reason): string => REASON_TEXTS[reason] ?? reason;

/** The status of the external time stamps in one or two German sentences. */
export function anchorStatusText(s: AnchorStatus): string {
  const oldest = s.oldestUnanchoredAt ? formatIsoDateTime(s.oldestUnanchoredAt) : '';
  switch (s.state) {
    case 'off':
      return (
        'Kein externer Zeitstempeldienst eingerichtet.' +
        (s.unanchored > 0
          ? ` Die ${s.unanchored} internen Stempel sind nur durch die Geräteuhr datiert.`
          : '')
      );
    case 'nothing':
      return 'Es gibt noch keine Stempel.';
    case 'ok':
      return `Alle ${s.headN} Stempel sind durch externe Zeitstempel abgedeckt${
        s.lastAnchorGenTime ? ` (letzter: ${formatIsoDateTime(s.lastAnchorGenTime)})` : ''
      }.`;
    case 'due':
      return `${s.unanchored} Stempel warten auf den externen Zeitstempel (der älteste von ${oldest}).`;
    case 'overdue':
      return `Überfällig: ${s.unanchored} Stempel sind älter als 24 Stunden und noch nicht extern gestempelt (der älteste von ${oldest}).`;
  }
}
