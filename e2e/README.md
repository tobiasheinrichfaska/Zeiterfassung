# Durchlauf im Browser (Ende zu Ende)

Lässt die gebaute Anwendung in headless Chromium gegen einen **lokalen** Zeitstempel-Weiterreicher laufen.
Es werden keine echten Dienste angefragt; der „Dienst“ hinter dem Weiterreicher ist `openssl ts -reply` mit
einer Test-PKI. Nicht Teil von `npm test` (braucht Playwright, `openssl`, Node 24 und das Repository
`zeitstempel` daneben).

Die einzige Abweichung vom echten Bau: `vite.e2e.config.ts` tauscht die **Wurzelzertifikate** der Dienste
gegen die Wurzel der Test-PKI (sonst könnte das Token der Test-PKI nicht geprüft werden). Weiterreicher-
Adapter, Prüfung, Oberfläche und Sicherheitsrichtlinie sind der ausgelieferte Code.

```bash
bash e2e/pki.sh                 # Test-PKI nach .tmp/e2e/pki
bash e2e/build.sh               # Bau nach .tmp/e2e-dist, Weiterreicher http://localhost:8790
node24 e2e/harness.ts &         # Weiterreicher :8790, Steuerung :8791, die Seite :5178 (Node 24)
node e2e/stamping.cjs           # Stempeln, fällig/ok/überfällig, 429, 502/504, manipulierte Antworten (~5 Minuten)
node e2e/retention.cjs          # Aufbewahrung (MT-11, MT-18), Protokoll (MT-16, MT-17), Breite 360/320 px
node24 e2e/pdfcheck.ts          # PDFs lesen, jedes Token mit `openssl ts -verify` prüfen
```

Umgebung: `ZEITSTEMPEL_DIR` (Standard `../zeitstempel`), `PLAYWRIGHT_MODULE` (Standard `playwright`),
`RELAY_ORIGINS` (Standard `http://localhost:5178`). Alle Daten sind erfunden; Ergebnisse und PDF liegen in
`.tmp/e2e/out/` (nicht im Git).
