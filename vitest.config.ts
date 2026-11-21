import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Test-only settings. The production build keeps using vite.config.ts as is.
export default mergeConfig(
  viteConfig,
  defineConfig({
    // Svelte components must be compiled for the browser to be mounted in tests.
    resolve: { conditions: ['browser'] },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
      // v1 has its own test run (npm run test:v1).
      exclude: [...configDefaults.exclude, 'v1/**', 'site-dist/**'],
      // jsdom has no IndexedDB; the setup file installs an in-memory one.
      setupFiles: ['src/test/setup.ts']
    }
  })
);
