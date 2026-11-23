// Reads the PDFs the end-to-end run saved (.tmp/e2e/out/*.pdf): prints the "Zeitstempel" section and checks
// every anchor token of the attached JSON with `openssl ts -verify` against the test root (an independent
// implementation, not the app's code). Start with Node 24 from the repository root: node e2e/pdfcheck.ts
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { inspect } from '../tests/pdfRead.ts';

const OUT = new URL('../.tmp/e2e/out/', import.meta.url).pathname;
const PKI = new URL('../.tmp/e2e/pki/', import.meta.url).pathname;
let failed = 0;
const check = (name: string, good: boolean, detail = '') => {
  if (!good) failed++;
  console.log(`${good ? 'PASS' : 'FAIL'} ${name}${detail ? '  -> ' + detail : ''}`);
};

for (const file of readdirSync(OUT).filter(
  (f) => f.endsWith('.pdf') && f.includes('zeiterfassung'),
)) {
  const { streams } = await inspect(new Uint8Array(readFileSync(OUT + file)));
  const json = JSON.parse(streams.embedded[0]?.text ?? 'null');
  const ts = json?.timestamps;
  console.log(`\n${file}: ${ts?.anchors?.length ?? '?'} anchors, status ${ts?.status?.state}`);
  const lines = streams.shown.split('\n');
  const from = lines.findIndex((l) => l.startsWith('Zeitstempel'));
  console.log(lines.slice(from, from + 14).join('\n'));
  check(
    `${file}: JSON has anchors with serial`,
    Array.isArray(ts?.anchors) &&
      ts.anchors.every((a: { serial?: string }) => /^[0-9a-f]+$/.test(a.serial ?? '')),
  );
  check(
    `${file}: PDF names the serial`,
    (ts?.anchors ?? []).every((a: { serial: string }) => streams.shown.includes(a.serial)),
  );
  for (const a of ts?.anchors ?? []) {
    writeFileSync(PKI + 'a.token', Buffer.from(a.token, 'base64'));
    const r = spawnSync(
      'openssl',
      [
        'ts',
        '-verify',
        '-in',
        PKI + 'a.token',
        '-token_in',
        '-digest',
        a.headHash,
        '-sha256',
        '-CAfile',
        PKI + 'root.crt',
        '-untrusted',
        PKI + 'chain.pem',
      ],
      { encoding: 'utf8' },
    );
    check(
      `${file}: openssl verifies anchor up to stamp ${a.coveredN} (serial ${a.serial})`,
      r.status === 0,
      (r.stdout + r.stderr).trim(),
    );
  }
}
process.exit(failed ? 1 : 0);
