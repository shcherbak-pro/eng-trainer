// Controlled negative tests of the product gates (ENG-V3-01; ENG-V3-02, stage A; ENG-V3-R1A; ENG-V3-R1A-RC1).
//
// Each case breaks a disposable copy on purpose and passes only when the gate that
// should notice does fail. A gate that cannot fail protects nothing.
//
//   npm run build:site && npm run build:v3 && npm run check:negative
//
// Nothing here touches the real builds, the real site or a tracked file. The copies
// and the deliberately wrong stable builds live in .local/negative/, which Git
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
async function failingGates(siteDir, experimental = experimentalDir) {
  const gates = await runProductGates({ site, siteDir, experimentalDir: experimental, locks });
  return new Map(gates.filter((gate) => gate.problems.length).map((gate) => [gate.id, gate.problems]));
}

/** A case passes when every expected gate failed and one of its messages matches. */
async function expectGateFailures(name, siteDir, expected, experimental = experimentalDir) {
  const failed = await failingGates(siteDir, experimental);
  const missing = Object.entries(expected).filter(([id, pattern]) => !failed.get(id)?.some((problem) => pattern.test(problem)));
  const seen = [...failed.entries()].map(([id, problems]) => `${id}: ${problems[0]}`).join(' | ') || 'no gate failed';
  record(name, missing.length === 0, missing.length ? `expected ${missing.map(([id]) => id).join(', ')} to fail; ${seen}` : seen);
}

async function copyOfSite(name) {
  const dir = `${WORK}/${name}`;
  await cp(join(repoRoot, PRODUCTION_SITE_DIR), join(repoRoot, dir), { recursive: true });
  return dir;
}

/** A copy of the experimental build, to break on purpose. */
async function copyOfExperimental(name) {
  const dir = `${WORK}/${name}`;
  await cp(join(repoRoot, experimentalDir), join(repoRoot, dir), { recursive: true });
  return dir;
}

/** The one file of a build copy whose path matches, relative to the copy. */
async function fileOf(dir, pattern) {
  const found = (await listFiles(join(repoRoot, dir))).filter((path) => pattern.test(path));
  if (found.length !== 1) throw new Error(`${dir}: expected one file matching ${pattern}, found ${found.length}`);
  return found[0];
}

/** Changes the text of one file of a build copy. The change must change something. */
async function rewrite(dir, path, change) {
  const before = await readFile(join(repoRoot, dir, path), 'utf8');
  const after = change(before);
  if (after === before) throw new Error(`${dir}/${path}: the deliberate fault changed nothing`);
  await writeFile(join(repoRoot, dir, path), after);
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
async function leakingStableBuild(name, mutate, { withoutExclusion = false } = {}) {
  const mutated = mutate(await readFile(join(repoRoot, 'src', 'app', 'App.svelte'), 'utf8'));
  let applied = false;
  let exclusionOff = false;

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
      // Simulates a stable build that lost the plugin which keeps the experimental-only
      // sources out (vite.config.ts): that plugin's hooks are taken away before the build starts.
      config(config) {
        if (!withoutExclusion) return;
        for (const plugin of (config.plugins ?? []).flat(Infinity)) {
          if (plugin?.name !== 'eng-trainer:without-experimental-sources') continue;
          delete plugin.resolveId;
          delete plugin.load;
          exclusionOff = true;
        }
      },
      load(id) {
        if (!id.replaceAll('\\', '/').endsWith('/src/app/App.svelte')) return null;
        applied = true;
        return mutated;
      }
    }]
  });
  if (!applied) throw new Error(`${name}: the changed source was not used by the build`);
  if (withoutExclusion && !exclusionOff) throw new Error(`${name}: the exclusion plugin was not found, so this case would prove nothing`);
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
      {#await import('../features/pronunciation/PronunciationPage.svelte') then feature}
        <svelte:component this={feature.default} {catalog} />
      {/await}`;
/** The guard of the Backup screen (ENG-V3-R1A), the second experimental-only screen. */
const BACKUP_GUARD = "{:else if __ENG_BACKUP__ && activePage === 'backup'}";

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
//
// Two things keep the speech feature out of the stable build: the compile-time guard in
// App.svelte, and the build plugin that gives the stable build an empty module in place of
// the experimental-only sources (vite.config.ts). Each case takes away one or both.
const unguarded = (source) => replaceOnce(source, GUARD, "{:else if activePage === 'pronunciation'}");
const staticImport = (source) => replaceOnce(
  replaceOnce(source, "  import Icon from '../shared/ui/Icon.svelte';", "  import Icon from '../shared/ui/Icon.svelte';\n  import Leaked from '../features/pronunciation/PronunciationPage.svelte';"),
  LAZY_BLOCK,
  "{:else if activePage === 'pronunciation'}\n      <Leaked {catalog} />"
);
{
  // The guard is gone, the exclusion holds: no feature code can enter, but the build is not the release.
  const siteDir = await leakingStableBuild('leak-guard-removed', unguarded);
  await expectGateFailures('stable build with the compile-time guard removed: no feature code enters, and the build is still refused', siteDir, {
    'stable-chunks': /expected exactly one script, found 2/,
    'released-site-lock': /^extra file: assets\//
  });
  const failed = await failingGates(siteDir);
  const leaked = [...failed.values()].flat().filter((problem) => /getUserMedia|new Worker|onnx|\.wasm|recognizer\.worker|pcm-collector/.test(problem));
  record('  with the exclusion in place, that build holds no speech code and no speech file', leaked.length === 0, leaked[0] ?? 'no speech token and no speech file in the stable output');
}
{
  const siteDir = await leakingStableBuild('leak-static-import', staticImport);
  await expectGateFailures('stable build with a static import of the experimental screen: refused', siteDir, {
    'released-site-lock': /^changed file: index\.html|^extra file: assets\/index-/
  });
}
{
  // The exclusion is gone, the guard holds. The feature's code is still dropped, but the files
  // that its modules emit while they are read would be published. This is the leak that the
  // exclusion prevents; the gates catch it on their own.
  const siteDir = await leakingStableBuild('leak-exclusion-removed', (source) => source.replace(GUARD, GUARD), { withoutExclusion: true });
  await expectGateFailures('stable build without the exclusion of experimental-only sources (Worker, worklet and runtime are emitted)', siteDir, {
    'released-site-lock': /^extra file: assets\/(?:ort-wasm-simd-threaded|recognizer\.worker|pcm-collector\.worklet)-/,
    'stable-chunks': /expected exactly one script, found 3/,
    'stable-tokens': /recognizer\.worker-[\w-]+\.js contains "(?:onnx|wasm|WebAssembly|new Worker)"/
  });
}
{
  // Both are gone: the whole feature is in the stable build.
  const siteDir = await leakingStableBuild('leak-both-removed', unguarded, { withoutExclusion: true });
  await expectGateFailures('stable build without the guard and without the exclusion (the speech feature leaks)', siteDir, {
    'stable-tokens': /contains "(?:data-experimental-feature|getUserMedia)"/,
    'stable-chunks': /expected exactly one script, found \d+/,
    'released-site-lock': /^extra file: assets\/PronunciationPage-/
  });
}

// The Backup screen (ENG-V3-R1A) is kept out of the stable build by the same two controls.
const backupUnguarded = (source) => replaceOnce(source, BACKUP_GUARD, "{:else if activePage === 'backup'}");
{
  const siteDir = await leakingStableBuild('leak-backup-guard-removed', backupUnguarded);
  await expectGateFailures('stable build with the guard of the Backup screen removed: no backup code enters, and the build is still refused', siteDir, {
    'stable-chunks': /expected exactly one script, found 2/,
    'released-site-lock': /^extra file: assets\//
  });
  const failed = await failingGates(siteDir);
  const leaked = [...failed.values()].flat().filter((problem) => /localStorage|englishAssessmentTrainer|eng-trainer-backup|BackupPage/.test(problem));
  record('  with the exclusion in place, that build holds no backup code and reads no other storage', leaked.length === 0, leaked[0] ?? 'no backup token and no key-value storage token in the stable output');
}
{
  const siteDir = await leakingStableBuild('leak-backup-both-removed', backupUnguarded, { withoutExclusion: true });
  await expectGateFailures('stable build without the guard of the Backup screen and without the exclusion (the backup feature leaks)', siteDir, {
    'stable-tokens': /contains "(?:localStorage|englishAssessmentTrainer|eng-trainer-backup)"/,
    'stable-chunks': /expected exactly one script, found \d+/,
    'released-site-lock': /^extra file: assets\/BackupPage-/
  });
}

// The experimental build (ENG-V3-02, stage A): each deliberate fault in a copy of it must fail its gate.
{
  const GATE = 'experimental-build';
  const site0 = PRODUCTION_SITE_DIR;
  const experimentalCase = async (name, title, pattern, fault) => {
    const dir = await copyOfExperimental(name);
    await fault(dir);
    await expectGateFailures(title, site0, { [GATE]: pattern }, dir);
  };
  {
    const failed = await failingGates(site0, await copyOfExperimental('experimental-control'));
    record('control: an untouched copy of the experimental build passes every gate', failed.size === 0, failed.size ? [...failed.keys()].join(', ') : 'all gates pass');
  }
  const policyMeta = /\s*<meta http-equiv="Content-Security-Policy"[^>]*>/;
  await experimentalCase('policy-removed', 'experimental page without its Content-Security-Policy', /declares no Content-Security-Policy/,
    (dir) => rewrite(dir, 'index.html', (html) => html.replace(policyMeta, '')));
  await experimentalCase('policy-other-host', 'experimental page whose policy allows another host', /declares another Content-Security-Policy/,
    (dir) => rewrite(dir, 'index.html', (html) => html.replace("connect-src 'self'", "connect-src 'self' https://models.example.net")));
  await experimentalCase('policy-url-worker', 'experimental page whose policy allows a Worker loaded from an address', /declares another Content-Security-Policy/,
    (dir) => rewrite(dir, 'index.html', (html) => html.replace('worker-src blob:', "worker-src 'self' blob:")));
  await experimentalCase('policy-inline-script', 'experimental page with a changed inline script (its hash no longer matches)', /declares another Content-Security-Policy/,
    (dir) => rewrite(dir, 'index.html', (html) => html.replace("document.documentElement.dataset.theme = resolved;", "document.documentElement.dataset.theme = resolved; fetch('/x');")));
  await experimentalCase('policy-after-script', 'experimental page that declares its policy after a script', /must come before the first script/,
    async (dir) => rewrite(dir, 'index.html', (html) => {
      const meta = policyMeta.exec(html)[0];
      return html.replace(meta, '').replace('</head>', `${meta}\n  </head>`);
    }));
  await experimentalCase('model-file', 'a model file inside the experimental build', /models\/moonshine\/onnx\/encoder_model_quantized\.onnx is a model file/,
    async (dir) => {
      await mkdir(join(repoRoot, dir, 'models', 'moonshine', 'onnx'), { recursive: true });
      await writeFile(join(repoRoot, dir, 'models', 'moonshine', 'onnx', 'encoder_model_quantized.onnx'), 'not a model');
    });
  await experimentalCase('runtime-changed', 'one changed byte in the WebAssembly runtime', /is not the pinned runtime onnxruntime-web/,
    async (dir) => {
      const path = join(repoRoot, dir, await fileOf(dir, /\.wasm$/));
      const bytes = readFileSync(path);
      bytes[bytes.length - 3] ^= 1;
      await writeFile(path, bytes);
    });
  await experimentalCase('second-runtime', 'a second WebAssembly file in the experimental build', /expected exactly one WebAssembly file, found 2/,
    (dir) => writeFile(join(repoRoot, dir, 'assets', 'other.wasm'), 'not a runtime'));
  await experimentalCase('other-host', 'a script of the experimental build that names another host', /names the host "cdn\.example\.net"/,
    async (dir) => rewrite(dir, await fileOf(dir, /^assets\/PronunciationPage-[\w-]+\.js$/), (code) => `${code}\nconst other="https://cdn.example.net/model.onnx";`));
  await experimentalCase('model-hub', 'a script of the experimental build that names a model hub', /contains "huggingface"/,
    async (dir) => rewrite(dir, await fileOf(dir, /^assets\/recognizer\.worker-[\w-]+\.js$/), (code) => `${code}\nconst hub="huggingface";`));
  await experimentalCase('service-worker', 'a script of the experimental build that names a service worker', /names a service worker/,
    async (dir) => rewrite(dir, await fileOf(dir, /^assets\/PronunciationPage-[\w-]+\.js$/), (code) => `${code}\nnavigator.serviceWorker;`));
  await experimentalCase('second-worker-start', 'a second place that starts a Worker', /expected exactly one place that starts a Worker/,
    async (dir) => rewrite(dir, await fileOf(dir, /^assets\/PronunciationPage-[\w-]+\.js$/), (code) => `${code}\nnew Worker("/eng-trainer/v3/assets/x.js");`));
  await experimentalCase('entry-speech-code', 'speech code in the entry script of the experimental build', /assets\/index-[\w-]+\.js contains "getUserMedia"/,
    async (dir) => rewrite(dir, await fileOf(dir, /^assets\/index-[\w-]+\.js$/), (code) => `${code}\nnavigator.mediaDevices.getUserMedia;`));
  await experimentalCase('microphone-elsewhere', 'a microphone request outside the experimental screen', /asks for the microphone outside the experimental screen/,
    (dir) => writeFile(join(repoRoot, dir, 'assets', 'extra-chunk.js'), 'navigator.mediaDevices.getUserMedia({audio:true});'));
}

// Backup and recovery in the experimental build (ENG-V3-R1A, ENG-V3-R1A-RC1): another product's storage is
// read in the Backup screen's file, written by the one recovery writer, and reached by no other file.
{
  const GATE = 'experimental-backup';
  const backupCase = async (name, title, pattern, fault) => {
    const dir = await copyOfExperimental(name);
    await fault(dir);
    await expectGateFailures(title, PRODUCTION_SITE_DIR, { [GATE]: pattern }, dir);
  };
  const ENTRY = /^assets\/index-[\w-]+\.js$/;
  const BACKUP = /^assets\/BackupPage-[\w-]+\.js$/;
  const SPEECH = /^assets\/PronunciationPage-[\w-]+\.js$/;
  const append = (file, code) => async (dir) => rewrite(dir, await fileOf(dir, file), (text) => `${text}\n${code}`);

  await backupCase('backup-entry-names-stable', 'the entry script of the experimental build names the stable database', /assets\/index-[\w-]+\.js names "eng-trainer-v2" outside the Backup screen/,
    append(ENTRY, 'indexedDB.open("eng-trainer-v2");'));
  await backupCase('backup-speech-reads-v1', 'another screen of the experimental build reads a record of the first version', /assets\/PronunciationPage-[\w-]+\.js names "(?:englishAssessmentTrainer|localStorage)" outside the Backup screen/,
    append(SPEECH, 'globalThis.localStorage.getItem("englishAssessmentTrainer.theme.v1");'));
  await backupCase('backup-worker-reads-stable', 'the recognizer\'s Worker names the stable database', /assets\/recognizer\.worker-[\w-]+\.js names "eng-trainer-v2" outside the Backup screen/,
    append(/^assets\/recognizer\.worker-[\w-]+\.js$/, 'const other="eng-trainer-v2";'));
  await backupCase('backup-writes-key-value', 'the Backup screen writes a key-value record', /contains "setItem"/,
    append(BACKUP, 'globalThis.localStorage.setItem("englishAssessmentTrainer.theme.v1","dark");'));
  await backupCase('backup-removes-key-value', 'the Backup screen removes a key-value record', /contains "removeItem"/,
    append(BACKUP, 'globalThis.localStorage.removeItem("englishAssessmentTrainer.theme.v1");'));
  await backupCase('backup-second-storage-access', 'the Backup screen reaches the key-value storage in a second place', /expected exactly one place that reaches the browser's key-value storage, found 2/,
    append(BACKUP, 'const again=globalThis.localStorage;'));
  await backupCase('backup-deletes-database', 'a file of the experimental build deletes a database', /contains "deleteDatabase"/,
    append(ENTRY, 'indexedDB.deleteDatabase("eng-trainer-v3");'));
  await backupCase('backup-second-write-transaction', 'the Backup screen starts a second read-write transaction', /expected exactly one read-write transaction .* found 2/,
    append(BACKUP, 'const again=(d)=>d.transaction(["progress"],"readwrite");'));
  await backupCase('backup-request', 'the Backup screen makes a request', /assets\/BackupPage-[\w-]+\.js contains "fetch\("/,
    append(BACKUP, 'fetch("/eng-trainer/v3/upload",{method:"POST"});'));
  await backupCase('backup-in-entry', 'the Backup screen inside the entry script', /the entry script contains the Backup screen; it must be loaded lazily/,
    append(ENTRY, 'const screen=\'<div data-experimental-feature="backup-recovery"></div>\';'));
  await backupCase('backup-screen-missing', 'an experimental build without the Backup screen', /expected exactly one file that holds the Backup screen, found 0/,
    async (dir) => rewrite(dir, await fileOf(dir, BACKUP), (text) => text.replace('data-experimental-feature="backup-recovery"', 'data-experimental-feature="other"')));
  await backupCase('backup-without-stable', 'a Backup screen that no longer reads the stable database', /does not name the stable database/,
    async (dir) => rewrite(dir, await fileOf(dir, BACKUP), (text) => text.split('eng-trainer-v2').join('eng-trainer-v0')));

  // The recovery writer (ENG-V3-R1A-RC1): one file, loaded by the Backup screen's file alone, with one
  // key-value write and one read-write transaction. It requests no database and creates no store, so it
  // can neither create nor upgrade one. The Backup screen's file itself still cannot write another product.
  const WRITER = /^assets\/recoveryWriter-[\w-]+\.js$/;
  await backupCase('backup-creates-store', 'the Backup screen creates an object store', /assets\/BackupPage-[\w-]+\.js creates an object store/,
    append(BACKUP, 'const make=(d)=>d.createObjectStore("progress");'));
  await backupCase('backup-versioned-open', 'the Backup screen opens a database with a version', /assets\/BackupPage-[\w-]+\.js: expected exactly one request that opens a database, without a version/,
    async (dir) => rewrite(dir, await fileOf(dir, BACKUP), (text) => text.replace(/indexedDB\.open\((\w+)\)/, 'indexedDB.open($1,2)')));
  await backupCase('backup-second-open', 'the Backup screen opens a database in a second place', /assets\/BackupPage-[\w-]+\.js: expected exactly one request that opens a database, without a version/,
    append(BACKUP, 'const other=(n)=>indexedDB.open(n);'));
  await backupCase('backup-second-import', 'the Backup screen loads a second file', /expected exactly one dynamic import, of the recovery writer\. Found 2/,
    append(BACKUP, 'const more=()=>import("./extra-00000000.js");'));
  await backupCase('backup-imports-another-file', 'the Backup screen loads another file in place of the recovery writer', /expected exactly one dynamic import, of the recovery writer\. Found 1/,
    async (dir) => rewrite(dir, await fileOf(dir, BACKUP), (text) => text.replace(/import\("\.\/recoveryWriter-[\w-]+\.js"\)/, 'import("./extra-00000000.js")')));
  await backupCase('writer-missing', 'an experimental build without the recovery writer', /expected exactly one recovery writer file, found 0/,
    async (dir) => rm(join(repoRoot, dir, await fileOf(dir, WRITER))));
  await backupCase('writer-twice', 'an experimental build with a second recovery writer', /expected exactly one recovery writer file, found 2/,
    async (dir) => cp(join(repoRoot, dir, await fileOf(dir, WRITER)), join(repoRoot, dir, 'assets', 'recoveryWriter-00000000.js')));
  await backupCase('writer-second-key-value-write', 'the recovery writer writes a key-value record in a second place', /assets\/recoveryWriter-[\w-]+\.js: expected exactly one call that writes a key-value record, found 2/,
    append(WRITER, 'const more=(s)=>s.setItem("another.application","x");'));
  await backupCase('writer-removes-key-value', 'the recovery writer removes a key-value record', /assets\/recoveryWriter-[\w-]+\.js contains "removeItem"/,
    append(WRITER, 'const drop=(s)=>s.removeItem("englishAssessmentTrainer.theme.v1");'));
  await backupCase('writer-second-storage-access', 'the recovery writer reaches the key-value storage in a second place', /assets\/recoveryWriter-[\w-]+\.js: expected exactly one place that reaches the browser's key-value storage, found 2/,
    append(WRITER, 'const again=globalThis.localStorage;'));
  await backupCase('writer-deletes-database', 'the recovery writer deletes a database', /assets\/recoveryWriter-[\w-]+\.js contains "deleteDatabase"/,
    append(WRITER, 'const drop=()=>indexedDB.deleteDatabase("eng-trainer-v2");'));
  await backupCase('writer-second-write-transaction', 'the recovery writer starts a second read-write transaction', /assets\/recoveryWriter-[\w-]+\.js: expected exactly one read-write transaction .* found 2/,
    append(WRITER, 'const again=(d)=>d.transaction(["progress"],"readwrite");'));
  await backupCase('writer-opens-database', 'the recovery writer requests a database itself, with a version', /assets\/recoveryWriter-[\w-]+\.js: the recovery writer requests a database itself/,
    append(WRITER, 'const other=()=>indexedDB.open("eng-trainer-v2",2);'));
  await backupCase('writer-creates-store', 'the recovery writer creates an object store', /assets\/recoveryWriter-[\w-]+\.js creates an object store/,
    append(WRITER, 'const make=(d)=>d.createObjectStore("progress");'));
  await backupCase('writer-request', 'the recovery writer makes a request', /assets\/recoveryWriter-[\w-]+\.js contains "fetch\("/,
    append(WRITER, 'fetch("/eng-trainer/v3/upload",{method:"POST"});'));
  await backupCase('writer-loads-a-file', 'the recovery writer loads another file', /assets\/recoveryWriter-[\w-]+\.js contains "import\("/,
    append(WRITER, 'const more=()=>import("./extra-00000000.js");'));
  await backupCase('writer-holds-screen', 'the recovery writer holds a screen', /the recovery writer holds an experimental screen/,
    append(WRITER, 'const screen=\'<div data-experimental-feature="other"></div>\';'));
  await backupCase('writer-loaded-by-entry', 'the entry script loads the recovery writer, without a confirmation', /assets\/index-[\w-]+\.js names the recovery writer/,
    async (dir) => {
      const writer = (await fileOf(dir, WRITER)).split('/').pop();
      await rewrite(dir, await fileOf(dir, ENTRY), (text) => `${text}\nconst early=()=>import("./${writer}");`);
    });
  await backupCase('writer-loaded-by-speech', 'another screen loads the recovery writer', /assets\/PronunciationPage-[\w-]+\.js names the recovery writer/,
    async (dir) => {
      const writer = (await fileOf(dir, WRITER)).split('/').pop();
      await rewrite(dir, await fileOf(dir, SPEECH), (text) => `${text}\nconst early=()=>import("./${writer}");`);
    });
  await backupCase('writer-preloaded-by-page', 'the entry page preloads the recovery writer', /index\.html names the recovery writer/,
    async (dir) => {
      const writer = (await fileOf(dir, WRITER)).split('/').pop();
      await rewrite(dir, 'index.html', (text) => text.replace('</head>', `<link rel="modulepreload" href="/eng-trainer/v3/assets/${writer}"></head>`));
    });
}

// Model storage in the experimental build (ENG-V3-R1B): the browser's storage manager, the lock of the
// model cache and the confirmation of a download are in the Pronunciation screen's file alone, the model
// cache is named there and in the Worker only, and no file calls the cache storage by its global name.
{
  const GATE = 'experimental-model-storage';
  const storageCase = async (name, title, pattern, fault) => {
    const dir = await copyOfExperimental(name);
    await fault(dir);
    await expectGateFailures(title, PRODUCTION_SITE_DIR, { [GATE]: pattern }, dir);
  };
  const ENTRY = /^assets\/index-[\w-]+\.js$/;
  const BACKUP = /^assets\/BackupPage-[\w-]+\.js$/;
  const SPEECH = /^assets\/PronunciationPage-[\w-]+\.js$/;
  const WORKER = /^assets\/recognizer\.worker-[\w-]+\.js$/;
  const WRITER = /^assets\/recoveryWriter-[\w-]+\.js$/;
  const append = (file, code) => async (dir) => rewrite(dir, await fileOf(dir, file), (text) => `${text}\n${code}`);

  await storageCase('storage-entry-asks-to-keep', 'the entry script asks the browser to keep the site\'s data, without a click', /assets\/index-[\w-]+\.js contains "\.persist\("/,
    append(ENTRY, 'navigator.storage.persist();'));
  await storageCase('storage-backup-reads-estimate', 'the Backup screen asks for the storage estimate', /assets\/BackupPage-[\w-]+\.js contains "\.estimate\("/,
    append(BACKUP, 'const room=()=>navigator.storage.estimate();'));
  await storageCase('storage-worker-reaches-manager', 'the recognizer\'s Worker reaches the storage manager', /assets\/recognizer\.worker-[\w-]+\.js reaches the browser's storage manager or lock manager/,
    append(WORKER, 'const manager=navigator.storage;'));
  await storageCase('storage-writer-takes-lock', 'the recovery writer requests a browser lock', /assets\/recoveryWriter-[\w-]+\.js contains "ifAvailable"/,
    append(WRITER, 'const lock=(l)=>l.request("x",{ifAvailable:!0},()=>{});'));
  await storageCase('storage-second-request-to-keep', 'the Pronunciation screen asks the browser to keep the data in a second place', /assets\/PronunciationPage-[\w-]+\.js: expected exactly one "\.persist\(", found 2/,
    append(SPEECH, 'const again=(m)=>m.persist();'));
  await storageCase('storage-second-manager', 'the Pronunciation screen reaches the storage manager in a second place', /expected exactly one place that reaches the browser's storage manager, found 2/,
    append(SPEECH, 'const other=navigator.storage;'));
  await storageCase('storage-second-lock', 'the Pronunciation screen requests a second lock', /expected exactly one request for a browser lock, found 2/,
    append(SPEECH, 'const lock=(l)=>l.request("other",{ifAvailable:!0},()=>{});'));
  await storageCase('storage-estimate-removed', 'a Pronunciation screen that no longer asks for the estimate', /expected exactly one "\.estimate\(", found 0/,
    async (dir) => rewrite(dir, await fileOf(dir, SPEECH), (text) => text.split('.estimate(').join('.guess(')));
  await storageCase('storage-second-confirmation', 'a second place that confirms a download', /expected exactly one place that confirms a download, found 2/,
    append(SPEECH, 'const quick=(s)=>s.install({confirmed:!0});'));
  await storageCase('storage-lists-caches', 'a file that lists the caches of the site', /assets\/PronunciationPage-[\w-]+\.js calls the browser's cache storage by its global name/,
    append(SPEECH, 'const all=()=>caches.keys();'));
  await storageCase('storage-deletes-another-cache', 'the entry script deletes a cache', /assets\/index-[\w-]+\.js (?:names the browser's cache storage|calls the browser's cache storage by its global name)/,
    append(ENTRY, 'caches.delete("another-cache");'));
  await storageCase('storage-backup-names-model-cache', 'the Backup screen names the model cache', /assets\/BackupPage-[\w-]+\.js names the model cache/,
    append(BACKUP, 'const cache="eng-trainer-v3-models";'));
  await storageCase('storage-worker-other-cache', 'a Worker that uses another cache than the model cache', /assets\/recognizer\.worker-[\w-]+\.js does not name the model cache/,
    async (dir) => rewrite(dir, await fileOf(dir, WORKER), (text) => text.split('eng-trainer-v3-models').join('eng-trainer-v3-other')));
  await storageCase('storage-private-file-system', 'a file that uses the site\'s private file system', /contains "getDirectory"/,
    append(WORKER, 'const root=(m)=>m.getDirectory();'));
}

const failed = results.filter((result) => !result.ok);
if (failed.length) {
  console.error(`\n${failed.length} of ${results.length} negative cases did not fail as required.`);
  process.exit(1);
}
console.log(`\nAll ${results.length} negative cases behave as required: every deliberate fault was refused by its gate.`);
