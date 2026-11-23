import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { Vault } from 'local-vault';
import { withDraft, type DateKey, type DayFormFields, type Drafts } from '../logic/index.ts';
import { readDrafts, writeDrafts } from '../io/drafts.ts';
import { useBookApi } from './bookContext.ts';
import { DraftContext, type DraftApi } from './draftContext.ts';

/**
 * Keeps unsaved form input in memory across page changes and, encrypted, in the vault's own slot, so a
 * form that was started survives swiping away and closing the app. Saving or discarding removes it.
 */
export function DraftProvider({ vault, children }: { vault: Vault; children: ReactNode }) {
  const { showError } = useBookApi();
  const [drafts, setDrafts] = useState<Drafts>(() => readDrafts(vault));

  const change = useCallback(
    (next: (old: Drafts) => Drafts) =>
      setDrafts((old) => {
        const updated = next(old);
        const refused = writeDrafts(vault, updated);
        if (refused !== undefined) queueMicrotask(() => showError(refused));
        return updated;
      }),
    [vault, showError],
  );

  const api = useMemo<DraftApi>(
    () => ({
      drafts,
      setTagDraft: (value: DayFormFields | undefined) =>
        change((old) => withDraft(old, 'tag', value)),
      setMonthDraft: (value: { date: DateKey; fields: DayFormFields } | undefined) =>
        change((old) => withDraft(old, 'monat', value)),
    }),
    [drafts, change],
  );

  return <DraftContext.Provider value={api}>{children}</DraftContext.Provider>;
}
