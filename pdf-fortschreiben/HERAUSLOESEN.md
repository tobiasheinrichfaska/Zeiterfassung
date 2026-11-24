# Herauslösen in ein eigenes Repo (Anweisung für Claude am PC)

## Auftrag an Claude am PC (von Tobias, 2026-11-24)

> Löse die Bibliothek `pdf-fortschreiben` aus dem Repo `Zeiterfassung` in ein eigenes Repo heraus, mit
> Verlauf, nach den Schritten unten. Name `pdf-fortschreiben`, **öffentlich**, Lizenz AGPLv3 + kommerziell
> wie die anderen Basis-Repos. Frag mich vor dem Anlegen des Repos nur, falls dir der Name nicht passt;
> lege es sonst an (Schritt 1). Danach Schritte 2–8, jeweils mit PR; am Ende eine kurze Liste, was erledigt
> ist und was offen blieb. Nichts taggen oder veröffentlichen ohne mein OK.

**Zusätzlich (Tobias' OK liegt vor, 2026-11-24):** im Repo `zeitstempel` den Tag `v0.1.0` auf den
Merge-Commit `a7a2db432019e16c31764751db2cfe05ddb456a9` setzen und pushen (die Cloud-Sitzung durfte keine Tags
pushen). Geprüft: eine Installation dieses Commits per Git baut über `prepare` das `dist` und exportiert
`createRelayClient`.

```bash
git -C <zeitstempel> fetch origin main
git -C <zeitstempel> tag -a v0.1.0 a7a2db432019e16c31764751db2cfe05ddb456a9 -m "zeitstempel 0.1.0"
git -C <zeitstempel> push origin v0.1.0
```

Kurz zum Stand: 0.0.1, nur Node-Tests, CI-Job `pdf-fortschreiben` in `Zeiterfassung` grün; Gegenprüfung
(`npm run extern`) braucht `openssl`, `pdfsig` und Python (pyHanko, pikepdf in `.tmp/venv`). Auch das
`Lohnarchiv` will PDFs mit `DocTimeStamp` stempeln: nach dem Herauslösen in dessen `CLAUDE.md` auf das neue
Repo verweisen (dort steht schon ein Hinweis).

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
