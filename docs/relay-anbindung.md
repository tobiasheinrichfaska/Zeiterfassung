# Was noch fehlt, damit das Zeitstempel-Relay diese App annimmt

Stand 2026-11-27. Die App ist für das Relay des Pakets `zeitstempel` gebaut; gegen ein aufgestelltes Relay ist sie
noch nie gelaufen (nur gegen ein lokales mit Test-PKI, `e2e/`). Konkrete Adressen und Kennungen stehen nicht in
diesem öffentlichen Repository, sondern beim Betreiber.

Unten steht `https://RELAY` für die Adresse des Relays und `https://APP` für die Adresse, unter der die App läuft.

## Schon passend

- Anmeldung (Auth v3): Der festgelegte Stand `951b91f` und das Relay-Image `6f218e6` sprechen dasselbe Protokoll
  (dazwischen keine Änderung an der Anmeldung).
- Dienste: Die App fragt zuerst `freetsa`. Ein Relay, das nur `freetsa` anbietet, genügt.
- Sicherheitsrichtlinie der Seite: `connect-src` wird beim Bauen aus `VITE_TIMESTAMP_RELAY` gesetzt.

## Es fehlt, in dieser Reihenfolge

| Nr. | Was                                                                                                                                                                                        | Wer                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| 1   | **Eine Adresse für die App** (`https://…`). Als Datei geöffnet (`file://`) hat die Seite keine Herkunft; das Relay lehnt sie ab. Aufzeichnen geht trotzdem, nur ohne externen Zeitstempel. | Entscheidung             |
| 2   | **Diese Herkunft beim Relay erlauben:** `RELAY_ORIGINS=https://APP` (nur Schema und Rechnername, ohne Pfad und Schrägstrich; mehrere durch Komma), danach Neustart.                        | Betreiber                |
| 3   | **Je Gerät ein Schlüssel** (`docs/geraeteschluessel.md`): öffentlicher Eintrag in die Schlüsseldatei des Relays, privater Teil nur auf das Gerät.                                          | Betreiber, Mitarbeitende |
| 4   | **Die App mit der Adresse bauen:** `VITE_TIMESTAMP_RELAY=https://RELAY`; `VITE_TIMESTAMP_AUDIENCE` nur, wenn die `RELAY_AUDIENCE` des Relays davon abweicht.                               | Entwicklung              |
| 5   | **Diesen Bau unter `https://APP` bereitstellen.**                                                                                                                                          | Betreiber                |
| 6   | **In der App einschalten:** „Externer Zeitstempeldienst (Weiterreicher)“ steht anfangs auf „Aus“. Adresse wählen, „Speichern“, dann den Geräteschlüssel einfügen.                          | Mitarbeitende            |
| 7   | **Probe im Browser gegen das echte Relay:** ein Stempel, die Meldungen bei falschem Schlüssel, keine Verletzung der Sicherheitsrichtlinie in der Konsole.                                  | Mensch am Bildschirm     |

## Zu beachten

- **Schlüsseldatei als Umgebungsvariable** (`RELAY_KEYS_JSON`, Container ohne Datei-Mount): Ein neuer oder
  widerrufener Schlüssel gilt dann erst nach Ändern der Variablen und Neustart des Containers, nicht nach
  5 Sekunden.
- **Art des Schlüssels:** Immer mit `--solo` erzeugen. Ohne Sammelbetrieb prüft das Relay die Art nicht; mit
  Sammelbetrieb würde ein Schlüssel ohne die Erlaubnis abgelehnt.
- **Gemeinsames Budget:** `freetsa` wird höchstens alle 5 Sekunden gefragt, für alle Geräte und Apps zusammen.
  Bei mehreren Nutzergruppen `RELAY_KEY_SHARE=50` setzen.
- **Daten:** Es geht nur eine Prüfsumme hinaus; Relay und Dienst sehen aber Zeitpunkt und Netzadresse.

## Vor echtem Betrieb (nicht nur zum Testen)

- Beim Relay: Begrenzung je Netzadresse, nur `https`, Überwachung.
- Rechtlich geklärt, ob der freie, nicht qualifizierte Dienst dafür genutzt werden soll (Nutzungsbedingungen
  nicht juristisch geprüft, `docs/dienste.md` des Pakets `zeitstempel`).
- Weder Relay noch App sind von einem Menschen sicherheitsgeprüft.
