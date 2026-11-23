import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import {
  attachmentName,
  emptyBook,
  monthLayout,
  monthToPdf,
  monthToXml,
  updateSettings,
} from '../src/logic/index.ts';
import { bookWith, day, val } from './helpers.ts';

const CREATED = '2026-12-01T06:00:00.000Z';

interface Streams {
  embedded: { text: string }[];
  /** Text drawn on the pages (hex strings of the content streams decoded as Latin-1). */
  shown: string;
}

async function inspect(bytes: Uint8Array): Promise<{ doc: PDFDocument; streams: Streams }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const embedded: { text: string }[] = [];
  let shown = '';
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const decoded = decodePDFRawStream(obj).decode();
    if (obj.dict.get(PDFName.of('Type')) === PDFName.of('EmbeddedFile')) {
      embedded.push({ text: new TextDecoder().decode(decoded) });
    } else {
      const content = new TextDecoder('latin1').decode(decoded);
      for (const m of content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
        const hex = m[1] ?? '';
        let line = '';
        for (let i = 0; i < hex.length; i += 2)
          line += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
        shown += `${line}\n`;
      }
    }
  }
  return { doc, streams: { embedded, shown } };
}

const november = () =>
  val(
    updateSettings(
      bookWith(
        day({ date: '2026-11-23' }), // 8:00
        day({ date: '2026-11-24', startMin: 480, endMin: 720, breaks: [], note: 'Ärztin: Büro ß' }), // 4:00
        day({ date: '2026-10-31' }), // other month
        day({ date: '2026-11-25', endMin: null, breaks: [] }), // running
      ),
      { employeeLabel: 'Anna Beispiel', retentionMonths: 24 },
    ),
  );

describe('monthLayout', () => {
  it('has the readable rows, the total and the notes', () => {
    const l = monthLayout(november(), '2026-11', CREATED);
    expect(l.title).toBe('Arbeitszeit November 2026');
    expect(l.employee).toBe('Anna Beispiel');
    expect(l.rows).toEqual([
      ['Mo 23.11.2026', '08:00', '16:30', '0:30', '8:00', 'Eingabe', ''],
      ['Di 24.11.2026', '08:00', '12:00', '0:00', '4:00', 'Eingabe', 'Ärztin: Büro ß'],
      ['Mi 25.11.2026', '08:00', 'läuft', '0:00', '–', 'Eingabe', ''],
    ]);
    expect(l.total).toBe('Summe Arbeitszeit: 12:00 Std. an 2 Tag(en)');
    expect(l.openNote).toContain('1 Tag(e) laufen noch');
    expect(l.attachmentNote).toContain(attachmentName('2026-11'));
    expect(l.created).toBe('Erstellt am 01.12.2026');
  });

  it('has no open note without running days', () => {
    expect(monthLayout(bookWith(day()), '2026-11', CREATED).openNote).toBeNull();
  });
});

describe('monthToPdf', () => {
  it('makes a readable PDF with the XML attached and the sums on the page', async () => {
    const book = november();
    const bytes = val(await monthToPdf(book, '2026-11', CREATED));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');

    const { doc, streams } = await inspect(bytes);
    expect(doc.getPageCount()).toBe(1);

    // the attachment is exactly the XML of the same data
    expect(streams.embedded).toHaveLength(1);
    expect(streams.embedded[0]?.text).toBe(val(monthToXml(book, '2026-11', CREATED)));
    expect(streams.embedded[0]?.text).toContain('summe-arbeitszeit-minuten="720"');

    // the page shows the table and the total
    expect(streams.shown).toContain('Arbeitszeit November 2026');
    expect(streams.shown).toContain('Mitarbeiter/in: Anna Beispiel');
    expect(streams.shown).toContain('Summe Arbeitszeit: 12:00 Std. an 2 Tag(en)');
    expect(streams.shown).toContain('Mo 23.11.2026');
    expect(streams.shown).toContain('Ärztin: Büro ß'); // WinAnsi agrees with Latin-1 for these
    expect(streams.shown).toContain(attachmentName('2026-11'));
  });

  it('names the attachment in the file', async () => {
    const bytes = val(await monthToPdf(november(), '2026-11', CREATED));
    expect(new TextDecoder('latin1').decode(bytes)).toContain('/EmbeddedFiles');
    expect(new TextDecoder('latin1').decode(bytes)).toContain('zeiterfassung-2026-11.xml');
  });

  it('keeps the metadata neutral (no library or tool name)', async () => {
    const bytes = val(await monthToPdf(november(), '2026-11', CREATED));
    const raw = new TextDecoder('latin1').decode(bytes);
    expect(raw).not.toMatch(/pdf-lib/i);
    expect(raw).not.toMatch(/claude|anthropic|\bAI\b/i);
    const { doc } = await inspect(bytes);
    expect(doc.getTitle()).toBe('Arbeitszeit November 2026');
    expect(doc.getProducer()).toBe('Zeiterfassung');
    expect(doc.getCreator()).toBe('Zeiterfassung');
    expect(doc.getAuthor()).toBe('');
    expect(doc.getCreationDate()?.toISOString()).toBe(CREATED);
  });

  it('is the same file for the same data (no random parts in what we control)', async () => {
    const a = val(await monthToPdf(november(), '2026-11', CREATED));
    const b = val(await monthToPdf(november(), '2026-11', CREATED));
    const stripId = (u: Uint8Array) =>
      new TextDecoder('latin1').decode(u).replace(/\/ID\s*\[[^\]]*\]/, '');
    expect(stripId(a)).toBe(stripId(b));
  });

  it('writes an empty month with a note and a zero total', async () => {
    const bytes = val(await monthToPdf(emptyBook(), '2026-11', CREATED));
    const { streams } = await inspect(bytes);
    expect(streams.shown).toContain('Keine Einträge in diesem Monat.');
    expect(streams.shown).toContain('Summe Arbeitszeit: 0:00 Std. an 0 Tag(en)');
    expect(streams.embedded[0]?.text).toContain('anzahl="0"');
  });

  it('fits a whole month of 31 long notes on one page', async () => {
    const days = Array.from({ length: 31 }, (_, i) =>
      day({ date: `2026-12-${String(i + 1).padStart(2, '0')}`, note: 'x'.repeat(200) }),
    );
    const bytes = val(await monthToPdf(bookWith(...days), '2026-12', CREATED));
    const { doc, streams } = await inspect(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(streams.shown).toContain('Summe Arbeitszeit: 248:00 Std. an 31 Tag(en)');
    expect(streams.shown).toContain('Do 31.12.2026');
    expect(streams.shown).toContain('...'); // long notes are shortened, not run off the page
    expect(streams.embedded[0]?.text).toContain('x'.repeat(200)); // the attachment keeps the whole note
  });

  it('does not fail on characters the standard font cannot show', async () => {
    const book = bookWith(day({ note: 'Pause 😀 → ok' }));
    const bytes = val(await monthToPdf(book, '2026-11', CREATED));
    const { streams } = await inspect(bytes);
    expect(streams.shown).toContain('Pause ? ? ok');
    // the attachment keeps the real text
    expect(streams.embedded[0]?.text).toContain('Pause 😀 → ok');
  });

  it('refuses a bad month', async () => {
    expect(await monthToPdf(emptyBook(), '2026-13', CREATED)).toEqual({
      ok: false,
      reason: 'bad-month',
    });
  });
});
