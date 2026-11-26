import type { Reason } from './model.ts';
import type { AnchorStatus } from './anchors.ts';
import { formatIsoDate, formatIsoDateTime } from './time.ts';
import { monthLabel } from './view.ts';
import type { PdfSaveRequest, PdfSlotPlan } from './runningPlan.ts';

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
  'old-anchor-format':
    'Die Daten enthalten externe Zeitstempel in einem alten Format, das nicht mehr gelesen wird.',
  'backup-anchor-unverified':
    'Die Sicherung enthält externe Zeitstempel, die sich nicht prüfen lassen. Es wurde nichts ersetzt.',
  'backup-days-mismatch':
    'Die Zeiten in der Sicherung passen nicht zu ihrer Stempelkette: Tage wurden außerhalb der App verändert. Es wurde nichts ersetzt.',
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
  'device-key-format':
    'Der Geräteschlüssel hat nicht die erwartete Form: Kennung, ein Punkt, dann der Schlüssel (ohne Leerzeichen).',
  'device-key-id':
    'Die Kennung vor dem Punkt ist ungültig (Kleinbuchstaben, Ziffern und Bindestrich, mit einem Buchstaben am Anfang, höchstens 32 Zeichen).',
  'device-key-unusable':
    'Dieser Geräteschlüssel lässt sich nicht verwenden (kein ECDSA-Schlüssel auf P-256).',
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

/** Texts of the running monthly PDF (German). */
export const RUNNING_PDF_TEXTS = {
  noRelay:
    'Kein externer Zeitstempeldienst eingerichtet: Der neueste Stand der laufenden Monatsdatei ist nicht gestempelt.',
  stampFailed: 'Der neueste Stand der laufenden Monatsdatei ist nicht gestempelt',
  tokenTooLarge: 'Das Token des Zeitstempeldienstes ist zu groß für den reservierten Platz.',
  notSingle:
    'Sammelbeleg statt Einzelstempel; ein Dokument-Zeitstempel braucht ein Token über genau diesen Stand',
  unreadable:
    'Die gespeicherte laufende Monatsdatei ist nicht lesbar. Sie bleibt unverändert; es wird nichts angehängt.',
  tooLarge:
    'Die laufende Monatsdatei ist zu groß für den Speicher der App. Der neue Stand wurde nicht gespeichert, damit die Arbeitszeiten immer Platz haben. Bitte die gespeicherte Datei jetzt sichern.',
  failed: 'Die laufende Monatsdatei konnte nicht fortgeschrieben werden',
  releaseChanged:
    'Die Monatsdatei in der App hat sich inzwischen geändert und wurde nicht entfernt. Bitte den neuesten Stand speichern.',
} as const;

/** Why a file must or should be saved, in one sentence. */
export function saveRequestText(r: PdfSaveRequest, today: string): string {
  const label = monthLabel(r.month);
  switch (r.why) {
    case 'previous':
      return r.mode === 'forced'
        ? `Die laufende Monatsdatei ${label} darf höchstens bis zum 7. des Folgemonats in der App bleiben. Bitte jetzt speichern.`
        : `Der Monat ${label} ist vorbei. Bitte seine laufende Monatsdatei bis zum 7. ${monthLabel(today.slice(0, 7))} speichern; ab dem 8. fragt die App, bevor sie weiter benutzt werden kann.`;
    case 'older':
      return `Die laufende Monatsdatei ${label} ist älter als der Vormonat und gehört nicht mehr in die App. Bitte jetzt speichern.`;
    case 'duplicate':
      return `Die laufende Monatsdatei ${label} liegt zweimal in der App. Bitte diese zweite Datei speichern.`;
    case 'too-large':
      return `${RUNNING_PDF_TEXTS.tooLarge} (${label})`;
  }
}

/** The texts of the save prompt and the reminder (German). */
export const SAVE_TEXTS = {
  forcedTitle: 'Monatsdatei speichern',
  forcedIntro:
    'Monatsdateien werden außerhalb der App aufbewahrt. Bitte die Datei speichern (oder teilen) und danach bestätigen; erst dann geht es weiter. Stempeln bleibt möglich.',
  reminderTitle: 'Monatsdatei bitte speichern',
  saveButton: 'Speichern',
  shareButton: 'Teilen …',
  confirmButton: 'Gespeichert – aus der App entfernen',
  confirmHint: 'Erst speichern oder teilen, dann bestätigen.',
  laterButton: 'Später',
  closeButton: 'Schließen',
  gone: 'Diese Monatsdatei liegt nicht mehr in der App.',
  confirmQuestion: (month: string) =>
    `Ist die Datei für ${monthLabel(month)} sicher gespeichert (zum Beispiel per E-Mail an die Personalakte)? Danach ist sie nur noch dort, nicht mehr in der App.`,
  saved: (name: string) => `Gespeichert als ${name} (Ordner „Downloads“).`,
  shared: 'Die Datei wurde weitergegeben.',
  removed: (month: string) =>
    `Die laufende Monatsdatei ${monthLabel(month)} ist aus der App entfernt.`,
  notStamped: 'Der neueste Stand dieser Datei ist noch nicht gestempelt.',
  busy: 'Die Monatsdatei wird gerade fortgeschrieben …',
  stampHeading: 'Stempeln',
  savedOut: (at: string) =>
    `Die laufende Monatsdatei dieses Monats wurde am ${formatIsoDate(at)} gespeichert und aus der App entfernt; sie wird nicht weitergeführt.`,
} as const;

/** Lines about the slots that are not about one file to save (German). */
export function slotPlanNotes(plan: PdfSlotPlan): string[] {
  const out: string[] = [];
  if (plan.currentWaits)
    out.push(
      'Für den laufenden Monat ist kein Platz frei: Erst muss eine ältere Monatsdatei gespeichert werden. Die Arbeitszeiten gehen nicht verloren; die Seiten werden danach nachgeholt.',
    );
  if (plan.unreadable.length > 0)
    out.push(
      `${plan.unreadable.length} Speicherplatz/Speicherplätze für Monatsdateien sind nicht lesbar; sie bleiben unverändert.`,
    );
  for (const a of plan.ahead)
    out.push(
      `Eine Monatsdatei für ${monthLabel(a.month)} liegt in der App, obwohl dieser Monat noch nicht begonnen hat (Geräteuhr prüfen). Sie bleibt unverändert.`,
    );
  return out;
}

/** From this difference between the device clock and the relay's clock on, the person is warned. */
export const CLOCK_WARNING_MS = 30_000;

/**
 * The warning about a wrong device clock, or `null` when the clocks agree (within 30 s). `offsetMs` is the
 * relay's clock minus the device clock: negative means the device clock is ahead („geht vor“).
 */
export function clockWarningText(offsetMs: number): string | null {
  if (!Number.isFinite(offsetMs) || Math.abs(offsetMs) <= CLOCK_WARNING_MS) return null;
  const seconds = Math.round(Math.abs(offsetMs) / 1000);
  const amount =
    seconds < 60
      ? `${seconds} ${seconds === 1 ? 'Sekunde' : 'Sekunden'}`
      : `${Math.round(seconds / 60)} ${Math.round(seconds / 60) === 1 ? 'Minute' : 'Minuten'}`;
  return `Die Uhr dieses Geräts geht ${amount} ${offsetMs < 0 ? 'vor' : 'nach'} – bitte die Uhrzeit des Geräts stellen.`;
}

/**
 * The standing red banner after a failed background write of the vault (e.g. a full storage): the times
 * may not be stored. `reason` is the vault's own text.
 */
export function unsavedText(reason: string): string {
  return `Achtung: Speichern ist fehlgeschlagen (${reason}). Die erfassten Zeiten sind möglicherweise nicht gespeichert und könnten beim Neuladen fehlen. Bitte die App nicht schließen, eine Sicherung herunterladen und Speicherplatz freigeben (z. B. die Monatsdatei speichern).`;
}

/** The refused import of a backup whose external time stamps do not verify: how many, German. */
export function anchorUnverifiedText(failed: number, total: number): string {
  return `${REASON_TEXTS['backup-anchor-unverified']} (${failed} von ${total} externen Zeitstempeln nicht bestätigt)`;
}

/** The red note on the month page when stored days do not match the stamp chain (`checkDaysAgainstChain`). */
export function chainMismatchNote(dates: readonly string[]): string {
  const shown = dates.slice(0, 5).map(formatIsoDate).join(', ');
  const more = dates.length > 5 ? ` und ${dates.length - 5} weitere` : '';
  return `Die gespeicherten Zeiten von ${dates.length} Tag(en) passen nicht zur Stempelkette (${shown}${more}): Sie wurden außerhalb der App verändert. Die angezeigten Zeiten sind für diese Tage nicht belegt.`;
}

/** The red note on the month page when stored external time stamps fail the check. */
export function anchorCheckNote(failed: number): string {
  return `${failed === 1 ? 'Ein externer Zeitstempel' : `${failed} externe Zeitstempel`} dieses Geräts ${failed === 1 ? 'besteht' : 'bestehen'} die Prüfung nicht. Die Daten wurden möglicherweise verändert.`;
}
