import {
  backupFileName,
  describeBook,
  emptyBook,
  moveWorkday,
  pdfFileName,
  replaceQuestion,
  restoreRefusal,
  setWorkday,
} from '../src/logic/index.ts';
import { CTX, NOW, bookWith, day, val } from './helpers.ts';

const input = { date: '2026-11-23', startMin: 480, endMin: 990, breaks: [], note: '' };

describe('moveWorkday', () => {
  it('replaces the day on the same date', () => {
    const b = bookWith(day());
    const r = val(moveWorkday(b, '2026-11-23', { ...input, endMin: 1000 }, NOW, CTX));
    expect(Object.keys(r.days)).toEqual(['2026-11-23']);
    expect(r.days['2026-11-23']?.endMin).toBe(1000);
  });

  it('moves a day to another date in one step', () => {
    const b = bookWith(day());
    const r = val(moveWorkday(b, '2026-11-23', { ...input, date: '2026-11-22' }, NOW, CTX));
    expect(Object.keys(r.days)).toEqual(['2026-11-22']);
  });

  it('changes nothing when the new input is refused (the old day stays)', () => {
    const b = bookWith(day());
    expect(
      moveWorkday(b, '2026-11-23', { ...input, date: '2026-11-22', endMin: 100 }, NOW, CTX),
    ).toEqual({
      ok: false,
      reason: 'end-before-start',
    });
    expect(Object.keys(b.days)).toEqual(['2026-11-23']);
  });

  it('refuses a day that is not there', () => {
    expect(moveWorkday(emptyBook(), '2026-11-23', input, NOW, CTX)).toEqual({
      ok: false,
      reason: 'no-such-day',
    });
  });

  it('replaces the entry already standing on the new date', () => {
    const b = bookWith(day(), day({ date: '2026-11-22', note: 'alt' }));
    const r = val(moveWorkday(b, '2026-11-23', { ...input, date: '2026-11-22' }, NOW, CTX));
    expect(Object.keys(r.days)).toEqual(['2026-11-22']);
    expect(r.days['2026-11-22']?.note).toBe('');
  });

  it('keeps the running-day rule', () => {
    const b = val(
      setWorkday(
        bookWith(day({ date: '2026-11-20' })),
        { ...input, date: '2026-11-22', endMin: null },
        NOW,
        CTX,
      ),
    );
    expect(
      moveWorkday(b, '2026-11-20', { ...input, date: '2026-11-21', endMin: null }, NOW, CTX),
    ).toEqual({
      ok: false,
      reason: 'second-open-day',
    });
  });
});

describe('file names and descriptions', () => {
  it('names the files', () => {
    expect(pdfFileName('2026-11')).toBe('zeiterfassung-2026-11.pdf');
    expect(backupFileName('2026-11-23', true)).toBe(
      'sicherung-2026-11-23.verschluesselt.zeiterfassung.json',
    );
    expect(backupFileName('2026-11-23', false)).toBe(
      'sicherung-2026-11-23.unverschluesselt.zeiterfassung.json',
    );
  });

  it('describes a book', () => {
    expect(describeBook(emptyBook())).toEqual({ days: 0, first: null, last: null });
    const b = bookWith(day({ date: '2026-11-24' }), day({ date: '2026-11-02' }));
    expect(describeBook(b)).toEqual({ days: 2, first: '2026-11-02', last: '2026-11-24' });
  });

  it('asks before a backup replaces the data, naming both', () => {
    const q = replaceQuestion(
      bookWith(day()),
      bookWith(day({ date: '2026-10-01' }), day({ date: '2026-10-02' })),
    );
    expect(q).toContain('1 Arbeitstag(e) von Mo 23.11.2026 bis Mo 23.11.2026');
    expect(q).toContain('2 Arbeitstag(e) von Do 01.10.2026 bis Fr 02.10.2026');
    expect(q).toContain('geht verloren');
    expect(replaceQuestion(emptyBook(), emptyBook())).toContain('keine Arbeitstage');
  });
});

describe('restoreRefusal (the restore form)', () => {
  it('asks for the password silently only the first time; an empty password entered is said', () => {
    expect(restoreRefusal('password-required', false, 'a.json')).toEqual({
      askPassword: true,
      text: null,
    });
    expect(restoreRefusal('password-required', true, 'a.json')).toEqual({
      askPassword: true,
      text: 'Diese Sicherung ist verschlüsselt. Bitte das Passwort eingeben.',
    });
    const wrong = restoreRefusal('wrong-password', true, 'a.json');
    expect(wrong.askPassword).toBe(true);
    expect(wrong.text).toContain('„a.json“ kann nicht eingespielt werden');
    expect(restoreRefusal('bad-backup', false, 'a.json').askPassword).toBe(false);
  });
});
