# Critical User Paths — Zeiterfassung

**Purpose:** Core workflows that must not break. Audit validates these end-to-end.

## Erfassen (Stufe 1)

- [x] **Stechuhr:** Kommen, Pause beginnt, Pause endet, Gehen — Logik fertig und getestet (`tests/actions.test.ts`); Bildschirm fehlt noch
- [x] **Eingabeformular:** Tag mit Kommen, Gehen, Pausen anlegen oder ersetzen — Logik fertig; Bildschirm fehlt noch
- [ ] **Zeiten bleiben nach dem Schließen erhalten** — verschlüsselt im Tresor (`local-vault`); nicht gebaut
- [ ] **Navigation** mit `rad-navi` zwischen Erfassen, Monat, Einstellungen — nicht gebaut
- [x] **Monatssumme** — Logik fertig (`monthSummary`); Bildschirm fehlt noch
- [x] **Sicherungsdatei** schreiben und streng wieder einlesen — Logik fertig; Bildschirm fehlt noch
- [x] **XML der Monatszusammenfassung** — Logik fertig (`monthToXml`)
- [ ] **PDF mit eingebetteten XML-Daten** zum Mailen an die digitale Personalakte — nicht gebaut
- [x] **Aufbewahrung:** nur exportierte Monate werden nach Ablauf gelöscht — Logik fertig; Bildschirm fehlt noch

| Path                                          | Impact                               | Audit Check                                          |
| --------------------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| Stempeln und Tag erscheint in der Monatssumme | Falsche Summe = falsche Abrechnung   | `tests/actions.test.ts`, `tests/summary-xml.test.ts` |
| Sicherung zurückspielen                       | Verlust der Zeiten bei Gerätewechsel | `tests/backup-retention.test.ts`                     |
| Kein Löschen nicht exportierter Monate        | Datenverlust                         | `tests/backup-retention.test.ts`                     |
| Keine Konsolenfehler beim Laden               | App instabil                         | Browser, manuell (`manual_tests/`)                   |
