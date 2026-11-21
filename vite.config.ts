import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// This is the v2 application. It is published at the root of the GitHub Pages
// site. The preserved v1 application in ./v1 is a separate project with its own
// config and is published under /eng-trainer/v1/.
export default defineConfig({
  base: '/eng-trainer/',
  plugins: [svelte()],
  build: {
    target: 'es2020',
    outDir: 'dist'
  },
  // Keep the dev server away from the other application and from build output.
  optimizeDeps: {
    entries: ['index.html']
  },
  server: {
    watch: {
      ignored: ['**/v1/**', '**/site-dist/**']
    }
  }
});
