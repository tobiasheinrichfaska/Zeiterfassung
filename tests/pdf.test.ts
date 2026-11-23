import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import {
  attachmentName,
  emptyBook,
  moveWorkday,
  monthLayout,
  monthToJson,
  monthToPdf,
  setWorkday,
  sha256Hex,
  updateSettings,
  wrapText,
} from '../src/logic/index.ts';
import { bookWith, day, val } from './helpers.ts';

const CREATED = '2026-12-01T06:00:00.000Z';

/** The WinAnsi bytes above Latin-1 that these tests meet. */
const WIN_ANSI: Record<number, string> = { 0x80: '€', 0x84: '„', 0x93: '“', 0x94: '”', 0x96: '–' };

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
        for (let i = 0; i < hex.length; i += 2) {
          const byte = parseInt(hex.slice(i, i + 2), 16);
          line += WIN_ANSI[byte] ?? String.fromCharCode(byte);
        }
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
  it('has the readable rows, the total, the changes and the checksum line', () => {
    const l = monthLayout(november(), '2026-11', CREATED, 'abc123');
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
    expect(l.hashLine).toBe('Prüfsumme der angehängten Datei (SHA-256): abc123');
    expect(l.created).toBe('Erstellt am 01.12.2026');
    expect(l.changes).toEqual([]);
  });

  it('has no open note without running days', () => {
    expect(monthLayout(bookWith(day()), '2026-11', CREATED, 'x').openNote).toBeNull();
  });
});

describe('wrapText', () => {
  const measure = (t: string) => t.length;
  it('wraps at spaces and cuts words that are longer than a line', () => {
    expect(wrapText('aaa bbb ccc', 7, measure)).toEqual(['aaa bbb', 'ccc']);
    expect(wrapText('abcdefghij', 4, measure)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapText('', 5, measure)).toEqual(['']);
    expect(wrapText('  a   b ', 5, measure)).toEqual(['a b']);
  });
});

describe('monthToPdf', () => {
  it('makes a readable PDF with the JSON attached and the sums on the page', async () => {
    const book = november();
    const bytes = val(await monthToPdf(book, '2026-11', CREATED));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');

    const { doc, streams } = await inspect(bytes);
    expect(doc.getPageCount()).toBe(1);

    expect(streams.embedded).toHaveLength(1);
    const attachment = streams.embedded[0]?.text ?? '';
    expect(attachment).toBe(val(monthToJson(book, '2026-11', CREATED)));
    expect(JSON.parse(attachment).totalWorkMinutes).toBe(720);

    expect(streams.shown).toContain('Arbeitszeit November 2026');
    expect(streams.shown).toContain('Mitarbeiter/in: Anna Beispiel');
    expect(streams.shown).toContain('Summe Arbeitszeit: 12:00 Std. an 2 Tag(en)');
    expect(streams.shown).toContain('Mo 23.11.2026');
    expect(streams.shown).toContain('Ärztin: Büro ß'); // WinAnsi agrees with Latin-1 for these
    expect(streams.shown).toContain(attachmentName('2026-11'));
  });

  it('prints the SHA-256 of the attachment, and it is the hash of the attachment that was read back', async () => {
    const bytes = val(await monthToPdf(november(), '2026-11', CREATED));
    const { streams } = await inspect(bytes);
    const hash = await sha256Hex(streams.embedded[0]?.text ?? '');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(streams.shown).toContain(`Prüfsumme der angehängten Datei (SHA-256): ${hash}`);
  });

  it('names the attachment and its type in the file', async () => {
    const bytes = val(await monthToPdf(november(), '2026-11', CREATED));
    const raw = new TextDecoder('latin1').decode(bytes);
    expect(raw).toContain('/EmbeddedFiles');
    expect(raw).toContain('zeiterfassung-2026-11.json');
    expect(raw).toContain('application#2Fjson');
    expect(raw).not.toContain('.xml');
  });

  it('keeps the metadata neutral (no library or tool name)', async () => {
    const bytes = val(await monthToPdf(november(), '2026-11', CREATED));
    const raw = new TextDecoder('latin1').decode(bytes);
    expect(raw).not.toMatch(/pdf-lib/i);
    expect(raw).not.toMatch(/claude|anthropic/i);
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
    expect(JSON.parse(streams.embedded[0]?.text ?? '{}')).toMatchObject({ days: [], openDays: 0 });
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
    expect(streams.embedded[0]?.text).toContain('Pause 😀 → ok'); // the attachment keeps the real text
  });

  describe('section „Nachträgliche Änderungen“', () => {
    const withChanges = () => {
      let b = bookWith(
        day({ date: '2026-11-20', breaks: [] }),
        day({ date: '2026-11-21', breaks: [] }),
      );
      b = val(
        setWorkday(
          b,
          { date: '2026-11-20', startMin: 480, endMin: 1020, breaks: [], note: '' },
          '2026-11-23T08:00:00.000Z',
          { today: '2026-11-23', reason: 'Gehen später' },
        ),
      );
      b = val(
        moveWorkday(
          b,
          '2026-11-21',
          { date: '2026-11-19', startMin: 480, endMin: 990, breaks: [], note: '' },
          '2026-11-23T09:00:00.000Z',
          { today: '2026-11-23' },
        ),
      );
      return b;
    };

    it('prints date, time, before, after and reason of every change of the month', async () => {
      const bytes = val(await monthToPdf(withChanges(), '2026-11', CREATED));
      const { streams } = await inspect(bytes);
      expect(streams.shown).toContain('Nachträgliche Änderungen');
      expect(streams.shown).toContain('Fr 20.11.2026 – Geändert am 23.11.2026 08:00 UTC');
      expect(streams.shown).toContain('vorher: 08:00–16:30, Pause 0:00, Eingabe');
      expect(streams.shown).toContain('nachher: 08:00–17:00, Pause 0:00, Eingabe');
      expect(streams.shown).toContain('Begründung: Gehen später');
      expect(streams.shown).toContain(
        'Gelöscht am 23.11.2026 09:00 UTC (verschoben nach Do 19.11.2026)',
      );
      expect(streams.shown).toContain(
        'Nachgetragen am 23.11.2026 09:00 UTC (verschoben von Sa 21.11.2026)',
      );
      const data = JSON.parse(streams.embedded[0]?.text ?? '{}');
      expect(data.changes).toHaveLength(3);
    });

    it('has no such section without changes', async () => {
      const { streams } = await inspect(val(await monthToPdf(november(), '2026-11', CREATED)));
      expect(streams.shown).not.toContain('Nachträgliche Änderungen');
    });

    it('prints only the changes of the month asked for', async () => {
      const { streams } = await inspect(val(await monthToPdf(withChanges(), '2026-10', CREATED)));
      expect(streams.shown).not.toContain('Nachträgliche Änderungen');
    });

    it('continues on more pages when there are many changes, with page numbers and the hash on the last', async () => {
      let b = bookWith(day({ date: '2026-11-20', breaks: [] }));
      for (let i = 0; i < 40; i += 1) {
        b = val(
          setWorkday(
            b,
            { date: '2026-11-20', startMin: 480, endMin: 900 + i, breaks: [], note: '' },
            `2026-11-23T08:${String(i).padStart(2, '0')}:00.000Z`,
            { today: '2026-11-23', reason: `Korrektur ${i}` },
          ),
        );
      }
      const bytes = val(await monthToPdf(b, '2026-11', CREATED));
      const { doc, streams } = await inspect(bytes);
      expect(doc.getPageCount()).toBeGreaterThan(1);
      const n = doc.getPageCount();
      for (let p = 1; p <= n; p += 1) expect(streams.shown).toContain(`Seite ${p} von ${n}`);
      expect(streams.shown).toContain('Begründung: Korrektur 39');
      const hash = await sha256Hex(streams.embedded[0]?.text ?? '');
      expect(streams.shown).toContain(hash);
      expect(JSON.parse(streams.embedded[0]?.text ?? '{}').changes).toHaveLength(40);
    });
  });

  it('refuses a bad month', async () => {
    expect(await monthToPdf(emptyBook(), '2026-13', CREATED)).toEqual({
      ok: false,
      reason: 'bad-month',
    });
  });
});
