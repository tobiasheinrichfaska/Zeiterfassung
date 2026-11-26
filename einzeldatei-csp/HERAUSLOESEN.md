# Herauslösen in ein eigenes Repo (Anweisung für Claude am PC)

Diese Bibliothek liegt nur vorläufig im Repo `Zeiterfassung`, weil die Cloud-Sitzung kein Repo anlegen
konnte (2026-11-25). **Beim nächsten Mal am PC herauslösen.**

## Auftrag an Claude am PC

- Mit Verlauf herauslösen (`git subtree split`), neues Repo **`einzeldatei-csp`**, öffentlich,
  AGPLv3 + kommerziell wie die anderen Basis-Repos.
- Tobias nur fragen, wenn der Name nicht passt (er beschreibt: Policy für eine Einzeldatei-App).
- **Ein PR pro Schritt** (Herauslösen, Ergänzungen im neuen Repo, Aufräumen in `Zeiterfassung`).
- Im neuen Repo CI, ESLint und Wächtertests ergänzen (siehe Schritt 4).
- Danach das Unterverzeichnis aus `Zeiterfassung` entfernen (Schritt 6).
- Dem **Lohnarchiv** einen Hinweis in dessen `CLAUDE.md` geben: es kann `einzeldatei-csp` benutzen (es ist
  heute eine Offline-Einzeldatei **ohne** CSP).
- **Nichts taggen oder veröffentlichen ohne Tobias' OK.**

## Schritte

1. **Repo anlegen:** `tobiasheinrichfaska/einzeldatei-csp`, leer, ohne README.
2. **Verlauf mitnehmen** (im Checkout von `Zeiterfassung`, Stand `main`, nachdem der PR gemergt ist):
   ```bash
   git subtree split --prefix=einzeldatei-csp -b export/einzeldatei-csp
   ```
3. **Neues Repo füllen** (neben den anderen öffentlichen Repos, z. B. `c:\skripte\public\einzeldatei-csp`):
   ```bash
   git init einzeldatei-csp && cd einzeldatei-csp
   git pull ../Zeiterfassung export/einzeldatei-csp
   git remote add origin https://github.com/tobiasheinrichfaska/einzeldatei-csp.git
   git push -u origin main
   ```
4. **Im neuen Repo ergänzen** (ein PR): `.github/workflows/tests.yml` (der Job `einzeldatei-csp` aus
   `Zeiterfassung/.github/workflows/tests.yml`, ohne `working-directory`), `eslint.config.js` und Wächtertests
   wie in `zeitstempel` (keine privaten Namen; nichts aus dem Netz: kein `fetch`, kein `node:http`), `SECURITY.md`.
   In `CLAUDE.md` den Abschnitt „TEMPORARY LOCATION“ entfernen; diese Datei löschen.
5. **Prüfen:** `npm ci`, `npm run typecheck`, `npm run format:check`, `npm test`.
6. **In `Zeiterfassung` aufräumen** (eigener PR): Verzeichnis `einzeldatei-csp/` löschen, den CI-Job, die
   Einträge in `eslint.config.js` (`globalIgnores`) und `.prettierignore` entfernen, `CLAUDE.md` (Zeile im
   Verzeichnis und Abschnitt „Base library `einzeldatei-csp`“) anpassen. Die App benutzt ihren eigenen Code
   (`src/build/csp.ts`) weiter, bis Tobias einen Tag mit OK freigibt; dann dort umstellen
   (`singleFileCsp`/`addCsp`/`checkCsp`, gleiche Standard-Policy, kein Verhaltenswechsel) und
   `tests/build/` auf `checkCsp` stützen.
7. **Lohnarchiv:** in dessen `CLAUDE.md` (Known Limitations) vermerken, dass es mit `einzeldatei-csp` eine
   CSP für die Einzeldatei bekommen kann.
8. **Workspace-Übersicht** (`c:\skripte\private\general stuff\CLAUDE.md`, Liste der Basis-Repos) nachziehen.
9. Den Export-Zweig löschen: `git branch -D export/einzeldatei-csp`.
