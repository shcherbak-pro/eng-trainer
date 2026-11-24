// Copies product builds into one site folder, by route (ENG-V3-01).
//
// The script only copies compiled files. It never builds, and it never touches the
// build directories. Which routes are copied is the caller's decision:
//
//   scripts/assemble-site.mjs        published routes only -> site-dist/   (the Pages artifact)
//   scripts/assemble-test-site.mjs   every route           -> .site-test/  (local checks, never uploaded)
import { cp, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PRODUCTION_SITE_DIR, TEST_SITE_DIR, removeGeneratedDir } from './generated-dirs.mjs';
import { EXPERIMENTAL_PRODUCT, LEGACY_PRODUCT, STABLE_PRODUCT, repoRoot } from './site-config.mjs';

// `site-dist` is uploaded to GitHub Pages, and only the production assembly writes it.
// `.site-test` is the local three-product assembly for browser checks.
export { PRODUCTION_SITE_DIR, TEST_SITE_DIR };

const BUILD_HINTS = {
  [STABLE_PRODUCT]: 'npm run build',
  [LEGACY_PRODUCT]: 'npm run build:v1',
  [EXPERIMENTAL_PRODUCT]: 'npm run build:v3'
};

/** Every file below a folder as a sorted list of forward-slash paths. Hidden files are included. */
export async function listFiles(dir, prefix = '') {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) files.push(...await listFiles(join(dir, entry.name), `${prefix}${entry.name}/`));
    else files.push(`${prefix}${entry.name}`);
  }
  return files.sort();
}

/**
 * Assembles the given routes into `target`, which is emptied first, so no file of an
 * earlier assembly can stay in it.
 *
 * `routes` are the routes to copy. `buildDirs` may replace a product's configured build
 * folder (the promotion rehearsal builds into its own folders).
 *
 * Refused, before anything is deleted or copied:
 * - a route that the configuration does not contain, or two routes at one path;
 * - a missing build;
 * - a build with a top-level entry named like any configured route. Such an entry would
 *   be published at that route's address, also when the route itself is not published;
 * - a `target` that is not an assembly folder (`site-dist`, `.site-test`) or a folder in
 *   a work area of the checks, or that is a file, a link or another spelling on disk.
 */
export async function assembleRoutes({ site, routes, target, buildDirs = {}, root = repoRoot }) {
  const seen = new Set();
  const plan = [];

  for (const route of routes) {
    if (!site.routes.some((item) => item.path === route.path && item.product === route.product)) {
      throw new Error(`Route ${JSON.stringify(route.path)} for "${route.product}" is not part of the site configuration`);
    }
    if (seen.has(route.path)) throw new Error(`Two routes are assembled at ${JSON.stringify(route.path)}`);
    seen.add(route.path);

    const build = join(root, buildDirs[route.product] ?? site.products[route.product].outDir);
    if (!existsSync(join(build, 'index.html'))) {
      throw new Error(`Missing ${join(build, 'index.html')}\nBuild "${route.product}" first: ${BUILD_HINTS[route.product] ?? 'see package.json'}`);
    }
    const entries = await readdir(build);
    for (const other of site.routes) {
      const segment = other.path.slice(0, -1);
      if (other.path === route.path || !other.path.startsWith(route.path) || !segment) continue;
      const inside = other.path.slice(route.path.length).split('/')[0];
      if (entries.includes(inside)) {
        throw new Error(`The build of "${route.product}" contains "${inside}". That path belongs to the route "${other.path}" of "${other.product}".`);
      }
    }
    plan.push({ route, build });
  }
  if (!plan.some(({ route }) => route.path === '')) throw new Error('No product is assembled at the site root');

  // The one removal of this module, checked on disk immediately before it happens.
  const targetDir = await removeGeneratedDir(root, target, ['site', 'work']);
  await mkdir(targetDir, { recursive: true });
  // The site root first, then the sub-paths.
  plan.sort((a, b) => a.route.path.length - b.route.path.length);
  for (const { route, build } of plan) await cp(build, join(targetDir, route.path), { recursive: true });

  return plan.map(({ route }) => route);
}

/** A one-line description of what an assembly contains and what it left out. */
export function describeAssembly(site, target, assembled) {
  const copied = assembled.map((route) => `${route.product} at "${target}/${route.path}"`).join(', ');
  const left = site.routes.filter((route) => !assembled.includes(route)).map((route) => `${route.product} ("${route.path}")`);
  return `Assembled ${copied}.${left.length ? ` Not included: ${left.join(', ')}.` : ''}`;
}
