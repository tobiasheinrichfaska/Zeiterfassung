/** The page the wheels were on, kept in the browser's plain storage: only the page's node id, no data. */
export const LAST_PAGE_KEY = 'ze-seite';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Never throws: a private window or blocked storage just means the wheels start on the first page.
 * `accept` decides which node ids are valid (the navigation tree is the app's).
 */
export function createLastPageStore(
  storage: () => StorageLike | undefined,
  accept: (node: string) => boolean,
) {
  return {
    read(): string | undefined {
      try {
        const raw = storage()?.getItem(LAST_PAGE_KEY);
        return raw && accept(raw) ? raw : undefined;
      } catch {
        return undefined;
      }
    },
    write(node: string | null): void {
      if (node === null || !accept(node)) return;
      try {
        storage()?.setItem(LAST_PAGE_KEY, node);
      } catch {
        /* storage full or blocked: not worth an error */
      }
    },
  };
}
