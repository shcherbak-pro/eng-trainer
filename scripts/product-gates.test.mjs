import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { sha256 } from './content-build.mjs';
import { BACKUP_SCREEN, CONFIRMED_DOWNLOAD_TOKEN, DYNAMIC_IMPORT_TOKEN, EXPERIMENTAL_MARKER, EXPERIMENTAL_TOKENS, FEATURE_TOKENS, FORBIDDEN_STORAGE_TOKENS, KEY_VALUE_WRITE_TOKEN, LOCK_REQUEST_TOKEN, MODEL_CACHE_TOKEN, MODEL_STORAGE_TOKENS, NETWORK_TOKENS, OTHER_SITE_STORAGE_TOKENS, OTHER_STORAGE_TOKENS, RECOVERY_WRITER_FILE, RECOVERY_WRITER_NAME, SPEECH_SCREEN, STORAGE_MANAGER_CALLS, compareInventory, inventory, readLocks, runProductGates } from './product-gates.mjs';
import { PRODUCTION_SITE_DIR, TEST_SITE_DIR, assembleRoutes, listFiles } from './site-assembly.mjs';
import { EXPERIMENTAL_PRODUCT, LEGACY_PRODUCT, STABLE_PRODUCT, loadSiteConfig, publishedRoutes, repoRoot } from './site-config.mjs';

const site = loadSiteConfig();
const { siteLock, catalogLock } = readLocks();

async function tempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'eng-trainer-gates-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function write(root, files) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

/** Minimal builds of the three products in a temporary root, at their configured folders. */
async function syntheticBuilds(t, extra = {}) {
  const root = await tempRoot(t);
  await write(root, {
    'dist/index.html': 'stable',
    'dist/assets/app.js': 'stable script',
    'v1/dist/index.html': 'legacy',
    'dist-v3/index.html': 'experimental',
    'dist-v3/assets/app.js': 'experimental script',
    ...extra
  });
  return root;
}

test('the released-site lock is the ENG-V2-03 artifact: 33 files, 28 of v2 and 5 of v1', () => {
  assert.equal(siteLock.release.commit, '498705a075e6f71b04e22e4437c50ec587de38dd');
  assert.equal(siteLock.release.workflowRun, 'https://github.com/shcherbak-pro/eng-trainer/actions/runs/45049070378');
  assert.equal(siteLock.release.artifact.zipSha256, '32f28a67b614386d6c9dab7f7f69b30aeb833ad69366415cf940f907a94b2ccf');
  assert.equal(siteLock.files.length, 33);
  assert.equal(siteLock.files.filter((file) => file.path.startsWith('v1/')).length, 5);
  assert.equal(siteLock.files.filter((file) => !file.path.startsWith('v1/')).length, 28);
  assert.deepEqual(siteLock.counts, { files: 33, stableV2: 28, legacyV1: 5 });
  for (const path of ['index.html', 'v1/index.html', 'assets/index-CggR75Uk.js', 'assets/index-DFaGuSQ9.css', 'data/manifest.json', 'v1/data/materials.json']) {
    assert.ok(siteLock.files.some((file) => file.path === path), path);
  }
  // A digest of the whole list. The lock is not edited to make a change pass: replacing it is
  // a separately approved stable release, and that release changes this value on purpose.
  assert.equal(sha256(JSON.stringify(siteLock.files)), 'fad43c4f965be026af034ccc2393cf88a95ea4dcb52192b6b36d60dc1f068b58');
});

test('the two locks agree: the released site contains exactly the released catalog', () => {
  const manifest = siteLock.files.find((file) => file.path === 'data/manifest.json');
  assert.deepEqual({ bytes: manifest.bytes, sha256: manifest.sha256 }, { bytes: catalogLock.manifestBytes, sha256: catalogLock.manifestSha256 });
  const packs = siteLock.files.filter((file) => file.path.startsWith('data/packs/')).map((file) => file.path).sort();
  assert.deepEqual(packs, catalogLock.packs.map((pack) => `data/${pack.url}`).sort());
  for (const pack of catalogLock.packs) {
    const file = siteLock.files.find((item) => item.path === `data/${pack.url}`);
    assert.deepEqual({ bytes: file.bytes, sha256: file.sha256 }, { bytes: pack.bytes, sha256: pack.sha256 });
  }
});

test('an inventory is compared exactly: extra, missing and changed files are all reported', async (t) => {
  const root = await tempRoot(t);
  await write(root, { 'index.html': 'one\n', 'assets/app.js': 'two', '.hidden': 'three', 'v3/index.html': 'four' });
  const found = await inventory(root);
  assert.deepEqual(found.map((file) => file.path), ['.hidden', 'assets/app.js', 'index.html', 'v3/index.html']);
  assert.deepEqual(compareInventory(found, found, root), []);

  const expected = [
    { path: 'index.html', bytes: 4, sha256: sha256('one\n') },
    { path: 'assets/app.js', bytes: 3, sha256: sha256('TWO') },
    { path: 'fonts/licence.txt', bytes: 1, sha256: sha256('x') }
  ];
  const problems = compareInventory(found, expected, root);
  assert.deepEqual(problems.filter((problem) => !problem.startsWith('changed')), ['extra file: .hidden', 'extra file: v3/index.html', 'missing file: fonts/licence.txt']);
  assert.equal(problems.filter((problem) => problem.startsWith('changed file: assets/app.js')).length, 1);
  assert.equal(problems.length, 4);
  // The same size with other bytes is a change too.
  assert.match(problems.find((problem) => problem.startsWith('changed')), /3 bytes.*released: 3 bytes/);
});

test('a file that differs only by carriage returns still fails, and says why', async (t) => {
  const root = await tempRoot(t);
  await write(root, { 'index.html': '<!doctype html>\r\n<html>\r\n</html>\r\r\n' });
  const expected = [{ path: 'index.html', bytes: 31, sha256: sha256('<!doctype html>\n<html>\n</html>\n') }];
  const problems = compareInventory(await inventory(root), expected, root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^changed file: index\.html .*differs only by carriage returns.*Build from LF files, as CI does\.$/);
  // A real change gets no such hint.
  await write(root, { 'index.html': '<!doctype html>\r\n<html lang="en">\r\n</html>\r\n' });
  assert.doesNotMatch(compareInventory(await inventory(root), expected, root)[0], /carriage returns/);
});

test('the production assembly copies published routes only and starts from an empty folder', async (t) => {
  const root = await syntheticBuilds(t);
  await write(root, { 'site-dist/stale.txt': 'old', 'site-dist/.stale': 'old', 'site-dist/v3/index.html': 'old beta' });

  const assembled = await assembleRoutes({ site, routes: publishedRoutes(site), target: PRODUCTION_SITE_DIR, root });
  assert.deepEqual(assembled.map((route) => route.product), [STABLE_PRODUCT, LEGACY_PRODUCT]);
  assert.deepEqual(await listFiles(join(root, PRODUCTION_SITE_DIR)), ['assets/app.js', 'index.html', 'v1/index.html']);
  assert.equal(await readFile(join(root, PRODUCTION_SITE_DIR, 'index.html'), 'utf8'), 'stable');
  // The build folders are only read.
  assert.deepEqual(await listFiles(join(root, 'dist')), ['assets/app.js', 'index.html']);
  assert.equal(existsSync(join(root, TEST_SITE_DIR)), false);
});

test('the test assembly adds only the experimental subtree, in its own folder', async (t) => {
  const root = await syntheticBuilds(t);
  await assembleRoutes({ site, routes: publishedRoutes(site), target: PRODUCTION_SITE_DIR, root });
  const production = await listFiles(join(root, PRODUCTION_SITE_DIR));

  await assembleRoutes({ site, routes: site.routes, target: TEST_SITE_DIR, root });
  const all = await listFiles(join(root, TEST_SITE_DIR));
  assert.deepEqual(all.filter((path) => !path.startsWith('v3/')), production);
  assert.deepEqual(all.filter((path) => path.startsWith('v3/')), ['v3/assets/app.js', 'v3/index.html']);
  assert.equal(await readFile(join(root, TEST_SITE_DIR, 'v3', 'index.html'), 'utf8'), 'experimental');
  // The production assembly is unchanged by the test assembly.
  assert.deepEqual(await listFiles(join(root, PRODUCTION_SITE_DIR)), production);
});

test('the assembly refuses collisions, missing builds and routes outside the configuration, before it deletes anything', async (t) => {
  const keep = { 'site-dist/keep.txt': 'still here' };
  const refused = async (files, routes, pattern, remove = []) => {
    const root = await syntheticBuilds(t, { ...keep, ...files });
    for (const path of remove) await rm(join(root, path), { recursive: true });
    await assert.rejects(assembleRoutes({ site, routes, target: PRODUCTION_SITE_DIR, root }), pattern);
    assert.deepEqual(await readdir(join(root, PRODUCTION_SITE_DIR)), ['keep.txt']);
  };

  // A stable build with a folder named like a route: also the route of an unpublished product.
  await refused({ 'dist/v3/index.html': 'leak' }, publishedRoutes(site), /The build of "stable-v2" contains "v3"\. That path belongs to the route "v3\/" of "experimental-v3"/);
  await refused({ 'dist/v1/index.html': 'leak' }, publishedRoutes(site), /contains "v1"/);
  await refused({ 'dist/v3': 'a file, not a folder' }, publishedRoutes(site), /contains "v3"/);
  await refused({}, publishedRoutes(site), /Missing .*index\.html\nBuild "stable-v2" first: npm run build/, ['dist']);
  await refused({}, publishedRoutes(site), /Build "legacy-v1" first: npm run build:v1/, ['v1/dist']);
  await refused({}, site.routes, /Build "experimental-v3" first: npm run build:v3/, ['dist-v3']);
  await refused({}, [{ path: 'v4/', product: EXPERIMENTAL_PRODUCT, publish: true }], /is not part of the site configuration/);
  await refused({}, [{ path: '', product: EXPERIMENTAL_PRODUCT, publish: true }], /is not part of the site configuration/);
  await refused({}, [site.routes[0], site.routes[0]], /Two routes are assembled at ""/);
  await refused({}, [site.routes[1]], /No product is assembled at the site root/);
});

test('the gates refuse to judge a site that was not built and assembled', async (t) => {
  const root = await tempRoot(t);
  const gates = await runProductGates({ site, siteDir: PRODUCTION_SITE_DIR, experimentalDir: 'dist-v3', locks: { siteLock, catalogLock }, root });
  assert.equal(gates.length, 1);
  assert.equal(gates[0].id, 'inputs');
  assert.equal(gates[0].problems.length, 2);
});

test('the token lists cover the feature and the product, and the experimental marker is in use', async () => {
  for (const token of ['getUserMedia', 'mediaDevices', 'AudioWorklet', 'MediaRecorder', 'SpeechRecognition', 'onnx', 'transformers', 'wasm', 'WebAssembly', 'new Worker', 'serviceWorker', 'huggingface', 'jsdelivr']) {
    assert.ok(FEATURE_TOKENS.includes(token), token);
  }
  for (const token of ['eng-trainer-v3', '/v3/', 'experimental-v3', EXPERIMENTAL_MARKER, 'PronunciationPage', 'BackupPage', 'recoveryWriter', 'eng-trainer-backup']) assert.ok(EXPERIMENTAL_TOKENS.includes(token), token);
  const screen = await readFile(join(repoRoot, 'src', 'features', 'pronunciation', 'PronunciationPage.svelte'), 'utf8');
  assert.ok(screen.includes(SPEECH_SCREEN));
  // The Backup screen (ENG-V3-R1A) has its own value of the marker, so the gates can tell the two screens apart.
  const backup = await readFile(join(repoRoot, 'src', 'features', 'backup', 'BackupPage.svelte'), 'utf8');
  assert.ok(backup.includes(BACKUP_SCREEN));
  assert.notEqual(SPEECH_SCREEN, BACKUP_SCREEN);
  for (const marker of [SPEECH_SCREEN, BACKUP_SCREEN]) assert.ok(marker.startsWith(`${EXPERIMENTAL_MARKER}="`));
  // What the backup gate looks for: the other products' storage, and the calls that no file may hold.
  assert.deepEqual(OTHER_STORAGE_TOKENS, ['eng-trainer-v2', 'englishAssessmentTrainer', 'localStorage']);
  for (const token of ['removeItem', 'sessionStorage', 'document.cookie', 'deleteDatabase']) assert.ok(FORBIDDEN_STORAGE_TOKENS.includes(token), token);
  for (const token of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon']) assert.ok(NETWORK_TOKENS.includes(token), token);
  // The recovery writer (ENG-V3-R1A-RC1): the one call that writes a key-value record is counted, not forbidden,
  // and the gate knows the writer by the name that the bundler derives from its source file.
  assert.equal(KEY_VALUE_WRITE_TOKEN, 'setItem');
  assert.ok(!FORBIDDEN_STORAGE_TOKENS.includes(KEY_VALUE_WRITE_TOKEN));
  assert.equal(DYNAMIC_IMPORT_TOKEN, 'import(');
  assert.ok(!NETWORK_TOKENS.includes(DYNAMIC_IMPORT_TOKEN));
  assert.ok(RECOVERY_WRITER_FILE.test('assets/recoveryWriter-B248Jo1q.js'));
  assert.ok(!RECOVERY_WRITER_FILE.test('assets/BackupPage-B248Jo1q.js'));
  assert.equal(RECOVERY_WRITER_NAME, 'recoveryWriter-');
  assert.ok(sources.includes('src/features/backup/recoveryWriter.ts'));
});

// ---- Source-level boundary -------------------------------------------------------------

/** Folders that belong to the experimental product only: the speech feature, and backup and recovery (ENG-V3-R1A). */
const SPEECH_DIR = 'src/features/pronunciation/';
const BACKUP_DIR = 'src/features/backup/';
const EXPERIMENTAL_ONLY = [SPEECH_DIR, BACKUP_DIR];
const sources = (await listFiles(join(repoRoot, 'src'))).filter((path) => /\.(?:ts|js|svelte)$/.test(path)).map((path) => `src/${path}`);
const sourceText = (path) => readFile(join(repoRoot, path), 'utf8');

test('the build keeps exactly these folders out of the stable product', async () => {
  const config = await readFile(join(repoRoot, 'vite.config.ts'), 'utf8');
  assert.match(config, /const EXPERIMENTAL_ONLY_SOURCES = \['src\/features\/pronunciation', 'src\/features\/backup'\];/);
  assert.deepEqual(EXPERIMENTAL_ONLY.map((dir) => dir.slice(0, -1)), ['src/features/pronunciation', 'src/features/backup']);
});

test('shared code reaches each experimental-only folder through one guarded dynamic import, and nothing else', async () => {
  const references = [];
  for (const path of sources.filter((file) => !EXPERIMENTAL_ONLY.some((dir) => file.startsWith(dir)))) {
    const lines = (await sourceText(path)).split('\n');
    lines.forEach((line, index) => {
      if (/features\/pronunciation|PronunciationPage|features\/backup|BackupPage/.test(line) && !/^\s*(?:\/\/|\*|\/\*)/.test(line)) references.push({ path, line: line.trim(), before: lines[index - 1]?.trim() });
    });
  }
  assert.deepEqual(references, [
    {
      path: 'src/app/App.svelte',
      line: "{#await import('../features/pronunciation/PronunciationPage.svelte') then feature}",
      before: "{:else if __ENG_PRONUNCIATION__ && activePage === 'pronunciation'}"
    },
    {
      path: 'src/app/App.svelte',
      line: "{#await import('../features/backup/BackupPage.svelte') then feature}",
      before: "{:else if __ENG_BACKUP__ && activePage === 'backup'}"
    }
  ]);
});

test('the two experimental-only folders do not reach into each other', async () => {
  for (const path of sources.filter((file) => file.startsWith(BACKUP_DIR))) assert.doesNotMatch(await sourceText(path), /features\/pronunciation|\.\.\/pronunciation/, path);
  for (const path of sources.filter((file) => file.startsWith(SPEECH_DIR))) assert.doesNotMatch(await sourceText(path), /features\/backup|\.\.\/backup/, path);
});

test('the guarded branches are the last branches of the screen list', async () => {
  const app = await sourceText('src/app/App.svelte');
  const chain = app.slice(app.indexOf("{#if activePage === 'index'}"));
  const branches = [...chain.slice(0, chain.indexOf('{/if}')).matchAll(/\{:else if ([^}]+)\}/g)].map((match) => match[1]);
  assert.equal(branches.at(-1), "__ENG_BACKUP__ && activePage === 'backup'");
  assert.equal(branches.at(-2), "__ENG_PRONUNCIATION__ && activePage === 'pronunciation'");
  assert.equal(branches.at(-3), 'activeTopic');
  assert.equal(branches.filter((branch) => branch.includes('__ENG_')).length, 2);
});

test('every use of a product constant in shared code is a bare name, and none sits inside a try block', async () => {
  const uses = [];
  for (const path of sources.filter((file) => !/\.test\.ts$/.test(file) && !file.startsWith('src/test/') && file !== 'src/product.d.ts')) {
    const text = await sourceText(path);
    for (const match of text.matchAll(/__(?:ENG_[A-Z_]+|SITE_BASE)__/g)) {
      const line = text.slice(text.lastIndexOf('\n', match.index) + 1, text.indexOf('\n', match.index));
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;
      // Depth of `try {` blocks that are still open at this position.
      const before = text.slice(0, match.index);
      let depth = 0;
      const open = [];
      for (const token of before.matchAll(/\btry\s*\{|[{}]/g)) {
        if (token[0] === '}') { if (open.pop() === 'try') depth -= 1; } else { open.push(token[0].startsWith('try') ? 'try' : 'block'); if (token[0].startsWith('try')) depth += 1; }
      }
      uses.push({ path, constant: match[0], insideTry: depth > 0 });
    }
  }
  assert.deepEqual(uses.filter((use) => use.insideTry), []);
  assert.deepEqual([...new Set(uses.map((use) => `${use.path} ${use.constant}`))].sort(), [
    'src/app/App.svelte __ENG_BACKUP__',
    'src/app/App.svelte __ENG_PRONUNCIATION__',
    'src/app/AppShell.svelte __ENG_BACKUP__',
    'src/app/AppShell.svelte __SITE_BASE__',
    'src/app/navigation.ts __ENG_BACKUP__',
    'src/app/navigation.ts __ENG_PRONUNCIATION__',
    'src/collections/service.ts __ENG_BACKUP__',
    'src/features/backup/BackupPage.svelte __ENG_VERSION_LINKS__',
    'src/features/pronunciation/PronunciationPage.svelte __ENG_DATABASE__',
    'src/features/pronunciation/PronunciationPage.svelte __ENG_PRODUCT__',
    'src/features/pronunciation/PronunciationPage.svelte __ENG_VERSION_LINKS__',
    'src/features/pronunciation/recognition/localMl.ts __SITE_BASE__',
    'src/features/settings/SettingsPage.svelte __SITE_BASE__',
    'src/state/persistence.ts __ENG_BACKUP__',
    'src/state/progress.ts __ENG_BACKUP__',
    'src/state/settings.ts __ENG_BACKUP__',
    'src/storage/database.ts __ENG_DATABASE__',
    'src/storage/database.ts __ENG_PRODUCT__'
  ]);
});

test('ENG-V3-R1A-RC3: every way in which the application changes its saved state asks for the hold first, behind the constant', async () => {
  const shared = sources.filter((file) => !/\.test\.ts$/.test(file) && !file.startsWith('src/test/') && !file.startsWith(SPEECH_DIR) && !file.startsWith(BACKUP_DIR));
  const code = new Map();
  for (const path of shared) code.set(path, withoutComments(await sourceText(path)));
  const filesWith = (pattern) => [...code.entries()].filter(([, source]) => pattern.test(source)).map(([path]) => path);

  // The application writes its database in two places: the queue of the state services, and the collections.
  assert.deepEqual(filesWith(/\bstorage\.write\(/), ['src/collections/service.ts', 'src/state/persistence.ts']);
  // Two state services hand changes to the queue, each from one function, and that function asks first.
  assert.deepEqual(filesWith(/\bpersist\(/), ['src/state/persistence.ts', 'src/state/progress.ts', 'src/state/settings.ts']);
  for (const path of ['src/state/progress.ts', 'src/state/settings.ts']) {
    const source = code.get(path);
    assert.equal(source.match(/\bpersist\(/g).length, 1, path);
    assert.match(source, /function update\(.*\): void \{\s*if \(__ENG_BACKUP__ && changesHeld\(\)\) return;\s*const next = [\s\S]*?state = next;\s*store\.set\(next\);\s*persist\(ops\);\s*\}/, path);
    // Nothing else of the service changes the state that is saved, except loading it from the database.
    assert.equal(source.match(/\bstate = /g).length, 3, path);
    assert.equal(source.match(/\bstore\.set\(/g).length, 2, path);
  }
  // The collections ask before a change is started. One that is being saved has its transaction already.
  const collections = code.get('src/collections/service.ts');
  assert.equal(collections.match(/\bstorage\.write\(/g).length, 1);
  assert.match(collections, /if \(__ENG_BACKUP__ && held\) throw new CollectionError\('busy', '[^']+'\);\s*writing = true;\s*try \{\s*await storage\.write\(/);
  assert.match(collections, /let held = false;\s*export function holdCollections\(hold: boolean\): void \{ held = hold; \}/);
  assert.equal(collections.match(/\bheld\b/g).length, 3);

  // The queue: the hold is taken only when nothing is queued, scheduled or being written, and
  // while it lasts nothing is written, whoever asks.
  const persistence = code.get('src/state/persistence.ts');
  assert.match(persistence, /export function holdChanges\(\): ChangeHold \{\s*if \(held \|\| !storage\) return 'unavailable';\s*if \(queue\.length \|\| scheduled \|\| running\) return 'unsaved';\s*held = true;\s*return 'held';\s*\}/);
  assert.match(persistence, /export function persist\(ops: WriteOp\[\]\): void \{[\s\S]*?queue\.push\(\.\.\.ops\);[\s\S]*?if \(__ENG_BACKUP__ && held\) return;\s*if \(scheduled\) return;/);
  assert.match(persistence, /export function retrySave\(\): Promise<void> \{\s*if \(!storage \|\| !queue\.length\) return Promise\.resolve\(\);\s*if \(__ENG_BACKUP__ && held\) return Promise\.resolve\(\);/);
  // Both parts of the hold begin and end together, in one place.
  const state = code.get('src/state/index.ts');
  assert.match(state, /export function holdState\(\): ChangeHold \{\s*const hold = holdChanges\(\);\s*if \(hold === 'held'\) holdCollections\(true\);\s*return hold;\s*\}/);
  assert.match(state, /export function releaseState\(\): void \{\s*holdCollections\(false\);\s*releaseChanges\(\);\s*\}/);
  assert.deepEqual(filesWith(/\bholdCollections\(/), ['src/collections/service.ts', 'src/state/index.ts']);
  assert.deepEqual(filesWith(/\b(?:holdChanges|releaseChanges)\(/), ['src/state/index.ts', 'src/state/persistence.ts']);
  // Shared code takes no hold by itself: only the recovery does.
  assert.deepEqual(filesWith(/\b(?:holdState|releaseState)\(/), ['src/state/index.ts']);

  // The shell keeps the open screen while changes are held: both ways of changing it ask first.
  const app = code.get('src/app/App.svelte');
  assert.match(app, /function syncPageFromHash\(\): void \{\s*if \(phase !== 'ready'\) return;\s*if \(__ENG_BACKUP__ && stateHeld\(\)\) \{\s*if \(pageFromHash\(\) !== activePage\) history\.replaceState\(history\.state, '', `#\$\{activePage\}`\);\s*return;\s*\}/);
  assert.match(app, /function navigate\(page: string\): void \{\s*if \(__ENG_BACKUP__ && stateHeld\(\)\) return;/);
  assert.equal(app.match(/\bactivePage = /g).length, 4);

  // Every question about the hold in shared code stands behind the bare constant, so the stable
  // build drops it. No module got a new import for it: a new import would reorder the stable build.
  for (const [path, source] of code) {
    for (const match of source.matchAll(/\b(?:changesHeld|stateHeld)\(\)|&& held\b/g)) {
      const line = source.slice(source.lastIndexOf('\n', match.index) + 1, source.indexOf('\n', match.index));
      if (/^export function (?:changesHeld|stateHeld)\(\)|^\s*return changesHeld\(\);/.test(line)) continue;
      assert.match(line, /^\s*if \(__ENG_BACKUP__ && (?:changesHeld\(\)|stateHeld\(\)|held)\) /, `${path}: ${line.trim()}`);
    }
  }
  assert.doesNotMatch(collections, /from '\.\.\/state/);
  assert.doesNotMatch(app, /from '\.\.\/state\/persistence'/);
  assert.doesNotMatch(persistence, /^import (?!\{ writable \} from 'svelte\/store'|type \{ AppStorage, WriteOp \} from '\.\.\/storage\/database').*$/m);
});

/** The experimental-only sources of the application, without their tests and test helpers. */
const applicationSources = (dir) => sources.filter((file) => file.startsWith(dir) && !/\.test\.ts$/.test(file) && !file.endsWith('/testing.ts'));
const featureSources = applicationSources(SPEECH_DIR);
const backupSources = applicationSources(BACKUP_DIR);
const withoutComments = (code) => code.replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|\/\/.*$/gm, '');

test('ENG-V3-02 stage A: the experimental-only folder is the speech feature, file by file', () => {
  assert.deepEqual(featureSources.map((file) => file.slice('src/features/pronunciation/'.length)), [
    'PronunciationPage.svelte',
    'audio.ts',
    'capture/capture.ts',
    'capture/levels.ts',
    'capture/pcm-collector.worklet.js',
    'models/capacity.ts',
    'models/exclusive.ts',
    'models/install.ts',
    'models/management.ts',
    'models/pinned.ts',
    'models/store.ts',
    'models/verify.ts',
    'practiceItems.ts',
    'prototypeHost.ts',
    'recognition/assets.ts',
    'recognition/bootstrap.ts',
    'recognition/localMl.ts',
    'recognition/lockdown.ts',
    'recognition/moonshine.ts',
    'recognition/protocol.ts',
    'recognition/recognizer.worker.ts',
    'recognition/tokenDecoder.ts',
    'recognition/types.ts',
    'session.ts',
    'spokenTarget.js'
  ]);
});

test('ENG-V3-02 stage A: each sensitive browser interface is used in one place of the feature', async () => {
  const code = new Map();
  for (const path of featureSources) code.set(path.slice('src/features/pronunciation/'.length), withoutComments(await sourceText(path)));
  const filesWith = (pattern) => [...code.entries()].filter(([, source]) => pattern.test(source)).map(([path]) => path);

  // The network: the installer downloads, and the lock-down names what it takes away from the Worker.
  assert.deepEqual(filesWith(/\bfetch\b/), ['models/install.ts', 'recognition/lockdown.ts']);
  assert.deepEqual(filesWith(/XMLHttpRequest|WebSocket|EventSource|WebTransport|importScripts|sendBeacon/), ['recognition/lockdown.ts']);
  // The Worker itself, its decoding loop, the recorder and the session call no network interface.
  for (const file of ['recognition/recognizer.worker.ts', 'recognition/moonshine.ts', 'recognition/tokenDecoder.ts', 'recognition/localMl.ts', 'capture/capture.ts', 'capture/pcm-collector.worklet.js', 'session.ts']) {
    assert.doesNotMatch(code.get(file), /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon/, file);
  }

  // The microphone and the audio graph: the recorder. Nothing encodes or keeps a recording.
  assert.deepEqual(filesWith(/getUserMedia/), ['capture/capture.ts']);
  assert.deepEqual(filesWith(/\bAudioContext\b|\bAudioWorkletNode\b/), ['capture/capture.ts']);
  assert.deepEqual(filesWith(/MediaRecorder|createObjectURL\([^)]*(?:audio|wav)/i), []);
  // Exactly one request for the microphone, and one place that starts a Worker.
  assert.equal(code.get('capture/capture.ts').match(/environment\.getUserMedia\(/g).length, 1, 'the recorder asks for the microphone in one place');
  assert.equal(code.get('capture/capture.ts').match(/navigator\.mediaDevices\.getUserMedia\(/g).length, 1, 'which reaches the browser in one place');
  assert.deepEqual(filesWith(/new Worker\b/), ['recognition/bootstrap.ts']);
  assert.equal(code.get('recognition/bootstrap.ts').match(/new Worker\b/g).length, 1);

  // Storage: the model cache only. No learning data, no other version's data, no service worker.
  assert.deepEqual(filesWith(/\bcaches\b/), ['models/store.ts']);
  assert.deepEqual(filesWith(/localStorage|sessionStorage|indexedDB|document\.cookie|serviceWorker/), []);
  assert.deepEqual(filesWith(/eng-trainer-v2/), []);
  assert.match(code.get('models/store.ts'), /export const MODEL_CACHE_NAME = 'eng-trainer-v3-models';/);
  // Its entries are named from the site base, so they do not change when the product's route does.
  assert.match(code.get('recognition/localMl.ts'), /const keyBase = `\$\{new URL\(__SITE_BASE__, globalThis\.location\.href\)\.href\}model-cache\/`;/);
  assert.deepEqual(filesWith(/model-cache/), ['recognition/localMl.ts']);
  assert.doesNotMatch(code.get('models/store.ts'), /BASE_URL|location/);

  // No browser recognizer, so no recognition service of a browser vendor, and no host name at all.
  assert.deepEqual(filesWith(/SpeechRecognition/), []);
  assert.deepEqual(filesWith(/https?:\/\//), []);
});

// ---- Model storage (ENG-V3-R1B): the source-level boundary --------------------------------

/** The speech feature's application code, without comments, by its path inside the folder. */
async function speechCode() {
  const code = new Map();
  for (const path of featureSources) code.set(path.slice(SPEECH_DIR.length), withoutComments(await sourceText(path)));
  return code;
}

test('ENG-V3-R1B: one module asks the browser\'s storage manager, and the request to keep data starts at one button', async () => {
  const code = await speechCode();
  const filesWith = (pattern) => [...code.entries()].filter(([, source]) => pattern.test(source)).map(([path]) => path);

  // One module reaches the storage manager, and it asks three things of it, once each.
  assert.deepEqual(filesWith(/navigator\??\.storage\b|\.estimate\(|\.persisted\(|\.persist\(/), ['models/capacity.ts']);
  const capacity = code.get('models/capacity.ts');
  assert.equal(capacity.match(/navigator\?\.storage\b/g).length, 1);
  for (const call of ['manager.estimate()', 'manager.persisted()', 'manager.persist()']) assert.equal(capacity.split(call).length - 1, 1, call);
  // These are the calls that the gate on built files counts.
  assert.deepEqual(STORAGE_MANAGER_CALLS, ['.estimate(', '.persisted(', '.persist(']);
  assert.deepEqual(MODEL_STORAGE_TOKENS, [...STORAGE_MANAGER_CALLS, LOCK_REQUEST_TOKEN]);
  // Nothing else of the site's storage: no private file system, no storage bucket.
  assert.deepEqual(filesWith(new RegExp(OTHER_SITE_STORAGE_TOKENS.join('|'))), []);

  // The request to keep the data: one function makes it, and it is reached from one click.
  assert.match(capacity, /export async function askForPersistence\(manager: [^\n]*\): Promise<PersistenceAnswer> \{\s*if \(!manager \|\| typeof manager\.persist !== 'function'\) return 'unsupported';\s*try \{\s*return \(await manager\.persist\(\)\) === true \? 'granted' : 'declined';/);
  assert.deepEqual(filesWith(/\baskForPersistence\(/), ['PronunciationPage.svelte', 'models/capacity.ts', 'models/management.ts', 'session.ts']);
  assert.equal(code.get('models/management.ts').match(/=> askForPersistence\(deps\.manager\(\)\)/g).length, 1);
  assert.equal(code.get('models/management.ts').match(/\baskForPersistence\(/g).length, 2, 'the member of the type, and that one call');
  assert.equal(code.get('session.ts').match(/modelStorage\.askForPersistence\(\)/g).length, 1);
  const page = code.get('PronunciationPage.svelte');
  assert.match(page, /function askForPersistence\(\): void \{\s*void session\.askForPersistence\(\);\s*\}/);
  assert.match(page, /onClick=\{askForPersistence\} data-action="ask-persistence"/);
  assert.equal(page.match(/\baskForPersistence\b/g).length, 3, 'the function, its one call of the session, and the one button');
  // Opening the screen asks nothing: the session reads the state, it does not request.
  const session = code.get('session.ts');
  const init = session.slice(session.indexOf('async init()'), session.indexOf('async prepare('));
  assert.doesNotMatch(init, /askForPersistence|verify\(/);
});

test('ENG-V3-R1B: a download is confirmed in one place, after room was found, and the installer asks for room before each request', async () => {
  const code = await speechCode();
  const filesWith = (pattern) => [...code.entries()].filter(([, source]) => pattern.test(source)).map(([path]) => path);

  // The session (ENG-V3-R1B-RC1): loading and installing are two requests.
  const session = code.get('session.ts');
  // Loading: the look at the phase and the call that loads. No storage question, no confirmation, no installation.
  assert.match(session, /async prepare\(\) \{\s*if \(state\.phase !== 'no-model'\) return;\s*await bring\(null\);\s*\},/);
  // Installing: offered, coordination, room by the estimate, then the confirmation. In that order, before the screen changes.
  const asked = session.slice(session.indexOf('async install(options = {}) {'), session.indexOf('cancelPrepare() {'));
  assert.match(asked, /^async install\(options = \{\}\) \{\s*if \(state\.phase !== 'no-model'\) return;\s*if \(!deps\.downloadOffered\) \{[\s\S]*?return;\s*\}\s*const storage = await readStorage\(\);\s*if \(disposed \|\| state\.phase !== 'no-model'\) return;\s*if \(storage\.storage && !storage\.storage\.canCoordinate\) \{[\s\S]*?return;\s*\}\s*if \(storage\.storage\?\.capacity\.state !== 'sufficient'\) \{[\s\S]*?return;\s*\}\s*if \(options\.confirmed !== true\) \{[\s\S]*?return;\s*\}\s*set\(storage\);\s*await bring\(storage\.installed \? null : \{ confirmed: options\.confirmed \}\);\s*\},/);
  // A download is handed to "bring" in that one place. The other caller loads.
  assert.deepEqual([...session.matchAll(/\bbring\(([^)]*)\)/g)].map((match) => match[1]).filter((argument) => !argument.startsWith('download:')), ['null', 'storage.installed ? null : { confirmed: options.confirmed }']);
  // In "bring": the recognizer installs only when a download was handed over, with the confirmation as it came. Loading is its own call.
  const bring = session.slice(session.indexOf('async function bring('), session.indexOf('async function finish('));
  assert.match(bring, /if \(download\) \{\s*await deps\.recognizer\.install\(\{\s*confirmed: download\.confirmed,/);
  assert.equal(session.match(/deps\.recognizer\.install\(/g).length, 1);
  assert.equal(session.match(/deps\.recognizer\.prepare\(/g).length, 1);
  assert.match(bring, /await deps\.recognizer\.prepare\(\{ signal: controller\.signal \}\);/);
  // The screen changes in the same step as the look at its state, so of two requests at once only one gets further.
  assert.ok(bring.slice(0, bring.indexOf('await')).includes("set({ phase: download ? 'installing' : 'loading'"));
  // What can be loaded is taken from the cache each time it is read, in one place. It is never set from the recognizer's state.
  assert.match(session, /return \{ installed: installation\?\.state === 'installed', installation, storage:/);
  assert.doesNotMatch(session, /installed: true|installed: recognizer/);

  // The screen: the confirmation is given by one handler, of one button, and only with the learner's own statement.
  const page = code.get('PronunciationPage.svelte');
  assert.equal(page.match(/confirmed: true/g).length, 1);
  assert.match(page, /function confirmInstall\(\): void \{\s*if \(!acknowledged \|\| state\.storage\?\.capacity\.state !== 'sufficient'\) return;\s*closeInstall\(\);\s*void session\.install\(\{ confirmed: true \}\);\s*\}/);
  assert.equal(page.match(/\bconfirmInstall\b/g).length, 2);
  assert.match(page, /disabled=\{!acknowledged \|\| capacity\?\.state !== 'sufficient'\} on:click=\{confirmInstall\} data-action="confirm-install"/);
  // The statement starts unset each time the question opens, and nothing but the checkbox sets it.
  assert.deepEqual([...page.matchAll(/\backnowledged = (\w+)/g)].map((match) => match[1]), ['false', 'false', 'false']);
  assert.match(page, /<input type="checkbox" bind:checked=\{acknowledged\} data-control="backup-acknowledged" \/>/);
  // "Load" asks to load and passes nothing. The confirmation goes to "install", from that one handler.
  assert.deepEqual([...page.matchAll(/session\.prepare\(([^)]*)\)/g)].map((match) => match[1]), ['']);
  assert.deepEqual([...page.matchAll(/session\.install\(([^)]*)\)/g)].map((match) => match[1]), ['{ confirmed: true }']);
  // The confirmation as the bundler writes it, for the gate on built files.
  assert.equal(CONFIRMED_DOWNLOAD_TOKEN, 'confirmed:!0');

  // The installer: room is asked for at the top of the loop, before the request of each file.
  const install = code.get('models/install.ts');
  assert.match(install, /for \(const \[index, file\] of files\.entries\(\)\) \{\s*await requireRoom\(files\.slice\(index\), options\);\s*if \(signal\.aborted\)[^\n]*\n\s*if \(index === 0\)[^\n]*\n\s*const bytes = await download\(/);
  assert.equal(install.match(/await requireRoom\(/g).length, 1);
  assert.equal(install.match(/await download\(/g).length, 1);
  assert.equal(install.match(/fetchFile\(/g).length, 1);
  assert.match(install, /const capacity = judgeCapacity\(estimate, needFor\(remaining, options\.reserve\)\);\s*if \(capacity\.state !== 'sufficient'\) throw new InstallError\('capacity', describeCapacity\(capacity\), capacity\);/);
  // An estimate that could not be read is never taken for room.
  assert.match(install, /\} catch \(error\) \{\s*estimate = \{ known: false, reason:/);
  // The verdict has one source: free room against need. Unknown is never "sufficient".
  const capacity = code.get('models/capacity.ts');
  assert.match(capacity, /if \(!estimate\.known\) return \{ state: 'unknown', reason: estimate\.reason, need \};\s*const free = Math\.max\(0, estimate\.quota - estimate\.usage\);\s*if \(free >= need\.total\) return \{ state: 'sufficient',/);
  assert.equal(capacity.match(/state: 'sufficient'/g).length, 2, 'the type and the one place that says it');
  assert.deepEqual(filesWith(/state: 'sufficient'/), ['models/capacity.ts']);
  // The application installs with the reserve of capacity.ts: nothing passes a smaller one.
  assert.match(capacity, /export const LEARNING_RESERVE_BYTES = 64_000_000;/);
  assert.deepEqual(filesWith(/\breserve\??:/), ['models/capacity.ts', 'models/install.ts']);
  assert.doesNotMatch(code.get('recognition/localMl.ts'), /reserve/);
});

test('ENG-V3-R1B: every cache call names the model cache, a change holds its lock, and removal is asked for by a button', async () => {
  const code = await speechCode();
  const filesWith = (pattern) => [...code.entries()].filter(([, source]) => pattern.test(source)).map(([path]) => path);

  // The cache storage is reached through one function of the store, and every call on it names the one cache.
  const store = code.get('models/store.ts');
  assert.match(store, new RegExp(`export const MODEL_CACHE_NAME = '${MODEL_CACHE_TOKEN}';`));
  assert.match(store, /export type CacheStorageLike = Pick<CacheStorage, 'open' \| 'has' \| 'delete'>;/);
  assert.equal(store.match(/\bcaches\b/g).length, 2, 'the check that it exists, and the one function that hands it out');
  assert.match(store, /const storage = \(\): CacheStorageLike => options\.storage \?\? caches;/);
  const calls = [...store.matchAll(/storage\(\)\.(\w+)\(([^)]*)\)/g)].map((match) => `${match[1]} ${match[2]}`);
  assert.ok(calls.length >= 10, `${calls.length} calls`);
  for (const call of calls) assert.match(call, /^(?:open|has|delete) MODEL_CACHE_NAME$/);
  // No other use of the cache storage: it is never listed, and never handed to anything.
  assert.equal(store.match(/\bstorage\(\)/g).length, calls.length);
  assert.doesNotMatch(store, /caches\s*\.|storage\(\)\.keys/);
  // The cache itself is deleted in one place: "remove".
  assert.equal(calls.filter((call) => call.startsWith('delete ')).length, 1);
  assert.match(store, /async function remove\(\): Promise<void> \{\s*await deleteWhere\(\(\) => false\);\s*await storage\(\)\.delete\(MODEL_CACHE_NAME\);\s*\}/);
  // Entries are deleted in one place, markers first: an interrupted deletion leaves no marker that promises files.
  assert.equal(store.match(/cache\.delete\(/g).length, 1);
  assert.match(store, /for \(const request of \[\.\.\.doomed\.filter\(\(item\) => isMarker\(item\.url\)\), \.\.\.doomed\.filter\(\(item\) => !isMarker\(item\.url\)\)\]\) await cache\.delete\(request\);/);
  // Looking never creates the cache: both ways of looking ask whether it exists first.
  for (const name of ['inspect', 'verify', 'read']) {
    assert.match(store, new RegExp(`async function ${name}\\([^)]*\\): Promise<[^{]+> \\{\\s*if \\(!\\(await storage\\(\\)\\.has\\(MODEL_CACHE_NAME\\)\\)\\)`), name);
  }

  // The lock: one module reaches the lock manager and makes the one request, under the cache's name.
  assert.deepEqual(filesWith(/navigator\??\.locks\b|\.request\(/), ['models/exclusive.ts']);
  const exclusive = code.get('models/exclusive.ts');
  assert.match(exclusive, new RegExp(`export const MODEL_LOCK_NAME = '${MODEL_CACHE_TOKEN}';`));
  // ENG-V3-R1B-RC1: no lock manager, no change. No path runs a change without the lock.
  assert.match(exclusive, /export async function exclusively<T>\(change: \(\) => Promise<T>, locks: LockManagerLike \| null = browserLocks\(\)\): Promise<T> \{\s*if \(!locks\) throw new NoCoordinationError\('it has no Web Locks'\);/);
  assert.equal(exclusive.match(/\bchange\(\)/g).length, 1, 'the one call of the change, inside the callback that got the lock');
  // A held lock is answered with a value inside the browser's callback, and refused after it returned.
  assert.match(exclusive, /async \(lock\) => \{\s*if \(!lock\) return HELD_ELSEWHERE;\s*started = true;\s*return change\(\);\s*\}\);/);
  assert.match(exclusive, /if \(outcome === HELD_ELSEWHERE\) throw new ModelBusyError\(\);\s*return outcome;/);
  // A lock that the browser did not give at all is a refusal. A failure of the change itself passes through.
  assert.match(exclusive, /\} catch \(error\) \{\s*if \(started\) throw error;[\s\S]*?throw new NoCoordinationError\(/);
  assert.equal(LOCK_REQUEST_TOKEN, 'ifAvailable');
  // Both changes of the cache run under it: the whole installation, and the removal.
  assert.deepEqual(filesWith(/\bexclusively\(/), ['models/install.ts', 'recognition/localMl.ts']);
  const install = code.get('models/install.ts');
  // ENG-V3-R1B-RC1: the entry point of every download refuses without the learner's confirmation, before it asks for the lock.
  assert.match(install, /export async function installModel\(options: InstallOptions\): Promise<void> \{\s*if \(options\.confirmed !== true\) throw new InstallError\('not-confirmed', [^\n]*\n\s*try \{\s*await exclusively\(\(\) => install\(options\), options\.locks\);/);
  // Under the lock, and before anything is removed or requested: a complete installation is left alone.
  assert.match(install, /async function install\(options: InstallOptions\): Promise<void> \{\s*const \{ store, signal \} = options;\s*if \(await store\.isInstalled\(\)\) return;\s*try \{/);
  assert.equal(install.match(/\binstall\(options\)/g).length, 1);
  const recognizer = code.get('recognition/localMl.ts');
  assert.match(recognizer, /await exclusively\(\(\) => deps\.store\.remove\(\), deps\.locks\);/);

  // What the installer may remove: files of this version before and after its own attempt, and an
  // older version after a completed installation. It never removes the cache.
  assert.doesNotMatch(install, /\.remove\(|deleteWhere|MODEL_CACHE_NAME/);
  assert.equal(install.match(/store\.discardStaged\(\)/g).length, 2);
  assert.equal(install.match(/store\.pruneOtherVersions\(\)/g).length, 1);
  assert.ok(install.indexOf('await store.complete();') < install.indexOf('store.pruneOtherVersions()'));

  // Removal: the store's "remove" is called by the recognizer alone, the recognizer's by the
  // session's "removeModel" alone, and that by two buttons of the screen.
  assert.deepEqual(filesWith(/store\.remove\(\)/), ['recognition/localMl.ts']);
  assert.equal(recognizer.match(/store\.remove\(\)/g).length, 1);
  const session = code.get('session.ts');
  assert.equal(session.match(/recognizer\.remove\(\)/g).length, 1);
  assert.ok(session.indexOf('async removeModel()') < session.indexOf('recognizer.remove()') && session.indexOf('recognizer.remove()') < session.indexOf('async refreshStorage()'));
  const page = code.get('PronunciationPage.svelte');
  assert.deepEqual([...page.matchAll(/onClick=\{\(\) => void session\.removeModel\(\)\} data-action="([\w-]+)"/g)].map((match) => match[1]), ['delete-model', 'remove-model-files']);
  assert.equal(page.match(/removeModel/g).length, 2);
});

test('ENG-V3-R1B: the screen never advises clearing the site\'s data, and never calls the browser\'s answer a backup', async () => {
  const code = await speechCode();
  const warning = 'Do not clear the data of this site to make room: that would remove your learning data too.';
  let warnings = 0;
  for (const [file, source] of code) {
    warnings += source.split(warning).length - 1;
    const rest = source.split(warning).join('');
    assert.doesNotMatch(rest, /\bclear(?:ing)?\b.{0,60}\b(?:site|browser|browsing|storage|cookies)\b/i, file);
    assert.doesNotMatch(rest, /\b(?:free up|delete (?:other|some|your)|remove (?:other|some) (?:data|sites))\b/i, file);
  }
  assert.equal(warnings, 2, 'the session\'s sentence and the screen\'s');

  const page = code.get('PronunciationPage.svelte');
  // Whatever the browser answers, the screen says next to it that it is not a backup.
  assert.match(page, /<p role="status" data-persistence-answer="granted">The browser agreed to keep this site's data\. That is not a backup\.<\/p>/);
  assert.match(page, /<p data-not-a-backup>None of this is a backup\./);
  // The paragraph is inside the panel without a condition of its own: it shows in every state of the panel.
  const panel = page.slice(page.indexOf('data-storage-panel'), page.indexOf('{#if modelLoaded && item && group}'));
  const before = panel.slice(0, panel.indexOf('<p data-not-a-backup>'));
  assert.equal((before.match(/\{#if/g) ?? []).length, (before.match(/\{\/if\}/g) ?? []).length);
  for (const [file, source] of code) {
    assert.doesNotMatch(source, /(?:data|progress) (?:is|are) (?:safe|secure|protected|guaranteed)|cannot be lost|will not be lost|safely stored|permanent(?:ly)? (?:stored|kept|saved)/i, file);
  }
});

test('ENG-V3-R1B-RC1: loading never reaches the installer, and the installer is reached in one place', async () => {
  const code = await speechCode();
  const filesWith = (pattern) => [...code.entries()].filter(([, source]) => pattern.test(source)).map(([path]) => path);
  const recognizer = code.get('recognition/localMl.ts');

  // One call of the installer in the whole feature: inside the recognizer's install(), with the confirmation handed on.
  assert.equal(recognizer.match(/\(deps\.install \?\? installModel\)\(/g).length, 1);
  const installing = recognizer.slice(recognizer.indexOf('async install({ confirmed, signal, onProgress })'), recognizer.indexOf('async prepare({ signal })'));
  assert.match(installing, /^async install\(\{ confirmed, signal, onProgress \}\): Promise<void> \{\s*if \(!deps\.mayDownload\(\)\) throw new DownloadNotOffered\(\);\s*await \(deps\.install \?\? installModel\)\(\{ confirmed, store: deps\.store,/);
  assert.deepEqual(filesWith(/\binstallModel\b/), ['models/install.ts', 'recognition/localMl.ts']);

  // prepare(): a look at the cache, a refusal without the files, then the Worker. No installer and no download question.
  const loading = recognizer.slice(recognizer.indexOf('async prepare({ signal })'), recognizer.indexOf('begin(capture: LiveCapture'));
  assert.match(loading, /^async prepare\(\{ signal \}\): Promise<void> \{\s*if \(ready\) return;\s*if \(!\(await deps\.store\.isInstalled\(\)\)\) throw new ModelFilesError\('not-installed', [^\n]*\n\s*if \(signal\.aborted\)[^\n]*\n\s*await load\(signal\);\s*\},/);
  assert.doesNotMatch(loading, /installModel|deps\.install|mayDownload|onProgress/);

  // The interface says the same: two operations, and only install takes a confirmation.
  const types = code.get('recognition/types.ts');
  assert.match(types, /install\(options: \{ confirmed: boolean; signal: AbortSignal; onProgress: \(loaded: number, total: number\) => void \}\): Promise<void>;/);
  assert.match(types, /prepare\(options: \{ signal: AbortSignal \}\): Promise<void>;/);

  // The screen follows the cache: a download or a removal is offered only where the tabs can be coordinated.
  const page = code.get('PronunciationPage.svelte');
  assert.match(page, /\$: coordinated = storage\?\.canCoordinate !== false;/);
  assert.match(page, /\{:else if canOffer && coordinated && capacity\?\.state === 'sufficient'\}\s*<Button variant="primary" icon="download" onClick=\{\(\) => void askToInstall\(\)\} data-action="install-model">/);
  assert.match(page, /\{#if settled && coordinated && state\.installed && !filesDamaged\}\s*<Button .*data-action="delete-model">/);
  assert.match(page, /\{:else if settled && coordinated && leftovers\}\s*<Button .*data-action="remove-model-files">/);
});

test('ENG-V3-R1B-RC1: the headroom is described as an estimate, never as room that is kept or reserved', async () => {
  const code = await speechCode();
  for (const [file, source] of code) assert.doesNotMatch(source, /stays? free|kept free|keeps? free|guarantee/i, file);
  const page = code.get('PronunciationPage.svelte');
  assert.match(page, /<p data-estimate-limits>These numbers are the browser's estimate\. They are approximate, and the trainer cannot reserve storage\. A download that succeeds does not mean that \{size\(capacity\.need\.reserve\)\} are left afterwards\./);
  assert.match(page, /and \{size\(capacity\.need\.reserve\)\} of headroom for learning data<\/dd>/);
  // The paragraph stands wherever the numbers stand: it needs nothing but the verdict.
  assert.match(page, /\{#if capacity\}\s*<p data-estimate-limits>/);
  assert.match(code.get('models/capacity.ts'), /MB of them as headroom for learning data\./);
});

test('ENG-V3-02 stage A: the Worker locks its network down before the runtime library is loaded', async () => {
  const worker = await sourceText('src/features/pronunciation/recognition/recognizer.worker.ts');
  const imports = [...worker.matchAll(/^import .*? from '([^']+)';$|^import '([^']+)';$/gm)].map((match) => match[1] ?? match[2]);
  assert.equal(imports[0], './lockdown');
  assert.ok(imports.indexOf('onnxruntime-web/wasm') > 0);
  // The runtime gets its binary and its models as bytes, runs on one thread and starts no helper.
  assert.match(worker, /ort\.env\.wasm\.numThreads = 1;/);
  assert.match(worker, /ort\.env\.wasm\.proxy = false;/);
  assert.match(worker, /ort\.env\.wasm\.wasmBinary = await bytes\('runtime\/ort-wasm-simd-threaded\.wasm'\);/);
  assert.equal(worker.match(/InferenceSession\.create\(new Uint8Array\(await bytes\(/g).length, 2);
});

test('one dependency was added, at an exact version: the WebAssembly runtime of the recognizer', async () => {
  const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies, { idb: '^8.0.4', 'onnxruntime-web': '1.31.1' });
  assert.deepEqual(Object.keys(pkg.devDependencies).sort(), ['@sveltejs/vite-plugin-svelte', 'fake-indexeddb', 'jsdom', 'svelte', 'svelte-check', 'typescript', 'vite', 'vitest']);

  const lock = JSON.parse(await readFile(join(repoRoot, 'package-lock.json'), 'utf8'));
  const locked = lock.packages['node_modules/onnxruntime-web'];
  assert.equal(locked.version, '1.31.1');
  assert.match(locked.integrity, /^sha512-/);
  assert.equal(locked.resolved, 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.31.1.tgz');
});

test('the pinned runtime is the file of the installed package: an update of the package fails here first', async () => {
  const pinned = JSON.parse(await readFile(join(repoRoot, 'src', 'features', 'pronunciation', 'models', 'pinned-files.json'), 'utf8'));
  const installed = JSON.parse(await readFile(join(repoRoot, 'node_modules', 'onnxruntime-web', 'package.json'), 'utf8'));
  assert.equal(pinned.runtime.package, 'onnxruntime-web');
  assert.equal(pinned.runtime.version, installed.version);
  const binary = await readFile(join(repoRoot, 'node_modules', 'onnxruntime-web', 'dist', pinned.runtime.file.path));
  assert.equal(binary.length, pinned.runtime.file.bytes);
  assert.equal(sha256(binary), pinned.runtime.file.sha256);
  // The application imports exactly this file and the single-thread build of the library.
  const assets = await sourceText('src/features/pronunciation/recognition/assets.ts');
  assert.match(assets, /from 'onnxruntime-web\/ort-wasm-simd-threaded\.wasm\?url';/);
  assert.match(await sourceText('src/features/pronunciation/recognition/recognizer.worker.ts'), /from 'onnxruntime-web\/wasm';/);
});

// ---- Backup and recovery (ENG-V3-R1A, ENG-V3-R1A-RC1): the source-level boundary -----------

test('ENG-V3-R1A: the backup folder, file by file', () => {
  assert.deepEqual(backupSources.map((file) => file.slice(BACKUP_DIR.length)), [
    'BackupPage.svelte',
    'destinations.ts',
    'exportBackup.ts',
    'format.ts',
    'legacyStorage.ts',
    'records.ts',
    'recoveryWriter.ts',
    'restore.ts',
    'snapshot.ts',
    'summary.ts',
    'validate.ts'
  ]);
});

/** The application sources of the backup folder, without comments, by file name. */
async function backupCode() {
  const code = new Map();
  for (const path of backupSources) code.set(path.slice(BACKUP_DIR.length), withoutComments(await sourceText(path)));
  return code;
}
/** Every module of the folder except the recovery writer: what the Backup screen's file is built from. */
const withoutWriter = (files) => files.filter((file) => file !== 'recoveryWriter.ts');

test('ENG-V3-R1A: outside the recovery writer, other products are only read, and only this product is written', async () => {
  const code = await backupCode();
  const filesWith = (pattern) => withoutWriter([...code.entries()].filter(([, source]) => pattern.test(source)).map(([path]) => path));
  const count = (file, pattern) => (code.get(file).match(pattern) ?? []).length;

  // IndexedDB is reached in the snapshot reader only, by a name that is opened without a version.
  assert.deepEqual(filesWith(/\bindexedDB\b/), ['snapshot.ts']);
  assert.equal(count('snapshot.ts', /indexedDB\.open\(/g), 1);
  assert.match(code.get('snapshot.ts'), /request = indexedDB\.open\(name\);/);
  assert.doesNotMatch(code.get('snapshot.ts'), /deleteDatabase|createObjectStore|deleteObjectStore/);
  assert.deepEqual(filesWith(/createObjectStore|deleteObjectStore|deleteDatabase/), []);

  // Transactions: the reader is read-only; one read-write transaction exists, in the recovery of this product.
  assert.deepEqual(filesWith(/\.transaction\(/), ['restore.ts', 'snapshot.ts']);
  assert.equal(count('snapshot.ts', /\.transaction\(/g), 1);
  assert.match(code.get('snapshot.ts'), /database\.transaction\(\[\.\.\.names\], 'readonly'\)/);
  assert.deepEqual(filesWith(/'readwrite'/), ['restore.ts']);
  assert.equal(count('restore.ts', /'readwrite'/g), 1);
  // Calls that change a store exist in that recovery only.
  assert.deepEqual(filesWith(/\.(?:put|add|delete|clear)\(/), ['restore.ts']);

  // That recovery writes the database this build was made for. It takes no database name, names
  // no other product's storage, and opens exactly one database.
  const restore = code.get('restore.ts');
  assert.equal(count('restore.ts', /openExistingDatabase\(/g), 1);
  assert.match(restore, /const database = await openExistingDatabase\(DATABASE_NAME\);/);
  assert.match(restore, /const OWN_SCHEMA = DATABASE_SCHEMAS\[EXPERIMENTAL_PRODUCT\];/);
  assert.match(restore, /database\.transaction\(\[\.\.\.OWN_SCHEMA\.stores\], 'readwrite'\)/);
  assert.doesNotMatch(restore, /STABLE_PRODUCT|LEGACY_|eng-trainer-v2|localStorage|legacyStorage|destinations|recoveryWriter/);
  assert.match(restore, /export async function restoreOwnSection\(file: BackupFile, options: \{ screenOpen\?: \(\) => boolean \} = \{\}\): Promise<void>/);

  // The stable database is named once in the whole folder, in the table of storage identities.
  assert.deepEqual([...code.entries()].filter(([, source]) => /eng-trainer-v2/.test(source)).map(([path]) => path), ['format.ts']);
  assert.equal(count('format.ts', /eng-trainer-v2/g), 1);

  // The key-value storage: one place reaches it, and it can only read. Nothing writes, removes or clears a record.
  assert.deepEqual(filesWith(/[.\s]localStorage\b(?!')/), ['legacyStorage.ts']);
  assert.equal(count('legacyStorage.ts', /globalThis\.localStorage/g), 1);
  assert.match(code.get('legacyStorage.ts'), /return \{ getItem: \(key\) => storage\.getItem\(key\) \};/);
  assert.deepEqual(filesWith(/setItem|removeItem|sessionStorage|document\.cookie|storage\.clear|\.key\(/), []);

  // Making a backup and looking at a destination write nothing: these modules hold no call that changes storage.
  for (const file of ['exportBackup.ts', 'destinations.ts', 'snapshot.ts', 'legacyStorage.ts', 'summary.ts', 'validate.ts', 'records.ts', 'format.ts']) {
    assert.doesNotMatch(code.get(file), /\.(?:put|add|delete|clear)\(|'readwrite'|setItem|removeItem|createObjectStore/, file);
  }

  // No request, no Worker, no cache, no microphone: a backup is made, read and recovered inside the page.
  assert.deepEqual([...code.entries()].filter(([, source]) => /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon|new Worker|\bcaches\b|getUserMedia|serviceWorker/.test(source)).map(([path]) => path), []);
  assert.deepEqual([...code.entries()].filter(([, source]) => /https?:\/\//.test(source)).map(([path]) => path), []);
  // The file reaches the learner through the one existing download helper, from the screen.
  assert.deepEqual(filesWith(/downloadFile\(/), ['BackupPage.svelte']);
});

test('ENG-V3-R1A-RC1: the recovery writer has two fixed destinations, and is the only module that writes another product', async () => {
  const code = await backupCode();
  const writer = code.get('recoveryWriter.ts');
  const count = (pattern) => (writer.match(pattern) ?? []).length;

  // What it offers: two functions, each for one product.
  assert.deepEqual([...writer.matchAll(/^export (?:async function|function|const|type) (\w+)/gm)].map((match) => match[1]), ['restoreStableSection', 'restoreLegacySection']);
  assert.match(writer, /export async function restoreStableSection\(file: BackupFile\): Promise<void>/);
  assert.match(writer, /export async function restoreLegacySection\(file: BackupFile\): Promise<void>/);

  // The stable database: its identity comes from the table of storage identities, never from an argument or the file.
  assert.match(code.get('destinations.ts'), /export const STABLE_SCHEMA = DATABASE_SCHEMAS\[STABLE_PRODUCT\];/);
  // It requests no database itself. It opens the stable one through the reader's request, which names no
  // version: so it can neither create a database nor upgrade one, and it has no call that makes or drops a store.
  assert.doesNotMatch(writer, /\bindexedDB\b/);
  assert.equal(count(/openExistingDatabase\(/g), 1);
  assert.match(writer, /const database = await openExistingDatabase\(STABLE_SCHEMA\.database\);\s*if \(!database\) \{\s*throw new BackupError\('unavailable'/);
  assert.doesNotMatch(writer, /createObjectStore|deleteObjectStore|deleteDatabase|onupgradeneeded|\.delete\(/);
  assert.equal(count(/\.transaction\(/g), 1);
  assert.match(writer, /database\.transaction\(\[\.\.\.STABLE_SCHEMA\.stores\], 'readwrite'\)/);
  // A database of another version or with other stores is refused before a transaction is started.
  assert.match(writer, /if \(database\.version !== STABLE_SCHEMA\.schemaVersion \|\| storeNames\.join\('\\n'\) !== \[\.\.\.STABLE_SCHEMA\.stores\]\.sort\(\)\.join\('\\n'\)\) \{\s*throw new BackupError\('unsupported-version'/);
  // The section is judged again, and the destination is judged inside the writing transaction.
  assert.match(writer, /checkSection\(product, section\);/);
  assert.match(writer, /if \(learningDataIn\(current\)\.length\) throw new BackupError\('not-empty'/);
  // Every write is issued behind the guard, whose record is the valid, empty one of format.ts.
  assert.match(code.get('format.ts'), /export const GUARD_STORE = 'progress';\s*export const GUARD_KEY = 'learnedPhrases';/);
  assert.match(writer, /const guardStore = transaction\.objectStore\(GUARD_STORE\);\s*guardStore\.put\(\[\], GUARD_KEY\);\s*const guard = guardStore\.add\(\[\], GUARD_KEY\);/);
  assert.match(code.get('restore.ts'), /const guardStore = transaction\.objectStore\(GUARD_STORE\);\s*guardStore\.put\(\[\], GUARD_KEY\);\s*const guard = guardStore\.add\(\[\], GUARD_KEY\);/);
  assert.equal(count(/\.put\(/g), 2);
  assert.equal(count(/\.add\(/g), 1);
  assert.equal(count(/\.clear\(/g), 1);

  // The first version: one place reaches the key-value storage, with two methods, for the two records only.
  assert.equal(count(/[.\s]localStorage\b/g), 1);
  assert.match(writer, /const storage = globalThis\.localStorage;/);
  assert.match(writer, /type LegacyStorage = \{ read\(key: LegacyKey\): string \| null; write\(key: LegacyKey, value: string\): void \};/);
  assert.match(writer, /return \{ read: \(key\) => storage\.getItem\(key\), write: \(key, value\) => storage\.setItem\(key, value\) \};/);
  assert.equal(count(/setItem/g), 1);
  assert.equal(count(/getItem/g), 1);
  assert.doesNotMatch(writer, /removeItem|sessionStorage|document\.cookie|storage\.clear|\.key\(/);
  // One call writes a record, for a key that the plan lists: the plan is made from the two fixed keys.
  assert.equal(count(/storage\.write\(/g), 1);
  assert.match(writer, /const plan = planLegacyRecovery\(current, section\);[\s\S]*?for \(const key of plan\.writes\) \{[\s\S]*?storage\.write\(key, text\);/);
  assert.match(code.get('destinations.ts'), /const writes = LEGACY_KEYS\.filter\(/);
  // The writing of the two records has no pause in it: no other code runs between the judgement and the writes.
  const legacy = writer.slice(writer.indexOf('function writeLegacyRecords'), writer.indexOf('export async function restoreLegacySection'));
  assert.match(legacy, /^function writeLegacyRecords\(section: LegacySection\): void \{/);
  assert.doesNotMatch(legacy, /\bawait\b|\basync\b|\.then\(|setTimeout|Promise/);

  // It makes no request and loads no other file.
  assert.doesNotMatch(writer, /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bimport\(|new Worker|\bcaches\b/);
  // It does not touch this product's own database or the running application.
  assert.doesNotMatch(writer, /DATABASE_NAME|EXPERIMENTAL_PRODUCT|initState|persistence|from '\.\.\/\.\.\//);
});

test('ENG-V3-R1A-RC2: after the writing transaction has completed, a failure is never "nothing was recovered"', async () => {
  const code = await backupCode();
  const failures = (source) => [...source.matchAll(/new BackupError\('([a-z-]+)'/g)].map((match) => match[1]);

  // This product (ENG-V3-R1A-RC3): the handover is one loop. It waits for the saves of this tab, asks
  // its questions, and takes the hold, with nothing awaited between a question and the hold. The
  // transaction is started in the step that took the hold.
  const restore = code.get('restore.ts');
  assert.match(restore, /while \(!held\) \{\s*await persistenceSettled\(\);\s*if \(options\.screenOpen && !options\.screenOpen\(\)\) throw new BackupError\('unavailable', LEFT\);\s*if \(get\(saveStatus\)\.state === 'error'\) throw new BackupError\('unavailable', UNSAVED\);\s*const hold = holdState\(\);\s*if \(hold === 'unavailable'\) throw new BackupError\('unavailable', stateHeld\(\) \? ALREADY_RUNNING : NOT_CONNECTED\);\s*held = hold === 'held';\s*if \(!held\) await retrySave\(\);\s*\}\s*await writeSection\(database, section\);\s*\} finally \{\s*database\.close\(\);\s*\}/);
  assert.equal(restore.match(/holdState\(\)/g).length, 1);
  // Before the transaction nothing of the running application is switched off, replaced or loaded.
  const body = restore.slice(restore.indexOf('export async function restoreOwnSection'));
  const before = body.slice(0, body.indexOf('await writeSection(database, section);'));
  assert.doesNotMatch(before, /initState|initStateWithoutStorage|releaseState/);
  // After it: the tab is detached at once, the data is checked, and only then is the state loaded.
  const after = body.slice(body.indexOf('await writeSection(database, section);'));
  assert.match(after, /^await writeSection\(database, section\);\s*\} finally \{\s*database\.close\(\);\s*\}\s*initStateWithoutStorage\(\);\s*await checkAndLoad\(digest\);\s*\} finally \{\s*if \(held\) releaseState\(\);\s*\}\s*\}\s*$/);
  // The hold is ended in one place, by the call that took it, on every way out.
  assert.equal(restore.match(/releaseState\(\)/g).length, 1);
  // Saving comes back in one way only: the state is loaded from the database again, after the check.
  assert.equal(restore.match(/await initState\(\)/g).length, 1);
  assert.doesNotMatch(restore, /connectStorage|connectCollections|disablePersistence|disableCollections|resumeAfterRollback/);
  const checked = restore.slice(restore.indexOf('async function checkAndLoad'), restore.indexOf('export async function restoreOwnSection'));
  assert.deepEqual(failures(checked), ['verification', 'verification', 'verification']);
  assert.ok(checked.indexOf('readDatabaseSnapshot(OWN_SCHEMA)') > 0 && checked.indexOf('readDatabaseSnapshot(OWN_SCHEMA)') < checked.indexOf('await initState()'));
  // A refusal of the handover is never `verification`, and none of them asks for a reload of unsaved work.
  assert.deepEqual(failures(before).filter((code) => code === 'verification'), []);
  assert.doesNotMatch(restore.match(/const UNSAVED = '[^']+';/)[0], /reload/i);

  // The stable database: the same rule for everything after its transaction.
  const writer = code.get('recoveryWriter.ts');
  const stable = writer.slice(writer.indexOf('export async function restoreStableSection'), writer.indexOf('type LegacyStorage'));
  const afterCommit = stable.slice(stable.indexOf('database.close();'));
  assert.ok(afterCommit.includes('readDatabaseSnapshot(STABLE_SCHEMA)'));
  assert.deepEqual(failures(afterCommit), ['verification', 'verification']);
  // The writer has nothing to do with the state of the running application.
  assert.doesNotMatch(writer, /initState|persistence|saveStatus/);

  // The screen: `verification` is shown as written, and data that may be the backup's is never data to reset.
  const page = code.get('BackupPage.svelte');
  assert.match(page, /const written = code === 'verification';/);
  assert.match(page, /title: written \? 'Written, but not checked' : code === 'partial' \? 'The recovery is not complete' : 'Nothing was recovered',/);
  assert.match(page, /const detached = own && \$saveStatus\.state === 'disabled';/);
  assert.match(page, /if \(unchecked && destination\.state !== 'identical'\) \{\s*return \{\s*state: 'unverified',/);
  assert.match(page, /inspectStableDestination\(file\.integrity\.sections\[STABLE_PRODUCT\]\)/);
  assert.match(page, /inspectDestination\(file\.integrity\.sections\[EXPERIMENTAL_PRODUCT\]\)/);
});

test('ENG-V3-R1A-RC2: every confirmation of a recovery of v1 warns about other tabs, the completion too', async () => {
  const page = (await backupCode()).get('BackupPage.svelte');
  const warning = 'Close every tab of the previous version first. A tab that stays open could later save its older state over the recovered data.';
  assert.equal(page.split(warning).length - 1, 2);
  const completing = page.slice(page.indexOf('{:else if completing}'), page.indexOf('{:else}', page.indexOf('{:else if completing}')));
  assert.ok(completing.includes(warning));
  // The other two products have theirs.
  assert.ok(page.includes('Close every tab of the stable version first.'));
  assert.ok(page.includes('Close other tabs of this application first.'));
});

test('ENG-V3-R1A-RC1: only the Backup screen loads the recovery writer, and only after the confirmation', async () => {
  const code = await backupCode();
  // No module of the folder imports the writer statically, and one module asks for it at all.
  for (const [file, source] of code) assert.doesNotMatch(source, /from '\.\/recoveryWriter'/, file);
  assert.deepEqual([...code.entries()].filter(([, source]) => /recoveryWriter/.test(source)).map(([path]) => path), ['BackupPage.svelte']);
  assert.deepEqual([...code.entries()].filter(([, source]) => /\bimport\(/.test(source)).map(([path]) => path), ['BackupPage.svelte']);

  const page = code.get('BackupPage.svelte');
  // One request for it (the other mention is its type), inside the function that writes one part.
  assert.deepEqual([...page.matchAll(/\bimport\('([^']+)'\)/g)].map((match) => match[1]), ['./recoveryWriter', './recoveryWriter']);
  assert.equal(page.match(/await import\('\.\/recoveryWriter'\)/g).length, 1);
  assert.match(page, /async function write\(product: ProductId, file: BackupFile\): Promise<void> \{[\s\S]*?writer = await import\('\.\/recoveryWriter'\);[\s\S]*?if \(product === STABLE_PRODUCT\) await writer\.restoreStableSection\(file\);\s*else await writer\.restoreLegacySection\(file\);\s*\}/);
  // That function is called in one place: the handler of the button that confirms.
  assert.equal(page.match(/\bwrite\(/g).length, 2);
  assert.match(page, /async function recover\(\): Promise<void> \{\s*if \(!loaded \|\| !asked \|\| restoring\) return;[\s\S]*?await write\(product, current\.file\);/);
  assert.equal(page.match(/\brecover\(\)/g).length, 1);
  assert.match(page, /on:click=\{recover\} data-backup-action="confirm-recover"/);
  // The confirmation is opened by the button of one part, and only where a recovery is possible.
  assert.match(page, /async function askToRecover\(product: ProductId\): Promise<void> \{\s*if \(restoring \|\| !dialog \|\| !targets\[product\]\?\.action\) return;/);
  assert.match(page, /onClick=\{\(\) => askToRecover\(section\.product\)\} data-backup-action="recover" data-backup-product=\{section\.product\}/);
});

test('ENG-V3-R1A: the other products are read only after the learner asks: for a backup, or for the preview of a recovery', async () => {
  const code = await backupCode();
  const page = code.get('BackupPage.svelte');
  // One call collects the sections, inside the handler of the "Make a backup file" button.
  assert.equal(page.match(/collectSections\(\)/g).length, 1);
  assert.match(page, /async function makeBackup\(\): Promise<void> \{[\s\S]*?const next = await collectSections\(\);/);
  assert.match(page, /onClick=\{makeBackup\} data-backup-action="make"/);
  // The screen itself starts nothing when it is opened.
  assert.doesNotMatch(page, /onMount|onDestroy|\$: void|\$: collect|\$: inspect/);
  // The two readers of other products are called by the exporter and by the module of the destinations, once each.
  const exporter = code.get('exportBackup.ts');
  assert.equal(exporter.match(/readLegacyRecords\(\)/g).length, 1);
  assert.equal(exporter.match(/readDatabaseSource\(STABLE_PRODUCT\)/g).length, 1);
  const destinations = code.get('destinations.ts');
  assert.equal(destinations.match(/readLegacyRecords\(\)/g).length, 1);
  assert.equal(destinations.match(/readDatabaseSnapshot\(STABLE_SCHEMA\)/g).length, 1);
  assert.deepEqual([...code.entries()].filter(([, source]) => /readLegacyRecords\(/.test(source)).map(([path]) => path), ['destinations.ts', 'exportBackup.ts', 'legacyStorage.ts']);
  // A destination is looked at for a part of a file that the learner selected, and after a recovery of that part.
  assert.equal(page.match(/inspectStableDestination\(/g).length, 1);
  assert.equal(page.match(/inspectLegacyDestination\(/g).length, 1);
  assert.match(page, /async function inspect\(product: ProductId, file: BackupFile\): Promise<Found> \{/);
  // Three callers: the selection of a file, the end of a recovery, and the button "Check again".
  assert.equal(page.match(/await inspect\(/g).length, 3);
  assert.match(page, /async function checkAgain\(product: ProductId\): Promise<void> \{\s*if \(!loaded \|\| restoring\) return;/);
  assert.equal(page.match(/\bcheckAgain\(/g).length, 2);
  assert.match(page, /onClick=\{\(\) => checkAgain\(section\.product\)\} data-backup-action="check-again"/);
  assert.match(page, /const backup = await readBackup\(await file\.arrayBuffer\(\)\);[\s\S]*?for \(const section of sections\) places\[section\.product\] = await inspect\(section\.product, backup\);/);
});
