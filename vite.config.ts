import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { CACHE_PREFIX, serviceWorkerSource } from './src/pwa/serviceWorker.ts';

/**
 * rapier3d-compat inlines its wasm as base64, which gzips far worse than the binary. The
 * production build moves it to a .wasm asset fetched by the same init(); dev and unit tests keep
 * the inlined copy. The build fails if a Rapier update moves the entry or changes the call.
 */
function rapierWasmAsset(): Plugin {
  const inlined = /\b[A-Za-z_$][\w$]*\.toByteArray\("([A-Za-z0-9+/=]+)"\)(?:\.buffer)?/g;
  let transformed = false;
  return {
    name: 'rapier-wasm-asset',
    apply: 'build',
    buildEnd(error) {
      if (!error && !transformed)
        this.error('Rapier entry rapier3d-compat/dist/rapier.mjs not found');
    },
    transform(code, id) {
      if (!/rapier3d-compat[\\/]dist[\\/]rapier\.mjs$/.test(id)) return null;
      transformed = true;
      const matches = [...code.matchAll(inlined)];
      if (matches.length !== 1) {
        this.error(`Expected one inlined Rapier wasm blob, found ${matches.length}`);
      }
      const [call, base64] = matches[0]!;
      const ref = this.emitFile({
        type: 'asset',
        name: 'rapier.wasm',
        source: Buffer.from(base64!, 'base64'),
      });
      return { code: code.replace(call, `import.meta.ROLLUP_FILE_URL_${ref}`), map: null };
    },
  };
}

/**
 * Emits `sw.js` listing every built and public file. The cache name hashes the file names, the
 * page and the public files, so any change to the build gives a new cache.
 */
function serviceWorker(): Plugin {
  let publicDir = '';
  return {
    name: 'service-worker',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle(_options, bundle) {
      const page = bundle['index.html'];
      if (page?.type !== 'asset') this.error('index.html is missing from the bundle');
      const hashed = Object.keys(bundle)
        .filter((name) => name !== 'index.html' && !name.endsWith('.map'))
        .sort();
      const publicFiles = readdirSync(publicDir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name).slice(publicDir.length + 1))
        .sort();
      const hash = createHash('sha256').update(hashed.join('\n')).update(page.source);
      for (const name of publicFiles) hash.update(name).update(readFileSync(join(publicDir, name)));
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: serviceWorkerSource({
          cacheName: CACHE_PREFIX + hash.digest('hex').slice(0, 12),
          hashed,
          fresh: ['./', ...publicFiles],
        }),
      });
    },
  };
}

export default defineConfig({
  base: '/flip-a-coin/',
  plugins: [rapierWasmAsset(), serviceWorker()],
  build: {
    // three.js is one module of about 550 kB that the first frame needs; it gets its own chunk,
    // which stays cached across releases that change only the game code.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/testing/englishBrowser.ts'],
  },
});
