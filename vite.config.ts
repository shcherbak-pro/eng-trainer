import { resolve } from 'node:path';
import { defineConfig, normalizePath, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { assertBuildDestinations } from './scripts/generated-dirs.mjs';
import { inlineScriptHashes, pagePolicy } from './scripts/pronunciation-policy.mjs';
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
 * Gives the built entry page of the experimental product its Content-Security-Policy
 * (ENG-V3-02, stage A), as a meta element right after the charset. GitHub Pages cannot
 * send the policy as a header.
 *
 * The policy governs the page, and the recognizer's Worker because that Worker is started
 * from a blob: address and so inherits it (src/features/pronunciation/recognition/bootstrap.ts).
 * It allows this origin and nothing else: no other host for requests, scripts or
 * Workers. The one inline script of index.html, which sets the theme, is allowed by its
 * hash. scripts/pronunciation-policy.mjs holds the text; the product gates compare the
 * built page with it.
 *
 * Build only: the development server needs inline scripts and a WebSocket of its own.
 */
function experimentalPagePolicy(): Plugin {
  const charset = '<meta charset="UTF-8" />';
  return {
    name: 'eng-trainer:experimental-page-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!html.includes(charset)) throw new Error('index.html: the charset element was not found');
        const policy = pagePolicy(inlineScriptHashes(html));
        return html.replace(charset, `${charset}\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
      }
    }
  };
}

/** Source folders that only the experimental product is built from. */
const EXPERIMENTAL_ONLY_SOURCES = ['src/features/pronunciation'];

/**
 * Builds a product that is not the experimental one without the experimental-only
 * source folders (ENG-V3-02, stage A): an import that leads into one of them gets an
 * empty module in its place.
 *
 * The compile-time guard in App.svelte already removes the feature's code from the
 * stable build. It does not stop the bundler from reading the guarded module first, and
 * files that a module emits while it is read (a Worker, a WebAssembly binary) would
 * land in the stable build folder although nothing refers to them. With this plugin the
 * stable build never reads those sources at all. The released-site lock still decides:
 * the stable output must be the released files and nothing else.
 *
 * Build only. Tests import the feature's modules directly, for either product.
 */
function withoutExperimentalSources(): Plugin {
  let folders: string[] = [];
  const empty = '\0eng-trainer:experimental-only';
  return {
    name: 'eng-trainer:without-experimental-sources',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      // From the root Vite resolved, so the folders are spelled exactly like the module addresses.
      folders = EXPERIMENTAL_ONLY_SOURCES.map((folder) => `${normalizePath(resolve(config.root, folder))}/`);
    },
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;
      const file = normalizePath(resolved.id).split('?')[0];
      return folders.some((folder) => file.startsWith(folder)) ? empty : null;
    },
    load(id) {
      return id === empty ? 'export default null;' : null;
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
  plugins: [svelte(), ownedOutputFolder(), ...(product.id === EXPERIMENTAL_PRODUCT ? [experimentalEntryPage(), experimentalPagePolicy()] : [withoutExperimentalSources()])],
  define: product.define,
  build: {
    target: 'es2020',
    outDir: product.outDir
  },
  // The recognizer's Worker of the experimental product is an ES module, started from a
  // blob: address (bootstrap.ts). The stable product has no Worker, so this changes nothing there.
  worker: {
    format: 'es'
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
