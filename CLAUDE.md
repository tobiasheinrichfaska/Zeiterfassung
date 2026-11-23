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
   a backup file everyone can make; at the end of the month a summary as **PDF with an attached JSON file**, which the
   employee mails himself/herself to the digital personnel file. **No `device-sync`, no Treffpunkt.**
2. **Later:** sync between devices with `device-sync` over a **configurable Treffpunkt** (a second one for
   the Kanzlei is possible), so that the person responsible for personnel sees the times; handing the data
   from an old device of that person to a new one; a separate base repo that fetches trusted timestamps
   from free (later also paid) time servers.

**Platform:** web (browser, installable later as PWA)
**Language:** TypeScript + React 19
**Architecture:** UI-free logic layer `src/logic/` (data model, rules, stamp clock, summary, report, backup,
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

| File/Folder                                                                                | Purpose                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                                                                | Project documentation and conventions                                                                                                                                                                                                                                                                                                       |
| `README.md`                                                                                | Short description (German), stages, license section                                                                                                                                                                                                                                                                                         |
| `FEATURES_REQUIRED.md`                                                                     | Critical user paths the audit validates                                                                                                                                                                                                                                                                                                     |
| `docs/data-model.html`                                                                     | Self-contained data-model reference (regenerate when the model changes; `tests/docs.test.ts` ties error codes and limits to it)                                                                                                                                                                                                             |
| `manual_tests/`                                                                            | Human-tester instructions (German)                                                                                                                                                                                                                                                                                                          |
| `src/logic/model.ts`                                                                       | Types (`TimeBook`, `Workday`, `Break`, `Settings`), `LIMITS`, `Reason` codes, `Result`                                                                                                                                                                                                                                                      |
| `src/logic/time.ts`                                                                        | Date/month keys, day arithmetic, `Clock`, formatting and parsing of times                                                                                                                                                                                                                                                                   |
| `src/logic/validate.ts`                                                                    | `checkWorkday`, `checkSettings`, break minutes                                                                                                                                                                                                                                                                                              |
| `src/logic/actions.ts`                                                                     | Stamp clock (`stampIn`, `breakStart`, `breakEnd`, `stampOut`), entry form (`setWorkday`, `removeWorkday`), `updateSettings`                                                                                                                                                                                                                 |
| `src/logic/changes.ts`                                                                     | Change log of days that are over (date < today): `changeEntry`, `addChanges`, `changesOfMonth`, `changeText`, `LOG_NOTICE`                                                                                                                                                                                                                  |
| `src/logic/summary.ts`                                                                     | Working minutes and `monthSummary`                                                                                                                                                                                                                                                                                                          |
| `src/logic/report.ts`                                                                      | `monthToJson` (the attached data file, canonical JSON), `canonicalJson`, `sha256Hex`, `attachmentName`                                                                                                                                                                                                                                      |
| `src/logic/backup.ts`                                                                      | `exportBackup`, strict `importBackup`                                                                                                                                                                                                                                                                                                       |
| `src/logic/retention.ts`                                                                   | `markExported`, `retentionReport`, `purgeExpired`                                                                                                                                                                                                                                                                                           |
| `src/logic/store.ts`                                                                       | `BOOK_SLOT`, `loadBook` (unreadable text is reported, never replaced), `serializeBook`                                                                                                                                                                                                                                                      |
| `src/logic/texts.ts`                                                                       | `REASON_TEXTS`: German message for every error code                                                                                                                                                                                                                                                                                         |
| `src/logic/view.ts`                                                                        | Stamp state and buttons (`STAMP_ENABLED`), form fields ↔ input (`parseDayForm`, `dayToForm`, `parseSettingsForm`), month labels, row texts                                                                                                                                                                                                  |
| `src/logic/pdf.ts`                                                                         | `monthLayout`, `monthToPdf` (pdf-lib 1.17.1): readable table, logged changes of the month, JSON attachment, SHA-256 of the attachment in the footer, several pages when needed                                                                                                                                                              |
| `src/logic/icc.ts`, `src/logic/chars.ts`                                                   | The sRGB profile generated in code (PDF/A output intent); `keepSupported` (characters the font lacks become „?“)                                                                                                                                                                                                                            |
| `src/logic/files.ts`                                                                       | File names, `describeBook`, `replaceQuestion` (asked before a backup replaces data)                                                                                                                                                                                                                                                         |
| `src/logic/index.ts`                                                                       | Public entry of the logic layer                                                                                                                                                                                                                                                                                                             |
| `third_party/`                                                                             | Licence texts and the list of third-party material (Noto Sans OFL 1.1, pdf-lib MIT, fontkit MIT)                                                                                                                                                                                                                                            |
| `src/io/files.ts`                                                                          | Browser files: download, share sheet, read a chosen file                                                                                                                                                                                                                                                                                    |
| `src/ui/`                                                                                  | React: `App` (wheel navigation, error banner), `BookProvider`/`bookContext` (book in the vault, every refusal shown), pages `StampPage`, `FormPage` + `DayForm`, `MonthPage`, `SettingsPage`, `BackupPage`, `navigation.ts` (tree as data, German wheel texts), `vault.ts` (prefix `zeiterfassung`, slot `book`, German texts), `styles.ts` |
| `src/main.tsx`                                                                             | Entry: `VaultGate` → `BookProvider` → `App`                                                                                                                                                                                                                                                                                                 |
| `tests/`                                                                                   | Vitest: `time`, `validate`, `actions`, `summary`, `changes`, `report`, `backup-retention`, `store`, `texts`, `view`, `files-move`, `pdf` (reads the PDF back), `vault` (in-memory vault), `navigation`, `docs`; `helpers.ts`                                                                                                                |
| `index.html`, `vite.config.ts`                                                             | Single-file build (`vite-plugin-singlefile`), dev port 5178                                                                                                                                                                                                                                                                                 |
| `package.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore` | Toolchain                                                                                                                                                                                                                                                                                                                                   |
| `.github/workflows/tests.yml`                                                              | Check "Tests": typecheck, lint, format, tests, build                                                                                                                                                                                                                                                                                        |
| `.gitattributes`, `.gitignore`                                                             | LF line endings; ignore rules                                                                                                                                                                                                                                                                                                               |
| `LICENSE`, `LICENSE_COMMERCIAL.md`, `CONTRIBUTING.md`                                      | AGPLv3 + commercial                                                                                                                                                                                                                                                                                                                         |

---

## Data Model

Authoritative reference: [`docs/data-model.html`](docs/data-model.html). Regenerate/align it in the same
session the model changes.

Decisions behind it: times are minutes since local midnight of the arrival day (wall clock, no time zone,
so daylight-saving changes need no special case; a shift past midnight has `endMin` above 1440); one
working day per date; a pause is a length or a span; at most one running day; backup and the stored book
are the same format (version 2; version 1 is read and migrated without loss).

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

- **The screens have never been run in a real browser** (nobody has opened the build yet): the vault in
  IndexedDB/localStorage, the wheel gestures, the file download, the share sheet and the look of the PDF
  in a viewer are unchecked. Automated: logic, the vault against its in-memory environment, the PDF read
  back (attachment, sums, metadata), the navigation tree. `manual_tests/` MT-01 to MT-19 are the first run.
- The PDF holds the readable table, the logged changes of the month and the monthly data as an **attached JSON file** (`zeiterfassung-JJJJ-MM.json`, canonical form) that only confirms the table (decision 2026-11-23); its SHA-256 is printed in the PDF. **XML can be added later if the personnel file demands it** (the earlier XML code was removed). Whether the personnel file accepts attachments is not checked.
- **PDF/A-3b: built to the standard, NOT validated.** Embedded fonts, XMP with `pdfaid` part 3 / conformance B, sRGB output intent with a profile generated in code, document ID, attachment as associated file with `AFRelationship Data`, no encryption, no scripts, DeviceRGB only — checked by structure tests of the written file (`tests/pdfa.test.ts`). No PDF/A checker (veraPDF needs Java; none installed) has been run: **say „nach PDF/A-3b gebaut, nicht validiert“, never „konform“**, until Tobias has a validator report. The sRGB profile is our own generation, not validated by an ICC tool.
- **Characters:** the embedded font (Noto Sans, Latin subset) covers the German alphabet (a–z, Ä Ö Ü ä ö ü ß), digits, usual punctuation including „ “ – and €. Anything it lacks (emoji, arrows, other scripts) is replaced by „?“ **in the PDF table and the change texts** (`keepSupported`); the attached JSON keeps the real text.
- The built HTML is about 1.5 MB (pdf-lib, fontkit, two font files). Third-party material and licences: `third_party/`.
- The backup file is **not encrypted** (readable text with all times); the vault copy is.
- The page position of the wheels is not remembered after a restart; a form being typed is lost when
  the page is swiped away.
- The app lock texts come from `local-vault` (German texts passed in `src/ui/vault.ts`).
- The bundle is about 715 kB (pdf-lib); no content security policy is set yet.
- One working day per date: a split shift (morning and evening) cannot be recorded as two shifts; use one
  day with a long pause.
- The stamp clock trusts the device clock. Nothing proves the time (a later stage adds timestamps from a
  time server).
- A lost device loses everything not backed up or mailed; there is no server copy by design.
- E-mailing the PDF is done by the employee by hand (a browser cannot attach a file to a `mailto:` link).
- The default retention of 24 months is a starting value, not a legal ruling.
- `local-vault` and `rad-navi` are not published to npm and not security-reviewed by a human; the
  stage-2 sync package is not used yet.

_Last updated: 2026-11-23 (stage 1 screens: vault, wheel navigation, stamp clock, entry form, month view, backup, PDF with attached JSON, change log, reopen; not yet run in a browser)_
