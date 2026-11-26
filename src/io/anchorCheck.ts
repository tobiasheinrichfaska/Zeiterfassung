import { verifyEvidence } from 'zeitstempel/client';
import {
  hexToBytes,
  readBackupFile,
  type Anchor,
  type Reason,
  type TimeBook,
} from '../logic/index.ts';
import { trustedServices } from './zeitstempel.ts';

/** How many anchors were looked at and how many did not verify. */
export interface AnchorCheck {
  total: number;
  failed: number;
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
  }
  return { total: anchors.length, failed };
}

export type VerifiedBackup =
  { ok: true; value: TimeBook } | { ok: false; reason: Reason; failed?: number; total?: number };

/**
 * Reads a backup file (`readBackupFile`) and, before anyone may replace the book with it, verifies every
 * anchor's evidence. Any failure: `backup-anchor-unverified` with the counts, nothing is returned to use.
 */
export async function readVerifiedBackup(
  text: string,
  password: string | undefined,
  trust?: string[],
): Promise<VerifiedBackup> {
  const read = await readBackupFile(text, password);
  if (!read.ok) return read;
  const check = await checkAnchors(read.value.anchors, trust);
  if (check.failed > 0) {
    return { ok: false, reason: 'backup-anchor-unverified', ...check };
  }
  return read;
}
