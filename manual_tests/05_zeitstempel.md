# 05 Zeitstempel (Stempelkette und externer Zeitstempeldienst)

Alle Daten sind erfunden. Auf einem echten Gerät und in anderen Browsern noch nicht durchgespielt. In headless
Chromium lief der Weg mit einem **lokalen** Weiterreicher (aus dem Paket `zeitstempel`) und einer Test-PKI statt
echter Dienste: siehe `e2e/README.md`. Mit einem **echten** Dienst über einen aufgestellten Weiterreicher hat es
noch niemand versucht (den Weiterreicher gibt es noch nicht im Netz). Für MT-25/26 braucht man einen Entwickler,
der eine Fassung mit Weiterreicher-Adresse baut (`VITE_TIMESTAMP_RELAY`).

Wichtig vorab: Die **internen** Stempel stammen von der Geräteuhr und belegen keine Zeit. Nur die
**externen** Zeitstempel belegen sie. Eine Web-Anwendung kann „spätestens alle 24 Stunden“ nur erfüllen,
solange sie geöffnet und online ist; im Hintergrund geht nichts.

## MT-23: Die Stempelkette ist sichtbar

**Schritte**

1. Unter „Stempeln“ „Kommen“, „Pause Beginn“, „Pause Ende“ und „Gehen“ drücken.
2. Im Bereich „Monat“ den Abschnitt „Zeitstempel“ öffnen und „Stempelkette dieses Monats“ aufklappen.

**Erwartet**

- Vier Zeilen mit den Nummern 1 bis 4 ohne Lücke, jeweils Zeit (Geräteuhr, UTC) mit der Art „Änderung“ darunter, Tag und die ersten 12 Zeichen einer Prüfsumme. Die Tabelle passt auf die Breite eines Handys (sonst lässt sie sich im Kasten seitlich schieben).
- Jede weitere Schreibaktion (Formular speichern, Tag löschen, wieder „Kommen“ nach „Gehen“) fügt genau eine Zeile hinzu.
- Am nächsten Tag (oder nach Mitternacht bei geöffneter App, spätestens nach einer Minute) kommt für den beendeten Tag eine Zeile „Abschluss“ dazu, danach für diesen Tag nicht mehr.
- Stellt man die Uhr des Geräts zurück und schreibt etwas, steht dort „(Uhr zurückgestellt)“; der Stempel wird trotzdem angehängt.

## MT-24: Kein Zeitstempeldienst eingerichtet

**Voraussetzung:** Eine Fassung ohne Weiterreicher (die normale Fassung).

**Schritte**

1. Im Bereich „Einstellungen“ die Zeile „Externer Zeitstempeldienst (Weiterreicher)“ ansehen.
2. Im Bereich „Monat“ den Abschnitt „Zeitstempel“ ansehen und den Knopf „Jetzt extern stempeln“ versuchen.
3. Den Monat als PDF speichern und im PDF den Abschnitt „Zeitstempel“ lesen.

**Erwartet**

- Die Auswahl zeigt nur „Aus (kein externer Zeitstempel)“ und den Hinweis, dass diese Fassung keinen Weiterreicher kennt.
- Im Abschnitt „Zeitstempel“ steht deutlich „Kein externer Zeitstempeldienst eingerichtet.“ (mit der Zahl der Stempel, die nur durch die Geräteuhr datiert sind); „Jetzt extern stempeln“ ist ausgegraut.
- Das PDF sagt dasselbe, nennt die Zahl der Stempel des Monats, den Kettenkopf (Nummer und Prüfsumme) und den Hinweis, dass die Geräteuhr keine Zeit belegt.
- Es wird nichts ins Netz gesendet (Entwicklerwerkzeuge, Register „Netzwerk“).

## MT-25: „fällig“ und „überfällig“

**Voraussetzung:** Eine Fassung mit Weiterreicher, in den Einstellungen eingeschaltet, der Dienst ist **nicht** erreichbar.

**Schritte**

1. Etwas stempeln. Im Abschnitt „Zeitstempel“ nachsehen.
2. Die Uhr des Geräts um mehr als 24 Stunden vorstellen (oder einen Tag warten), die App neu öffnen, nachsehen.
3. Einen Monat als PDF speichern.

**Erwartet**

- Schritt 1: „… Stempel warten auf den externen Zeitstempel (der älteste von …).“ (fällig). Bei jedem Versuch (Start, alle 15 Minuten, Knopf) erscheint ein roter Kasten mit dem Grund, zum Beispiel „Der Zeitstempeldienst ist nicht erreichbar. (…)“.
- Schritt 2: „Überfällig: … Stempel sind älter als 24 Stunden und noch nicht extern gestempelt …“. Die App verhindert nichts; sie zeigt es nur.
- Schritt 3: Das PDF wird trotzdem gespeichert; unter dem Knopf steht, dass es keinen frischen externen Zeitstempel gab; der Abschnitt „Zeitstempel“ im PDF nennt „Überfällig“ und „Nicht durch einen externen Zeitstempel abgedeckt ab Stempel Nr. …“.

## MT-26: Mit erreichbarem Dienst (Stellvertreter)

**Voraussetzung:** Eine Fassung mit Adresse eines Zeitstempel-Weiterreichers (`POST <Adresse>/v1/stamp/<Kennung>`, signiert; die Prüfung des Tokens macht die App selbst gegen die mitgelieferten Wurzelzertifikate). Der Weiterreicher muss die Herkunft der Seite erlauben (`RELAY_ORIGINS`), seine `RELAY_AUDIENCE` muss die der Fassung sein (`VITE_TIMESTAMP_AUDIENCE`, ohne sie die Herkunft des Weiterreichers).

**Schritte**

1. In den Einstellungen die Adresse wählen, „Speichern“.
2. Im Bereich „Monat“ „Jetzt extern stempeln“ drücken.
3. Den Monat als PDF speichern.

**Erwartet**

- Schritt 2: Der Status wechselt auf „Alle … Stempel sind durch externe Zeitstempel abgedeckt (letzter: … UTC).“; es gibt keinen roten Kasten.
- Die App sendet nur die Prüfsumme (im Register „Netzwerk“: eine Anfrage `POST …/v1/stamp/<Kennung>` (vorher die Vorabfrage `OPTIONS`), im Inhalt nur `hash` (43 Zeichen Base64url) und `"mode": "solo"`).
- Unter „Externe Zeitstempel“ steht eine Zeile mit Dienst, Zeit laut Token (UTC), „bis Stempel Nr. …“ und der Seriennummer; im PDF und im angehängten JSON stehen dieselbe Seriennummer und das Token.
- Ein Token, das nicht zur Prüfsumme passt, verändert oder von einem unbekannten Aussteller ist, wird abgelehnt („Das Token des Zeitstempeldienstes hat die Prüfung nicht bestanden. (…)“); es entsteht kein Eintrag. Antwortet der Weiterreicher mit „zu viele Anfragen“ (429), wartet die App die genannte Zeit ab („… nimmt vorerst keine weitere Anfrage an“) und fragt in der Zwischenzeit nicht nach.
- Schritt 3: Vor dem Speichern versucht die App einen frischen Zeitstempel; im PDF stehen unter „Zeitstempel“ der Dienst, die Zeit des Tokens, „deckt die Stempel bis Nr. …“ und die Prüfsumme. Im angehängten JSON stehen die Stempel des Monats und alle Anker samt Token (Base64).
- Eine Zeit im Token, die mehr als 15 Minuten von der Geräteuhr abweicht, wird abgelehnt mit „Die Zeit des externen Zeitstempels passt nicht zur Geräteuhr. …“.

## MT-27: Stempelkette nach Wiederherstellung

**Schritte**

1. Eine Sicherung speichern (MT-10) und einspielen.
2. Eine Sicherung mit einem Texteditor (unverschlüsselt) so verändern, dass ein Datum in der Liste „stamps“ geändert ist, und einspielen.

**Erwartet**

- Schritt 1: Die Kette ist nach dem Einspielen unverändert.
- Schritt 2: Roter Kasten „Die Stempelkette ist unterbrochen oder verändert …“; nichts wird eingespielt.
- Eine Sicherung aus einer älteren Fassung (Format 1 oder 2) wird eingespielt; die Kette beginnt dann leer, und beim nächsten Start bekommen alle bereits beendeten Tage einen Abschluss-Stempel.

## MT-28: Kette voll

**Hinweis:** Dieser Fall ist nur mit einem Testdatensatz mit fast 6000 Stempeln sinnvoll (ein Entwickler kann ihn erzeugen).

**Erwartet**

- Bei 6000 Stempeln lehnt die App eine neue Schreibaktion mit „Die Stempelkette ist voll (6000 Stempel). …“ ab; nichts wird still verworfen.
- Nach „Fällige exportierte Monate löschen“ wird die Kette nur gekürzt, wenn ein Anker die alten Stempel abdeckt (oder kein Weiterreicher eingestellt ist).

## MT-37: Gerät mit dem Geräteschlüssel freischalten

**Voraussetzung:** Eine Fassung mit Weiterreicher (`VITE_TIMESTAMP_RELAY`), der Weiterreicher läuft mit
Schlüsseldatei. Vom Betreiber drei Schlüsseltexte (Form `<kennung>.<schlüssel>`, siehe `docs/geraeteschluessel.md`):
A mit `"solo": true` in der Schlüsseldatei, B ohne `"solo"`, C gar nicht in der Schlüsseldatei. Alle Daten erfunden.

**Schritte**

1. Unter „Einstellungen“ den Weiterreicher wählen und „Speichern“. „Kommen“ stempeln, dann „Monat“ → „Zeitstempel“ ansehen.
2. Unter „Einstellungen“ → „Geräteschlüssel“ einen Text ohne Punkt (nur die lange Zeile) einfügen und „Schlüssel speichern“.
3. Schlüssel C einfügen und speichern; unter „Monat“ „Jetzt extern stempeln“.
4. Schlüssel B einfügen und speichern; wieder „Jetzt extern stempeln“.
5. Schlüssel A einfügen und speichern; wieder „Jetzt extern stempeln“.
6. Die App schließen und neu öffnen (mit App-Sperre: Passwort eingeben), „Einstellungen“ ansehen.
7. „Schlüssel entfernen“, Rückfrage bestätigen.

**Erwartet**

- Schritt 1: „Gerät nicht freigeschaltet (Geräteschlüssel fehlt). Den Geräteschlüssel tragen Sie unter „Einstellungen“ ein.“; „Jetzt extern stempeln“ ist ausgegraut. Das Stempeln der Zeiten funktioniert.
- Schritt 2: roter Kasten „Der Geräteschlüssel hat nicht die erwartete Form …“; nichts wird gespeichert.
- Schritt 3: Danach steht dort nur die Kennung („Gerät freigeschaltet mit dem Geräteschlüssel „…““), das Feld ist leer, der Schlüssel ist nirgends mehr zu sehen. Beim Stempeln roter Kasten „Geräteschlüssel wird vom Zeitstempeldienst nicht angenommen. (Status 401, unauthorized)“; kein externer Zeitstempel kommt dazu.
- Schritt 4: derselbe Kasten mit „(Status 403, Schlüssel ohne Solo-Erlaubnis)“ (nur wenn der Weiterreicher im Sammelbetrieb läuft; sonst wird gestempelt).
- Schritt 5: Status „ok“, ein externer Zeitstempel mehr; das laufende Monats-PDF wird nach dem nächsten „Gehen“ gestempelt.
- Schritt 6: Die Kennung von A steht weiter da (der Schlüssel liegt verschlüsselt im Tresor, nicht im einfachen Speicher des Browsers).
- Schritt 7: „Gerät nicht freigeschaltet (Geräteschlüssel fehlt).“; es wird nichts mehr gesendet.
