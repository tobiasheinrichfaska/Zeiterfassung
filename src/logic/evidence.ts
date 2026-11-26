/**
 * The evidence of an external time stamp (format v1 of `zeitstempel/client`, `docs/client.md` there): the
 * service, the stamped hash, the token (base64url) and the time the token attests, as checked at stamping
 * time. The app keeps it as it is, in the anchors of the stamp chain. Only pure readers of the library are
 * used here (no network): `readEvidence` (strict form check) and `readToken` (for the serial number).
 */
import { fromBase64Url, readToken, toBase64Url } from 'zeitstempel';
import { readEvidence, type Evidence } from 'zeitstempel/client';
import { isHash } from './sha256.ts';

export type { Evidence };
export { readEvidence };

/** A hash of 64 hex digits as the base64url text an evidence carries, or null. */
export function hexToBase64Url(hex: string): string | null {
  if (!isHash(hex)) return null;
  return toBase64Url(Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16)));
}

/** The DER bytes of the evidence's token, or null when it is not readable base64url. */
export const evidenceToken = (evidence: Evidence): Uint8Array | null =>
  fromBase64Url(evidence.token);

/** The serial number of the evidence's token (lower-case hex), or null when the token cannot be read. */
export function evidenceSerial(evidence: Evidence): string | null {
  const token = evidenceToken(evidence);
  if (!token) return null;
  try {
    return readToken(token).info.serial;
  } catch {
    return null;
  }
}
