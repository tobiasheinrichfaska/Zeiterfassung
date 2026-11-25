# CLAUDE.md — einzeldatei-csp

> Workspace-wide conventions (language, git, build, architecture, testing, collaboration):
> [`c:\skripte\private\general stuff\CLAUDE.md`](../../private/general%20stuff/CLAUDE.md)

---

## Project overview

Content-Security-Policy for an offline single-file web app (vite-plugin-singlefile): after the build, the
SHA-256 hashes of the inline scripts (and styles) are computed and one `<meta http-equiv="Content-Security-Policy">`
is written with `default-src 'none'`, the hashes and `connect-src` from a list of origins the caller gives
(none → `'none'`). Generalised 2026-11-25 from `Zeiterfassung`'s `src/build/csp.ts` (the default policy is
identical); the app does **not** use it yet.

**TEMPORARY LOCATION:** a subdirectory of the `Zeiterfassung` repo because the cloud session could not
create a repository. **Claude on the PC: extract it next time — follow `HERAUSLOESEN.md`.**

**Platform:** build tool (Node >= 22, `node:crypto` allowed; no network, no browser code)
**Language:** TypeScript (erasable syntax only)
**Architecture:** `src/csp.ts` pure functions over text (`addCsp`, `checkCsp`, `cspFor`, `hashOf`,
`parsePolicy`); `src/vite.ts` the thin Vite plugin (`singleFileCsp`, `vite` optional peer dependency).

## Key rules

- **Public repo (AGPLv3 + commercial):** no private project names, no real data, no credentials. Only
  `Zeiterfassung` and `Lohnarchiv` (both public) may be named.
- **The default policy stays exactly as `Zeiterfassung` has it** (`cspFor`); a change is a change for every app.
- `checkCsp` is the guard apps use in their built test; it must stay strict (hash match, no external load,
  no unsafe or wildcard source).
- Nothing is published, tagged or released without Tobias' OK.

## Project Directory

| File/Folder                                                             | Purpose                                                                                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/csp.ts`                                                            | `cspFor` (the policy), `addCsp` (insert after `<meta charset>`, throws on a bad page), `checkCsp`, `parsePolicy`, `hashOf` |
| `src/vite.ts`                                                           | `singleFileCsp(options)`: Vite plugin, applies `addCsp` to the written html in `writeBundle`                               |
| `src/index.ts`                                                          | Public entry (`.`); the plugin is `einzeldatei-csp/vite`                                                                   |
| `tests/csp.test.ts`                                                     | Policy, insertion, refusals, `checkCsp`, the plugin on a temp dir; `tests/fixtures/single.html`                            |
| `HERAUSLOESEN.md`                                                       | Steps to move this directory into its own repository (delete after doing it)                                               |
| `package.json`, `tsconfig.json`, `vitest.config.ts`, `.prettierrc.json` | Toolchain                                                                                                                  |

## Tests

```bash
npm ci
npm run typecheck
npm run format:check
npm test
```

## Known Limitations

- Fixed policy shape (`img-src data:`, no fonts/workers/frames/forms); no options beyond `connectOrigins`.
- Not run against a real build of an app from here; `Zeiterfassung`'s own built test still does that.
- A meta policy cannot carry `frame-ancestors` or `report-uri`.
- Not published, not tagged, not security-reviewed by a human.
