import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { sha256 } from './content-build.mjs';
import { EXPERIMENTAL_MARKER, EXPERIMENTAL_TOKENS, FEATURE_TOKENS, compareInventory, inventory, readLocks, runProductGates } from './product-gates.mjs';
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
  for (const token of ['eng-trainer-v3', '/v3/', 'experimental-v3', EXPERIMENTAL_MARKER]) assert.ok(EXPERIMENTAL_TOKENS.includes(token), token);
  const screen = await readFile(join(repoRoot, 'src', 'features', 'pronunciation', 'PronunciationPage.svelte'), 'utf8');
  assert.ok(screen.includes(`${EXPERIMENTAL_MARKER}=`));
});

// ---- Source-level boundary -------------------------------------------------------------

/** Folders that belong to the experimental product only. */
const EXPERIMENTAL_ONLY = ['src/features/pronunciation/'];
const sources = (await listFiles(join(repoRoot, 'src'))).filter((path) => /\.(?:ts|js|svelte)$/.test(path)).map((path) => `src/${path}`);
const sourceText = (path) => readFile(join(repoRoot, path), 'utf8');

test('shared code reaches the experimental-only folder through one guarded dynamic import, and nothing else', async () => {
  const references = [];
  for (const path of sources.filter((file) => !EXPERIMENTAL_ONLY.some((dir) => file.startsWith(dir)))) {
    const lines = (await sourceText(path)).split('\n');
    lines.forEach((line, index) => {
      if (/features\/pronunciation|PronunciationPage/.test(line) && !/^\s*(?:\/\/|\*|\/\*)/.test(line)) references.push({ path, line: line.trim(), before: lines[index - 1]?.trim() });
    });
  }
  assert.deepEqual(references, [{
    path: 'src/app/App.svelte',
    line: "{#await import('../features/pronunciation/PronunciationPage.svelte') then feature}",
    before: "{:else if __ENG_PRONUNCIATION__ && activePage === 'pronunciation'}"
  }]);
});

test('the guarded branch is the last branch of the screen list', async () => {
  const app = await sourceText('src/app/App.svelte');
  const chain = app.slice(app.indexOf("{#if activePage === 'index'}"));
  const branches = [...chain.slice(0, chain.indexOf('{/if}')).matchAll(/\{:else if ([^}]+)\}/g)].map((match) => match[1]);
  assert.equal(branches.at(-1), "__ENG_PRONUNCIATION__ && activePage === 'pronunciation'");
  assert.equal(branches.at(-2), 'activeTopic');
  assert.equal(branches.filter((branch) => branch.includes('__ENG_')).length, 1);
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
    'src/app/App.svelte __ENG_PRONUNCIATION__',
    'src/app/AppShell.svelte __SITE_BASE__',
    'src/app/navigation.ts __ENG_PRONUNCIATION__',
    'src/features/pronunciation/PronunciationPage.svelte __ENG_DATABASE__',
    'src/features/pronunciation/PronunciationPage.svelte __ENG_PRODUCT__',
    'src/features/pronunciation/PronunciationPage.svelte __ENG_VERSION_LINKS__',
    'src/features/pronunciation/recognition/localMl.ts __SITE_BASE__',
    'src/features/settings/SettingsPage.svelte __SITE_BASE__',
    'src/storage/database.ts __ENG_DATABASE__',
    'src/storage/database.ts __ENG_PRODUCT__'
  ]);
});

/** The experimental-only sources of the application, without their tests and test helpers. */
const featureSources = sources.filter((file) => EXPERIMENTAL_ONLY.some((dir) => file.startsWith(dir)) && !/\.test\.ts$/.test(file) && !file.endsWith('/testing.ts'));
const withoutComments = (code) => code.replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|\/\/.*$/gm, '');

test('ENG-V3-02 stage A: the experimental-only folder is the speech feature, file by file', () => {
  assert.deepEqual(featureSources.map((file) => file.slice('src/features/pronunciation/'.length)), [
    'PronunciationPage.svelte',
    'audio.ts',
    'capture/capture.ts',
    'capture/levels.ts',
    'capture/pcm-collector.worklet.js',
    'models/install.ts',
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
