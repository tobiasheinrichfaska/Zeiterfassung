// Writes the test keys of the end-to-end run into .tmp/e2e/keys/ (never into the repository):
//   relay-keys.json   the relay's key file {"version": 2, "keys": [...]} (public keys only)
//   geraet.txt        device key text of `e2e-geraet` (key type 2, "solo": true): the one the app needs
//   ohne-solo.txt     device key text of `e2e-ohne-solo` (key type 1): the relay refuses its solo stamps (403)
//   unbekannt.txt     device key text of `e2e-unbekannt`, whose public key is NOT in the key file (401)
// A device key text is `<kennung>.<privater Schlüssel>`, the private key being line 1 of zeitstempel's
// `make-key` (ECDSA P-256, PKCS#8, base64url); these keys are made the same way, here, for the test only.
const fs = require('node:fs');
const path = require('node:path');
const { subtle } = require('node:crypto').webcrypto;
const DIR = path.join(__dirname, '..', '.tmp', 'e2e', 'keys');
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

async function makeKey(id) {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
  const raw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  return { text: `${id}.${b64url(pkcs8)}`, entry: { id, publicKey: b64url(raw) } };
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const geraet = await makeKey('e2e-geraet');
  const ohneSolo = await makeKey('e2e-ohne-solo');
  const unbekannt = await makeKey('e2e-unbekannt');
  fs.writeFileSync(
    path.join(DIR, 'relay-keys.json'),
    JSON.stringify({ version: 2, keys: [{ ...geraet.entry, solo: true }, ohneSolo.entry] }) + '\n',
    { mode: 0o644 },
  );
  fs.writeFileSync(path.join(DIR, 'geraet.txt'), geraet.text, { mode: 0o600 });
  fs.writeFileSync(path.join(DIR, 'ohne-solo.txt'), ohneSolo.text, { mode: 0o600 });
  fs.writeFileSync(path.join(DIR, 'unbekannt.txt'), unbekannt.text, { mode: 0o600 });
  console.log('keys written to ' + DIR);
})();
