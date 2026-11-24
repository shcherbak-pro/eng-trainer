import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { assertBuildDestinations } from './scripts/generated-dirs.mjs';
import { EXPERIMENTAL_PRODUCT, STABLE_PRODUCT, loadSiteConfig, productBuild } from './scripts/site-config.mjs';

// One source tree builds two products (ENG-V3-01). The product is chosen at build time:
//
//   stable-v2        the released v2 application, published at the site root (the default)
//   experimental-v3  the experimental build, not published
//
// site.config.json names each product's database, folders and route; scripts/site-config.mjs
// validates it. Without ENG_PRODUCT the build is the stable one, exactly as before.
// The preserved v1 application in ./v1 is a separate project with its own config and is
// published under /eng-trainer/v1/.
const product = productBuild(loadSiteConfig(), process.env.ENG_PRODUCT ?? STABLE_PRODUCT);

/**
 * Marks the entry page of the experimental product. The stable build never loads this
 * plugin, so its index.html stays byte-identical. "noindex" only asks search engines
 * not to list the page: it does not make a published path private.
 */
function experimentalEntryPage(): Plugin {
  const title = '<title>English Assessment Trainer</title>';
  return {
    name: 'eng-trainer:experimental-entry-page',
    transformIndexHtml(html) {
      if (!html.includes(title)) throw new Error('index.html: the title element was not found');
      return {
        html: html.replace(title, '<title>English Assessment Trainer (experimental v3)</title>'),
        tags: [
          { tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' }, injectTo: 'head' },
          { tag: 'meta', attrs: { name: 'eng-trainer-product', content: product.id }, injectTo: 'head' }
        ]
      };
    }
  };
}

/**
 * Vite empties its output folder before it writes a build. This stops a build unless that
 * folder is one this repository generates (scripts/generated-dirs.mjs): a product build
 * folder or a work area of the checks, and on disk a real folder, not a file, a link or
 * another spelling of a source folder. A Rollup output option would give Vite further
 * folders to empty, so none is accepted. Assets go to "assets", no manifest is written,
 * and the folder may hold no ".git" entry, which Vite would keep and could write through.
 * The check sees the options from every source (this file, the JavaScript API, the
 * command line), runs before Vite empties or writes an output folder and adds nothing to
 * the build output.
 */
function ownedOutputFolder(): Plugin {
  return {
    name: 'eng-trainer:owned-output-folder',
    apply: 'build',
    configResolved(config) {
      assertBuildDestinations(config);
    }
  };
}

export default defineConfig({
  base: product.base,
  publicDir: product.publicDir,
  plugins: [svelte(), ownedOutputFolder(), ...(product.id === EXPERIMENTAL_PRODUCT ? [experimentalEntryPage()] : [])],
  define: product.define,
  build: {
    target: 'es2020',
    outDir: product.outDir
  },
  // Keep the dev server away from the other application and from build output.
  optimizeDeps: {
    entries: ['index.html']
  },
  server: {
    watch: {
      ignored: ['**/v1/**', '**/site-dist/**', '**/dist-v3/**', '**/.variant/**', '**/.site-test/**', '**/.rehearsal/**', '**/.local/**']
    }
  }
});
