# Hinweis 2026-11-27: Aktualisierung gemeinsamer Pakete

Nur zur Information und Prüfung. Es wurde in diesem Projekt kein Code und keine Abhängigkeit geändert.

## rad-navi

- Dieses Projekt nutzt `rad-navi` fest auf `v0.1.1`. Es ändert sich nichts, solange der Stand nicht angehoben wird.
- Am 2026-11-27 auf `main` dazugekommen (PR #8): nur Testkonfiguration (längeres Timeout) und eine Notiz,
  kein Laufzeitcode. Es gibt dafür keinen neuen Tag.
- Schon vorher auf `main`, aber nach `v0.1.1` und noch ohne Tag: Schnellzugriffe auf den Naben und
  „zuletzt geöffnete Seite merken“ (`rememberKey`). Wer das braucht, braucht einen neuen Tag oder Commit.
- Zu tun: nichts. Bei Bedarf prüfen, ob der Stand angehoben werden soll.

## pdf-fortschreiben: `v0.1.0` ist da, mit geänderter API

- Dieses Projekt ist fest auf Commit `d90c7cd` und läuft unverändert weiter.
- `v0.1.0` (Commit `c3f4151`) bricht die API: `appendRevision`, `writeUpdate`, `PdfFile.open` (der Konstruktor ist
  privat), `attachFile`, `readAttachments`, `attachmentChanges`, `appendDocTimeStamp`, `findDocTimeStamps`,
  `prepareDrawnPages`, `appendDrawnPages` werfen nicht mehr, sondern geben
  `{ ok: true, value }` oder `{ ok: false, code, detail }` zurück.
- `PdfReadError` und `PdfLibError` gibt es nicht mehr (jetzt `PdfError` mit `code`); die alten Lese-Codes bleiben.
  Ein ablehnender `Stamper` ergibt `stamper-failed`.
- Zu tun beim Umstieg auf den Tag: alle Aufrufe und Fehlerbehandlungen anpassen, Tests laufen lassen.
  Einzelheiten stehen in README und CLAUDE.md von `pdf-fortschreiben`.
