import { useMemo, useRef } from 'react';

/**
 * A value that functions started earlier can still read as it is now (a request that comes back after
 * the book changed). Reading and writing happen in callbacks, never while rendering.
 */
export function useLatest<T>(initial: T): { get: () => T; set: (value: T) => void } {
  const ref = useRef(initial);
  return useMemo(
    () => ({
      get: () => ref.current,
      set: (value: T) => {
        ref.current = value;
      },
    }),
    [],
  );
}
