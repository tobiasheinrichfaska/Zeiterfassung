# einzeldatei-csp

Eine **Content-Security-Policy für eine Offline-Einzeldatei-Web-App** (alles Skript inline, z. B. durch
`vite-plugin-singlefile`). Nach dem Bauen werden die SHA-256-Hashes der Inline-Skripte (und -Styles)
berechnet und ein `<meta http-equiv="Content-Security-Policy">` in die Datei geschrieben: `default-src 'none'`,
nur diese Hashes, `connect-src` nur für die übergebenen Ursprünge (keine → `'none'`). Der Browser selbst
verweigert dann jede Netzverbindung, jedes fremde Skript und `eval`, was der Code auch tut.

**Stand: 0.0.1, Entwurf.** Liegt vorläufig als Unterverzeichnis im Repo `Zeiterfassung`, wird in ein eigenes
Repo herausgelöst (`HERAUSLOESEN.md`). Nicht auf npm, nicht getaggt. Nur ein Bauwerkzeug (Node, kein Netz);
die Wirkung im Browser (keine Verstöße zur Laufzeit) muss die jeweilige App selbst von Hand prüfen.

## Benutzen

```ts
import { addCsp, checkCsp } from 'einzeldatei-csp';

const out = addCsp(html, { connectOrigins: ['https://relay.example'] }); // ohne connectOrigins: 'none'
checkCsp(out, { connectOrigins: ['https://relay.example'] }); // { ok, problems }
```

```ts
// vite.config.ts
import { singleFileCsp } from 'einzeldatei-csp/vite';
plugins: [viteSingleFile(), singleFileCsp({ connectOrigins })];
```

`addCsp` wirft bei einer Seite, die schon eine Policy hat, ein Skript oder Stylesheet von außen lädt, kein
Inline-Skript oder kein `<meta charset>` hat. `checkCsp` prüft die fertige Datei: genau eine Policy vor dem
ersten Skript, Hashes passen zum Inline-Text, keine unsicheren Quellen, nichts von außen geladen.

## Grenzen

- Styles dürfen inline stehen (dann mit Hash); Style-Eigenschaften über das CSSOM (React `style`-Props)
  schränkt keine Policy ein.
- Die Policy ist fest (`img-src data:`, keine Schriften, Worker, Frames, Formulare); andere Formen sind noch
  nicht vorgesehen.
- Ein Meta-Tag kann `frame-ancestors` und `report-uri` nicht ersetzen (nur über HTTP-Kopf möglich).

## Lizenz

AGPL-3.0-only oder kommerziell, siehe `LICENSE` und `LICENSE_COMMERCIAL.md`.
