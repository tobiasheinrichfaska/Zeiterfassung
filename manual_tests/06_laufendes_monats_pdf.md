# 06 Laufendes Monats-PDF

Alle Daten sind erfunden. Noch von niemandem durchgespielt, weder auf einem echten Gerät noch in headless
Chromium (nur automatische Tests der Logik und des Ablaufs mit einem Tresor im Arbeitsspeicher und einem
Stellvertreter-Dienst). Für MT-30 braucht man eine Fassung mit Weiterreicher-Adresse (`VITE_TIMESTAMP_RELAY`),
siehe MT-26.

Die laufende Monatsdatei ist eine PDF-Datei je Monat, die nie neu gebaut, sondern nur fortgeschrieben wird:
Für jeden beendeten Tag kommt eine neue Seite (Stand des Monats bis zu diesem Tag) und ein neuer Anhang dazu,
danach ein Dokument-Zeitstempel. Der bisherige Export „Monat als PDF speichern“ bleibt daneben unverändert.

Monatsdateien werden außerhalb der App aufbewahrt: Die App behält nur die Datei des laufenden Monats und, bis
zum 7. des Folgemonats, die des Vormonats. Vom 1. bis 7. erinnert ein Hinweis oben, ab dem 8. sperrt eine
Abfrage die App, bis die Datei gespeichert und „Gespeichert – aus der App entfernen“ bestätigt ist; Stempeln
bleibt in dieser Abfrage möglich. Zum Durchspielen die Geräteuhr verstellen (Datum), die App danach neu laden.

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
- Im Register „Netzwerk“ der Entwicklerwerkzeuge gehen nur `POST …/v1/stamp/<Kennung>` (mit Vorabfrage `OPTIONS`) mit einer Prüfsumme hinaus, nie die Datei.

## MT-31: Monatswechsel, Löschen und was nicht in der Sicherung ist

**Schritte**

1. Am Ende eines Monats einen Tag stempeln, die App schließen und erst im neuen Monat wieder öffnen.
2. Im Bereich „Monat“ zum Vormonat blättern und den Abschnitt „Laufendes Monats-PDF“ ansehen.
3. Eine Sicherung speichern und auf einem anderen Browser einspielen; dort den Abschnitt ansehen.
4. Mit einem Testdatensatz, dessen Monat exportiert und älter als die Aufbewahrungszeit ist: unter „Sicherung“ „Fällige exportierte Monate löschen“.

**Erwartet**

- Schritt 2: Der letzte Tag des Vormonats ist in dessen laufender Datei enthalten (beim Start nachgeholt). Oben steht der Hinweis „Monatsdatei bitte speichern: …“ (siehe MT-32).
- Schritt 3: Die laufende Monatsdatei ist **nicht** in der Sicherung; auf dem anderen Browser beginnt sie neu (mit allen beendeten Tagen des laufenden und des Vormonats, aber anderen Zeiten auf den Seiten).
- Schritt 4: Liegt die laufende Monatsdatei des Monats noch in der App, verschwindet sie mit ihm; der Abschnitt sagt „Für diesen Monat liegt keine laufende Monatsdatei in der App.“
- Ein roter Hinweis „Achtung: Frühere Anhänge der Datei wurden entfernt oder verändert …“ darf nie erscheinen (er zeigt eine Datei an, die nicht nur ergänzt wurde).

## MT-32: Erinnerung in der ersten Woche, Speichern und Bestätigen

**Voraussetzung:** Ein Tag im Vormonat ist gestempelt; die Geräteuhr steht auf dem 1. bis 7. des neuen Monats.

**Schritte**

1. Die App öffnen.
2. Im Hinweis oben „Später“ drücken, durch die Seiten blättern, dann die App neu laden.
3. Im Hinweis „Speichern …“ drücken. Zuerst „Gespeichert – aus der App entfernen“ ansehen, dann „Speichern“ (oder „Teilen …“) drücken.
4. Die gespeicherte Datei öffnen, dann „Gespeichert – aus der App entfernen“ drücken und die Rückfrage bestätigen.
5. Unter „Monat“ zum Vormonat blättern.

**Erwartet**

- Schritt 1: Oben ein Hinweis „Monatsdatei bitte speichern: (Vormonat)“ mit „Speichern …“ und „Später“; alle Seiten bleiben bedienbar.
- Schritt 2: Nach „Später“ ist der Hinweis weg; nach dem Neuladen ist er wieder da.
- Schritt 3: Die Bestätigung ist ausgegraut mit dem Satz „Erst speichern oder teilen, dann bestätigen.“; nach dem Speichern ist sie bedienbar; „Gespeichert als zeiterfassung-JJJJ-MM-laufend.pdf …“.
- Schritt 4: Der Hinweis verschwindet. Die Datei enthält alle beendeten Tage des Vormonats.
- Schritt 5: „Die laufende Monatsdatei dieses Monats wurde am … gespeichert und aus der App entfernt; sie wird nicht weitergeführt.“ Sie wird auch nach dem Neuladen nicht neu angelegt.

## MT-33: Erzwungenes Speichern ab dem 8., Stempeln bleibt möglich

**Voraussetzung:** Die Datei des Vormonats liegt noch in der App (MT-32 nicht bestätigt); die Geräteuhr steht auf dem 8. oder später.

**Schritte**

1. Die App öffnen.
2. Versuchen, die Räder oder eine andere Seite zu bedienen; „Zurück“ des Browsers bzw. Wischen versuchen.
3. In der Abfrage unten unter „Stempeln“ „Kommen“ und später „Gehen“ drücken.
4. „Gespeichert – aus der App entfernen“ ohne vorheriges Speichern versuchen; dann „Speichern“ und bestätigen.

**Erwartet**

- Schritt 1: Eine bildschirmfüllende Abfrage „Monatsdatei speichern“ mit dem Vormonat, ohne „Schließen“ oder „Später“.
- Schritt 2: Keine andere Seite ist erreichbar; die Abfrage bleibt.
- Schritt 3: Stempeln funktioniert in der Abfrage; der Tag erscheint nach dem Bestätigen unter „Monat“ und in der laufenden Datei des neuen Monats.
- Schritt 4: Erst nach dem Speichern ist die Bestätigung möglich; danach verschwindet die Abfrage und die App ist wieder bedienbar.

## MT-34: Zwei Monate in der App, ein dritter kommt nicht hinein

**Voraussetzung:** Testdaten mit Tagen in drei aufeinanderfolgenden Monaten (zum Beispiel Oktober, November, Dezember); die Dateien für Oktober und November liegen in der App (Uhr nacheinander auf Oktober und November stellen, jeweils öffnen, nichts bestätigen).

**Schritte**

1. Die Geräteuhr auf den 2. Dezember stellen, einen Tag stempeln, die App neu laden.
2. Die Datei für Oktober speichern und bestätigen.

**Erwartet**

- Schritt 1: Sofort die sperrende Abfrage für Oktober („älter als der Vormonat“) und der Satz „Für den laufenden Monat ist kein Platz frei …“. Die Datei für November bleibt (nur Erinnerung). Stempeln geht.
- Schritt 2: Die Abfrage verschwindet (November bleibt als Erinnerung). Unter „Monat“ hat der Dezember jetzt eine laufende Datei mit dem gestempelten Tag (nachgeholt).

## MT-35: Datei zu groß für den Speicher

Mit normalen Daten kaum zu erreichen (ein Monat mit 22 Tagen braucht etwa 0,7 Mio. von 1,2 Mio. Zeichen). Nur
mit einer Testfassung, in der `PDF_SLOT_LIMIT` (`src/logic/runningPlan.ts`) klein gesetzt ist.

**Erwartet**

- Nach dem nächsten „Gehen“ wird der neue Stand nicht gespeichert; roter Hinweis „Die laufende Monatsdatei ist zu groß für den Speicher der App …“ und sofort die sperrende Abfrage für den laufenden Monat. Die Arbeitszeiten selbst sind gespeichert.
- Nach dem Speichern und Bestätigen führt die App diesen Monat nicht weiter (Satz im Abschnitt „Laufendes Monats-PDF“); der Export „Monat als PDF speichern“ geht weiterhin.

## MT-36: Übernahme aus der früheren Fassung

**Voraussetzung:** Ein Gerät, auf dem die frühere Fassung (ein Fach je Monat) schon laufende Dateien angelegt hat, für den laufenden, den Vormonat und einen älteren Monat.

**Erwartet**

- Nach dem ersten Start der neuen Fassung liegen die Dateien des laufenden und des Vormonats unverändert weitergeführt in der App (unter „Monat“ sichtbar, gleiche Titelseite mit der alten Beginn-Zeit).
- Für den älteren Monat erscheint der Hinweis „Monatsdatei bitte speichern“ mit „Eine laufende Monatsdatei … einer früheren Fassung …“; nach Speichern und Bestätigen ist sie weg.
