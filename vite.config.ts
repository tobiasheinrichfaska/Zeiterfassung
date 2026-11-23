import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import type { Plugin } from 'vite';
import { withCsp } from './src/build/csp.ts';

/**
 * The Content-Security-Policy with the hash of what the single-file step inlined — applied to the
 * written file, because that step inlines during generateBundle after the other plugins.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    writeBundle: (output, bundle) => {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.html') || !output.dir) continue;
        const path = join(output.dir, file.fileName);
        writeFileSync(path, withCsp(readFileSync(path, 'utf8')));
      }
    },
  };
}

export default defineConfig({
  // Relative asset paths so the single file also runs from file://
  base: './',
  plugins: [react(), viteSingleFile(), contentSecurityPolicy()],
  build: { modulePreload: { polyfill: false }, chunkSizeWarningLimit: 2000 },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
