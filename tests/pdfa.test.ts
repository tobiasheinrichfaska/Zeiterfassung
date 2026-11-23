import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';
import { monthToPdf, sha256Hex, updateSettings, xmpPacket } from '../src/logic/index.ts';
import { bookWith, day, val } from './helpers.ts';
import { ASSETS } from './pdfAssets.ts';
import { inspect } from './pdfRead.ts';

/**
 * Structure tests for the PDF/A-3b rules we build to. They look at the written file, not at our code.
 * They are NOT a validation: no PDF/A checker (for example veraPDF) was available or run.
 */
const CREATED = '2026-12-01T06:00:00.000Z';

const book = () =>
  val(
    updateSettings(bookWith(day({ date: '2026-11-23', note: 'Ärztin „Büro“ – 5 €' })), {
      employeeLabel: 'Anna',
      retentionMonths: 24,
      timestampRelay: '',
    }),
  );

async function build() {
  const bytes = val(await monthToPdf(book(), '2026-11', CREATED, ASSETS));
  const { doc, streams } = await inspect(bytes);
  return { bytes, doc, streams, raw: new TextDecoder('latin1').decode(bytes) };
}

const decodeStream = (s: PDFStream): Uint8Array => decodePDFRawStream(s as PDFRawStream).decode();
const asText = (u: Uint8Array): string => new TextDecoder().decode(u);

/** A very small well-formedness check: every opening tag is closed in order. */
function balanced(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:.-]*)[^>]*?(\/?)>/g)) {
    if (m[3] === '/') continue;
    if (m[1] === '') stack.push(m[2] ?? '');
    else if (stack.pop() !== m[2]) return false;
  }
  return stack.length === 0;
}

describe('PDF/A-3b structure', () => {
  it('starts with the PDF 1.7 header and a binary comment line', async () => {
    const { bytes } = await build();
    expect(new TextDecoder('latin1').decode(bytes.slice(0, 8))).toBe('%PDF-1.7');
    const second = bytes.slice(bytes.indexOf(10) + 1);
    expect(second[0]).toBe(0x25); // %
    expect(second.slice(1, 5).every((b) => b >= 0x80)).toBe(true);
  });

  it('has an XMP stream, uncompressed, with the PDF/A part 3 conformance B identification', async () => {
    const { doc } = await build();
    const metadata = doc.catalog.lookup(PDFName.of('Metadata'), PDFStream) as PDFRawStream;
    expect(metadata.dict.get(PDFName.of('Type'))).toBe(PDFName.of('Metadata'));
    expect(metadata.dict.get(PDFName.of('Subtype'))).toBe(PDFName.of('XML'));
    expect(metadata.dict.get(PDFName.of('Filter'))).toBeUndefined();
    const xmp = asText(metadata.contents);
    expect(xmp).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(xmp.startsWith('<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>')).toBe(true);
    expect(xmp.endsWith('<?xpacket end="w"?>')).toBe(true);
    expect(balanced(xmp.replace(/<\?[\s\S]*?\?>/g, ''))).toBe(true);
  });

  it('keeps the Info entries and the XMP the same (title, producer, creator, dates, description)', async () => {
    const { doc } = await build();
    const xmp = asText(
      (doc.catalog.lookup(PDFName.of('Metadata'), PDFStream) as PDFRawStream).contents,
    );
    expect(xmp).toContain(`>${doc.getTitle()}</rdf:li>`);
    expect(xmp).toContain(`<pdf:Producer>${doc.getProducer()}</pdf:Producer>`);
    expect(xmp).toContain(`<xmp:CreatorTool>${doc.getCreator()}</xmp:CreatorTool>`);
    expect(xmp).toContain(`>${doc.getSubject()}</rdf:li>`);
    const date = `${CREATED.slice(0, 19)}Z`;
    expect(xmp).toContain(`<xmp:CreateDate>${date}</xmp:CreateDate>`);
    expect(xmp).toContain(`<xmp:ModifyDate>${date}</xmp:ModifyDate>`);
    expect(doc.getCreationDate()?.toISOString()).toBe(CREATED);
    expect(doc.getModificationDate()?.toISOString()).toBe(CREATED);
    expect(doc.getAuthor()).toBeUndefined(); // an Info entry without a counterpart in the XMP
    expect(doc.getKeywords()).toBeUndefined();
  });

  it('escapes the XMP texts', () => {
    const xmp = xmpPacket({
      title: 'A & B <c>',
      subject: '"x"',
      producer: 'P',
      creatorTool: 'T',
      createdIso: CREATED,
    });
    expect(xmp).toContain('A &amp; B &lt;c&gt;');
    expect(xmp).toContain('&quot;x&quot;');
    expect(balanced(xmp.replace(/<\?[\s\S]*?\?>/g, ''))).toBe(true);
  });

  it('has an output intent with an embedded RGB profile', async () => {
    const { doc } = await build();
    const intents = doc.catalog.lookup(PDFName.of('OutputIntents'), PDFArray);
    expect(intents.size()).toBe(1);
    const intent = intents.lookup(0, PDFDict);
    expect(intent.get(PDFName.of('Type'))).toBe(PDFName.of('OutputIntent'));
    expect(intent.get(PDFName.of('S'))).toBe(PDFName.of('GTS_PDFA1'));
    expect(intent.lookup(PDFName.of('OutputConditionIdentifier'), PDFString).decodeText()).toBe(
      'sRGB',
    );
    const profile = intent.lookup(PDFName.of('DestOutputProfile'), PDFStream) as PDFRawStream;
    expect(profile.dict.lookup(PDFName.of('N'), PDFNumber).asNumber()).toBe(3);
    const bytes = decodeStream(profile);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0)).toBe(bytes.length);
    expect(String.fromCharCode(...bytes.slice(36, 40))).toBe('acsp');
    expect(String.fromCharCode(...bytes.slice(16, 20))).toBe('RGB ');
  });

  it('attaches the data as an associated file with the relationship „Data“', async () => {
    const { doc, streams } = await build();
    const af = doc.catalog.lookup(PDFName.of('AF'), PDFArray);
    expect(af.size()).toBe(1);
    const specRef = af.get(0) as PDFRef;
    const spec = doc.context.lookup(specRef, PDFDict);
    expect(spec.get(PDFName.of('Type'))).toBe(PDFName.of('Filespec'));
    expect(spec.get(PDFName.of('AFRelationship'))).toBe(PDFName.of('Data'));
    expect(spec.lookup(PDFName.of('F'), PDFString).decodeText()).toBe('zeiterfassung-2026-11.json');
    expect(spec.lookup(PDFName.of('UF'), PDFHexString).decodeText()).toBe(
      'zeiterfassung-2026-11.json',
    );
    expect(spec.lookup(PDFName.of('Desc'), PDFHexString).decodeText()).toContain('SHA-256');

    const file = spec
      .lookup(PDFName.of('EF'), PDFDict)
      .lookup(PDFName.of('F'), PDFStream) as PDFRawStream;
    expect(file.dict.get(PDFName.of('Type'))).toBe(PDFName.of('EmbeddedFile'));
    expect(file.dict.get(PDFName.of('Subtype'))).toBe(PDFName.of('application/json'));
    const params = file.dict.lookup(PDFName.of('Params'), PDFDict);
    expect(params.lookup(PDFName.of('Size'), PDFNumber).asNumber()).toBe(
      streams.embedded[0]?.bytes.length,
    );
    expect(params.lookup(PDFName.of('ModDate'), PDFString).asString()).toBe('D:20261201060000Z');
    expect(params.lookup(PDFName.of('CreationDate'), PDFString).asString()).toBe(
      'D:20261201060000Z',
    );

    // the same file specification stands in the name tree of embedded files
    const names = doc.catalog
      .lookup(PDFName.of('Names'), PDFDict)
      .lookup(PDFName.of('EmbeddedFiles'), PDFDict)
      .lookup(PDFName.of('Names'), PDFArray);
    expect(names.get(1)).toBe(specRef);
    expect(names.lookup(0, PDFHexString).decodeText()).toBe('zeiterfassung-2026-11.json');
  });

  it('describes the attachment with the hash of the attachment itself', async () => {
    const { doc, streams } = await build();
    const spec = doc.context.lookup(
      doc.catalog.lookup(PDFName.of('AF'), PDFArray).get(0) as PDFRef,
      PDFDict,
    );
    const desc = spec.lookup(PDFName.of('Desc'), PDFHexString).decodeText();
    expect(desc).toContain(await sha256Hex(streams.embedded[0]?.text ?? ''));
  });

  it('embeds every font (no standard font, a font file for each) with a subset name', async () => {
    const { doc, raw } = await build();
    expect(raw).not.toMatch(/\/BaseFont\s*\/(Helvetica|Times|Courier|Symbol|ZapfDingbats)/);
    let composite = 0;
    let cid = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict) || obj.get(PDFName.of('Type')) !== PDFName.of('Font')) continue;
      const kind = obj.get(PDFName.of('Subtype'));
      if (kind === PDFName.of('Type0')) {
        composite += 1;
        expect(obj.get(PDFName.of('ToUnicode'))).toBeInstanceOf(PDFRef);
        expect(obj.lookup(PDFName.of('DescendantFonts'), PDFArray).size()).toBe(1);
      } else {
        expect(kind).toBe(PDFName.of('CIDFontType2'));
        cid += 1;
        const descriptor = obj.lookup(PDFName.of('FontDescriptor'), PDFDict);
        expect(descriptor.get(PDFName.of('FontFile2'))).toBeInstanceOf(PDFRef);
        expect(descriptor.lookup(PDFName.of('FontName'), PDFName).decodeText()).toMatch(
          /^[A-Z]{6}\+NotoSans-(Regular|Bold)$/,
        );
      }
    }
    expect(composite).toBe(2); // regular and bold
    expect(cid).toBe(2);
  });

  it('has a document ID of two equal 16-byte halves, and it depends on the data', async () => {
    const { raw } = await build();
    const m = /\/ID\s*\[\s*<([0-9A-Fa-f]{32})>\s*<([0-9A-Fa-f]{32})>\s*\]/.exec(raw);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe(m?.[2]);
    const other = new TextDecoder('latin1').decode(
      val(await monthToPdf(bookWith(day({ date: '2026-11-24' })), '2026-11', CREATED, ASSETS)),
    );
    expect(/\/ID\s*\[\s*<([0-9A-Fa-f]{32})>/.exec(other)?.[1]).not.toBe(m?.[1]);
  });

  it('is not encrypted and has no scripts, actions, launch or external references', async () => {
    const { raw } = await build();
    for (const forbidden of [
      '/Encrypt',
      '/JavaScript',
      '/JS',
      '/Launch',
      '/OpenAction',
      '/AA',
      '/URI',
      '/RichMedia',
      '/Movie',
      '/Sound',
    ]) {
      expect(raw, forbidden).not.toContain(forbidden);
    }
  });

  it('paints only in DeviceRGB (no gray, CMYK or other colour operators)', async () => {
    const { doc } = await build();
    let sawRgb = false;
    for (const page of doc.getPages()) {
      const contents = page.node.Contents();
      const list =
        contents instanceof PDFArray
          ? contents.asArray().map((r) => doc.context.lookup(r, PDFStream))
          : [contents as PDFStream];
      for (const stream of list) {
        const tokens = new TextDecoder('latin1').decode(decodeStream(stream)).split(/\s+/);
        for (const op of ['g', 'G', 'k', 'K', 'cs', 'CS', 'sc', 'SC', 'scn', 'SCN', 'sh']) {
          expect(tokens, op).not.toContain(op);
        }
        if (tokens.includes('rg') || tokens.includes('RG')) sawRgb = true;
      }
    }
    expect(sawRgb).toBe(true);
  });

  it('sets the document language and uses uncompressed object structure (no object streams)', async () => {
    const { doc, raw } = await build();
    expect(doc.catalog.lookup(PDFName.of('Lang'), PDFString).decodeText()).toBe('de-DE');
    expect(raw).not.toContain('/ObjStm');
    expect(raw).not.toContain('/XRef');
  });

  it('keeps the page text readable through the fonts, with the characters of German writing', async () => {
    const { streams } = await build();
    expect(streams.shown).toContain('Ärztin „Büro“ – 5 €');
  });
});
