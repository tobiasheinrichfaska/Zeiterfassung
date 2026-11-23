import { readFileSync } from 'node:fs';
import type { PdfAssets } from '../src/logic/index.ts';

const font = (weight: 400 | 700): Uint8Array =>
  new Uint8Array(
    readFileSync(
      new URL(
        `../node_modules/@fontsource/noto-sans/files/noto-sans-latin-${weight}-normal.woff`,
        import.meta.url,
      ),
    ),
  );

/** The two font files of the app, read from the package (the app imports the same files). */
export const ASSETS: PdfAssets = { fontRegular: font(400), fontBold: font(700) };
