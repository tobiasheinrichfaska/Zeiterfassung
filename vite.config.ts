import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { withCsp } from './src/build/csp.ts';
import { parseRelayList, relayOrigin } from './src/logic/relay.ts';

/**
 * The Content-Security-Policy with the hash of what the single-file step inlined — applied to the
 * written file, because that step inlines during generateBundle after the other plugins. `connect-src`
 * allows exactly the origins of the relay addresses the build names (`VITE_TIMESTAMP_RELAY`), else none.
 */
function contentSecurityPolicy(connectOrigins: string[]): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    writeBundle: (output, bundle) => {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.html') || !output.dir) continue;
        const path = join(output.dir, file.fileName);
        writeFileSync(path, withCsp(readFileSync(path, 'utf8'), connectOrigins));
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const relays = parseRelayList(env.VITE_TIMESTAMP_RELAY);
  const origins = [...new Set(relays.map(relayOrigin))];
  return {
    // Relative asset paths so the single file also runs from file://
    base: './',
    plugins: [react(), viteSingleFile(), contentSecurityPolicy(origins)],
    build: { modulePreload: { polyfill: false }, chunkSizeWarningLimit: 2000 },
    test: {
      globals: true,
      include: ['tests/**/*.test.ts'],
    },
  };
});
