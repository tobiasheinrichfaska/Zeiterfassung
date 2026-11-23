# Manuelle Tests — Zeiterfassung

Für Menschen am Bildschirm, ohne Programmierkenntnisse. Sie ergänzen die automatischen Tests und
prüfen nur, was eine Person sehen muss (Aussehen, Gesten, Dateien, Dialoge).

## Vorbereitung

1. Die Datei `dist/index.html` ist die ganze Anwendung (Entwicklung: `npm run build`).
2. Doppelklick öffnet sie im Browser. Es werden keine Daten ins Netz gesendet.
3. Alle Testdaten sind erfunden.

## Stand

Die Bildschirme der Stufe 1 sind gebaut, **aber noch von niemandem in einem echten Browser
durchgespielt**: Die Fälle MT-02 bis MT-22 sind der erste Durchlauf. Automatisch geprüft sind die
Logik, das Lesen und Schreiben im Tresor (Speicher im Arbeitsspeicher), das PDF (zurückgelesen, Anhang
und Summen) und der Navigationsbaum.

## Dateien

| Datei                         | Inhalt                                                        |
| ----------------------------- | ------------------------------------------------------------- |
| `01_start.md`                 | Start der Anwendung                                           |
| `02_stechuhr_und_formular.md` | Stempeln, Tag eintragen, Fehlermeldungen, Mitternacht         |
| `03_monat_sicherung_pdf.md`   | Monat, PDF mit Anhang, Sicherung, Aufbewahrung, Räder, Tresor |
| `04_aenderungsprotokoll.md`   | Änderungen an abgelaufenen Tagen, Protokoll, Aufbewahrung     |
