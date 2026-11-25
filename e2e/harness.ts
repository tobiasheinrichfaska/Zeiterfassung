// Start with Node 24 from the repository root: node e2e/harness.ts
// Local relay (the one of the zeitstempel package) with a stand-in upstream (openssl ts -reply with a test PKI), a control port and a static server.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
const ZS = process.env.ZEITSTEMPEL_DIR ?? new URL('../../zeitstempel', import.meta.url).pathname;
const { createRelayServer } = await import(`${ZS}/relay/server.ts`);
const { loadServices } = await import(`${ZS}/relay/load.ts`);
const { UpstreamError } = await import(`${ZS}/relay/upstream.ts`);
const { readKeyFile } = await import(`${ZS}/relay/keys.ts`);
import { randomBytes } from 'node:crypto';

const D = new URL('../.tmp/e2e/pki/', import.meta.url).pathname;
const root = readFileSync(D + 'root.crt', 'utf8');
const mode = { value: 'normal', calls: 0, seen: [] as string[] };
const all = loadServices();
const services = all
  .filter((s) => ['freetsa', 'sectigo'].includes(s.id))
  .map((s) => ({ ...s, anchorPems: [root] }));
const upstream = async (target: { url: string }, body: Uint8Array) => {
  mode.calls++;
  mode.seen.push(target.url);
  if (mode.value === 'fail504') throw new UpstreamError('timeout');
  if (mode.value === 'fail502-first' && target.url.includes('freetsa'))
    throw new UpstreamError('failed');
  if (mode.value === 'slow') await new Promise((r) => setTimeout(r, 11_000));
  writeFileSync(D + 'q.tsq', body);
  const r = spawnSync(
    'openssl',
    ['ts', '-reply', '-queryfile', D + 'q.tsq', '-config', D + 'ts.cnf', '-out', D + 'r.tsr'],
    { cwd: D },
  );
  if (r.status !== 0) throw new UpstreamError('failed');
  return {
    status: 200,
    contentType: 'application/timestamp-reply',
    body: new Uint8Array(readFileSync(D + 'r.tsr')),
  };
};
const origins = (process.env.RELAY_ORIGINS ?? 'http://localhost:5178').split(',');
// the authenticated relay: the key file of the test keys (node e2e/make-keys.cjs first)
const keyFile = readKeyFile(
  JSON.parse(
    readFileSync(new URL('../.tmp/e2e/keys/relay-keys.json', import.meta.url).pathname, 'utf8'),
  ),
);
if (!keyFile.ok) throw new Error('key file: ' + keyFile.reason);
// collecting operation on (default 15 s, E2E_BATCH_MS=0 for single operation), so `mode: "solo"` and the
// solo permission of the key are really checked (without it the relay ignores `mode`)
const batchMs = Number(process.env.E2E_BATCH_MS ?? '15000');
const { server } = createRelayServer({
  services,
  origins,
  allowPlainHttp: false,
  upstream,
  random: (n) => new Uint8Array(randomBytes(n)),
  now: () => Date.now(),
  keys: keyFile.value,
  ...(batchMs > 0 ? { batch: { windowMs: batchMs, max: 128 } } : {}),
});
server.listen(8790, '127.0.0.1');

http
  .createServer((q, r) => {
    const u = new URL(q.url!, 'http://x');
    if (u.pathname === '/mode') {
      mode.value = u.searchParams.get('v') ?? 'normal';
      mode.seen = [];
      mode.calls = 0;
    }
    r.setHeader('content-type', 'application/json');
    r.end(JSON.stringify(mode));
  })
  .listen(8791, '127.0.0.1');

const page = readFileSync(
  process.env.DIST ?? new URL('../.tmp/e2e-dist/index.html', import.meta.url).pathname,
);
http
  .createServer((q, r) => {
    r.setHeader('content-type', 'text/html; charset=utf-8');
    r.end(page);
  })
  .listen(5178, '127.0.0.1');
console.log(`harness up (auth on, ${batchMs > 0 ? `batch ${batchMs} ms` : 'single operation'})`);
