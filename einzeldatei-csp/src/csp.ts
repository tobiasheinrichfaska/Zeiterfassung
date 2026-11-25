// Content-Security-Policy for an offline single-file page (all script inlined, e.g. by
// vite-plugin-singlefile). The browser itself then refuses every network connection, every foreign
// script and eval, whatever the code does. Inline scripts (and styles) are allowed by their SHA-256
// hash, computed over the finished file. Pure functions over text; Node only (`node:crypto`), no network.
import { createHash } from 'node:crypto';

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
const STYLE = /<style\b([^>]*)>([\s\S]*?)<\/style>/g;
const CHARSET = /<meta charset="UTF-8" \/>|<meta charset="utf-8">/i;
const POLICY_META = /<meta[^>]+http-equiv=["']?Content-Security-Policy/i;

export type CspOptions = {
  /** Origins `connect-src` allows (e.g. `https://relay.example`). None → `'none'`. */
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

/** The page's own markup: the bundled code may mention tags as text, so script bodies are emptied. */
function markupOf(html: string): string {
  return html.replace(SCRIPT, (_all, attrs: string) => `<script${attrs}></script>`);
}

/**
 * Inserts the policy as the first element after `<meta charset>`. Throws on a page that loads a script
 * or stylesheet from outside, already carries a policy, has no inline script or has no `<meta charset>`.
 */
export function addCsp(html: string, options: CspOptions = {}): string {
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
  const policy = cspFor(
    scripts.map((match) => hashOf(match[2] ?? '')),
    styles.map((match) => hashOf(match[2] ?? '')),
    options.connectOrigins ?? [],
  );
  const charset = CHARSET.exec(markup);
  if (!charset) throw new Error('The page has no <meta charset>');
  const at = charset.index + charset[0].length;
  const tag = `\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`;
  return html.slice(0, at) + tag + html.slice(at);
}

export type CspCheck = { ok: boolean; problems: string[] };

/** The policy of a page as directive → sources (empty when there is none). */
export function parsePolicy(html: string): Map<string, string[]> {
  const content = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? '';
  const out = new Map<string, string[]>();
  for (const part of content.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out.set(name, sources);
  }
  return out;
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Checks a finished page against what `addCsp` promises: exactly one policy, in front of the first
 * script; the script (and style) hashes are those of the inline text; `default-src 'none'`, no unsafe or
 * wildcard source; nothing loaded from outside (script/link/img/iframe/… with an address). With
 * `connectOrigins` given, `connect-src` must be exactly that list (none → `'none'`).
 */
export function checkCsp(html: string, options: CspOptions = {}): CspCheck {
  const problems: string[] = [];
  const markup = markupOf(html);
  const metas = html.match(/Content-Security-Policy/g) ?? [];
  if (metas.length !== 1) problems.push(`Expected exactly one policy, found ${metas.length}`);
  const policy = parsePolicy(html);
  if (policy.size === 0) problems.push('No Content-Security-Policy meta tag');
  const firstScript = html.indexOf('<script');
  const at = html.indexOf('Content-Security-Policy');
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
  if (options.connectOrigins !== undefined) {
    const wanted = options.connectOrigins.length > 0 ? options.connectOrigins : ["'none'"];
    if (!same(policy.get('connect-src') ?? [], wanted)) {
      problems.push('connect-src is not exactly the given origins');
    }
  }
  const all = [...policy.values()].flat().join(' ');
  if (/unsafe-inline|unsafe-eval|\*|blob:|ws:|javascript:/.test(all)) {
    problems.push('The policy allows an unsafe or wildcard source');
  }

  if (/<script[^>]*\bsrc=/i.test(markup)) problems.push('The page loads a script from outside');
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
