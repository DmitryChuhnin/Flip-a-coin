import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * rapier3d-compat inlines its wasm as base64, which gzips far worse than the binary. The
 * production build moves it to a .wasm asset fetched by the same init(); dev and unit tests keep
 * the inlined copy. The build fails if a Rapier update changes the inlined call.
 */
function rapierWasmAsset(): Plugin {
  const inlined = /\b[A-Za-z_$][\w$]*\.toByteArray\("([A-Za-z0-9+/=]+)"\)(?:\.buffer)?/g;
  return {
    name: 'rapier-wasm-asset',
    apply: 'build',
    transform(code, id) {
      if (!/rapier3d-compat[\\/]dist[\\/]rapier\.mjs$/.test(id)) return null;
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

export default defineConfig({
  base: '/flip-a-coin/',
  plugins: [rapierWasmAsset()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
