import { resolve } from 'node:path';
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Test-only settings. The production build keeps using vite.config.ts as is.
// The suite runs for one product at a time: `npm test` for stable-v2 and
// `npm run test:v3` for experimental-v3 (see scripts/product-run.mjs).
const experimental = viteConfig.define?.__ENG_PRODUCT__ === JSON.stringify('experimental-v3');

export default mergeConfig(
  viteConfig,
  defineConfig({
    resolve: {
      // Svelte components must be compiled for the browser to be mounted in tests.
      conditions: ['browser'],
      // The generated content of the product under test (src/test/content.ts).
      alias: { '$product-public': resolve(viteConfig.publicDir as string) }
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
      // v1 has its own test run (npm run test:v1).
      exclude: [...configDefaults.exclude, 'v1/**', 'site-dist/**'],
      // jsdom has no IndexedDB; the setup file installs an in-memory one.
      setupFiles: ['src/test/setup.ts'],
      // Some whole-application tests need 3 to 4 seconds, against a limit of 5. The experimental
      // suite runs as a second pass on the same machine and was seen to cross that limit once,
      // with no assertion failing. It gets a wider limit. The stable suite keeps the default.
      ...(experimental ? { testTimeout: 10_000 } : {})
    }
  })
);
