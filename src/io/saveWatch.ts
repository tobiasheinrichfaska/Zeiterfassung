import type { Vault } from 'local-vault';

/**
 * Watches the vault's writes, which happen after `writeSlot` returned (`local-vault` writes encrypted in
 * the background and reports a failure only through `onError`, e.g. a full storage). Every reported failure
 * becomes the standing `problem` (the times may not be stored); it stays until a later write of the book has
 * been stored with no failure reported in between. `onChange` gets every change of the problem.
 */
export interface SaveWatch {
  /** Listens to the vault's failures; returns the function that stops listening (an effect's cleanup). */
  start(): () => void;
  /** Call after every accepted `writeSlot` of the book. */
  wrote(): void;
  problem(): string | undefined;
}

export function watchSaves(
  vault: Pick<Vault, 'onError' | 'saved'>,
  onChange: (problem: string | undefined) => void,
): SaveWatch {
  let failures = 0;
  let problem: string | undefined;
  return {
    start: () =>
      vault.onError((error) => {
        failures += 1;
        problem = error;
        onChange(problem);
      }),
    wrote() {
      const seen = failures;
      void vault.saved().then(
        () => {
          if (failures === seen && problem !== undefined) {
            problem = undefined;
            onChange(undefined);
          }
        },
        () => undefined,
      );
    },
    problem: () => problem,
  };
}
