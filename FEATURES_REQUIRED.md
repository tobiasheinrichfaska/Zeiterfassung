# Critical User Paths — Zeiterfassung

**Purpose:** Core workflows that must not break. Audit validates these end-to-end.

Legende: `[x]` = gebaut und durch automatische Tests der Logik gedeckt; **im Browser noch von niemandem
durchgespielt** (siehe `manual_tests/`, MT-01 bis MT-13).

## Erfassen (Stufe 1)

- [x] **Stechuhr:** Kommen, Pause Beginn/Ende, Gehen; nur sinnvolle Knöpfe aktiv — `tests/actions.test.ts`, `tests/view.test.ts` (Knopftabelle gegen die Aktionen)
- [x] **Eingabeformular:** Tag mit Kommen, Gehen, Pausen (Dauer oder Zeitraum), Notiz, auch über Mitternacht; laufenden Tag korrigieren — `tests/view.test.ts`
- [x] **Fehler werden gezeigt:** jeder Fehlercode hat einen deutschen Text, ein roter Kasten bleibt bis „Gelesen“ — `tests/texts.test.ts`
- [x] **Zeiten bleiben nach dem Schließen erhalten** — verschlüsselt im Tresor, nicht lesbarer Inhalt wird nie überschrieben — `tests/vault.test.ts` (Arbeitsspeicher-Umgebung; echter Browser offen)
- [x] **Navigation** mit `rad-navi`: Erfassen, Monat, Einstellungen — Baum geprüft (`tests/navigation.test.ts`); Gesten nur am Gerät prüfbar
- [x] **Monat:** Tage ansehen, bearbeiten, verschieben, löschen; Summe; laufende Tage sichtbar — `tests/summary.test.ts`, `tests/files-move.test.ts`
- [x] **Sicherungsdatei** schreiben und streng wieder einlesen, mit Rückfrage — `tests/backup-retention.test.ts`, `tests/files-move.test.ts`
- [x] **PDF mit eingebettetem JSON** zum Mailen an die digitale Personalakte — `tests/pdf.test.ts`, `tests/report.test.ts` (PDF zurückgelesen: Anhang, Prüfsumme, Summen, Änderungen, neutrale Metadaten)
- [x] **„Kommen“ nach „Gehen“** öffnet den Tag nach Rückfrage wieder; die Lücke ist Pause — `tests/actions.test.ts`
- [x] **Änderungsprotokoll** für abgelaufene Tage (Nachtrag, Ändern, Verschieben, Löschen), im Monat und im Bericht — `tests/changes.test.ts`, `tests/pdf.test.ts`
- [x] **Sicherung verschlüsselt** (Passwort), unverschlüsselt nur nach ausdrücklicher Wahl; Einlesen beider Formen — `tests/backupCrypto.test.ts`
- [x] **Angefangenes Formular bleibt erhalten** (Speicher + Tresor-Fach) und die Seite der Räder wird gemerkt — `tests/draft-lastpage.test.ts`
- [x] **Strenge Content-Security-Policy** in der gebauten Datei — `tests/build/` (im Browser ungeprüft)
- [x] **PDF nach PDF/A-3b gebaut** (nicht validiert) — `tests/pdfa.test.ts`
- [x] **Zeitstempel-Kette:** jede abgeschlossene Schreibaktion und jeder abgelaufene Tag wird verkettet; Bruch wird erkannt — `tests/stamps.test.ts`
- [x] **Externe Anker:** Status (off/nothing/ok/due/overdue), strenge Aufnahme, Bericht mit Ankern und Token — `tests/anchors.test.ts`, `tests/report-stamps.test.ts`, `tests/anchor-service.test.ts` (nur mit Stellvertreter-Dienst; echter Dienst nicht angeschlossen)
- [x] **Aufbewahrung:** nur exportierte Monate werden auf Bestätigung gelöscht — `tests/backup-retention.test.ts`

| Path                                             | Impact                                      | Audit Check                                      |
| ------------------------------------------------ | ------------------------------------------- | ------------------------------------------------ |
| Stempeln und Tag erscheint in der Monatssumme    | Falsche Summe = falsche Abrechnung          | `tests/actions.test.ts`, `tests/summary.test.ts` |
| PDF-Summe und JSON-Anhang stimmen überein        | Personalakte bekommt widersprüchliche Daten | `tests/pdf.test.ts`                              |
| Sicherung zurückspielen                          | Verlust der Zeiten bei Gerätewechsel        | `tests/backup-retention.test.ts`                 |
| Kein Löschen nicht exportierter Monate           | Datenverlust                                | `tests/backup-retention.test.ts`                 |
| Falsches Passwort öffnet keine Sicherung         | Datenschutz                                 | `tests/backupCrypto.test.ts`                     |
| Unlesbarer Tresorinhalt wird nicht überschrieben | Datenverlust                                | `tests/vault.test.ts`                            |
| Keine Konsolenfehler beim Laden                  | App instabil                                | Browser, manuell (`manual_tests/` MT-01)         |
