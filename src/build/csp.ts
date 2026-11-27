// Content-Security-Policy of the single HTML file (the idea taken over from the other single-file apps of
// the same author): the browser itself refuses every network connection, every foreign script and
// eval — whatever the code does. The one inlined script is allowed by its SHA-256 hash, computed after
// inlining. Styles come from the CSSOM (React's style props), which a policy does not restrict, so no
// inline style text is allowed (and none is emitted).
import { createHash } from 'node:crypto';

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const STYLE = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
const RAW_TEXT = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/iy;

/**
 * The page with every HTML comment blanked out (same length, so positions stay valid); bodies of
 * `<script>` and `<style>` are code, not comments. The same rule as `einzeldatei-csp`.
 */
function maskComments(html: string): string {
  let out = '';
  let i = 0;
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const close = html.indexOf('-->', i + 4);
      const end = close < 0 ? html.length : close + 3;
      out += html.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
      continue;
    }
    if (html[i] === '<') {
      RAW_TEXT.lastIndex = i;
      const raw = RAW_TEXT.exec(html);
      if (raw) {
        out += raw[0];
        i += raw[0].length;
        continue;
      }
    }
    out += html[i];
    i += 1;
  }
  return out;
}

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
export function withCsp(source: string, connectOrigins: readonly string[] = []): string {
  // Look at the page's own markup only: comments and the bundled code (which may mention these tags as
  // text) are blanked out, keeping every position, so the place found below is the place in `source`.
  const html = maskComments(source);
  const markup = html.replace(SCRIPT, (all: string, _attrs: string, body: string) => {
    const open = all.length - body.length - '</script>'.length;
    return all.slice(0, open) + body.replace(/[^\n]/g, ' ') + all.slice(open + body.length);
  });
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
  return source.slice(0, at) + tag + source.slice(at);
}
