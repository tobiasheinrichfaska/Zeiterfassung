# CLAUDE.md — Zeiterfassung

> Workspace-wide conventions (language, git, build, architecture, testing, collaboration):
> [`c:\skripte\private\general stuff\CLAUDE.md`](../../private/general%20stuff/CLAUDE.md)

---

## Project overview

Working-time recording: employees record when they came, when they left and how long their breaks were —
as an entry form or with stamp-clock buttons. One offline HTML file (React/Vite singlefile), data only on
the device. Created 2026-11-23.

**Stages (Tobias, 2026-11-23):**

1. **Stage 1 (now):** record locally; store encrypted in `local-vault`; navigation with `rad-navi`;
   a backup file everyone can make; at the end of the month a summary as **PDF with XML data**, which the
   employee mails himself/herself to the digital personnel file. **No `device-sync`, no Treffpunkt.**
2. **Later:** sync between devices with `device-sync` over a **configurable Treffpunkt** (a second one for
   the Kanzlei is possible), so that the person responsible for personnel sees the times; handing the data
   from an old device of that person to a new one; a separate base repo that fetches trusted timestamps
   from free (later also paid) time servers.

**Platform:** web (browser, installable later as PWA)
**Language:** TypeScript + React 19
**Architecture:** UI-free logic layer `src/logic/` (data model, rules, stamp clock, summary, XML, backup,
retention; clock and "now" are parameters, errors are codes) and a thin UI `src/ui/`. The logic runs and is
tested without any UI. Private companion repo: `Zeiterfassung-privat` (data only).

## Key rules

- **Public repo (AGPLv3 + commercial):** no real data, no private project names, in files and in git
  history. Real times, names and exports never belong here (`.gitignore` blocks `*.pdf`, `*.xml`,
  `*.zeiterfassung.json`).
- Dependencies `local-vault` (tag `v0.1.0`) and `rad-navi` (tag `v0.1.1`) come by Git tag; their install
  scripts build them (`prepare`). Tags are changed only with Tobias' OK.
- The device clock is not a trusted time: `recordedAt` and the stamped minutes are what the device says.
- Retention: only a month that was **exported** may be purged, and never a running day.

---

## Project Directory

| File/Folder                                                                                | Purpose                                                                                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                                                                | Project documentation and conventions                                                                                           |
| `README.md`                                                                                | Short description (German), stages, license section                                                                             |
| `FEATURES_REQUIRED.md`                                                                     | Critical user paths the audit validates                                                                                         |
| `docs/data-model.html`                                                                     | Self-contained data-model reference (regenerate when the model changes; `tests/docs.test.ts` ties error codes and limits to it) |
| `manual_tests/`                                                                            | Human-tester instructions (German)                                                                                              |
| `src/logic/model.ts`                                                                       | Types (`TimeBook`, `Workday`, `Break`, `Settings`), `LIMITS`, `Reason` codes, `Result`                                          |
| `src/logic/time.ts`                                                                        | Date/month keys, day arithmetic, `Clock`, formatting and parsing of times                                                       |
| `src/logic/validate.ts`                                                                    | `checkWorkday`, `checkSettings`, break minutes                                                                                  |
| `src/logic/actions.ts`                                                                     | Stamp clock (`stampIn`, `breakStart`, `breakEnd`, `stampOut`), entry form (`setWorkday`, `removeWorkday`), `updateSettings`     |
| `src/logic/summary.ts`                                                                     | Working minutes and `monthSummary`                                                                                              |
| `src/logic/xml.ts`                                                                         | `monthToXml`: machine-readable monthly summary (`urn:zeiterfassung:monat:1`)                                                    |
| `src/logic/backup.ts`                                                                      | `exportBackup`, strict `importBackup`                                                                                           |
| `src/logic/retention.ts`                                                                   | `markExported`, `retentionReport`, `purgeExpired`                                                                               |
| `src/logic/index.ts`                                                                       | Public entry of the logic layer                                                                                                 |
| `src/ui/App.tsx`, `src/main.tsx`                                                           | UI shell (placeholder so far)                                                                                                   |
| `tests/`                                                                                   | Vitest: `time`, `validate`, `actions`, `summary-xml`, `backup-retention`, `docs`; `helpers.ts`                                  |
| `index.html`, `vite.config.ts`                                                             | Single-file build (`vite-plugin-singlefile`), dev port 5178                                                                     |
| `package.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore` | Toolchain                                                                                                                       |
| `.github/workflows/tests.yml`                                                              | Check "Tests": typecheck, lint, format, tests, build                                                                            |
| `.gitattributes`, `.gitignore`                                                             | LF line endings; ignore rules                                                                                                   |
| `LICENSE`, `LICENSE_COMMERCIAL.md`, `CONTRIBUTING.md`                                      | AGPLv3 + commercial                                                                                                             |

---

## Data Model

Authoritative reference: [`docs/data-model.html`](docs/data-model.html). Regenerate/align it in the same
session the model changes.

Decisions behind it: times are minutes since local midnight of the arrival day (wall clock, no time zone,
so daylight-saving changes need no special case; a shift past midnight has `endMin` above 1440); one
working day per date; a pause is a length or a span; at most one running day; backup and the stored book
are the same format (version 1).

## Development Server Ports

| Server             | Port |
| ------------------ | ---- |
| Vite dev / preview | 5178 |

## Tests

```bash
npm install
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

## Known Limitations

- Stage 1 is not finished: no screens yet (stamp clock, entry form, month view, settings, backup),
  the book is not yet stored in `local-vault`, navigation with `rad-navi` is not wired, and the **PDF
  export with XML data is not built** (only the XML text exists). Whether the XML is an attachment or
  machine-readable text pages in the PDF is open.
- One working day per date: a split shift (morning and evening) cannot be recorded as two shifts; use one
  day with a long pause.
- The stamp clock trusts the device clock. Nothing proves the time (a later stage adds timestamps from a
  time server).
- A lost device loses everything not backed up or mailed; there is no server copy by design.
- E-mailing the PDF is done by the employee by hand (a browser cannot attach a file to a `mailto:` link).
- The default retention of 24 months is a starting value, not a legal ruling.
- `local-vault` and `rad-navi` are not published to npm and not security-reviewed by a human; the
  stage-2 sync package is not used yet.

_Last updated: 2026-11-23 (project created: logic layer, data model, tests)_
