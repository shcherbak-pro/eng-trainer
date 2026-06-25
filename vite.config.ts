import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// base: './' allows the built app to work on GitHub Pages under any repo path.
export default defineConfig({
  base: '/eng-trainer/',
  plugins: [svelte()],
  build: {
    target: 'es2020'
  }
});
