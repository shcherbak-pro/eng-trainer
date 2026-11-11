import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Test-only settings. The production build keeps using vite.config.ts as is.
export default mergeConfig(
  viteConfig,
  defineConfig({
    // Svelte components must be compiled for the browser to be mounted in tests.
    resolve: { conditions: ['browser'] },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts']
    }
  })
);
