import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addCsp, checkCsp, cspFor, parsePolicy } from '../src/index.ts';
import { singleFileCsp } from '../src/vite.ts';

const hash = (t: string) => `'sha256-${createHash('sha256').update(t, 'utf8').digest('base64')}'`;
const page = (body: string, head = '') =>
  `<!doctype html><html><head><meta charset="UTF-8" />${head}<title>x</title></head><body>${body}</body></html>`;
const policyOf = (html: string): string =>
  /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? '';
const fixture = readFileSync(new URL('./fixtures/single.html', import.meta.url), 'utf8');

describe('cspFor', () => {
  it('forbids everything and allows only the given hashes', () => {
    const p = cspFor(["'sha256-AAA='"], []);
    expect(p).toBe(
      [
        "default-src 'none'",
        "script-src 'sha256-AAA='",
        "style-src 'none'",
        'img-src data:',
        "font-src 'none'",
        "connect-src 'none'",
        "worker-src 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; '),
    );
    expect(p).not.toMatch(/unsafe|\*|https?:/);
  });

  it('names the origins that are given for connect-src, and none otherwise', () => {
    expect(cspFor(["'sha256-A='"], [])).toContain("connect-src 'none'");
    expect(cspFor(["'sha256-A='"], [], ['https://a.example', 'http://localhost:1'])).toContain(
      'connect-src https://a.example http://localhost:1;',
    );
  });

  it('lists style hashes when there are inline styles', () => {
    expect(cspFor(["'sha256-A='"], ["'sha256-B='", "'sha256-C='"])).toContain(
      "style-src 'sha256-B=' 'sha256-C='",
    );
  });
});

describe('addCsp', () => {
  it('puts the policy right after the charset with the hash of the exact script text', () => {
    const js = 'console.log("a < b && c");';
    const html = addCsp(page(`<script type="module">${js}</script>`));
    expect(html.indexOf('Content-Security-Policy')).toBeGreaterThan(html.indexOf('<meta charset'));
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<title>'));
    expect(policyOf(html)).toContain(`script-src ${hash(js)}`);
    expect(html.match(/Content-Security-Policy/g)).toHaveLength(1);
  });

  it('hashes styles too, and a script that mentions a closing tag in an escaped form', () => {
    const css = 'body{margin:0}';
    const js = 'x = "<\\/script>";';
    const p = policyOf(addCsp(page(`<script>${js}</script>`, `<style>${css}</style>`)));
    expect(p).toContain(`style-src ${hash(css)}`);
    expect(p).toContain(hash(js));
  });

  it('passes the origins on to connect-src', () => {
    const html = addCsp(page('<script>1</script>'), { connectOrigins: ['https://relay.example'] });
    expect(policyOf(html)).toContain('connect-src https://relay.example;');
    expect(policyOf(addCsp(page('<script>1</script>')))).toContain("connect-src 'none'");
  });

  it('refuses a page that already has a policy', () => {
    const head = '<meta http-equiv="Content-Security-Policy" content="default-src *" />';
    expect(() => addCsp(page('<script>1</script>', head))).toThrow(/already has/);
  });

  it('refuses scripts and stylesheets from outside', () => {
    expect(() => addCsp(page('<script src="https://x/y.js"></script>'))).toThrow(
      /script from outside/,
    );
    expect(() => addCsp(page('<script src="app.js"></script>'))).toThrow(/script from outside/);
    expect(() =>
      addCsp(page('<script>1</script>', '<link rel="stylesheet" href="a.css">')),
    ).toThrow(/stylesheet from outside/);
  });

  it('refuses a page without an inline script or without a charset', () => {
    expect(() => addCsp(page('<p>hi</p>'))).toThrow(/no inline script/);
    expect(() => addCsp('<html><head></head><body><script>1</script></body></html>')).toThrow(
      /no <meta charset>/,
    );
  });
});

describe('the fixture page', () => {
  it('gets a policy whose hashes match checkCsp, with and without origins', () => {
    const plain = addCsp(fixture);
    expect(checkCsp(plain, { connectOrigins: [] })).toEqual({ ok: true, problems: [] });
    const origins = ['https://relay.example', 'http://localhost:8787'];
    const withOrigins = addCsp(fixture, { connectOrigins: origins });
    expect(checkCsp(withOrigins, { connectOrigins: origins }).problems).toEqual([]);
    expect(parsePolicy(withOrigins).get('connect-src')).toEqual(origins);
    expect(parsePolicy(plain).get('connect-src')).toEqual(["'none'"]);
    expect(checkCsp(plain, { connectOrigins: origins }).ok).toBe(false);
  });
});

describe('checkCsp', () => {
  const good = addCsp(fixture);

  it('refuses a page without a policy and a changed script', () => {
    expect(checkCsp(fixture).ok).toBe(false);
    const changed = good.replace('const text', 'const other');
    expect(checkCsp(changed).problems.join()).toMatch(/script-src/);
  });

  it('refuses a style that is not covered, and one added after the hashes', () => {
    const withStyle = good.replace('</head>', '<style>p{color:red}</style></head>');
    expect(checkCsp(withStyle).problems.join()).toMatch(/style-src/);
  });

  it('refuses external script, link and img', () => {
    expect(checkCsp(good.replace('</body>', '<script src="x.js"></script></body>')).ok).toBe(false);
    expect(
      checkCsp(good.replace('</head>', '<link rel="stylesheet" href="a.css"></head>')).ok,
    ).toBe(false);
    expect(checkCsp(good.replace('</head>', '<link rel="preload" href="a.css"></head>')).ok).toBe(
      false,
    );
    const img = checkCsp(good.replace('</body>', '<img src="https://x.example/a.png"></body>'));
    expect(img.ok).toBe(false);
    expect(img.problems.join()).toMatch(/external address/);
    expect(checkCsp(good.replace('</body>', '<img src="a.png"></body>')).ok).toBe(false);
    expect(
      checkCsp(good.replace('</body>', '<img src="data:image/gif;base64,AAAA"></body>')).ok,
    ).toBe(true);
  });

  it('refuses an unsafe or wildcard source and a second policy', () => {
    expect(checkCsp(good.replace("worker-src 'none'", 'worker-src *')).ok).toBe(false);
    expect(checkCsp(good.replace('img-src data:', "img-src data: 'unsafe-inline'")).ok).toBe(false);
    const twice = good.replace(
      '</head>',
      '<meta http-equiv="Content-Security-Policy" content="x"></head>',
    );
    expect(checkCsp(twice).ok).toBe(false);
  });

  it('ignores tags the bundled code only mentions as text', () => {
    const js = 'const s = \'<script src="x.js"><\\\\/script><img src="http://a/b">\';';
    expect(checkCsp(addCsp(page(`<script>${js}</script>`))).problems).toEqual([]);
  });
});

describe('policy parsing and unknown directives', () => {
  const good = addCsp(fixture);

  it('parsePolicy keeps the FIRST of a repeated directive, as browsers do', () => {
    const twice = good.replace("default-src 'none'", "default-src 'none'; default-src *");
    expect(parsePolicy(twice).get('default-src')).toEqual(["'none'"]);
    const first = good.replace("default-src 'none'", "default-src *; default-src 'none'");
    expect(parsePolicy(first).get('default-src')).toEqual(['*']);
  });

  it('checkCsp reports a repeated directive', () => {
    const twice = good.replace("default-src 'none'", "default-src 'none'; default-src 'none'");
    expect(checkCsp(twice).problems.join()).toMatch(/default-src is repeated/);
    expect(checkCsp(good).ok).toBe(true);
  });

  it('checkCsp reports a directive outside the documented set', () => {
    const extra = good.replace("default-src 'none'", "default-src 'none'; media-src 'none'");
    expect(checkCsp(extra).problems.join()).toMatch(/Unknown directive media-src/);
    const sandbox = good.replace("default-src 'none'", "default-src 'none'; Report-To x");
    expect(checkCsp(sandbox).ok).toBe(false);
  });
});

describe('comments and tag case', () => {
  const js = 'console.log(1);';

  it('a policy or script inside an HTML comment does not count', () => {
    const commented = page(
      `<script>${js}</script><!-- <script src="x.js"></script><meta http-equiv="Content-Security-Policy" content="x"> -->`,
    );
    const out = addCsp(commented);
    expect(checkCsp(out).problems).toEqual([]);
    expect(policyOf(out)).toContain(`script-src ${hash(js)}`);
  });

  it('a comment that mentions an external script does not make the page fail', () => {
    const out = addCsp(page(`<script>${js}</script><!-- <img src="http://a/b.png"> -->`));
    expect(checkCsp(out).ok).toBe(true);
  });

  it('an inline script is not a comment, and a comment-like text in code stays code', () => {
    const code = 'const a = "<!--";';
    const out = addCsp(page(`<script>${code}</script><script>${js}</script>`));
    expect(policyOf(out)).toContain(`${hash(code)} ${hash(js)}`);
    expect(checkCsp(out).problems).toEqual([]);
  });

  it('addCsp does not insert into a comment', () => {
    const html = `<!doctype html><html><head><!-- <meta charset="UTF-8" /> --></head><body><script>${js}</script></body></html>`;
    expect(() => addCsp(html)).toThrow(/charset/);
    const both = `<!doctype html><html><head><!-- <meta charset="UTF-8" /> --><meta charset="UTF-8" /></head><body><script>${js}</script></body></html>`;
    const out = addCsp(both);
    expect(out.indexOf('Content-Security-Policy')).toBeGreaterThan(out.indexOf('--><meta'));
    expect(checkCsp(out).ok).toBe(true);
  });

  it('tags are matched whatever their case', () => {
    const upper = `<!doctype html><html><head><META charset="UTF-8" /></head><body><SCRIPT>${js}</SCRIPT></body></html>`;
    const out = addCsp(upper);
    expect(policyOf(out)).toContain(`script-src ${hash(js)}`);
    expect(checkCsp(out).problems).toEqual([]);
    expect(() => addCsp(page('<SCRIPT SRC="x.js"></SCRIPT>'))).toThrow(/outside/);
    expect(() =>
      addCsp(
        page(`<script>${js}</script>`, '<META HTTP-EQUIV="Content-Security-Policy" content="x">'),
      ),
    ).toThrow(/already/);
    expect(checkCsp(out.replace('</body>', '<SCRIPT SRC="x.js"></SCRIPT></body>')).ok).toBe(false);
    expect(checkCsp(out.replace('</body>', '<SCRIPT>evil()</SCRIPT></body>')).ok).toBe(false);
  });
});

describe('singleFileCsp (Vite plugin)', () => {
  it('writes the policy into the written html file only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'einzeldatei-csp-'));
    writeFileSync(join(dir, 'index.html'), fixture);
    writeFileSync(join(dir, 'data.txt'), 'x');
    const plugin = singleFileCsp({ connectOrigins: ['https://relay.example'] });
    const write = plugin.writeBundle as (o: unknown, b: unknown) => void;
    write(
      { dir },
      {
        'index.html': { type: 'asset', fileName: 'index.html' },
        'data.txt': { type: 'asset', fileName: 'data.txt' },
        'a.js': { type: 'chunk', fileName: 'a.js' },
      },
    );
    const out = readFileSync(join(dir, 'index.html'), 'utf8');
    expect(checkCsp(out, { connectOrigins: ['https://relay.example'] }).problems).toEqual([]);
    expect(readFileSync(join(dir, 'data.txt'), 'utf8')).toBe('x');
    expect(plugin.name).toBe('einzeldatei-csp');
  });
});
