// The app's real build configuration with ONE change: the trust anchors of the time stamp services are
// replaced by the root of a test PKI (see build.sh), so the stand-in service's tokens verify. Everything
// else (the relay adapter, the verification, the UI, the policy) is the shipped code. Output: .tmp/e2e-dist.
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig, type Plugin, type UserConfigFnObject } from 'vite';
import base from '../vite.config.ts';

const trust = fileURLToPath(new URL('../.tmp/e2e/trust.ts', import.meta.url));

const swapTrustAnchors = (): Plugin => ({
  name: 'e2e-trust',
  enforce: 'pre',
  resolveId(source, importer) {
    // every importer of the trust: the relay adapter and the check of stored and restored anchors
    const trusting =
      importer?.endsWith('src/io/anchorService.ts') || importer?.endsWith('src/io/anchorCheck.ts');
    return trusting && source === './zeitstempel.ts' ? trust : null;
  },
});

export default defineConfig((env) =>
  mergeConfig((base as UserConfigFnObject)(env), {
    plugins: [swapTrustAnchors()],
    build: { outDir: '.tmp/e2e-dist', emptyOutDir: true },
  }),
);
