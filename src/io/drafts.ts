import type { Vault } from 'local-vault';
import {
  DRAFT_SLOT,
  emptyDrafts,
  parseDrafts,
  serializeDrafts,
  type Drafts,
} from '../logic/index.ts';

/** Reads the drafts from the open vault; a slot that cannot be read gives no drafts (never an error). */
export function readDrafts(vault: Pick<Vault, 'readSlot'>): Drafts {
  try {
    return parseDrafts(vault.readSlot(DRAFT_SLOT));
  } catch {
    return emptyDrafts();
  }
}

/** Writes the drafts encrypted; returns the vault's refusal text, or undefined. */
export function writeDrafts(vault: Pick<Vault, 'writeSlot'>, drafts: Drafts): string | undefined {
  return vault.writeSlot(DRAFT_SLOT, serializeDrafts(drafts));
}
