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
  type Shown = { coveredN: number; headHash: string; evidence?: { token?: string; hash?: string } };
  // every attached JSON file with a time stamp section (a running monthly PDF has one per day)
  const sections = streams.embedded
    .map((e) => {
      try {
        return (
          JSON.parse(e.text) as { timestamps?: { anchors?: Shown[]; status?: { state?: string } } }
        ).timestamps;
      } catch {
        return undefined;
      }
    })
    .filter((t) => t !== undefined);
  const anchors: Shown[] = sections.flatMap((t) => t.anchors ?? []);
  console.log(
    `\n${file}: ${sections.length} attachment(s), ${anchors.length} anchors, status ${sections.at(-1)?.status?.state}`,
  );
  const lines = streams.shown.split('\n');
  const from = lines.findIndex((l) => l.startsWith('Zeitstempel'));
  console.log(lines.slice(from, from + 14).join('\n'));
  check(
    `${file}: JSON has anchors with evidence (format v1)`,
    sections.length > 0 &&
      sections.every((t) => Array.isArray(t.anchors)) &&
      anchors.every(
        (a) =>
          typeof a.evidence?.token === 'string' &&
          // the evidence's hash (base64url) is the anchor's headHash
          Buffer.from(a.evidence.hash ?? '', 'base64url').toString('hex') === a.headHash,
      ),
  );
  for (const a of anchors) {
    writeFileSync(PKI + 'a.token', Buffer.from(a.evidence?.token ?? '', 'base64url'));
    // the serial as openssl reads it from the token (independent of the app's reader)
    const text = spawnSync(
      'openssl',
      ['ts', '-reply', '-in', PKI + 'a.token', '-token_in', '-text'],
      {
        encoding: 'utf8',
      },
    );
    const serial =
      /Serial number: (?:0x)?([0-9A-Fa-f]+)/.exec(text.stdout)?.[1]?.toLowerCase() ?? '';
    check(
      `${file}: PDF names the serial of anchor up to stamp ${a.coveredN}`,
      serial !== '' && streams.shown.toLowerCase().includes(serial.replace(/^0+(?=.)/, '')),
      serial || text.stderr.trim(),
    );
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
      `${file}: openssl verifies anchor up to stamp ${a.coveredN} (serial ${serial})`,
      r.status === 0,
      (r.stdout + r.stderr).trim(),
    );
  }
}
process.exit(failed ? 1 : 0);
