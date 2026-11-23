# 03 Monat, Sicherung, PDF, Navigation, Tresor

Alle Daten sind erfunden. Bisher in keinem echten Browser durchgespielt.

## MT-08: Monat ansehen, ändern, löschen

**Voraussetzung:** Mindestens zwei erfasste Tage im laufenden Monat.

**Schritte**

1. Bereich „Monat“ öffnen.
2. Bei einem Tag „Bearbeiten“ drücken, die Notiz ändern, „Änderung speichern“.
3. Bei demselben Tag „Bearbeiten“ und dann „Eintrag löschen“ drücken, die Rückfrage bestätigen.
4. Mit „◀ Vormonat“ und „Nächster Monat ▶“ blättern.

**Erwartet**

- Unter der Tabelle steht „Summe: H:MM Std.“; ein laufender Tag ist darin **nicht** enthalten, das steht daneben.
- Nach Schritt 3 ist der Tag weg und die Summe kleiner.
- Das Datum eines Tages lässt sich im Formular ändern: der Tag erscheint dann unter dem neuen Datum, am alten nicht mehr.

## MT-09: Monat als PDF speichern

**Voraussetzung:** Ein Monat mit Einträgen; unter „Einstellungen“ ist ein Name eingetragen.

**Schritte**

1. Bereich „Monat“, Knopf „Monat als PDF speichern“.
2. Die gespeicherte Datei `zeiterfassung-JJJJ-MM.pdf` im Ordner „Downloads“ öffnen.

**Erwartet**

- Gibt es nachträgliche Änderungen im Monat, zeigt das PDF den Abschnitt „Nachträgliche Änderungen“ mit Datum, Zeitpunkt, vorher, nachher und Begründung.
- Das PDF zeigt Überschrift „Arbeitszeit <Monat Jahr>“, den Namen, die Tabelle, die Summe und den Satz über die angehängte Datei.
- Nicht offensichtlich: Der Anhang (`zeiterfassung-JJJJ-MM.json`) ist nur im PDF-Programm sichtbar (zum Beispiel „Anlagen“ im Adobe Reader oder im Büroviewer); er dient nur der Bestätigung der Tabelle. Im Fuß des PDF steht die Prüfsumme (SHA-256) des Anhangs.
- Unter dem Knopf steht „Dieser Monat wurde am TT.MM.JJJJ exportiert.“
- Auf einem Handy mit Teilen-Funktion erscheint zusätzlich „PDF teilen …“. Die App hängt nichts selbst an eine E-Mail: Die Datei bitte selbst mailen.
- Läuft noch ein Tag, kommt vorher eine Rückfrage.

## MT-10: Sicherung speichern und einspielen

**Schritte**

1. Bereich „Einstellungen“, Seite „Sicherung“, „Sicherung speichern“.
2. Im Bereich „Erfassen“ einen Tag eintragen (so weicht der Stand von der Sicherung ab).
3. Zurück zu „Sicherung“, „Sicherung einspielen …“ und die gespeicherte Datei wählen.
4. Die Rückfrage mit „OK“ bestätigen.

**Erwartet**

- Die Rückfrage nennt die Zahl der Tage von beiden Seiten („… werden durch die Sicherung (…) ersetzt“).
- Danach ist der Tag aus Schritt 2 weg (Stand der Sicherung).
- Wählt man eine beliebige andere Datei (zum Beispiel ein Foto), erscheint ein roter Kasten mit Grund und es ändert sich nichts.

## MT-11: Aufbewahrung

**Voraussetzung:** Unter „Einstellungen“ die Aufbewahrung auf 1 Monat gestellt; Tage aus einem Monat vor mehr als 1 Monat vorhanden (Formular).

**Schritte**

1. Seite „Sicherung“ öffnen. Den alten Monat noch **nicht** exportieren.
2. Im Bereich „Monat“ zu diesem Monat blättern und „Monat als PDF speichern“.
3. Wieder „Sicherung“ öffnen, „Fällige exportierte Monate löschen“ drücken, bestätigen.

**Erwartet**

- Nach Schritt 1: roter Hinweis „Fällig, aber nicht exportiert (bleiben erhalten)“, kein Löschknopf.
- Nach Schritt 3: der Monat ist leer. Es wird nie ohne Rückfrage gelöscht.

## MT-12: Navigation mit den Rädern

**Schritte**

1. Mit Wischen oder Mausrad zwischen „Stempeln“ und „Tag eingeben“, dann zu den Bereichen „Monat“ und „Einstellungen“ wechseln.
2. Den unteren Mittelpunkt (Sprung) drücken.

**Erwartet**

- Fünf Seiten in drei Bereichen: Erfassen (Stempeln, Tag eingeben), Monat (Monat), Einstellungen (Einstellungen, Sicherung).
- Der Sprung führt zu „Stempeln“. Die Bedienung per Geste lässt sich nur auf dem Gerät prüfen.

## MT-13: Tresor und App-Sperre

**Schritte**

1. Einen Tag eintragen, die Seite schließen und neu öffnen.
2. Unter „Einstellungen“ die App-Sperre einschalten (Passwort mindestens 6 Zeichen), Seite neu laden.

**Erwartet**

- Nach Schritt 1 ist der Tag noch da.
- Nach Schritt 2 fragt die App nach dem Passwort („Gesperrt“, „Entsperren“). Alle Texte sind deutsch.
- Wird der Browserspeicher gelöscht, sind die Daten weg; nur die Sicherungsdatei rettet sie.
