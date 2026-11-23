import type { PdfAssets } from '../logic/index.ts';
import regular from '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff?inline';
import bold from '@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff?inline';

/** A `data:` URL (what Vite's `?inline` gives) → its bytes. */
function bytesOfDataUrl(url: string): Uint8Array {
  const binary = atob(url.slice(url.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * Noto Sans (SIL Open Font License 1.1, package `@fontsource/noto-sans`), Latin subset, regular and
 * bold, built into the single HTML file as data (no network at run time).
 */
export const pdfAssets = (): PdfAssets => ({
  fontRegular: bytesOfDataUrl(regular),
  fontBold: bytesOfDataUrl(bold),
});
