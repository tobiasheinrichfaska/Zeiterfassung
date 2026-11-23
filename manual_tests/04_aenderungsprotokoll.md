# 04 Änderungsprotokoll (abgelaufene Tage)

Alle Daten sind erfunden. Bisher in keinem echten Browser durchgespielt.

Ein Tag ist **abgelaufen**, wenn sein Datum vor dem heutigen Datum liegt. Änderungen daran sind erlaubt,
werden aber protokolliert. Heutige Tage und das Stempeln in Echtzeit werden nicht protokolliert.

## MT-15: Nachtrag für einen vergangenen Tag

**Schritte**

1. Bereich „Erfassen“, Seite „Tag eingeben“: „Datum“ auf **gestern**, „Kommen“ 08:00, „Gehen“ 16:00, „Speichern“.
2. Im Fenster „Dieser Tag ist abgelaufen. Die Änderung wird protokolliert.“ bei „Begründung“ „Stempeln vergessen“ eintragen, „Änderung speichern“ drücken.
3. Bereich „Monat“ (den Monat von gestern) öffnen.

**Erwartet**

- Das Fenster erscheint vor dem Speichern; mit „Abbrechen“ wird nichts gespeichert und nichts protokolliert.
- Im Monat steht beim Tag „(nachträglich geändert)“ und unten ein Abschnitt „Nachträgliche Änderungen“ mit „Nachgetragen am TT.MM.JJJJ HH:MM UTC“, „vorher: –“, „nachher: 08:00–16:00, …“ und der Begründung.
- Nicht offensichtlich: Die Zeitangabe ist in UTC (Geräteuhr), nicht in Ortszeit.
- Für **heute** erscheint dieses Fenster nicht.

## MT-16: Ändern, Verschieben, Löschen

**Voraussetzung:** Ein Tag von gestern (MT-15).

**Schritte**

1. Im Bereich „Monat“ bei diesem Tag „Bearbeiten“, „Gehen“ auf 17:00, „Änderung speichern“, Fenster bestätigen.
2. Dasselbe, aber „Datum“ um einen Tag früher setzen („Änderung speichern“, bestätigen).
3. Bei dem verschobenen Tag „Bearbeiten“ und „Eintrag löschen“, beide Rückfragen bestätigen.

**Erwartet**

- Schritt 1: ein Eintrag „Geändert“ mit „vorher“ 16:00 und „nachher“ 17:00.
- Schritt 2: zwei Einträge, „Gelöscht (verschoben nach …)“ und „Nachgetragen (verschoben von …)“.
- Schritt 3: ein Eintrag „Gelöscht“. Der Tag ist weg, die Einträge bleiben im Protokoll.
- Speichert man ein Formular ohne Änderung, entsteht kein Eintrag.

## MT-17: Offener Vortag

**Voraussetzung:** Gestern wurde nur „Kommen“ gestempelt (oder ein Tag ohne „Gehen“ eingetragen).

**Schritte**

1. „Tag eingeben“ öffnen, „Gehen“ nachtragen, „Speichern“, Fenster bestätigen.

**Erwartet**

- Ein Eintrag „Geändert“: vorher „…–läuft“, nachher mit Ende.
- Stempelt man dagegen nach Mitternacht „Gehen“ einer Nachtschicht, erscheint kein Fenster (das ist keine nachträgliche Änderung).

## MT-18: Aufbewahrung und Protokoll

**Voraussetzung:** Aufbewahrung auf 1 Monat; ein alter, exportierter Monat mit protokollierten Änderungen.

**Schritte**

1. Den alten Monat im Bereich „Monat“ als PDF speichern, dann im Bereich „Sicherung“ die fälligen Monate löschen.
2. Einen anderen alten Monat nach dem Export noch einmal ändern und wieder die Seite „Sicherung“ öffnen.

**Erwartet**

- Nach Schritt 1 ist der Monat samt seinen Protokolleinträgen weg.
- Nach Schritt 2 steht der Monat unter „Fällig, aber nicht exportiert“ mit dem Hinweis, dass er nach dem Export verändert wurde; er wird nicht gelöscht. Erst ein neuer Export gibt ihn frei.
- Nicht offensichtlich: Das Protokoll ist nicht manipulationssicher (keine Kette, keine Signatur, Geräteuhr).

## MT-20: Seite wird gemerkt

**Schritte**

1. Zur Seite „Sicherung“ wechseln, die Anwendung schließen und wieder öffnen.

**Erwartet**

- Die Räder öffnen wieder auf „Sicherung“ (mit Passwort-Sperre erst nach dem Entsperren).
- Im privaten Fenster ohne Speicher starten die Räder auf der ersten Seite, ohne Fehlermeldung.

## MT-21: Angefangenes Formular geht nicht verloren

**Schritte**

1. Unter „Tag eingeben“ ein Datum, „Kommen“ und eine Notiz eintragen, aber **nicht** speichern.
2. Zu einer anderen Seite wischen und zurück.
3. Die Anwendung schließen, neu öffnen und „Tag eingeben“ öffnen.
4. „Entwurf verwerfen“ drücken. Dann noch einmal etwas eintragen und „Speichern“ drücken.
5. Im Bereich „Monat“ bei einem Tag „Bearbeiten“, die Notiz ändern, zur Seite „Stempeln“ wischen und zurück.

**Erwartet**

- Nach Schritt 2 und 3 stehen die Eingaben noch da, dazu der Hinweis „Ein angefangener Entwurf wurde wiederhergestellt.“
- Nach „Entwurf verwerfen“ ist das Formular leer; nach „Speichern“ erscheint der Entwurf nicht mehr.
- Nach Schritt 5 öffnet der Monat wieder auf dem Tag mit der geänderten Notiz (noch nicht gespeichert).
- Der Entwurf liegt verschlüsselt im Tresor (nicht lesbar im Browser-Speicher).

## MT-22: Keine Verstöße gegen die Sicherheitsrichtlinie

**Voraussetzung:** Ein Browser mit Entwicklerwerkzeugen (Taste F12), `dist/index.html` geöffnet.

**Schritte**

1. Das Register „Konsole“ öffnen und die Seite neu laden.
2. Nacheinander: einen Tag stempeln, ein Formular speichern, einen Monat als PDF speichern, eine Sicherung speichern und wieder einspielen, die App-Sperre ein- und ausschalten.
3. Im Register „Netzwerk“ prüfen, ob außer der Seite selbst etwas geladen oder gesendet wurde.

**Erwartet**

- In der Konsole keine Meldungen wie „Refused to …“ oder „violates the following Content Security Policy directive“.
- Alles aus Schritt 2 funktioniert, auch die Datei-Downloads (die Datei erscheint im Ordner „Downloads“) und die Darstellung (Abstände, Ränder, Rahmen sind da).
- Im Register „Netzwerk“ keine Anfragen außer der Seite.
- Bisher **nicht geprüft**: Die Richtlinie ist gebaut und gegen die Datei geprüft, aber in keinem Browser gelaufen.
