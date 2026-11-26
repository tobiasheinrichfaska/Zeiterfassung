// Thin Vite wrapper: writes the policy into the finished HTML file. The single-file step inlines during
// generateBundle after the other plugins, so the policy is applied to the written file (writeBundle).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { addCsp, type CspOptions } from './csp.ts';

export function singleFileCsp(options: CspOptions = {}): Plugin {
  return {
    name: 'einzeldatei-csp',
    apply: 'build',
    writeBundle: (output, bundle) => {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.html') || !output.dir) continue;
        const path = join(output.dir, file.fileName);
        writeFileSync(path, addCsp(readFileSync(path, 'utf8'), options));
      }
    },
  };
}
