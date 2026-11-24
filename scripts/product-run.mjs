// Runs a tool for one product (ENG-V3-01). The product is passed to vite.config.ts through
// ENG_PRODUCT, which works the same in every shell, and no new dependency is needed.
//
//   node scripts/product-run.mjs <product> build          generate its content, then `vite build`
//   node scripts/product-run.mjs <product> test [args]    generate its content, then `vitest run`
//   node scripts/product-run.mjs <product> dev            generate its content, then the dev server
//
// Run products one after another. Some tests are close to their time limit, and two
// suites on one machine at the same time can make them fail.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { appProducts, loadSiteConfig, repoRoot } from './site-config.mjs';

const TOOLS = {
  build: ['node_modules/vite/bin/vite.js', 'build'],
  test: ['node_modules/vitest/vitest.mjs', 'run'],
  dev: ['node_modules/vite/bin/vite.js']
};

const [productId, command, ...rest] = process.argv.slice(2);
const site = loadSiteConfig();
const products = appProducts(site);
if (!products.includes(productId) || !Object.hasOwn(TOOLS, command ?? '')) {
  console.error(`Usage: node scripts/product-run.mjs <${products.join('|')}> <${Object.keys(TOOLS).join('|')}> [arguments]`);
  process.exit(1);
}

// The file system's own spelling of the folder. Svelte derives scoped class names from file
// paths relative to the working directory; a differently cased drive letter changes them.
const cwd = realpathSync.native(repoRoot);
const env = { ...process.env, ENG_PRODUCT: productId };

function run(script, args) {
  const result = spawnSync(process.execPath, [join(cwd, script), ...args], { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('scripts/generate-content.mjs', [productId]);
const [tool, ...toolArgs] = TOOLS[command];
run(tool, [...toolArgs, ...rest]);
