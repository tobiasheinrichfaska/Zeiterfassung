import { BOOK_SLOT, emptyBook, exportBackup, loadBook, serializeBook } from '../src/logic/index.ts';
import { bookWith, day } from './helpers.ts';

describe('loadBook', () => {
  it('gives a fresh empty book when nothing is stored', () => {
    expect(loadBook(null)).toEqual({ kind: 'ok', book: emptyBook() });
  });

  it('reads what serializeBook wrote', () => {
    const book = bookWith(day());
    expect(loadBook(serializeBook(book))).toEqual({ kind: 'ok', book });
  });

  it('uses the backup format for the slot', () => {
    const book = bookWith(day());
    expect(serializeBook(book)).toBe(exportBackup(book));
  });

  it('reports stored text that fails the rules instead of an empty book', () => {
    expect(loadBook('{not json')).toEqual({ kind: 'unreadable', reason: 'bad-backup' });
    expect(loadBook('')).toEqual({ kind: 'unreadable', reason: 'bad-backup' });
    const newer = JSON.stringify({ ...emptyBook(), version: 4 });
    expect(loadBook(newer)).toEqual({ kind: 'unreadable', reason: 'unknown-version' });
  });

  it('names the slot', () => {
    expect(BOOK_SLOT).toBe('book');
  });
});
