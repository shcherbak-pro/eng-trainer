import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// v1 is published under the /v1/ sub-path of the combined GitHub Pages site.
export default defineConfig({
  base: '/eng-trainer/v1/',
  plugins: [svelte()],
  build: {
    target: 'es2020'
  }
});
