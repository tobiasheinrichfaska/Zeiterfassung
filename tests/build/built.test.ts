import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

/**
 * Builds the real single file twice into the project's `.tmp/` — once without a relay, once with the
 * build variable `VITE_TIMESTAMP_RELAY` — and looks at what came out: the policy, its hashes, and the
 * code the policy has to live with. No browser and no server are used, so this proves the file and the
 * policy fit together on paper; whether a browser raises no violation at run time is a manual test
 * (MT-22).
 */
const root = fileURLToPath(new URL('../../', import.meta.url));

/** The function-bind fallback of the bundled font library (see the test that names it). */
const FALLBACK = /Function\(`binder`,/g;

async function buildFile(outDir: string, relays?: string): Promise<string> {
  const before = process.env.VITE_TIMESTAMP_RELAY;
  if (relays === undefined) delete process.env.VITE_TIMESTAMP_RELAY;
  else process.env.VITE_TIMESTAMP_RELAY = relays;
  try {
    await build({
      root,
      configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    });
  } finally {
    if (before === undefined) delete process.env.VITE_TIMESTAMP_RELAY;
    else process.env.VITE_TIMESTAMP_RELAY = before;
  }
  return readFileSync(new URL(`../../${outDir}/index.html`, import.meta.url), 'utf8');
}

const markupOf = (html: string): string =>
  html.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/g, '<script$1></script>');

const policyOf = (html: string): Map<string, string[]> => {
  const content = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? '';
  return new Map(
    content.split(';').map((d) => {
      const [name, ...sources] = d.trim().split(/\s+/);
      return [name ?? '', sources];
    }),
  );
};

let plain = '';
let withRelay = '';

beforeAll(async () => {
  plain = await buildFile('.tmp/csp-build', undefined);
  withRelay = await buildFile(
    '.tmp/csp-build-relay',
    'https://relay.example/stamp, http://localhost:8787/x, ftp://dropped.example/x, https://relay.example/stamp',
  );
}, 240_000);

/** What must hold for every build, whatever its relay setting. */
function commonChecks(name: string, get: () => string, connect: string[]) {
  describe(name, () => {
    it('carries exactly one policy, in front of the script', () => {
      const html = get();
      expect(html.match(/Content-Security-Policy/g)).toHaveLength(1);
      expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script'));
    });

    it('allows exactly the inline scripts by their SHA-256 hashes and nothing inline otherwise', () => {
      const html = get();
      const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
      expect(scripts.length).toBeGreaterThan(0);
      const wanted = scripts.map(
        (m) =>
          `'sha256-${createHash('sha256')
            .update(m[1] ?? '', 'utf8')
            .digest('base64')}'`,
      );
      expect(policyOf(html).get('script-src')).toEqual(wanted);
      expect(markupOf(html)).not.toMatch(/<style\b/); // so style-src can stay 'none'
      expect(policyOf(html).get('style-src')).toEqual(["'none'"]);
    });

    it('allows the network only where the build names a relay, and nothing else', () => {
      const p = policyOf(get());
      for (const d of [
        'default-src',
        'worker-src',
        'frame-src',
        'object-src',
        'base-uri',
        'form-action',
        'font-src',
      ]) {
        expect(p.get(d), d).toEqual(["'none'"]);
      }
      expect(p.get('connect-src')).toEqual(connect);
      expect(p.get('img-src')).toEqual(['data:']);
      const all = [...p.values()].flat().join(' ');
      expect(all).not.toMatch(/unsafe-inline|unsafe-eval|\*|blob:|ws:|javascript:/);
    });

    it('loads nothing from outside the file', () => {
      const markup = markupOf(get());
      expect(markup).not.toMatch(/<script[^>]*\bsrc=/i);
      expect(markup).not.toMatch(/<link[^>]*rel=["']?stylesheet/i);
      expect(markup).not.toMatch(/\b(?:src|href)=["']https?:/i);
      for (const l of [...markup.matchAll(/<link\b[^>]*>/g)].map((m) => m[0])) {
        expect(l).toMatch(/href="data:/);
      }
    });

    it('has the one known fallback that builds a function from text, and it is never reached', () => {
      // @pdf-lib/fontkit carries the „function-bind“ polyfill: `Function("binder", …)` runs only where
      // `Function.prototype.bind` is missing (no current browser). Under the policy (no unsafe-eval) it
      // could not run anyway. Any other construction of code from text must not appear (next test).
      expect(get().match(FALLBACK)).toHaveLength(1);
    });

    it('contains no code that a script policy without eval would stop, and only the one fetch', () => {
      const code = get().replace(FALLBACK, 'FALLBACK(');
      for (const [label, pattern] of [
        ['eval', /\beval\s*\(/],
        ['new Function', /new\s+Function\b/],
        ['Function(', /(?:^|[^\w$.])Function\s*\(/],
        ['importScripts', /\bimportScripts\b/],
        ['WebAssembly', /\bWebAssembly\b/],
        ['Worker', /new\s+(?:Shared)?Worker\b/],
        ['XMLHttpRequest', /\bXMLHttpRequest\b/],
        ['WebSocket', /\bWebSocket\b/],
        ['EventSource', /\bEventSource\b/],
        ['sendBeacon', /\bsendBeacon\b/],
        ['document.write', /\bdocument\.write\b/],
        ['style attribute', /setAttribute\(\s*["'`]style["'`]/],
      ] as const) {
        expect(code, label).not.toMatch(pattern);
      }
      // the one place that talks to the network: the relay adapter of the time stamps
      expect(code.match(/\bfetch\s*\(/g) ?? []).toHaveLength(1);
      expect(code).toMatch(/credentials:`omit`/);
      expect(code).toMatch(/redirect:`error`/);
    });

    it('has the fonts and the app inside (one file), and a sane size', () => {
      const html = get();
      expect(html).toContain('Zeiterfassung');
      expect(html.length).toBeGreaterThan(500_000);
      expect(html.length).toBeLessThan(4_000_000);
    });
  });
}

commonChecks('the built single file without a relay', () => plain, ["'none'"]);
commonChecks('the built single file with relays named by the build', () => withRelay, [
  'https://relay.example',
  'http://localhost:8787',
]);

describe('the relay setting of the build', () => {
  it('is not in a file built without it, and exactly the valid addresses are in one built with it', () => {
    expect(plain).not.toContain('relay.example');
    expect(plain).not.toContain('localhost:8787');
    expect(withRelay).toContain('https://relay.example/stamp');
    expect(withRelay).toContain('http://localhost:8787/x');
    expect(JSON.stringify([...policyOf(withRelay)])).not.toContain('dropped.example'); // invalid: not in the policy
  });

  it('allows only the origins, not the paths, and each origin once', () => {
    const connect = policyOf(withRelay).get('connect-src') ?? [];
    expect(connect).toEqual(['https://relay.example', 'http://localhost:8787']);
    expect(new Set(connect).size).toBe(connect.length);
  });
});
