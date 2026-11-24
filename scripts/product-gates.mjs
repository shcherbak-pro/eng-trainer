// Fail-closed gates on the products of this repository (ENG-V3-01).
//
// They examine the assembled site, the folder that is uploaded to GitHub Pages, and the
// build of the experimental product. scripts/check-products.mjs runs them before the
// upload; scripts/check-negative.mjs proves on deliberately broken copies that each
// gate fails when it should.
//
// The released-site lock is the list of files that ENG-V2-03 released. Work on the
// experimental product must pass it unchanged. It is never updated to make such work
// pass: a real change of the stable product is a separate, approved stable release.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listFiles } from './site-assembly.mjs';
import { entryAssetUrls } from './site-checks.mjs';
import { EXPERIMENTAL_PRODUCT, LEGACY_PRODUCT, STABLE_PRODUCT, repoRoot, routeOf, routeUrl } from './site-config.mjs';

export const SITE_LOCK_FILE = 'scripts/locks/released-site.files.json';
export const CATALOG_LOCK_FILE = 'src/test/fixtures/released-catalog-v2.lock.json';

/** Marker attribute of experimental-only screens. It must never reach the stable output. */
export const EXPERIMENTAL_MARKER = 'data-experimental-feature';

/**
 * Speech, model, Worker and remote-runtime tokens. The released stable output contains
 * none of them. ENG-V3-01 implements no speech feature, so the experimental output
 * must not contain them either.
 */
export const FEATURE_TOKENS = [
  'getUserMedia', 'mediaDevices', 'AudioWorklet', 'AudioContext', 'MediaRecorder', 'SpeechRecognition',
  'onnx', 'transformers', 'wasm', 'WebAssembly', 'new Worker', 'importScripts', 'SharedArrayBuffer',
  'serviceWorker', 'caches.open', 'huggingface', 'jsdelivr'
];

/** Traces of the experimental product, and of a build that lost its compile-time constants. */
export const EXPERIMENTAL_TOKENS = ['eng-trainer-v3', 'experimental-v3', '/v3/', EXPERIMENTAL_MARKER, 'PronunciationPlaceholder', '__ENG_', '__SITE_BASE__'];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isCode = (path) => /\.(?:html|js|mjs|css)$/.test(path);

export function readLocks(root = repoRoot) {
  const siteLock = JSON.parse(readFileSync(join(root, SITE_LOCK_FILE), 'utf8'));
  const catalogLock = JSON.parse(readFileSync(join(root, CATALOG_LOCK_FILE), 'utf8'));
  if (!Array.isArray(siteLock.files) || !siteLock.files.every((file) => typeof file.path === 'string' && Number.isInteger(file.bytes) && /^[0-9a-f]{64}$/.test(file.sha256))) {
    throw new Error(`${SITE_LOCK_FILE}: every entry needs a path, a size and a SHA-256`);
  }
  if (new Set(siteLock.files.map((file) => file.path)).size !== siteLock.files.length) throw new Error(`${SITE_LOCK_FILE}: a path is listed twice`);
  if (!/^[0-9a-f]{64}$/.test(catalogLock.manifestSha256) || !Array.isArray(catalogLock.packs)) throw new Error(`${CATALOG_LOCK_FILE}: malformed`);
  return { siteLock, catalogLock };
}

/** Path, size and SHA-256 of every file below a folder, hidden files included. */
export async function inventory(dir) {
  return (await listFiles(dir)).map((path) => {
    const bytes = readFileSync(join(dir, path));
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  });
}

/**
 * Compares a file list with the expected one: nothing extra, nothing missing, nothing changed.
 * `dir` lets a changed file be classified: a file that differs only by carriage returns
 * comes from a checkout with CRLF line endings. It still fails. CI builds from LF.
 */
export function compareInventory(found, expected, dir) {
  const problems = [];
  const wanted = new Map(expected.map((file) => [file.path, file]));
  const present = new Map(found.map((file) => [file.path, file]));
  for (const file of found) if (!wanted.has(file.path)) problems.push(`extra file: ${file.path}`);
  for (const file of expected) if (!present.has(file.path)) problems.push(`missing file: ${file.path}`);
  for (const file of found) {
    const want = wanted.get(file.path);
    if (!want || (want.sha256 === file.sha256 && want.bytes === file.bytes)) continue;
    let hint = '';
    if (dir) {
      const stripped = Buffer.from(readFileSync(join(dir, file.path)).filter((byte) => byte !== 13));
      if (sha256(stripped) === want.sha256) hint = ' It differs only by carriage returns: this build comes from a checkout with CRLF line endings. Build from LF files, as CI does.';
    }
    problems.push(`changed file: ${file.path} (${file.bytes} bytes, SHA-256 ${file.sha256.slice(0, 16)}…; released: ${want.bytes} bytes, ${want.sha256.slice(0, 16)}…).${hint}`);
  }
  return problems;
}

/** The files of one product inside an assembled site: its route, without the routes nested in it. */
function productFiles(site, files, productId) {
  const own = routeOf(site, productId).path;
  const nested = site.routes.map((route) => route.path).filter((path) => path !== own && path.startsWith(own));
  return files.filter((file) => file.path.startsWith(own) && !nested.some((path) => file.path.startsWith(path)));
}

function scanTokens(dir, files, tokens) {
  const hits = [];
  for (const file of files.filter((item) => isCode(item.path))) {
    const text = readFileSync(join(dir, file.path), 'utf8');
    for (const token of tokens) if (text.includes(token)) hits.push(`${file.path} contains "${token}"`);
  }
  return hits;
}

/** Gate 1. The assembled site is exactly the released site, plus only what a published route adds. */
function gateReleasedSite({ site, siteFiles, siteDir, experimentalFiles, siteLock }) {
  const problems = [];
  const stable = routeOf(site, STABLE_PRODUCT);
  const legacy = routeOf(site, LEGACY_PRODUCT);
  if (stable.path !== '' || !stable.publish || legacy.path !== 'v1/' || !legacy.publish) {
    problems.push('the released-site lock describes stable-v2 at the site root and legacy-v1 at v1/. A different arrangement needs its own approved lock.');
    return problems;
  }

  let locked = siteFiles;
  const experimental = site.routes.find((route) => route.product === EXPERIMENTAL_PRODUCT);
  if (experimental?.publish) {
    // A published experimental route may add its own build under its path, and nothing else.
    const added = siteFiles.filter((file) => file.path.startsWith(experimental.path));
    locked = siteFiles.filter((file) => !file.path.startsWith(experimental.path));
    const expected = experimentalFiles.map((file) => ({ ...file, path: `${experimental.path}${file.path}` }));
    problems.push(...compareInventory(added, expected).map((problem) => `${EXPERIMENTAL_PRODUCT}: ${problem}`));
  }
  problems.push(...compareInventory(locked, siteLock.files, siteDir));
  return problems;
}

/** Gate 2. Nothing is published at the path of a route whose committed flag says "publish": false. */
function gateUnpublished({ site, siteFiles }) {
  const problems = [];
  for (const route of site.routes.filter((item) => !item.publish)) {
    const segment = route.path.slice(0, -1);
    const leaked = siteFiles.filter((file) => file.path === segment || file.path.startsWith(route.path));
    if (leaked.length) problems.push(`"${route.product}" is not published, but the site has ${leaked.length} file(s) at ${route.path}, for example ${leaked[0].path}`);
  }
  return problems;
}

/** Gate 3. The stable product is one script and one stylesheet: no lazy feature chunk. */
function gateStableChunks({ stableDir, stableFiles }) {
  const problems = [];
  const scripts = stableFiles.filter((file) => /\.m?js$/.test(file.path)).map((file) => file.path);
  const stylesheets = stableFiles.filter((file) => file.path.endsWith('.css')).map((file) => file.path);
  if (scripts.length !== 1) problems.push(`expected exactly one script, found ${scripts.length}: ${scripts.join(', ')}`);
  if (stylesheets.length !== 1) problems.push(`expected exactly one stylesheet, found ${stylesheets.length}: ${stylesheets.join(', ')}`);
  const indexPath = join(stableDir, 'index.html');
  if (!existsSync(indexPath)) return [...problems, 'index.html is missing'];
  const referenced = entryAssetUrls(readFileSync(indexPath, 'utf8')).map((url) => url.split('/').pop()).sort();
  const built = [...scripts, ...stylesheets].map((path) => path.split('/').pop()).sort();
  if (referenced.join() !== built.join()) problems.push(`index.html names ${referenced.join(', ') || 'nothing'}, but the build has ${built.join(', ') || 'nothing'}`);
  return problems;
}

/** Gates 5 and 6 (content). A product's published catalog is exactly the released one. */
function contentProblems(files, dir, catalogLock) {
  const expected = [
    { path: 'data/manifest.json', bytes: catalogLock.manifestBytes, sha256: catalogLock.manifestSha256 },
    ...catalogLock.packs.map((pack) => ({ path: `data/${pack.url}`, bytes: pack.bytes, sha256: pack.sha256 }))
  ];
  return compareInventory(files.filter((file) => file.path.startsWith('data/')), expected, dir);
}

/** Gate 7. The experimental build is its own product, and ENG-V3-01 gives it no speech feature. */
function gateExperimentalBuild({ site, experimentalDir, experimentalFiles }) {
  const problems = [];
  const indexPath = join(experimentalDir, 'index.html');
  if (!existsSync(indexPath)) return ['index.html is missing'];
  const html = readFileSync(indexPath, 'utf8');
  if (!html.includes('<meta name="robots" content="noindex, nofollow">')) problems.push('index.html has no noindex marker');
  if (!html.includes(`<meta name="eng-trainer-product" content="${EXPERIMENTAL_PRODUCT}">`)) problems.push('index.html does not name its product');

  const prefix = `${routeUrl(site, routeOf(site, EXPERIMENTAL_PRODUCT))}assets/`;
  const entryUrls = entryAssetUrls(html);
  for (const url of entryUrls) if (!url.startsWith(prefix)) problems.push(`${url} is outside ${prefix}`);

  const code = experimentalFiles.filter((file) => isCode(file.path));
  const text = (file) => readFileSync(join(experimentalDir, file.path), 'utf8');
  if (!code.some((file) => text(file).includes('eng-trainer-v3'))) problems.push('the build does not use the database eng-trainer-v3');
  for (const file of code) if (text(file).includes('eng-trainer-v2')) problems.push(`${file.path} names the stable database eng-trainer-v2`);

  // The experimental screen is a lazy chunk of its own: the entry script must not contain it.
  const entryScripts = entryUrls.filter((url) => url.endsWith('.js')).map((url) => `assets/${url.slice(prefix.length)}`);
  const scripts = code.filter((file) => file.path.endsWith('.js'));
  const lazy = scripts.filter((file) => !entryScripts.includes(file.path));
  if (!lazy.some((file) => text(file).includes(EXPERIMENTAL_MARKER))) problems.push('no lazy chunk holds the experimental screen');
  for (const file of scripts.filter((item) => entryScripts.includes(item.path))) {
    if (text(file).includes(EXPERIMENTAL_MARKER)) problems.push(`${file.path}: the entry script contains the experimental screen; it must be loaded lazily`);
  }
  problems.push(...scanTokens(experimentalDir, experimentalFiles, FEATURE_TOKENS));
  return problems;
}

/**
 * Runs every gate. `siteDir` is the assembled site and `experimentalDir` the build of
 * the experimental product; both are relative to `root`.
 */
export async function runProductGates({ site, siteDir, experimentalDir, locks, root = repoRoot }) {
  const { siteLock, catalogLock } = locks;
  const sitePath = join(root, siteDir);
  const experimentalPath = join(root, experimentalDir);
  const missing = [sitePath, experimentalPath].filter((path) => !existsSync(join(path, 'index.html')));
  if (missing.length) {
    return [{ id: 'inputs', title: 'Built and assembled inputs', problems: missing.map((path) => `missing ${join(path, 'index.html')}: build and assemble first (npm run build:site, npm run build:v3)`) }];
  }

  const siteFiles = await inventory(sitePath);
  const experimentalFiles = await inventory(experimentalPath);
  const stableRoute = routeOf(site, STABLE_PRODUCT);
  const stableDir = join(sitePath, stableRoute.path);
  const stableFiles = productFiles(site, siteFiles, STABLE_PRODUCT).map((file) => ({ ...file, path: file.path.slice(stableRoute.path.length) }));

  return [
    {
      id: 'released-site-lock',
      title: `Released-site lock: ${siteLock.files.length} files of ${siteLock.release.milestone} (${siteLock.release.commit.slice(0, 7)}), exact paths, sizes and SHA-256`,
      problems: gateReleasedSite({ site, siteFiles, siteDir: sitePath, experimentalFiles, siteLock })
    },
    { id: 'unpublished-routes', title: 'No file at the path of an unpublished route', problems: gateUnpublished({ site, siteFiles }) },
    { id: 'stable-chunks', title: 'Stable product: exactly one script and one stylesheet, no lazy chunk', problems: gateStableChunks({ stableDir, stableFiles }) },
    {
      id: 'stable-tokens',
      title: 'Stable product: no speech, model, Worker, remote-runtime or experimental-product token',
      problems: scanTokens(stableDir, stableFiles, [...FEATURE_TOKENS, ...EXPERIMENTAL_TOKENS])
    },
    { id: 'stable-content', title: `Stable product: released manifest and all ${catalogLock.packs.length} packs`, problems: contentProblems(stableFiles, stableDir, catalogLock) },
    {
      id: 'experimental-content',
      title: `Experimental product: empty overlay, so the released manifest and all ${catalogLock.packs.length} packs`,
      problems: contentProblems(experimentalFiles, experimentalPath, catalogLock)
    },
    {
      id: 'experimental-build',
      title: 'Experimental product: own database and base path, lazy placeholder chunk, noindex, no speech feature',
      problems: gateExperimentalBuild({ site, experimentalDir: experimentalPath, experimentalFiles })
    }
  ];
}

/** Prints the results and returns true when every gate passed. */
export function reportGates(results, log = console.log) {
  for (const gate of results) {
    log(`${gate.problems.length ? 'FAIL' : 'pass'}  ${gate.title}`);
    for (const problem of gate.problems) log(`      - ${problem}`);
  }
  return results.every((gate) => !gate.problems.length);
}
