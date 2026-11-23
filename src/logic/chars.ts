/**
 * Replaces every character the output font cannot show by `replacement` (default „?“), one for each
 * character (a letter outside the font and an emoji count as one each). The kept characters are exactly
 * those `supported` accepts; nothing else is changed.
 */
export function keepSupported(
  text: string,
  supported: (codePoint: number) => boolean,
  replacement = '?',
): string {
  let out = '';
  for (const ch of text) out += supported(ch.codePointAt(0) ?? -1) ? ch : replacement;
  return out;
}
