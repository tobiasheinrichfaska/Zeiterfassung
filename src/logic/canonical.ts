export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Canonical JSON: keys sorted at every level, two-space indentation, a final line break, and only
 * integers as numbers (a fraction or an infinite number is a programming error and throws). The same
 * data always gives the same bytes, so a checksum of the text is stable. Used for the attached data
 * file and for the hashes of the stamp chain.
 */
export function canonicalJson(value: Json): string {
  const write = (v: Json, indent: string): string => {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number') {
      if (!Number.isInteger(v)) throw new TypeError(`only integers are allowed, got ${v}`);
      return String(v);
    }
    const inner = `${indent}  `;
    if (Array.isArray(v)) {
      return v.length === 0
        ? '[]'
        : `[\n${v.map((item) => inner + write(item, inner)).join(',\n')}\n${indent}]`;
    }
    const keys = Object.keys(v).sort();
    return keys.length === 0
      ? '{}'
      : `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${write(v[k] as Json, inner)}`).join(',\n')}\n${indent}}`;
  };
  return `${write(value, '')}\n`;
}
