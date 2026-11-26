import { verifyEvidence } from 'zeitstempel/client';
import {
  hexToBytes,
  readBackupFile,
  type Anchor,
  type Reason,
  type TimeBook,
} from '../logic/index.ts';
import { trustedServices } from './zeitstempel.ts';

/** How many anchors were looked at and how many did not verify; `good[i]` for each anchor. */
export interface AnchorCheck {
  total: number;
  failed: number;
  good: boolean[];
}

/** The trust anchors of this build, every service together (the client takes one combined list too). */
function buildTrust(): string[] {
  return [...new Set([...trustedServices().values()].flatMap((s) => s.anchors))];
}

/** Results by token and hash, for the build's trust only (a stored book is checked again at every change). */
const known = new Map<string, boolean>();

/**
 * Verifies the evidence of every anchor against the anchor's `headHash` with the library's `verifyEvidence`
 * (token signature, certificate chain to the build's anchors, hash). No freshness rule: the evidence is old
 * by now. The logic layer only reads the form (`checkedEvidence`); this is the check of the token itself.
 * Never throws.
 */
export async function checkAnchors(
  anchors: readonly Anchor[],
  trust?: string[],
): Promise<AnchorCheck> {
  const useTrust = trust ?? buildTrust();
  let failed = 0;
  const goods: boolean[] = [];
  for (const anchor of anchors) {
    const key = trust ? null : `${anchor.headHash}|${anchor.evidence.token}`;
    let good = key === null ? undefined : known.get(key);
    if (good === undefined) {
      const hash = hexToBytes(anchor.headHash);
      try {
        const result = hash
          ? await verifyEvidence(anchor.evidence, hash, { trust: useTrust })
          : { ok: false };
        good = result.ok;
      } catch {
        good = false;
      }
      if (key !== null) known.set(key, good);
    }
    if (!good) failed += 1;
    goods.push(good);
  }
  return { total: anchors.length, failed, good: goods };
}

export type VerifiedBackup =
  { ok: true; value: TimeBook; dropped: number; total: number } | { ok: false; reason: Reason };

/**
 * Reads a backup file (`readBackupFile`: strict, and its days must match its stamp chain) and verifies
 * every anchor's evidence before anyone may replace the book with it. An anchor that does not verify is
 * **dropped** (decision Tobias 2026-11-26): every time is kept, the remaining anchors stay in order, and
 * `dropped` says how many went (the stretch of the chain only they covered is no longer externally
 * covered; a later anchor covers it again from its own time on).
 */
export async function readVerifiedBackup(
  text: string,
  password: string | undefined,
  trust?: string[],
): Promise<VerifiedBackup> {
  const read = await readBackupFile(text, password);
  if (!read.ok) return read;
  const book = read.value;
  const check = await checkAnchors(book.anchors, trust);
  const anchors = book.anchors.filter((_, i) => check.good[i]);
  return {
    ok: true,
    value: check.failed > 0 ? { ...book, anchors } : book,
    dropped: check.failed,
    total: check.total,
  };
}
