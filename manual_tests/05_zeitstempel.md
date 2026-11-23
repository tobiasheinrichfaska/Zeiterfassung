# 05 Zeitstempel (Stempelkette und externer Zeitstempeldienst)

Alle Daten sind erfunden. Bisher in keinem echten Browser durchgespielt. Einen echten Zeitstempeldienst
gibt es noch nicht: Die Fälle MT-26 bis MT-28 brauchen einen Stellvertreter (ein kleines Programm oder einen
Entwickler, der für den Test eine Fassung mit einer Weiterreicher-Adresse baut und einen Dienst nachstellt).

Wichtig vorab: Die **internen** Stempel stammen von der Geräteuhr und belegen keine Zeit. Nur die
**externen** Zeitstempel belegen sie. Eine Web-Anwendung kann „spätestens alle 24 Stunden“ nur erfüllen,
solange sie geöffnet und online ist; im Hintergrund geht nichts.

## MT-23: Die Stempelkette ist sichtbar

**Schritte**

1. Unter „Stempeln“ „Kommen“, „Pause Beginn“, „Pause Ende“ und „Gehen“ drücken.
2. Im Bereich „Monat“ den Abschnitt „Zeitstempel“ öffnen und „Stempelkette dieses Monats“ aufklappen.

**Erwartet**

- Vier Zeilen mit den Nummern 1 bis 4 ohne Lücke, jeweils Zeit (Geräteuhr, UTC), Art „Änderung“, Tag und die ersten 12 Zeichen einer Prüfsumme.
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

**Voraussetzung:** Eine Fassung mit Weiterreicher-Adresse; ein Stellvertreter-Dienst antwortet auf die Adresse mit `{"tsaId": …, "genTime": …, "token": …}`.

**Schritte**

1. In den Einstellungen die Adresse wählen, „Speichern“.
2. Im Bereich „Monat“ „Jetzt extern stempeln“ drücken.
3. Den Monat als PDF speichern.

**Erwartet**

- Schritt 2: Der Status wechselt auf „Alle … Stempel sind durch externe Zeitstempel abgedeckt (letzter: … UTC).“; es gibt keinen roten Kasten.
- Die App sendet nur die Prüfsumme (im Register „Netzwerk“: eine Anfrage an die gewählte Adresse, im Inhalt nur `hash`).
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
