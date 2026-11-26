// Writes .tmp/e2e/trust.ts: the module that replaces src/io/zeitstempel.ts in the end-to-end build, with
// the root of the test PKI as the only trust anchor of the services the stand-in relay offers.
const fs = require('node:fs');
const pem = fs.readFileSync('.tmp/e2e/pki/root.crt', 'utf8');
const entry = (id) =>
  `[${JSON.stringify(id)}, { name: 'E2E', qualified: false, anchors: [${JSON.stringify(pem)}] }]`;
fs.mkdirSync('.tmp/e2e', { recursive: true });
fs.writeFileSync(
  '.tmp/e2e/trust.ts',
  `export const trustedServices = () => new Map([${entry('freetsa')}, ${entry('sectigo')}]);\n`,
);
