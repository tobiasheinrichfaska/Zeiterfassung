import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

/**
 * Builds the real single file into the project's `.tmp/` and looks at what came out: the policy, its
 * hashes, and the code the policy has to live with. No browser and no server are used, so this proves
 * the file and the policy fit together on paper; whether a browser raises no violation at run time is
 * a manual test (MT-22).
 */
const root = fileURLToPath(new URL('../../', import.meta.url));
const outDir = '.tmp/csp-build';
/** The function-bind fallback of the bundled font library (see the test that names it). */
const FALLBACK = /Function\(`binder`,/g;
let html = '';
/** The page's own markup: the script bodies emptied (the bundled code mentions tags in its messages). */
let markup = '';

beforeAll(async () => {
  await build({
    root,
    configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });
  html = readFileSync(new URL(`../../${outDir}/index.html`, import.meta.url), 'utf8');
  markup = html.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/g, '<script$1></script>');
}, 120_000);

const policy = (): Map<string, string[]> => {
  const content = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? '';
  return new Map(
    content.split(';').map((d) => {
      const [name, ...sources] = d.trim().split(/\s+/);
      return [name ?? '', sources];
    }),
  );
};

describe('the built single file', () => {
  it('carries exactly one policy, in front of the script', () => {
    expect(html.match(/Content-Security-Policy/g)).toHaveLength(1);
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script'));
  });

  it('allows exactly the inline scripts by their SHA-256 hashes and nothing inline otherwise', () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    const wanted = scripts.map(
      (m) =>
        `'sha256-${createHash('sha256')
          .update(m[1] ?? '', 'utf8')
          .digest('base64')}'`,
    );
    expect(policy().get('script-src')).toEqual(wanted);
    expect(markup).not.toMatch(/<style\b/); // so style-src can stay 'none'
    expect(policy().get('style-src')).toEqual(["'none'"]);
  });

  it('forbids the network, frames, workers, plug-ins, forms and a base address', () => {
    const p = policy();
    for (const d of [
      'default-src',
      'connect-src',
      'worker-src',
      'frame-src',
      'object-src',
      'base-uri',
      'form-action',
      'font-src',
    ]) {
      expect(p.get(d), d).toEqual(["'none'"]);
    }
    expect(p.get('img-src')).toEqual(['data:']);
    const all = [...p.values()].flat().join(' ');
    expect(all).not.toMatch(/unsafe-inline|unsafe-eval|\*|https?:|blob:|ws:/);
  });

  it('loads nothing from outside the file', () => {
    expect(markup).not.toMatch(/<script[^>]*\bsrc=/i);
    expect(markup).not.toMatch(/<link[^>]*rel=["']?stylesheet/i);
    expect(markup).not.toMatch(/\b(?:src|href)=["']https?:/i);
    const links = [...markup.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
    for (const l of links) expect(l).toMatch(/href="data:/);
  });

  it('has the one known fallback that builds a function from text, and it is never reached', () => {
    // @pdf-lib/fontkit carries the „function-bind“ polyfill: `Function("binder", …)` runs only where
    // `Function.prototype.bind` is missing (no current browser). Under the policy (no unsafe-eval) it
    // could not run anyway. Any other construction of code from text must not appear (next test).
    expect(html.match(FALLBACK)).toHaveLength(1);
  });

  it('contains no code that a script policy without eval would stop, and no network code', () => {
    const code = html.replace(FALLBACK, 'FALLBACK(');
    for (const [name, pattern] of [
      ['eval', /\beval\s*\(/],
      ['new Function', /new\s+Function\b/],
      ['Function(', /(?:^|[^\w$.])Function\s*\(/],
      ['importScripts', /\bimportScripts\b/],
      ['WebAssembly', /\bWebAssembly\b/],
      ['Worker', /new\s+(?:Shared)?Worker\b/],
      ['fetch', /\bfetch\s*\(/],
      ['XMLHttpRequest', /\bXMLHttpRequest\b/],
      ['WebSocket', /\bWebSocket\b/],
      ['EventSource', /\bEventSource\b/],
      ['sendBeacon', /\bsendBeacon\b/],
      ['document.write', /\bdocument\.write\b/],
      ['style attribute', /setAttribute\(\s*["'`]style["'`]/],
    ] as const) {
      expect(code, name).not.toMatch(pattern);
    }
  });

  it('has the fonts and the app inside (one file), and a sane size', () => {
    expect(html).toContain('Zeiterfassung');
    expect(html.length).toBeGreaterThan(500_000);
    expect(html.length).toBeLessThan(4_000_000);
  });
});
