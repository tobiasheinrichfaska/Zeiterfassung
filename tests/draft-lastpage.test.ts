import { memoryEnvironment } from 'local-vault';
import {
  DRAFT_SLOT,
  LIMITS,
  emptyDrafts,
  emptyForm,
  isEmptyDrafts,
  parseDrafts,
  readFormFields,
  serializeDrafts,
  withDraft,
  type DayFormFields,
} from '../src/logic/index.ts';
import { readDrafts, writeDrafts } from '../src/io/drafts.ts';
import { LAST_PAGE_KEY, createLastPageStore, type StorageLike } from '../src/io/lastPage.ts';
import { PAGES, TREE, isPageNode } from '../src/ui/navigation.ts';
import { createAppVault } from '../src/ui/vault.ts';

const form = (over: Partial<DayFormFields> = {}): DayFormFields => ({
  ...emptyForm('2026-11-20'),
  start: '08:00',
  end: '16:30',
  note: 'Ärztin',
  breaks: [{ kind: 'span', minutes: '', from: '12:00', to: '12:30' }],
  ...over,
});

describe('drafts', () => {
  it('starts empty and sets and removes the two drafts', () => {
    let d = emptyDrafts();
    expect(isEmptyDrafts(d)).toBe(true);
    d = withDraft(d, 'tag', form());
    d = withDraft(d, 'monat', { date: '2026-11-21', fields: form() });
    expect(isEmptyDrafts(d)).toBe(false);
    expect(d.tag).toEqual(form());
    expect(d.monat?.date).toBe('2026-11-21');
    d = withDraft(d, 'tag', undefined);
    expect(d.tag).toBeUndefined();
    expect(d.monat).toBeDefined();
    expect(isEmptyDrafts(withDraft(d, 'monat', undefined))).toBe(true);
  });

  it('does not change the draft it is given', () => {
    const d = withDraft(emptyDrafts(), 'tag', form());
    withDraft(d, 'tag', undefined);
    expect(d.tag).toEqual(form());
  });

  it('round-trips through the stored text', () => {
    const d = withDraft(withDraft(emptyDrafts(), 'tag', form()), 'monat', {
      date: '2026-11-21',
      fields: form({ note: 'x' }),
    });
    expect(parseDrafts(serializeDrafts(d))).toEqual(d);
  });

  it('drops whatever does not pass, and never throws', () => {
    expect(parseDrafts(null)).toEqual(emptyDrafts());
    expect(parseDrafts('')).toEqual(emptyDrafts());
    expect(parseDrafts('{')).toEqual(emptyDrafts());
    expect(parseDrafts('[]')).toEqual(emptyDrafts());
    expect(parseDrafts('{"version":2}')).toEqual(emptyDrafts());
    expect(parseDrafts('x'.repeat(100_001))).toEqual(emptyDrafts());
    // one bad part does not take the other with it
    const text = JSON.stringify({
      version: 1,
      tag: { ...form(), extra: 1 },
      monat: { date: '2026-11-21', fields: form() },
    });
    const read = parseDrafts(text);
    expect(read.tag).toBeUndefined();
    expect(read.monat?.date).toBe('2026-11-21');
  });

  it('reads form fields strictly', () => {
    expect(readFormFields(form())).toEqual(form());
    expect(readFormFields({ ...form(), nextDay: 'ja' })).toBeNull();
    expect(readFormFields({ ...form(), start: '08:00:00' })).toBeNull();
    expect(readFormFields({ ...form(), note: 'x'.repeat(LIMITS.maxNoteChars + 1) })).toBeNull();
    expect(readFormFields({ ...form(), note: 'x'.repeat(LIMITS.maxNoteChars) })).not.toBeNull();
    expect(
      readFormFields({ ...form(), breaks: [{ kind: 'weird', minutes: '', from: '', to: '' }] }),
    ).toBeNull();
    expect(readFormFields({ ...form(), breaks: [{ kind: 'length', minutes: '30' }] })).toBeNull();
    const many = Array.from({ length: LIMITS.maxBreaksPerDay + 1 }, () => ({
      kind: 'length',
      minutes: '1',
      from: '',
      to: '',
    }));
    expect(readFormFields({ ...form(), breaks: many })).toBeNull();
    expect(readFormFields(null)).toBeNull();
    expect(
      parseDrafts(JSON.stringify({ version: 1, monat: { date: '2026-13-40', fields: form() } }))
        .monat,
    ).toBeUndefined();
  });
});

describe('drafts in the vault', () => {
  it('survive a restart, encrypted, and do not touch the book slot', async () => {
    const env = memoryEnvironment();
    const first = createAppVault(env);
    expect(await first.startVault()).toEqual({ kind: 'open' });
    expect(readDrafts(first)).toEqual(emptyDrafts());
    const d = withDraft(emptyDrafts(), 'tag', form({ note: 'geheimer Entwurf' }));
    expect(writeDrafts(first, d)).toBeUndefined();
    await first.saved();
    expect(env.read(`zeiterfassung-${DRAFT_SLOT}`)).not.toContain('geheimer');
    expect(env.read('zeiterfassung-book')).toBeNull();

    const second = createAppVault(env);
    await second.startVault();
    expect(readDrafts(second)).toEqual(d);

    // saving or discarding removes it
    writeDrafts(second, emptyDrafts());
    await second.saved();
    const third = createAppVault(env);
    await third.startVault();
    expect(isEmptyDrafts(readDrafts(third))).toBe(true);
  });

  it('give no drafts when the slot cannot be read (nothing is thrown)', () => {
    const closed = createAppVault(memoryEnvironment()); // not started: reading throws
    expect(readDrafts(closed)).toEqual(emptyDrafts());
  });
});

describe('the page the wheels were on', () => {
  const memory = (): StorageLike & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
  };

  it('accepts only page nodes of the tree', () => {
    expect(isPageNode('erfassen/stempeln')).toBe(true);
    expect(isPageNode('verwalten/sicherung')).toBe(true);
    expect(isPageNode('erfassen')).toBe(false); // an area, not a page
    expect(isPageNode('wurzel')).toBe(false);
    expect(isPageNode('gibt/es/nicht')).toBe(false);
    expect(isPageNode('')).toBe(false);
    for (const page of Object.keys(PAGES)) {
      const areas = (TREE.children ?? []).filter((a) =>
        (a.children ?? []).some((p) => p.page === page),
      );
      expect(areas.length, page).toBe(1);
    }
  });

  it('writes and reads the node id, under one key, nothing else', () => {
    const storage = memory();
    const store = createLastPageStore(() => storage, isPageNode);
    expect(store.read()).toBeUndefined();
    store.write('monatsbereich/monat');
    expect([...storage.map.keys()]).toEqual([LAST_PAGE_KEY]);
    expect(storage.map.get(LAST_PAGE_KEY)).toBe('monatsbereich/monat');
    expect(store.read()).toBe('monatsbereich/monat');
  });

  it('ignores the wheel (null), an unknown node and a stored value that is no longer valid', () => {
    const storage = memory();
    const store = createLastPageStore(() => storage, isPageNode);
    store.write('erfassen/tag');
    store.write(null);
    store.write('quatsch');
    expect(store.read()).toBe('erfassen/tag');
    storage.map.set(LAST_PAGE_KEY, 'altes/Format');
    expect(store.read()).toBeUndefined();
  });

  it('never throws when the storage is missing, blocked or full', () => {
    const blocked = createLastPageStore(() => {
      throw new Error('SecurityError');
    }, isPageNode);
    expect(blocked.read()).toBeUndefined();
    expect(() => blocked.write('erfassen/tag')).not.toThrow();
    const full = createLastPageStore(
      () => ({
        getItem: () => 'erfassen/tag',
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      }),
      isPageNode,
    );
    expect(full.read()).toBe('erfassen/tag');
    expect(() => full.write('erfassen/tag')).not.toThrow();
    expect(createLastPageStore(() => undefined, isPageNode).read()).toBeUndefined();
  });
});
