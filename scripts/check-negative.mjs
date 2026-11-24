// Controlled negative tests of the product gates (ENG-V3-01).
//
// Each case breaks a disposable copy on purpose and passes only when the gate that
// should notice does fail. A gate that cannot fail protects nothing.
//
//   npm run build:site && npm run build:v3 && npm run check:negative
//
// Nothing here touches the real builds, the real site or a tracked file. The copies
// and the two deliberately wrong stable builds live in .local/negative/, which Git
// ignores. The source changes for those builds are made in memory only.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import { NEGATIVE_WORK_DIR, removeGeneratedDir } from './generated-dirs.mjs';
import { PRODUCTION_SITE_DIR, assembleRoutes, listFiles } from './site-assembly.mjs';
import { readLocks, runProductGates } from './product-gates.mjs';
import { EXPERIMENTAL_PRODUCT, STABLE_PRODUCT, loadSiteConfig, publishedRoutes, repoRoot, validateSiteConfig } from './site-config.mjs';

// Svelte derives scoped class names from file paths relative to the working directory.
process.chdir(realpathSync.native(repoRoot));

const WORK = NEGATIVE_WORK_DIR;
const site = loadSiteConfig();
const locks = readLocks();
const experimentalDir = site.products[EXPERIMENTAL_PRODUCT].outDir;
const results = [];

const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}\n      ${detail}`);
};

/** Runs the gates on a site folder and reports which gates failed, with their first messages. */
async function failingGates(siteDir) {
  const gates = await runProductGates({ site, siteDir, experimentalDir, locks });
  return new Map(gates.filter((gate) => gate.problems.length).map((gate) => [gate.id, gate.problems]));
}

/** A case passes when every expected gate failed and one of its messages matches. */
async function expectGateFailures(name, siteDir, expected) {
  const failed = await failingGates(siteDir);
  const missing = Object.entries(expected).filter(([id, pattern]) => !failed.get(id)?.some((problem) => pattern.test(problem)));
  const seen = [...failed.entries()].map(([id, problems]) => `${id}: ${problems[0]}`).join(' | ') || 'no gate failed';
  record(name, missing.length === 0, missing.length ? `expected ${missing.map(([id]) => id).join(', ')} to fail; ${seen}` : seen);
}

async function copyOfSite(name) {
  const dir = `${WORK}/${name}`;
  await cp(join(repoRoot, PRODUCTION_SITE_DIR), join(repoRoot, dir), { recursive: true });
  return dir;
}

async function expectThrow(name, pattern, action) {
  try {
    await action();
    record(name, false, 'nothing was refused');
  } catch (error) {
    record(name, pattern.test(error.message), error.message.split('\n')[0]);
  }
}

/**
 * Builds the stable product from sources changed in memory, then assembles it like the
 * real site. `mutate` receives the text of App.svelte and must change it.
 */
async function leakingStableBuild(name, mutate) {
  const mutated = mutate(await readFile(join(repoRoot, 'src', 'app', 'App.svelte'), 'utf8'));
  let applied = false;

  const outDir = `${WORK}/${name}/dist`;
  delete process.env.ENG_PRODUCT;
  await build({
    root: repoRoot,
    configFile: join(repoRoot, 'vite.config.ts'),
    logLevel: 'error',
    build: { outDir, emptyOutDir: true },
    plugins: [{
      name: 'eng-trainer:negative-probe',
      enforce: 'pre',
      load(id) {
        if (!id.replaceAll('\\', '/').endsWith('/src/app/App.svelte')) return null;
        applied = true;
        return mutated;
      }
    }]
  });
  if (!applied) throw new Error(`${name}: the changed source was not used by the build`);
  const siteDir = `${WORK}/${name}/site`;
  await assembleRoutes({ site, routes: publishedRoutes(site), target: siteDir, buildDirs: { [STABLE_PRODUCT]: outDir } });
  return siteDir;
}

/** Replaces an anchor that must occur exactly once, so a probe cannot silently stop matching the source. */
const replaceOnce = (text, from, to) => {
  if (text.split(from).length !== 2) throw new Error(`The probe no longer matches src/app/App.svelte: ${from.slice(0, 60)}`);
  return text.replace(from, to);
};
const GUARD = "{:else if __ENG_PRONUNCIATION__ && activePage === 'pronunciation'}";
const LAZY_BLOCK = `${GUARD}
      {#await import('../features/pronunciation/PronunciationPlaceholder.svelte') then feature}
        <svelte:component this={feature.default} />
      {/await}`;

// The work area is deleted and created again. Other folders in .local/ are never touched.
await removeGeneratedDir(repoRoot, WORK, ['work']);
await mkdir(join(repoRoot, WORK), { recursive: true });

// Control: an untouched copy passes, so every failure below is caused by its own change.
{
  const failed = await failingGates(await copyOfSite('control'));
  record('control: an untouched copy of the site passes every gate', failed.size === 0, failed.size ? [...failed.keys()].join(', ') : 'all gates pass');
}

{
  const dir = await copyOfSite('changed-byte');
  const script = (await listFiles(join(repoRoot, dir, 'assets'))).find((file) => file.endsWith('.js'));
  const path = join(repoRoot, dir, 'assets', script);
  const bytes = readFileSync(path);
  bytes[bytes.length - 2] ^= 1;
  await writeFile(path, bytes);
  await expectGateFailures('one changed byte in the stable script', dir, { 'released-site-lock': /^changed file: assets\/index-/ });
}

{
  const dir = await copyOfSite('changed-v1');
  await writeFile(join(repoRoot, dir, 'v1', 'index.html'), `${await readFile(join(repoRoot, dir, 'v1', 'index.html'), 'utf8')}\n`);
  await expectGateFailures('one added line break in the frozen v1 entry page', dir, { 'released-site-lock': /^changed file: v1\/index\.html/ });
}

{
  const dir = await copyOfSite('extra-file');
  await writeFile(join(repoRoot, dir, 'notes.txt'), 'extra\n');
  await writeFile(join(repoRoot, dir, '.hidden'), 'extra\n');
  await expectGateFailures('an extra file and a hidden extra file in the stable site', dir, { 'released-site-lock': /^extra file: \.hidden/ });
  const failed = await failingGates(dir);
  record('  the visible extra file is reported too', Boolean(failed.get('released-site-lock')?.includes('extra file: notes.txt')), 'extra file: notes.txt');
}

{
  const dir = await copyOfSite('missing-file');
  await rm(join(repoRoot, dir, 'fonts', 'OFL-Literata.txt'));
  await expectGateFailures('a missing stable file', dir, { 'released-site-lock': /^missing file: fonts\/OFL-Literata\.txt/ });
}

{
  const dir = await copyOfSite('changed-pack');
  const pack = join(repoRoot, dir, 'data', locks.catalogLock.packs[0].url);
  await writeFile(pack, (await readFile(pack, 'utf8')).replace('"schemaVersion": 1', '"schemaVersion": 1 '));
  await expectGateFailures('one changed byte in a released content pack', dir, { 'stable-content': /^changed file: data\/packs\//, 'released-site-lock': /^changed file: data\/packs\// });
}

{
  const dir = await copyOfSite('unpublished-product');
  await cp(join(repoRoot, experimentalDir), join(repoRoot, dir, 'v3'), { recursive: true });
  await expectGateFailures('the unpublished experimental product copied into the site', dir, {
    'unpublished-routes': /is not published, but the site has \d+ file\(s\) at v3\//,
    'released-site-lock': /^extra file: v3\/index\.html/
  });
}

// Colliding routes: refused by the configuration reader, and by the assembly.
const withRoutes = (edit) => {
  const raw = structuredClone(site);
  edit(raw.routes);
  return raw;
};
await expectThrow('configuration: two products at one route', /is used twice/, () =>
  validateSiteConfig(withRoutes((routes) => { routes.find((route) => route.product === EXPERIMENTAL_PRODUCT).path = ''; })));
await expectThrow('configuration: a route named like a build folder', /collides with a folder/, () =>
  validateSiteConfig(withRoutes((routes) => { routes.find((route) => route.product === EXPERIMENTAL_PRODUCT).path = 'assets/'; })));
{
  const outDir = `${WORK}/colliding-build/dist`;
  await cp(join(repoRoot, site.products[STABLE_PRODUCT].outDir), join(repoRoot, outDir), { recursive: true });
  await mkdir(join(repoRoot, outDir, 'v3'));
  await writeFile(join(repoRoot, outDir, 'v3', 'index.html'), '<!doctype html>');
  await expectThrow('assembly: a stable build that contains a "v3" folder', /contains "v3"\. That path belongs to the route "v3\/"/, () =>
    assembleRoutes({ site, routes: publishedRoutes(site), target: `${WORK}/colliding-build/site`, buildDirs: { [STABLE_PRODUCT]: outDir } }));
}

// Folders (ENG-V3-01-RC1): scripts and builds empty the folders they write, so the
// configuration cannot choose one, and a build refuses any folder that is not generated.
await expectThrow('configuration: a product folder that is not the product\'s own', /products\.experimental-v3\.publicDir must be "\.variant\/experimental-v3\/public" \(found "SRC"\)/, () => {
  const raw = structuredClone(site);
  raw.products[EXPERIMENTAL_PRODUCT].publicDir = 'SRC';
  return validateSiteConfig(raw);
});
// Vite also empties every folder that a Rollup output option names (ENG-V3-01-RC2), so a
// build accepts no such option, whatever "build.outDir" says.
{
  // The folder does not exist, so a missing refusal would only leave a new folder behind.
  const unknown = 'not-a-generated-folder';
  const expectBuildRefused = async (name, options, pattern) => {
    let message = 'the build was not refused';
    delete process.env.ENG_PRODUCT;
    try {
      await build({ root: repoRoot, configFile: join(repoRoot, 'vite.config.ts'), logLevel: 'silent', build: { emptyOutDir: true, ...options } });
    } catch (error) {
      message = error.message.split('\n')[0];
    }
    record(name, pattern.test(message) && !existsSync(join(repoRoot, unknown)) && !existsSync(join(repoRoot, WORK, 'refused-build')), message);
  };
  await expectBuildRefused('build: an output folder that the repository does not generate', { outDir: unknown },
    /"not-a-generated-folder" is not a generated folder of this repository/);
  await expectBuildRefused('build: a Rollup output option, with a valid output folder', { outDir: `${WORK}/refused-build/dist`, rollupOptions: { output: { dir: unknown } } },
    /"build\.rollupOptions\.output" is set\. A build of this repository accepts no Rollup output option/);
}

// Cross-variant imports: the stable product built with the experimental screen reachable.
{
  const siteDir = await leakingStableBuild('leak-guard-removed', (source) => replaceOnce(source, GUARD, "{:else if activePage === 'pronunciation'}"));
  await expectGateFailures('stable build with the compile-time guard removed (lazy import leaks)', siteDir, {
    'stable-chunks': /expected exactly one script, found 2/,
    'stable-tokens': /contains "data-experimental-feature"/,
    'released-site-lock': /^extra file: assets\/PronunciationPlaceholder-/
  });
}
{
  const siteDir = await leakingStableBuild('leak-static-import', (source) => replaceOnce(
    replaceOnce(source, "  import Icon from '../shared/ui/Icon.svelte';", "  import Icon from '../shared/ui/Icon.svelte';\n  import Leaked from '../features/pronunciation/PronunciationPlaceholder.svelte';"),
    LAZY_BLOCK,
    "{:else if activePage === 'pronunciation'}\n      <Leaked />"
  ));
  await expectGateFailures('stable build with a static import of the experimental screen', siteDir, {
    'stable-tokens': /contains "data-experimental-feature"/,
    'released-site-lock': /^changed file: index\.html|^extra file: assets\/index-/
  });
}

const failed = results.filter((result) => !result.ok);
if (failed.length) {
  console.error(`\n${failed.length} of ${results.length} negative cases did not fail as required.`);
  process.exit(1);
}
console.log(`\nAll ${results.length} negative cases behave as required: every deliberate fault was refused by its gate.`);
