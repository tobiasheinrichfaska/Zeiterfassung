# Durchlauf im Browser (Ende zu Ende)

Lässt die gebaute Anwendung in headless Chromium gegen einen **lokalen** Zeitstempel-Weiterreicher laufen.
Es werden keine echten Dienste angefragt; der „Dienst“ hinter dem Weiterreicher ist `openssl ts -reply` mit
einer Test-PKI. Nicht Teil von `npm test` (braucht Playwright, `openssl`, `faketime`, Node 24 und das Repository
`zeitstempel` daneben, auf dem Stand, an den `package.json` die App bindet).

**Angemeldetes Relay (seit 2026-11-25):** Das Relay läuft mit Schlüsseldatei und im Sammelbetrieb (Fenster
15 s; `E2E_BATCH_MS=0` für den Einzelbetrieb), damit `"mode": "solo"` und die Solo-Erlaubnis des Schlüssels
wirklich geprüft werden. Anmeldung v3 (seit 2026-11-25, `zeitstempel/client`): Das Relay hat `RELAY_AUDIENCE`
`zeiterfassung-e2e`, die Fassung wird mit derselben `VITE_TIMESTAMP_AUDIENCE` gebaut. `node e2e/make-keys.cjs` (ruft
`build.sh` auf) erzeugt die Schlüssel mit `scripts/make-key.ts` von `zeitstempel` (mit `NODE24`) und schreibt nach
`.tmp/e2e/keys/` die Schlüsseldatei Version 3 (`e2e-geraet` mit `"solo": true` und `"services": ["freetsa", "sectigo"]`,
`e2e-ohne-solo` ohne) und drei Geräteschlüssel-Texte
(`geraet.txt`, `ohne-solo.txt`, `unbekannt.txt`: nicht in der Schlüsseldatei). Die Skripte tragen den Schlüssel wie
eine Person unter „Einstellungen“ → „Geräteschlüssel“ ein (`enterKey` in `lib.cjs`); `stamping.cjs` prüft vorher
„nicht freigeschaltet“, den unbekannten Schlüssel (401) und den ohne Solo (403).

**Uhr:** Der Client gleicht eine Abweichung der Geräteuhr vom Relay nur bis 65 s aus. Wo ein Skript die Uhr der Seite
verstellt, ohne dass es um eine falsche Uhr geht (Tage, Monatswechsel), stellt es mit `syncClock` (`lib.cjs`) die Uhr des
Relays und des Stellvertreter-Dienstes (`faketime` um `openssl ts -reply`) auf dieselbe Zeit (Steuerung `/clock?offset=`).

Die einzige Abweichung vom echten Bau: `vite.e2e.config.ts` tauscht die **Wurzelzertifikate** der Dienste
gegen die Wurzel der Test-PKI (sonst könnte das Token der Test-PKI nicht geprüft werden). Weiterreicher-
Adapter, Prüfung, Oberfläche und Sicherheitsrichtlinie sind der ausgelieferte Code.

```bash
bash e2e/pki.sh                 # Test-PKI nach .tmp/e2e/pki
NODE24=node24 bash e2e/build.sh # Testschlüssel nach .tmp/e2e/keys, Bau nach .tmp/e2e-dist, Weiterreicher http://localhost:8790
node24 e2e/harness.ts &         # Weiterreicher :8790, Steuerung :8791, die Seite :5178 (Node 24)
node e2e/stamping.cjs           # Stempeln, fällig/ok/überfällig, 429/503 (Warten im Client, Pause), 502/504, manipulierte Antworten, falsche Uhr (~8 Minuten)
node e2e/retention.cjs          # Aufbewahrung (MT-11, MT-18), Protokoll (MT-16, MT-17), Breite 360/320 px
node e2e/runningpdf.cjs         # Laufendes Monats-PDF (MT-29 bis MT-33 teilweise): Tag, Zeitstempel, Relay aus/an, Monatswechsel, Speichern (~6 Minuten; Node >= 22)
node24 e2e/pdfcheck.ts          # PDFs lesen, jedes Token mit `openssl ts -verify` prüfen
```

Umgebung: `ZEITSTEMPEL_DIR` (Standard `../zeitstempel`), `PLAYWRIGHT_MODULE` (Standard `playwright`),
`RELAY_ORIGINS` (Standard `http://localhost:5178`). Alle Daten sind erfunden; Ergebnisse und PDF liegen in
`.tmp/e2e/out/` (nicht im Git).
