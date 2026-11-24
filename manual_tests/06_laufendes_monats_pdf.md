# 06 Laufendes Monats-PDF

Alle Daten sind erfunden. Noch von niemandem durchgespielt, weder auf einem echten Gerät noch in headless
Chromium (nur automatische Tests der Logik und des Ablaufs mit einem Tresor im Arbeitsspeicher und einem
Stellvertreter-Dienst). Für MT-30 braucht man eine Fassung mit Weiterreicher-Adresse (`VITE_TIMESTAMP_RELAY`),
siehe MT-26.

Die laufende Monatsdatei ist eine PDF-Datei je Monat, die nie neu gebaut, sondern nur fortgeschrieben wird:
Für jeden beendeten Tag kommt eine neue Seite (Stand des Monats bis zu diesem Tag) und ein neuer Anhang dazu,
danach ein Dokument-Zeitstempel. Der bisherige Export „Monat als PDF speichern“ bleibt daneben unverändert.

## MT-29: Ohne Zeitstempeldienst

**Voraussetzung:** Die normale Fassung (ohne Weiterreicher).

**Schritte**

1. Unter „Stempeln“ „Kommen“ und nach einer Weile „Gehen“ drücken.
2. Im Bereich „Monat“ den Abschnitt „Laufendes Monats-PDF“ ansehen.
3. „Laufendes PDF speichern“ drücken und die Datei `zeiterfassung-JJJJ-MM-laufend.pdf` in einem PDF-Betrachter öffnen.
4. Die App schließen, am nächsten Tag (oder nach Vorstellen der Geräteuhr) wieder öffnen, einen weiteren Tag stempeln und Schritt 2 und 3 wiederholen.

**Erwartet**

- Schritt 2: „1 Tag(e) enthalten, zuletzt …“, „Noch kein Dokument-Zeitstempel.“, „Der neueste Stand ist noch nicht gestempelt.“ und ein rot umrandeter Hinweis „Kein externer Zeitstempeldienst eingerichtet: …“.
- Schritt 3: Seite 1 ist die Titelseite („Laufende Monatsdatei …“), Seite 2 die Tabelle mit dem Tag und der Überschrift „Arbeitszeit … – Stand …“. In der Liste der Anhänge stehen `zeiterfassung-JJJJ-MM-beginn.json` und `zeiterfassung-JJJJ-MM-tag-TT.json`.
- Schritt 4: Eine dritte Seite mit beiden Tagen; die ersten beiden Seiten und Anhänge sind unverändert; ein weiterer Anhang ist dazugekommen.
- Der Export „Monat als PDF speichern“ funktioniert wie bisher und ist eine andere Datei.

## MT-30: Mit Zeitstempeldienst, auch nach einer Zeit ohne Netz

**Voraussetzung:** Eine Fassung mit Weiterreicher, in den Einstellungen eingeschaltet.

**Schritte**

1. Das Gerät vom Netz trennen (Flugmodus). „Kommen“ und „Gehen“ drücken. Den Abschnitt „Laufendes Monats-PDF“ ansehen.
2. Die App schließen, das Netz wieder einschalten, die App öffnen.
3. Das laufende PDF speichern und in einem Betrachter mit Signaturanzeige öffnen (zum Beispiel Adobe Acrobat Reader, Signaturbereich).

**Erwartet**

- Schritt 1: Der Tag ist enthalten, roter Hinweis „Der neueste Stand der laufenden Monatsdatei ist nicht gestempelt: Der Zeitstempeldienst ist nicht erreichbar. (…)“. Der Tag geht nicht verloren.
- Schritt 2: Kurz nach dem Start: „1 Dokument-Zeitstempel, letzter … (laut Token).“ und „Der neueste Stand ist gestempelt.“; kein roter Hinweis mehr. Bleibt die App offen und der Dienst unerreichbar, versucht sie es alle 15 Minuten erneut.
- Schritt 3: Der Betrachter zeigt einen Dokument-Zeitstempel. (Ob er ihn als vertrauenswürdig anzeigt, hängt vom Dienst ab; die freien Dienste sind nicht qualifiziert.)
- Im Register „Netzwerk“ der Entwicklerwerkzeuge gehen nur `GET …/v1/services` und `POST …/v1/stamp/<Kennung>` mit einer Prüfsumme hinaus, nie die Datei.

## MT-31: Monatswechsel, Löschen und was nicht in der Sicherung ist

**Schritte**

1. Am Ende eines Monats einen Tag stempeln, die App schließen und erst im neuen Monat wieder öffnen.
2. Im Bereich „Monat“ zum Vormonat blättern und den Abschnitt „Laufendes Monats-PDF“ ansehen.
3. Eine Sicherung speichern und auf einem anderen Browser einspielen; dort den Abschnitt ansehen.
4. Mit einem Testdatensatz, dessen Monat exportiert und älter als die Aufbewahrungszeit ist: unter „Sicherung“ „Fällige exportierte Monate löschen“.

**Erwartet**

- Schritt 2: Der letzte Tag des Vormonats ist in dessen laufender Datei enthalten (beim Start nachgeholt).
- Schritt 3: Die laufende Monatsdatei ist **nicht** in der Sicherung; auf dem anderen Browser beginnt sie neu (mit allen beendeten Tagen des laufenden und des Vormonats, aber anderen Zeiten auf den Seiten).
- Schritt 4: Mit dem Monat verschwindet auch seine laufende Monatsdatei; der Abschnitt sagt „Für diesen Monat gibt es noch keine laufende Monatsdatei.“
- Ein roter Hinweis „Achtung: Frühere Anhänge der Datei wurden entfernt oder verändert …“ darf nie erscheinen (er zeigt eine Datei an, die nicht nur ergänzt wurde).
