# Manuelle Tests — Zeiterfassung

Für Menschen am Bildschirm, ohne Programmierkenntnisse. Sie ergänzen die automatischen Tests und
prüfen nur, was eine Person sehen muss (Aussehen, Gesten, Dateien, Dialoge).

## Vorbereitung

1. Die Datei `dist/index.html` ist die ganze Anwendung (Entwicklung: `npm run build`).
2. Doppelklick öffnet sie im Browser. Es werden keine Daten ins Netz gesendet.
3. Alle Testdaten sind erfunden.

## Stand

Die Bildschirme der Stufe 1 sind gebaut. Ein Teil der Fälle (MT-01 bis MT-06, MT-08 bis MT-10, MT-12,
MT-13, MT-14, MT-15, MT-20, MT-21, MT-22 und die Stempelkette aus MT-23/24) lief am 2026-11-23 automatisiert in
headless Chromium (mit Fenstergröße eines Handys, über `http://localhost`, Start und Neuladen auch über `file://`); **auf einem echten Gerät und
in anderen Browsern hat sie noch niemand durchgespielt**, ebenso nicht MT-07, MT-11, MT-16 bis MT-19 und MT-25 bis MT-28. Automatisch geprüft sind die
Logik, das Lesen und Schreiben im Tresor (Speicher im Arbeitsspeicher), das PDF (zurückgelesen, Anhang
und Summen) und der Navigationsbaum.

## Dateien

| Datei                         | Inhalt                                                                   |
| ----------------------------- | ------------------------------------------------------------------------ |
| `01_start.md`                 | Start der Anwendung                                                      |
| `02_stechuhr_und_formular.md` | Stempeln, Tag eintragen, Fehlermeldungen, Mitternacht                    |
| `03_monat_sicherung_pdf.md`   | Monat, PDF mit Anhang, Sicherung, Aufbewahrung, Räder, Tresor            |
| `04_aenderungsprotokoll.md`   | Änderungen an abgelaufenen Tagen, Protokoll, Aufbewahrung                |
| `05_zeitstempel.md`           | Stempelkette, externer Zeitstempeldienst, fällig und überfällig, Bericht |
