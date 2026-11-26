// Content-Security-Policy for an offline single-file page (all script inlined, e.g. by
// vite-plugin-singlefile). The browser itself then refuses every network connection, every foreign
// script and eval, whatever the code does. Inline scripts (and styles) are allowed by their SHA-256
// hash, computed over the finished file. Pure functions over text; Node only (`node:crypto`), no network.
import { createHash } from 'node:crypto';

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const STYLE = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
const CHARSET = /<meta charset="UTF-8" \/>|<meta charset="utf-8">/i;
const POLICY_META = /<meta[^>]+http-equiv=["']?Content-Security-Policy/i;
const SCHEME_ONLY = /^[a-z][a-z0-9+.-]*:$/i;
const ORIGIN =
  /^(?:https:\/\/[A-Za-z0-9.-]+|http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]))(?::\d{1,5})?$/;
const RAW_TEXT = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/iy;

/** The directives `cspFor` writes: the documented default set. Any other directive is a problem. */
export const KNOWN_DIRECTIVES: readonly string[] = [
  'default-src',
  'script-src',
  'style-src',
  'img-src',
  'font-src',
  'connect-src',
  'worker-src',
  'frame-src',
  'object-src',
  'base-uri',
  'form-action',
];

export type CspOptions = {
  /** Origins `connect-src` allows: `https://host[:port]`, or `http://` for localhost/127.0.0.1/[::1] only (`addCsp` throws on anything else). None → `'none'`. */
  connectOrigins?: readonly string[];
};

export function hashOf(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

/**
 * The policy for these inline script and style hashes. The page needs no fonts, frames, workers,
 * plug-ins or forms (a download made from a `blob:` link is not a fetch). `data:` images are for an empty
 * favicon only. `connect-src` is `'none'` unless origins are given: then exactly those, nothing else.
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
 * The page with the content of every HTML comment blanked out (same length, so positions stay valid).
 * Bodies of `<script>` and `<style>` are opaque: a `<!--` inside code is code, not a comment.
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

/** The page's own markup: the bundled code may mention tags as text, so script bodies are emptied. */
function markupOf(html: string): string {
  return html.replace(SCRIPT, (_all, attrs: string) => `<script${attrs}></script>`);
}

/**
 * Inserts the policy as the first element after `<meta charset>`. Throws on a page that loads a script
 * or stylesheet from outside, already carries a policy, has no inline script or has no `<meta charset>`.
 */
export function addCsp(source: string, options: CspOptions = {}): string {
  const html = maskComments(source);
  const markup = markupOf(html);
  if (POLICY_META.test(markup)) throw new Error('The page already has a Content-Security-Policy');
  if (/<link\b[^>]*rel=["']?stylesheet/i.test(markup)) {
    throw new Error('The page loads a stylesheet from outside');
  }
  const scripts = [...html.matchAll(SCRIPT)];
  if (scripts.some((match) => /\bsrc\s*=/i.test(match[1] ?? ''))) {
    throw new Error('The page loads a script from outside');
  }
  if (scripts.length === 0) throw new Error('The page has no inline script');
  const styles = [...markup.matchAll(STYLE)];
  for (const origin of options.connectOrigins ?? []) {
    if (!ORIGIN.test(origin))
      throw new Error(`Not an origin of the form scheme://host[:port]: ${origin}`);
  }
  const policy = cspFor(
    scripts.map((match) => hashOf(match[2] ?? '')),
    styles.map((match) => hashOf(match[2] ?? '')),
    options.connectOrigins ?? [],
  );
  const charset = CHARSET.exec(markup);
  if (!charset) throw new Error('The page has no <meta charset>');
  const at = charset.index + charset[0].length;
  const tag = `\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`;
  return source.slice(0, at) + tag + source.slice(at);
}

export type CspCheck = { ok: boolean; problems: string[] };

function readPolicy(source: string): { map: Map<string, string[]>; duplicates: string[] } {
  const markup = markupOf(maskComments(source));
  const meta = /<meta\b[^>]*http-equiv=["']?Content-Security-Policy[^>]*>/i.exec(markup)?.[0] ?? '';
  const content = /\bcontent="([^"]*)"/i.exec(meta)?.[1] ?? '';
  const map = new Map<string, string[]>();
  const duplicates: string[] = [];
  for (const part of content.split(';')) {
    const [rawName, ...sources] = part.trim().split(/\s+/);
    if (!rawName) continue;
    const name = rawName.toLowerCase();
    // a browser uses the FIRST of a repeated directive and ignores the rest
    if (map.has(name)) duplicates.push(name);
    else map.set(name, sources);
  }
  return { map, duplicates };
}

/** The policy of a page as directive → sources (empty when there is none). The first of a repeated directive counts. */
export function parsePolicy(html: string): Map<string, string[]> {
  return readPolicy(html).map;
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Checks a finished page against what `addCsp` promises: exactly one policy, in front of the first
 * script; the script (and style) hashes are those of the inline text; `default-src 'none'`, no unsafe or
 * wildcard source; nothing loaded from outside (script/link/img/iframe/… with an address). With
 * `connectOrigins` given, `connect-src` must be exactly that list (none → `'none'`).
 */
export function checkCsp(source: string, options: CspOptions = {}): CspCheck {
  const problems: string[] = [];
  const html = maskComments(source);
  const markup = markupOf(html);
  const metas = html.match(/Content-Security-Policy/gi) ?? [];
  if (metas.length !== 1) problems.push(`Expected exactly one policy, found ${metas.length}`);
  const { map: policy, duplicates } = readPolicy(source);
  if (policy.size === 0) problems.push('No Content-Security-Policy meta tag');
  for (const name of new Set(duplicates)) problems.push(`The directive ${name} is repeated`);
  for (const name of policy.keys()) {
    if (!KNOWN_DIRECTIVES.includes(name)) problems.push(`Unknown directive ${name}`);
  }
  const firstScript = html.search(/<script\b/i);
  const at = html.search(/Content-Security-Policy/i);
  if (at >= 0 && firstScript >= 0 && at > firstScript) {
    problems.push('The policy comes after the first script');
  }

  const scripts = [...html.matchAll(SCRIPT)];
  if (scripts.length === 0) problems.push('The page has no inline script');
  const wantedScripts = scripts.map((match) => hashOf(match[2] ?? ''));
  if (!same(policy.get('script-src') ?? [], wantedScripts)) {
    problems.push('script-src does not hold exactly the hashes of the inline scripts');
  }
  const styles = [...markup.matchAll(STYLE)];
  const wantedStyles = styles.length > 0 ? styles.map((m) => hashOf(m[2] ?? '')) : ["'none'"];
  if (!same(policy.get('style-src') ?? [], wantedStyles)) {
    problems.push('style-src does not hold exactly the hashes of the inline styles');
  }
  if (!same(policy.get('default-src') ?? [], ["'none'"]))
    problems.push("default-src is not 'none'");
  for (const directive of [
    'worker-src',
    'frame-src',
    'object-src',
    'base-uri',
    'form-action',
    'font-src',
  ]) {
    if (!same(policy.get(directive) ?? [], ["'none'"])) problems.push(`${directive} is not 'none'`);
  }
  if (!same(policy.get('img-src') ?? [], ['data:'])) problems.push('img-src is not data:');
  // without connectOrigins the page may not connect anywhere; with them: exactly that list
  const wantedConnect =
    options.connectOrigins !== undefined && options.connectOrigins.length > 0
      ? options.connectOrigins
      : ["'none'"];
  const connect = policy.get('connect-src') ?? [];
  if (!same(connect, wantedConnect)) {
    problems.push("connect-src is not exactly the given origins (none: 'none')");
  }
  if (connect.some((source) => SCHEME_ONLY.test(source) || source.includes('*'))) {
    problems.push('connect-src allows a whole scheme or a wildcard');
  }
  const all = [...policy.values()].flat().join(' ');
  if (/unsafe-inline|unsafe-eval|\*|blob:|ws:|javascript:/.test(all)) {
    problems.push('The policy allows an unsafe or wildcard source');
  }

  if (/<script[^>]*\bsrc\s*=/i.test(markup)) problems.push('The page loads a script from outside');
  if (/<link[^>]*rel=["']?stylesheet/i.test(markup)) {
    problems.push('The page loads a stylesheet from outside');
  }
  if (/\b(?:src|href|srcset|data|poster|action)=["']?(?:https?:)?\/\//i.test(markup)) {
    problems.push('The page refers to an external address');
  }
  for (const link of markup.match(/<link\b[^>]*>/g) ?? []) {
    if (!/href="data:/.test(link)) problems.push(`A <link> that is not a data: link: ${link}`);
  }
  for (const tag of markup.match(
    /<(?:img|iframe|frame|embed|object|audio|video|source)\b[^>]*>/gi,
  ) ?? []) {
    const value = /\b(?:src|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const address = value?.[1] ?? value?.[2] ?? value?.[3];
    if (address !== undefined && !address.toLowerCase().startsWith('data:')) {
      problems.push(`A tag that loads something other than a data: URL: ${tag}`);
    }
  }
  return { ok: problems.length === 0, problems };
}
