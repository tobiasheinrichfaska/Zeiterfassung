import { createHash } from 'node:crypto';
import { cspFor, withCsp } from '../../src/build/csp.ts';

const hash = (t: string) => `'sha256-${createHash('sha256').update(t, 'utf8').digest('base64')}'`;
const page = (body: string, head = '') =>
  `<!doctype html><html><head><meta charset="UTF-8" />${head}<title>x</title></head><body>${body}</body></html>`;
const policyOf = (html: string): string =>
  /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? '';

describe('cspFor', () => {
  it('forbids everything and allows only the given hashes', () => {
    const p = cspFor(["'sha256-AAA='"], []);
    expect(p).toContain("default-src 'none'");
    expect(p).toContain("script-src 'sha256-AAA='");
    expect(p).toContain("style-src 'none'");
    expect(p).toContain("connect-src 'none'");
    expect(p).toContain("object-src 'none'");
    expect(p).toContain("base-uri 'none'");
    expect(p).toContain("form-action 'none'");
    expect(p).toContain("worker-src 'none'");
    expect(p).toContain("frame-src 'none'");
    expect(p).toContain("font-src 'none'");
    expect(p).toContain('img-src data:');
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

describe('withCsp', () => {
  it('puts the policy right after the charset with the hash of the exact script text', () => {
    const js = 'console.log("a < b && c");';
    const html = withCsp(page(`<script type="module">${js}</script>`));
    expect(html.indexOf('Content-Security-Policy')).toBeGreaterThan(html.indexOf('<meta charset'));
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<title>'));
    expect(policyOf(html)).toContain(`script-src ${hash(js)}`);
    expect(html.match(/Content-Security-Policy/g)).toHaveLength(1);
  });

  it('hashes styles too, and a script that mentions a closing tag in an escaped form', () => {
    const css = 'body{margin:0}';
    const js = 'x = "<\\/script>";';
    const p = policyOf(withCsp(page(`<script>${js}</script>`, `<style>${css}</style>`)));
    expect(p).toContain(`style-src ${hash(css)}`);
    expect(p).toContain(hash(js));
  });

  it('inserts at the right place in the page even after a script, and never into a comment', () => {
    const early = '<script>var a = "a long script body before the charset";</script>';
    const src = `<!doctype html><html><head>${early}<meta charset="UTF-8" /><title>x</title></head><body><script>1</script></body></html>`;
    const out = withCsp(src);
    expect(out).toContain(early);
    expect(out).toContain(
      '<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy"',
    );
    const commented = `<!doctype html><html><head><!-- <meta charset="UTF-8" /> --></head><body><script>1</script></body></html>`;
    expect(() => withCsp(commented)).toThrow(/charset/);
    const both = commented.replace('--></head>', '--><meta charset="UTF-8" /></head>');
    expect(withCsp(both)).toContain('--><meta charset="UTF-8" />\n    <meta http-equiv');
  });

  it('upper-case tags count: an external <SCRIPT SRC> is refused', () => {
    expect(() => withCsp(page('<SCRIPT SRC="x.js"></SCRIPT>'))).toThrow(/script from outside/);
  });

  it('passes the relay origins on to connect-src', () => {
    const html = withCsp(page('<script>1</script>'), ['https://relay.example']);
    expect(policyOf(html)).toContain('connect-src https://relay.example;');
    expect(policyOf(withCsp(page('<script>1</script>')))).toContain("connect-src 'none'");
  });

  it('refuses a page that already has a policy', () => {
    const head = '<meta http-equiv="Content-Security-Policy" content="default-src *" />';
    expect(() => withCsp(page('<script>1</script>', head))).toThrow(/already has/);
  });

  it('refuses scripts and stylesheets from outside', () => {
    expect(() => withCsp(page('<script src="https://x/y.js"></script>'))).toThrow(
      /script from outside/,
    );
    expect(() => withCsp(page('<script src="app.js"></script>'))).toThrow(/script from outside/);
    expect(() =>
      withCsp(page('<script>1</script>', '<link rel="stylesheet" href="a.css">')),
    ).toThrow(/stylesheet from outside/);
  });

  it('refuses a page without an inline script or without a charset', () => {
    expect(() => withCsp(page('<p>hi</p>'))).toThrow(/no inline script/);
    expect(() => withCsp('<html><head></head><body><script>1</script></body></html>')).toThrow(
      /no <meta charset>/,
    );
  });
});
