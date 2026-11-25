# Geräteschlüssel: ein Gerät für den Zeitstempeldienst freischalten

Der Weiterreicher (Relay) des Pakets `zeitstempel` stempelt nur für Geräte, die er kennt. Jedes Gerät, auf dem die
Zeiterfassung läuft, bekommt dafür **einen eigenen Geräteschlüssel** (Entscheidung 2026-11-25). Ohne Schlüssel
erfasst die App die Zeiten wie immer; nur externe Zeitstempel (Anker der Stempelkette und der Dokument-Zeitstempel
des laufenden Monats-PDF) gibt es dann nicht. Die App zeigt das als „Gerät nicht freigeschaltet (Geräteschlüssel
fehlt)“.

Die Schlüssel werden **vorerst im Projekt** erzeugt (von der Person, die das Relay betreibt), später vielleicht von
einem Schlüsseldienst.

## Wie es funktioniert

- Ein Geräteschlüssel ist ein Schlüsselpaar (ECDSA P-256). Den **privaten** Teil bekommt nur das Gerät; das Relay
  kennt nur den **öffentlichen** Teil und eine Kennung in seiner Schlüsseldatei.
- Die App unterschreibt jede Stempel-Anfrage damit (Kopf `X-Zeitstempel-Auth`). Der Schlüssel selbst wird nie
  gesendet.
- Die App fragt **immer einzeln** („solo“): Der Dienst stempelt genau die Prüfsumme der App. Ein Stempel aus dem
  Sammelbetrieb des Relays gälte nur für die Wurzel eines Baums aus vielen Prüfsummen und wäre kein gültiger
  Dokument-Zeitstempel des PDF. Darum braucht jeder Geräteschlüssel in der Schlüsseldatei **`"solo": true`**
  (Schlüssel der Art 2). Ein Schlüssel ohne diese Erlaubnis wird abgelehnt, sobald das Relay im Sammelbetrieb läuft.

## 1. Schlüssel erzeugen (Betreiber des Relays)

Im geklonten Repository `zeitstempel` (`npm install` einmal vorher), mit einer Kennung je Gerät, z. B. `geraet-07`
(Kleinbuchstaben, Ziffern, Bindestrich, mit einem Buchstaben am Anfang, höchstens 32 Zeichen):

```bash
node scripts/make-key.ts geraet-07 --solo
```

Die Ausgabe hat zwei Zeilen (nur auf dem Bildschirm, es wird keine Datei geschrieben):

```text
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg…        <- Zeile 1: privater Schlüssel, nur für das Gerät
{"id":"geraet-07","publicKey":"BAsY3mTq0…","solo":true}  <- Zeile 2: Eintrag für die Schlüsseldatei
```

## 2. Zeile 2 in die Schlüsseldatei des Relays

Die Schlüsseldatei (Pfad aus `RELAY_KEYS_FILE`) hat diese Form; Zeile 2 kommt als neuer Eintrag in `keys`:

```json
{ "version": 2, "keys": [{ "id": "geraet-07", "publicKey": "BAsY3mTq0…", "solo": true }] }
```

Das Relay liest die Datei alle 5 Sekunden neu; ein Neustart ist nicht nötig. Die Datei enthält kein Geheimnis, aber
nur der Betreiber darf sie schreiben (wer sie schreiben kann, kann einen eigenen Schlüssel eintragen). Einzelheiten:
`docs/relay.md` des Pakets `zeitstempel`, Abschnitt „Zugangsschlüssel“.

## 3. Den Schlüsseltext für das Gerät bilden

Die App nimmt **einen** Text: die Kennung, einen Punkt, dann Zeile 1 (ohne Leerzeichen):

```text
geraet-07.MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg…
```

Der Text ist ein Geheimnis. **Über einen sicheren Weg** weitergeben (persönlich, verschlüsselte Nachricht, nicht
per gewöhnlicher E-Mail und nicht in einen Chat), und danach Zeile 1 beim Betreiber nicht aufbewahren. Geht der Text
verloren, wird ein neuer Schlüssel erzeugt (Schritte 1 bis 3) und der alte widerrufen.

## 4. Auf dem Gerät eintragen (Mitarbeiterin, Mitarbeiter)

1. In der App „Einstellungen“ öffnen, Abschnitt „Geräteschlüssel“.
2. Den Text in das Feld einfügen und „Schlüssel speichern“ drücken.
3. Dort steht dann „Gerät freigeschaltet mit dem Geräteschlüssel „geraet-07““. Der Schlüssel selbst wird nicht mehr
   angezeigt.

Die App prüft die Form (Kennung, Punkt, Schlüssel auf P-256) und liest den Schlüssel so ein, dass die Seite ihn
benutzen, aber nicht mehr auslesen kann. Gespeichert wird er **verschlüsselt im Tresor** der App (Fach
`geraeteschluessel`), nie im einfachen Speicher des Browsers und nicht in der Sicherungsdatei: Nach einem Gerätewechsel
wird er neu eingetragen (besser: ein neuer Schlüssel für das neue Gerät, der alte wird widerrufen).

„Schlüssel entfernen“ löscht ihn vom Gerät; danach wird nicht mehr gestempelt.

## Widerrufen

Den Eintrag aus `keys` der Schlüsseldatei entfernen. Das Relay lässt den Schlüssel spätestens 5 Sekunden nach dem
Speichern nicht mehr zu. Die App meldet dann „Geräteschlüssel wird vom Zeitstempeldienst nicht angenommen“; die
Zeiten werden weiter erfasst.

## Meldungen der App

| Meldung                                                      | Bedeutung                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Gerät nicht freigeschaltet (Geräteschlüssel fehlt).          | Ein Weiterreicher ist eingestellt, aber auf diesem Gerät ist kein Schlüssel eingetragen                                   |
| Geräteschlüssel wird vom Zeitstempeldienst nicht angenommen. | Status 401: Kennung unbekannt, Schlüssel widerrufen oder falsch, oder die Uhr weicht stark ab (die App korrigiert einmal) |
| … (Status 403, Schlüssel ohne Solo-Erlaubnis)                | Der Eintrag in der Schlüsseldatei hat kein `"solo": true`                                                                 |
| Der Geräteschlüssel hat nicht die erwartete Form …           | Der eingefügte Text ist nicht `<kennung>.<schlüssel>` (z. B. nur Zeile 1, Leerzeichen innen, abgeschnitten)               |
| Die Kennung vor dem Punkt ist ungültig …                     | Großbuchstaben, Ziffer am Anfang oder zu lang                                                                             |
| Dieser Geräteschlüssel lässt sich nicht verwenden …          | Kein ECDSA-Schlüssel auf P-256                                                                                            |

## Grenzen

- Wer das entsperrte Gerät in der Hand hat, kann den Schlüssel **benutzen** (stempeln lassen), aber nicht auslesen.
  Wer die Seite selbst verändern kann, kann ihn ebenfalls benutzen. Ein Schlüssel hält fremde Apps und Skripte vom
  Relay fern, nicht die Nutzer eines Geräts.
- Ein Schlüssel je Gerät und je Relay: denselben Schlüssel nicht bei zwei Relays eintragen (`docs/relay.md`,
  „Kein Relay in der Nachricht“).
- Frische: Die App nimmt nur ein Token an, dessen Zeit frühestens 60 Sekunden vor dem Senden liegt und höchstens
  5 Minuten nach jetzt. Weicht die Geräteuhr um mehr als 30 Sekunden von der Uhr des Relays ab (Kopf `Date`), gilt
  für diese Prüfung die Uhr des Relays; das Fenster beruht dann auf dessen Angabe.
- Anker der Stempelkette werden vorerst ebenfalls einzeln gestempelt (kein neues Ankerformat). Der Sammelbetrieb für
  Anker (Token und Beleg zusammen aufbewahren) ist eine spätere Möglichkeit.
