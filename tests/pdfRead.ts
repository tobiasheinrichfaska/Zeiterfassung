import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
} from 'pdf-lib';

export interface Streams {
  /** Text of every embedded file. */
  embedded: { text: string; bytes: Uint8Array }[];
  /** All text shown on the pages, one string per drawn line, decoded through the fonts' ToUnicode maps. */
  shown: string;
  /** The same, one string per page. */
  pages: string[];
}

const decode = (s: PDFRawStream): Uint8Array => decodePDFRawStream(s).decode();
const text = (u: Uint8Array): string => new TextDecoder('latin1').decode(u);

/** `bfchar` and `bfrange` entries of a ToUnicode CMap → code → text. */
export function parseToUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  const utf16 = (hex: string): string => {
    let out = '';
    for (let i = 0; i < hex.length; i += 4)
      out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return out;
  };
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of (block[1] ?? '').matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(m[1] ?? '', 16), utf16(m[2] ?? ''));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of (block[1] ?? '').matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
    )) {
      const lo = parseInt(m[1] ?? '', 16);
      const hi = parseInt(m[2] ?? '', 16);
      const first = (m[3] ?? '').length === 4 ? parseInt(m[3] ?? '', 16) : undefined;
      for (let code = lo; code <= hi; code += 1) {
        map.set(
          code,
          first === undefined ? utf16(m[3] ?? '') : String.fromCharCode(first + code - lo),
        );
      }
    }
  }
  return map;
}

export async function inspect(bytes: Uint8Array): Promise<{ doc: PDFDocument; streams: Streams }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const { context } = doc;
  const embedded: Streams['embedded'] = [];
  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (
      obj instanceof PDFRawStream &&
      obj.dict.get(PDFName.of('Type')) === PDFName.of('EmbeddedFile')
    ) {
      const data = decode(obj);
      embedded.push({ text: new TextDecoder().decode(data), bytes: data });
    }
  }

  let shown = '';
  const pages: string[] = [];
  for (const page of doc.getPages()) {
    const pageStart = shown.length;
    const maps = new Map<string, Map<number, string>>();
    const fonts = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
    for (const [name, ref] of fonts?.entries() ?? []) {
      const font = context.lookup(ref, PDFDict);
      const toUnicode = font.lookupMaybe(PDFName.of('ToUnicode'), PDFStream);
      if (toUnicode) {
        maps.set(name.decodeText(), parseToUnicode(text(decode(toUnicode as PDFRawStream))));
      }
    }
    const contents = page.node.Contents();
    const streams: PDFStream[] =
      contents instanceof PDFArray
        ? contents.asArray().map((r) => context.lookup(r, PDFStream))
        : contents
          ? [contents]
          : [];
    for (const stream of streams) {
      const ops = text(decode(stream as PDFRawStream));
      let current: Map<number, string> | undefined;
      for (const m of ops.matchAll(/\/(\S+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]*)>\s*Tj/g)) {
        if (m[1] !== undefined) current = maps.get(m[1]);
        else {
          const hex = m[2] ?? '';
          let line = '';
          for (let i = 0; i < hex.length; i += 4) {
            const code = parseInt(hex.slice(i, i + 4), 16);
            line += current?.get(code) ?? '�';
          }
          shown += `${line}\n`;
        }
      }
    }
    pages.push(shown.slice(pageStart));
  }
  return { doc, streams: { embedded, shown, pages } };
}
