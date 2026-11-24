# Herauslösen in ein eigenes Repo (Anweisung für Claude am PC)

Diese Bibliothek liegt nur vorläufig im Repo `Zeiterfassung`, weil die Cloud-Sitzung kein Repo anlegen
konnte (2026-11-24). **Beim nächsten Mal am PC herauslösen.** Name: Arbeitsname `pdf-fortschreiben` –
Tobias bestätigt den Namen und die Sichtbarkeit (öffentlich, AGPLv3 + kommerziell wie die anderen
Basis-Repos), bevor das Repo angelegt wird.

1. **Repo anlegen** (Tobias oder mit seinem OK): `tobiasheinrichfaska/pdf-fortschreiben`, leer, ohne README.
2. **Verlauf mitnehmen** (im Checkout von `Zeiterfassung`, Stand `main`, nachdem der PR gemergt ist):
   ```bash
   git subtree split --prefix=pdf-fortschreiben -b export/pdf-fortschreiben
   ```
3. **Neues Repo füllen** (neben den anderen öffentlichen Repos, z. B. `c:\skripte\public\pdf-fortschreiben`):
   ```bash
   git init pdf-fortschreiben && cd pdf-fortschreiben
   git pull ../Zeiterfassung export/pdf-fortschreiben
   git remote add origin https://github.com/tobiasheinrichfaska/pdf-fortschreiben.git
   git push -u origin main
   ```
4. **Im neuen Repo ergänzen** (ein PR): `.github/workflows/tests.yml` (der Job `pdf-fortschreiben` aus
   `Zeiterfassung/.github/workflows/tests.yml`, ohne `working-directory`), `eslint.config.js` und die
   Wächtertests wie in `zeitstempel` (kein `node:` in `src/`, keine privaten Namen), `SECURITY.md`. In
   `CLAUDE.md` den Abschnitt „TEMPORARY LOCATION“ und Aufgabe 1 entfernen; diese Datei löschen.
5. **Prüfen:** `npm ci`, `npm run typecheck`, `npm run format:check`, `npm test`, und einmal `npm run extern`
   (braucht `openssl`, `pdfsig`, Python für pyHanko).
6. **In `Zeiterfassung` aufräumen** (eigener PR): Verzeichnis `pdf-fortschreiben/` löschen, den CI-Job, die
   Einträge in `eslint.config.js` (`globalIgnores`) und `.prettierignore` entfernen, `CLAUDE.md` (Zeile im
   Verzeichnis und Abschnitt „Base library in a subdirectory“) anpassen. **Keine Abhängigkeit eintragen**,
   solange es keinen Tag mit Build gibt (Tag nur mit Tobias' OK).
7. **Workspace-Übersicht** (`c:\skripte\private\general stuff\CLAUDE.md`, Liste der Basis-Repos) und
   `Zeiterfassung-privat/docs/plan.md` nachziehen.
8. Den Export-Zweig löschen: `git branch -D export/pdf-fortschreiben`.
