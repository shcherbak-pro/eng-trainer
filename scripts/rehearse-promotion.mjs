// Local rehearsal of route promotion and of its rollback (ENG-V3-01). Test only.
//
//   npm run build:site && npm run build:v3 && npm run rehearse:promotion
//
// Promotion is a change of the route list, not of the sources:
//
//   committed:  stable-v2 at ""    legacy-v1 at "v1/"   experimental-v3 at "v3/" (not published)
//   promoted:   experimental-v3 at ""   legacy-v1 at "v1/"   stable-v2 at "v2/"
//
// The promoted route list exists only in memory. site.config.json is not edited, no
// source file moves, nothing is published and no live route is replaced. Both
// arrangements are built into .rehearsal/, which Git ignores:
//
//   .rehearsal/promotion/site/   the promoted site, for the checks below and for browser checks
//   .rehearsal/rollback/site/    the committed arrangement rebuilt: it must be the released site again
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'vite';
import { REHEARSAL_WORK_DIR, removeGeneratedDir } from './generated-dirs.mjs';
import { assembleRoutes } from './site-assembly.mjs';
import { checkAssembledSite, entryAssetUrls } from './site-checks.mjs';
import { EXPERIMENTAL_MARKER, EXPERIMENTAL_TOKENS, FEATURE_TOKENS, compareInventory, inventory, readLocks, reportGates, runProductGates } from './product-gates.mjs';
import { declaredPolicy, inlineScriptHashes, pagePolicy } from './pronunciation-policy.mjs';
import {
  EXPERIMENTAL_PRODUCT, LEGACY_PRODUCT, STABLE_PRODUCT,
  appProducts, loadSiteConfig, productBuild, publishedRoutes, repoRoot, routeOf, routeUrl, validateSiteConfig
} from './site-config.mjs';

const WORK = REHEARSAL_WORK_DIR;
// Svelte derives scoped class names from file paths relative to the working directory.
process.chdir(realpathSync.native(repoRoot));

const committed = loadSiteConfig();
const locks = readLocks();
const problems = [];
const report = { promoted: {}, rollback: {} };
const check = (ok, message) => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${message}`);
  if (!ok) problems.push(message);
};

/** The promoted arrangement: the experimental product takes the site root, the stable one moves to v2/. */
function promote(site) {
  const raw = structuredClone(site);
  for (const route of raw.routes) {
    if (route.product === EXPERIMENTAL_PRODUCT) Object.assign(route, { path: '', publish: true });
    if (route.product === STABLE_PRODUCT) Object.assign(route, { path: 'v2/', publish: true });
  }
  return validateSiteConfig(raw);
}

function generateContent(productId) {
  const result = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'generate-content.mjs'), productId], { cwd: process.cwd(), stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Content generation failed for ${productId}`);
}

/** Builds one product for an arrangement. Only the address and the links between versions differ from a normal build. */
async function buildProduct(site, productId, outDir) {
  const settings = productBuild(site, productId);
  process.env.ENG_PRODUCT = productId;
  try {
    await build({
      root: repoRoot,
      configFile: join(repoRoot, 'vite.config.ts'),
      logLevel: 'error',
      base: settings.base,
      define: settings.define,
      build: { outDir, emptyOutDir: true }
    });
  } finally {
    delete process.env.ENG_PRODUCT;
  }
}

async function buildArrangement(site, name) {
  const buildDirs = {};
  for (const productId of appProducts(site)) {
    buildDirs[productId] = `${WORK}/${name}/build/${productId}`;
    await buildProduct(site, productId, buildDirs[productId]);
  }
  return buildDirs;
}

const codeOf = (dir, files) => files.filter((file) => /\.(?:html|js|css)$/.test(file.path)).map((file) => ({ path: file.path, text: readFileSync(join(dir, file.path), 'utf8') }));
const containing = (code, token) => code.filter((file) => file.text.includes(token)).map((file) => file.path);

for (const required of [committed.products[STABLE_PRODUCT].outDir, committed.products[LEGACY_PRODUCT].outDir, committed.products[EXPERIMENTAL_PRODUCT].outDir]) {
  if (!existsSync(join(repoRoot, required, 'index.html'))) {
    console.error(`Missing ${required}/index.html. Run first: npm run build:site && npm run build:v3`);
    process.exit(1);
  }
}

await removeGeneratedDir(repoRoot, WORK, ['work']);
await mkdir(join(repoRoot, WORK), { recursive: true });
for (const productId of appProducts(committed)) generateContent(productId);

// ---------------------------------------------------------------- promotion
console.log('\nPromotion: experimental-v3 at the site root, stable-v2 at v2/, legacy-v1 unchanged at v1/');
const promoted = promote(committed);
const promotedBuilds = await buildArrangement(promoted, 'promotion');
const promotedSite = `${WORK}/promotion/site`;
await assembleRoutes({ site: promoted, routes: promoted.routes, target: promotedSite, buildDirs: promotedBuilds });

const structure = await checkAssembledSite({ site: promoted, routes: promoted.routes, siteDir: promotedSite });
check(structure.problems.length === 0, `promoted site: every product has its entry page, assets, fonts and content under its own base path${structure.problems.length ? `: ${structure.problems.join('; ')}` : ''}`);

const siteBase = promoted.base;
const v1Url = routeUrl(promoted, routeOf(promoted, LEGACY_PRODUCT));
const promotedFiles = await inventory(join(repoRoot, promotedSite));
const under = (path) => promotedFiles.filter((file) => file.path.startsWith(path)).map((file) => ({ ...file, path: file.path.slice(path.length) }));
const catalog = [
  { path: 'data/manifest.json', bytes: locks.catalogLock.manifestBytes, sha256: locks.catalogLock.manifestSha256 },
  ...locks.catalogLock.packs.map((pack) => ({ path: `data/${pack.url}`, bytes: pack.bytes, sha256: pack.sha256 }))
];

// Archived stable product at v2/: same product, same database, same content; only its address changed.
{
  const dir = join(repoRoot, promotedSite, 'v2');
  const files = under('v2/');
  const code = codeOf(dir, files);
  const scripts = files.filter((file) => file.path.endsWith('.js'));
  const stylesheets = files.filter((file) => file.path.endsWith('.css'));
  check(containing(code, 'eng-trainer-v2').length > 0 && containing(code, 'eng-trainer-v3').length === 0, 'stable-v2 at v2/: still uses the database eng-trainer-v2 and never names eng-trainer-v3');
  check(scripts.length === 1 && stylesheets.length === 1, `stable-v2 at v2/: one script and one stylesheet, no lazy chunk (${scripts.length} script, ${stylesheets.length} stylesheet)`);
  const tokens = [...FEATURE_TOKENS, ...EXPERIMENTAL_TOKENS].filter((token) => containing(code, token).length);
  check(tokens.length === 0, `stable-v2 at v2/: no speech, model, Worker or experimental-product token${tokens.length ? ` (found ${tokens.join(', ')})` : ''}`);
  check(compareInventory(files.filter((file) => file.path.startsWith('data/')), catalog).length === 0, 'stable-v2 at v2/: the released manifest and all 14 packs');
  check(containing(code, `"${v1Url}"`).length > 0 && containing(code, `${siteBase}v2/v1/`).length === 0, `stable-v2 at v2/: links to v1 at the site base (${v1Url}), not below its own path`);
  check(containing(code, `${siteBase}v2/#index`).length > 0, `stable-v2 at v2/: the brand link is ${siteBase}v2/#index`);
  check(containing(code, `${siteBase}v2/data/`).length > 0, `stable-v2 at v2/: content is loaded from ${siteBase}v2/data/`);
  // Only the files with compiled-in addresses differ from the released ones.
  const released = locks.siteLock.files.filter((file) => !file.path.startsWith('v1/'));
  const changed = compareInventory(files, released).map((problem) => problem.split(' (')[0]);
  const expectedChanges = new Set(['index.html', ...scripts.map((file) => file.path), ...stylesheets.map((file) => file.path)]);
  const beyond = changed.filter((problem) => {
    const path = problem.replace(/^(?:changed|extra|missing) file: /, '');
    return !(expectedChanges.has(path) || (problem.startsWith('missing file: assets/index-') && /\.(?:js|css)$/.test(path)));
  });
  check(beyond.length === 0, `stable-v2 at v2/: fonts, licences, icon and content are byte-identical to the release; only the entry page, script and stylesheet carry the new address${beyond.length ? ` (unexpected: ${beyond.join('; ')})` : ''}`);
  report.promoted[STABLE_PRODUCT] = { path: 'v2/', script: scripts[0]?.path, stylesheet: stylesheets[0]?.path, files: files.length };
}

// Experimental product at the site root: same product and database as under v3/.
{
  const dir = join(repoRoot, promotedSite);
  const files = promotedFiles.filter((file) => !file.path.startsWith('v1/') && !file.path.startsWith('v2/'));
  const code = codeOf(dir, files);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const entryScripts = entryAssetUrls(html).filter((url) => url.endsWith('.js')).map((url) => url.slice(siteBase.length));
  const lazy = code.filter((file) => file.path.endsWith('.js') && !entryScripts.includes(file.path));
  check(containing(code, 'eng-trainer-v3').length > 0 && containing(code, 'eng-trainer-v2').length === 0, 'experimental-v3 at the root: still uses the database eng-trainer-v3 and never names eng-trainer-v2');
  check(html.includes(`<meta name="eng-trainer-product" content="${EXPERIMENTAL_PRODUCT}">`), 'experimental-v3 at the root: the entry page still names its product');
  check(lazy.some((file) => file.text.includes(EXPERIMENTAL_MARKER)), 'experimental-v3 at the root: the Pronunciation screen is still a lazily loaded file');
  check(compareInventory(files.filter((file) => file.path.startsWith('data/')), catalog).length === 0, 'experimental-v3 at the root: the released manifest and all 14 packs');
  check(containing(code, `"${v1Url}"`).length > 0, `experimental-v3 at the root: links to v1 at ${v1Url}`);
  check(containing(code, `${siteBase}#index`).length > 0 && containing(code, `${siteBase}v3/`).length === 0, `experimental-v3 at the root: the brand link is ${siteBase}#index and nothing points to ${siteBase}v3/`);
  const stableLink = `href:"${siteBase}v2/"`;
  check(lazy.some((file) => file.text.includes(stableLink)), `experimental-v3 at the root: its link to the stable version follows the route list (${siteBase}v2/)`);
  const entryCode = code.filter((file) => entryScripts.includes(file.path));
  const tokens = FEATURE_TOKENS.filter((token) => containing(entryCode, token).length);
  check(entryCode.length > 0 && tokens.length === 0, `experimental-v3 at the root: its entry script holds no speech, model or Worker code${tokens.length ? ` (found ${tokens.join(', ')})` : ''}`);
  check(declaredPolicy(html) === pagePolicy(inlineScriptHashes(html)), 'experimental-v3 at the root: the page still declares the committed Content-Security-Policy');
  // At the site root a service worker would also control v1/ and v2/.
  check(containing(code, 'serviceWorker').length === 0, 'experimental-v3 at the root: nothing names a service worker');
  report.promoted[EXPERIMENTAL_PRODUCT] = { path: '', script: entryScripts[0], lazy: lazy.map((file) => file.path), files: files.length };
}

// Frozen v1: byte-identical to the release.
{
  const released = locks.siteLock.files.filter((file) => file.path.startsWith('v1/'));
  const found = promotedFiles.filter((file) => file.path.startsWith('v1/'));
  const differences = compareInventory(found, released, join(repoRoot, promotedSite));
  check(differences.length === 0, `legacy-v1 at v1/: all ${released.length} files byte-identical to the release${differences.length ? ` (${differences.join('; ')})` : ''}`);
  report.promoted[LEGACY_PRODUCT] = { path: 'v1/', files: found.length };
}
report.promoted.siteFiles = promotedFiles.length;

// ---------------------------------------------------------------- rollback
console.log('\nRollback: the committed route list again, rebuilt from the same sources');
const rollbackBuilds = await buildArrangement(committed, 'rollback');
const rollbackSite = `${WORK}/rollback/site`;
await assembleRoutes({ site: committed, routes: publishedRoutes(committed), target: rollbackSite, buildDirs: rollbackBuilds });
const gates = await runProductGates({ site: committed, siteDir: rollbackSite, experimentalDir: rollbackBuilds[EXPERIMENTAL_PRODUCT], locks });
const gatesPass = reportGates(gates, (line) => console.log(`      ${line}`));
check(gatesPass, `rollback: the rebuilt site is the released site again (${locks.siteLock.files.length} files, exact) and passes every product gate`);
{
  const rebuilt = await inventory(join(repoRoot, rollbackBuilds[EXPERIMENTAL_PRODUCT]));
  const normal = await inventory(join(repoRoot, committed.products[EXPERIMENTAL_PRODUCT].outDir));
  const differences = compareInventory(rebuilt, normal);
  check(differences.length === 0, `rollback: the experimental product under v3/ is byte-identical to its normal build (${normal.length} files)${differences.length ? ` (${differences.join('; ')})` : ''}`);
  report.rollback = { siteFiles: (await inventory(join(repoRoot, rollbackSite))).length, experimentalFiles: rebuilt.length, gates: gates.map((gate) => ({ id: gate.id, ok: gate.problems.length === 0 })) };
}

report.ok = problems.length === 0;
report.problems = problems;
writeFileSync(join(repoRoot, WORK, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

if (problems.length) {
  console.error(`\nPromotion rehearsal failed: ${problems.length} check(s).`);
  process.exit(1);
}
console.log('\nPromotion and rollback rehearsal passed. Nothing was published and site.config.json is unchanged.');
