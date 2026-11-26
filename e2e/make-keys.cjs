// Writes the test keys of the end-to-end run into .tmp/e2e/keys/ (never into the repository), made by
// zeitstempel's own `scripts/make-key.ts` (ZEITSTEMPEL_DIR, run with Node 24: NODE24, default `node`):
//   relay-keys.json   the relay's key file {"version": 3, "keys": [...]} (public keys only)
//   geraet.txt        device key text of `e2e-geraet` (key type 2, `--solo`, `--services freetsa,sectigo`)
//   ohne-solo.txt     device key text of `e2e-ohne-solo` (key type 1): the relay refuses its solo stamps (403)
//   unbekannt.txt     device key text of `e2e-unbekannt`, whose public key is NOT in the key file (401)
// A device key text is `<kennung>.<privater Schlüssel>`, the private key being line 1 of `make-key`.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const DIR = path.join(__dirname, '..', '.tmp', 'e2e', 'keys');
const ZS = process.env.ZEITSTEMPEL_DIR ?? path.join(__dirname, '..', '..', 'zeitstempel');
const NODE = process.env.NODE24 ?? 'node';

function makeKey(id, ...flags) {
  const out = execFileSync(NODE, [path.join(ZS, 'scripts', 'make-key.ts'), id, ...flags], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const [privateKey, entry] = out.trim().split('\n');
  return { text: `${id}.${privateKey}`, entry: JSON.parse(entry) };
}

fs.mkdirSync(DIR, { recursive: true });
const geraet = makeKey('e2e-geraet', '--solo', '--services', 'freetsa,sectigo');
const ohneSolo = makeKey('e2e-ohne-solo');
const unbekannt = makeKey('e2e-unbekannt');
fs.writeFileSync(
  path.join(DIR, 'relay-keys.json'),
  JSON.stringify({ version: 3, keys: [geraet.entry, ohneSolo.entry] }) + '\n',
  { mode: 0o644 },
);
fs.writeFileSync(path.join(DIR, 'geraet.txt'), geraet.text, { mode: 0o600 });
fs.writeFileSync(path.join(DIR, 'ohne-solo.txt'), ohneSolo.text, { mode: 0o600 });
fs.writeFileSync(path.join(DIR, 'unbekannt.txt'), unbekannt.text, { mode: 0o600 });
console.log('keys written to ' + DIR);
