// Content-Security-Policy of the single HTML file (the idea taken over from the other single-file apps of
// the same author): the browser itself refuses every network connection, every foreign script and
// eval — whatever the code does. The one inlined script is allowed by its SHA-256 hash, computed after
// inlining. Styles come from the CSSOM (React's style props), which a policy does not restrict, so no
// inline style text is allowed (and none is emitted).
import { createHash } from 'node:crypto';

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
const STYLE = /<style\b([^>]*)>([\s\S]*?)<\/style>/g;

function hashOf(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

/**
 * The policy for these inline script and style hashes. The page never connects anywhere; it needs no
 * fonts, frames, workers, plug-ins or forms (a download is made from a `blob:` link, which is not a
 * fetch). `data:` images are for the empty favicon only. `connect-src` is `'none'` unless the build
 * names relay origins (see `parseRelayList`): then exactly those origins, nothing else.
 */
export function cspFor(
  scriptHashes: readonly string[],
  styleHashes: readonly string[],
  connectOrigins: readonly string[] = [],
): string {
  return [
    "default-src 'none'",
    `script-src ${scriptHashes.join(' ')}`,
    `style-src ${styleHashes.length > 0 ? styleHashes.join(' ') : "'none'"}`,
    'img-src data:',
    "font-src 'none'",
    `connect-src ${connectOrigins.length > 0 ? connectOrigins.join(' ') : "'none'"}`,
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/**
 * Inserts the policy as the first element after `<meta charset>`. Refuses a page that loads a script or
 * stylesheet from outside or already carries a policy — the single file must not.
 */
export function withCsp(html: string, connectOrigins: readonly string[] = []): string {
  // Look at the page's own markup only: the bundled code may mention these tags as text.
  const markup = html.replace(SCRIPT, (_all, attrs: string) => `<script${attrs}></script>`);
  if (/<meta[^>]+http-equiv=["']?Content-Security-Policy/i.test(markup)) {
    throw new Error('The page already has a Content-Security-Policy');
  }
  if (/<link\b[^>]*rel=["']?stylesheet/i.test(markup)) {
    throw new Error('The page loads a stylesheet from outside');
  }
  const scripts = [...html.matchAll(SCRIPT)];
  if (scripts.some((match) => /\bsrc\s*=/i.test(match[1] ?? ''))) {
    throw new Error('The page loads a script from outside');
  }
  if (scripts.length === 0) throw new Error('The page has no inline script');
  const styles = [...markup.matchAll(STYLE)];
  const policy = cspFor(
    scripts.map((match) => hashOf(match[2] ?? '')),
    styles.map((match) => hashOf(match[2] ?? '')),
    connectOrigins,
  );
  const charset = /<meta charset="UTF-8" \/>|<meta charset="utf-8">/i.exec(markup);
  if (!charset) throw new Error('The page has no <meta charset>');
  const at = charset.index + charset[0].length;
  const tag = `\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`;
  return html.slice(0, at) + tag + html.slice(at);
}
