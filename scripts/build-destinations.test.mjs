// Regressions for the review findings F1-RC1 (ENG-V3-01-RC2) and F1-RC2 (ENG-V3-01-RC3): a
// build option must never make Vite empty or overwrite a source folder.
//
//   F1-RC1  Vite empties every folder that a Rollup output option names with "dir", so a
//           valid "build.outDir" alone did not protect the sources.
//   F1-RC2  Vite keeps an entry named ".git" when it empties an output folder, and a
//           manifest or assets option could write into it, and through it if it is a link.
//
// Every case is a real build: the command line ("vite build") or the JavaScript API
// ("build()", "createBuilder()"), each in its own process. A refused build must exit with
// an error and leave everything unchanged: every file, folder and link, compared by path,
// type, size and SHA-256.
//
// Nothing here can touch the real repository. Each test builds in a new, complete copy of
// the application ("fixture"): sources, content, scripts, configuration and the frozen v1
// project. The copies live in .local/ of this repository, which Git ignores, because a
// build needs the installed packages and Node finds them from there without a link. A
// fixture's links point only into the same fixture, and a test removes only its own folder.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { EXPERIMENTAL_PRODUCT, STABLE_PRODUCT } from './site-config.mjs';

const sourceRoot = realpathSync.native(join(dirname(fileURLToPath(import.meta.url)), '..'));
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const installed = (name) => JSON.parse(readFileSync(join(sourceRoot, 'node_modules', name, 'package.json'), 'utf8')).version;

/** The application as it is built: everything a build reads, and everything it must not harm. */
const APPLICATION = ['index.html', 'src', 'public', 'content', 'scripts', 'v1', 'package.json', 'package-lock.json', 'site.config.json', 'svelte.config.js', 'tsconfig.json', 'tsconfig.node.json', 'vite.config.ts', 'vitest.config.ts'];
/** Installed packages and build output of the v1 project are not part of a copy. */
const NOT_COPIED = new Set(['node_modules', 'dist']);
/** Marks a folder as a copy. No build of these tests starts in a folder without it. */
const MARKER = 'disposable-copy.txt';

const VITE = join(sourceRoot, 'node_modules', 'vite', 'bin', 'vite.js');
/** The JavaScript API, as a program for `node --eval`. Arguments: the inline configuration as JSON, and "builder" or nothing. */
const API = `
import { existsSync } from 'node:fs';
if (!existsSync(${JSON.stringify(MARKER)})) throw new Error('Not a disposable copy: no build is started here.');
const { build, createBuilder } = await import('vite');
const [config, how] = process.argv.slice(1);
if (how === 'builder') {
  const builder = await createBuilder(JSON.parse(config));
  await builder.build(builder.environments.client);
} else {
  await build(JSON.parse(config));
}`;

/**
 * A disposable copy: `base/repo` with the application and its generated content, and
 * `base/outside` beside it. Returns both paths.
 */
function fixture(t) {
  mkdirSync(join(sourceRoot, '.local'), { recursive: true });
  const base = realpathSync.native(mkdtempSync(join(sourceRoot, '.local', 'build-destinations-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'repo');
  mkdirSync(root);
  for (const entry of APPLICATION) {
    cpSync(join(sourceRoot, entry), join(root, entry), { recursive: true, filter: (source) => !NOT_COPIED.has(basename(source)) });
  }
  writeFileSync(join(root, MARKER), 'A disposable copy of the application for scripts/build-destinations.test.mjs.\n');
  mkdirSync(join(base, 'outside', 'deep'), { recursive: true });
  writeFileSync(join(base, 'outside', 'deep', 'owner.txt'), 'a file outside the repository\n');
  // The content of both products, generated inside the copy by the copy's own scripts.
  for (const args of [[], [EXPERIMENTAL_PRODUCT]]) {
    const generated = spawnSync(process.execPath, ['scripts/generate-content.mjs', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(generated.status, 0, `${generated.stdout}${generated.stderr}`);
  }
  return { base, root };
}

/** Runs a program in a copy, for one product. Refuses any folder that is not a copy. */
function run(root, args, product) {
  assert.ok(root.startsWith(join(sourceRoot, '.local') + sep) && existsSync(join(root, MARKER)), `${root} is not a disposable copy`);
  const env = { ...process.env };
  delete env.ENG_PRODUCT;
  if (product !== STABLE_PRODUCT) env.ENG_PRODUCT = product;
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 1 << 26 });
  return { exit: result.status, output: `${result.stdout}${result.stderr}`, built: /built in/.test(`${result.stdout}${result.stderr}`) };
}
/** `vite build [arguments]` */
const cli = (root, args = [], product = EXPERIMENTAL_PRODUCT) => run(root, [VITE, 'build', ...args], product);
/** `build(config)` of the JavaScript API; the configuration file is used as it is. */
const api = (root, config, product = EXPERIMENTAL_PRODUCT) => run(root, ['--input-type=module', '--eval', API, JSON.stringify(config)], product);
/** `createBuilder(config)`, then a build of the client environment. */
const builder = (root, config, product = EXPERIMENTAL_PRODUCT) => run(root, ['--input-type=module', '--eval', API, JSON.stringify(config), 'builder'], product);

/** A link to a folder: a junction on Windows (no privilege needed), a symbolic link elsewhere. */
const link = (target, path) => symlinkSync(target, path, 'junction');

/** Every folder, file and link below `dir`. Links are recorded, never followed. */
function snapshot(dir, prefix = '') {
  const rows = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) rows.push({ path: `${prefix}${name}`, type: 'link', target: readlinkSync(path) });
    else if (stats.isDirectory()) rows.push({ path: `${prefix}${name}`, type: 'folder' }, ...snapshot(path, `${prefix}${name}/`));
    else rows.push({ path: `${prefix}${name}`, type: 'file', bytes: stats.size, sha256: sha256(readFileSync(path)) });
  }
  return rows;
}

/** What differs between two snapshots, as short text. Empty when they are equal. */
function difference(before, after) {
  const was = new Map(before.map((row) => [row.path, JSON.stringify(row)]));
  const now = new Map(after.map((row) => [row.path, JSON.stringify(row)]));
  return [
    ...[...was.keys()].filter((path) => !now.has(path)).map((path) => `removed ${path}`),
    ...[...now.keys()].filter((path) => !was.has(path)).map((path) => `added ${path}`),
    ...[...was.keys()].filter((path) => now.has(path) && now.get(path) !== was.get(path)).map((path) => `changed ${path}`)
  ];
}

/** The same, without the output folder of the copy: the folder, what it holds, and new folders that lead to it. */
function differenceOutside(before, after, folder) {
  const output = `repo/${folder}`;
  return difference(before, after).filter((line) => {
    const path = line.slice(line.indexOf(' ') + 1);
    return !(path === output || path.startsWith(`${output}/`) || (line.startsWith('added ') && output.startsWith(`${path}/`)));
  });
}

/** The files that a build must not harm: sources, content, scripts, configuration, v1 and the folder outside. */
const protectedFiles = (rows) => rows.filter((row) => row.type === 'file' && /^(?:repo\/(?:src|content|scripts|public|v1)\/|repo\/[^/]+$|outside\/)/.test(row.path));

/**
 * The decisive assertions for a build that must be refused: it exits with an error, for
 * the stated reason, without having built, and the whole fixture is as it was before.
 */
function mustRefuse(base, label, build, reason) {
  const before = snapshot(base);
  assert.ok(protectedFiles(before).filter((row) => row.path.startsWith('repo/src/')).length > 100, `${label}: the copy has no sources to protect`);
  const result = build();
  assert.notEqual(result.exit, 0, `${label}: the build was not refused\n${result.output}`);
  assert.equal(result.built, false, `${label}: the build ran\n${result.output}`);
  assert.match(result.output, reason, label);
  assert.deepEqual(difference(before, snapshot(base)), [], `${label}: a refused build changed the copy`);
}

/** A build that must succeed, and change nothing outside the named output folder. */
function mustBuild(base, label, build, folder) {
  const before = snapshot(base);
  const result = build();
  assert.equal(result.exit, 0, `${label}\n${result.output}`);
  assert.equal(result.built, true, `${label}\n${result.output}`);
  const after = snapshot(base);
  assert.deepEqual(differenceOutside(before, after, folder), [], `${label}: the build changed something outside ${folder}`);
  assert.deepEqual(protectedFiles(after), protectedFiles(before), label);
  const files = after.filter((row) => row.type === 'file' && row.path.startsWith(`repo/${folder}/`)).map((row) => row.path.slice(`repo/${folder}/`.length));
  assert.ok(files.includes('index.html') && files.some((file) => /^assets\/index-.+\.js$/.test(file)) && files.includes('data/manifest.json'), `${label}: ${files.join(', ')}`);
  return after.filter((row) => row.path.startsWith(`repo/${folder}/`));
}

/** Replaces an anchor that must occur exactly once, so an edit cannot silently stop matching. */
function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length, 2, `vite.config.ts no longer contains exactly one "${from.trim()}"`);
  return text.replace(from, to);
}

const NO_OUTPUT_OPTION = /rollupOptions\.output" is set\. A build of this repository accepts no Rollup output option/;
const NOT_GENERATED = /is not a generated folder of this repository, so no script may empty or delete it/;
const NO_MANIFEST = /manifest" is set\. A build of this repository writes no manifest, so no option may name a file for one/;
const ONLY_ASSETS = /assetsDir" is ".*"\. A build of this repository writes its assets to "assets" below its output folder and nowhere else/;
const output = (value) => ({ build: { rollupOptions: { output: value } } });

test('the build check was read against the installed Vite and Rollup', () => {
  // scripts/generated-dirs.mjs relies on how this Vite version finds the folders it empties
  // and what it keeps in them (getResolvedOutDirs, prepareOutDir, emptyDir), and on Rollup
  // refusing file names that leave the output folder. After an update, read both again,
  // run this file, then change the numbers.
  assert.equal(installed('vite'), '6.4.3');
  assert.equal(installed('rollup'), '4.63.1');
});

test('F1-RC1: a Rollup output folder written into vite.config.ts is refused, as an object and as a list', (t) => {
  const { base, root } = fixture(t);
  const original = readFileSync(join(root, 'vite.config.ts'), 'utf8');
  const cases = {
    'object { dir: "src" }, experimental product': [{ dir: 'src' }, EXPERIMENTAL_PRODUCT],
    'list [{ dir: "dist-v3" }, { dir: "src" }], experimental product': [[{ dir: 'dist-v3' }, { dir: 'src' }], EXPERIMENTAL_PRODUCT],
    'object { dir: "src" }, stable product': [{ dir: 'src' }, STABLE_PRODUCT]
  };
  for (const [label, [value, product]] of Object.entries(cases)) {
    writeFileSync(join(root, 'vite.config.ts'), replaceOnce(original, '    outDir: product.outDir\n', `    outDir: product.outDir,\n    rollupOptions: { output: ${JSON.stringify(value)} }\n`));
    mustRefuse(base, label, () => cli(root, [], product), NO_OUTPUT_OPTION);
  }
});

test('F1-RC1: the JavaScript API with an unchanged configuration file is refused the same way', (t) => {
  const { base, root } = fixture(t);
  assert.equal(sha256(readFileSync(join(root, 'vite.config.ts'))), sha256(readFileSync(join(sourceRoot, 'vite.config.ts'))));
  link(join(root, 'src'), join(root, 'linked-output'));
  link(join(base, 'outside'), join(root, 'linked-outside'));
  if (process.platform === 'win32') {
    // On Windows "SRC" is the source folder itself.
    assert.equal(realpathSync.native(join(root, 'SRC')), join(root, 'src'));
  }

  const values = {
    'the source folder': { dir: 'src' },
    'a list in which the first entry is the product\'s own folder': [{ dir: 'dist-v3' }, { dir: 'src' }],
    'a list in which the last entry is the product\'s own folder': [{ dir: 'src' }, { dir: 'dist-v3' }],
    'an absolute path to the source folder': { dir: join(root, 'src') },
    'another spelling of the source folder': { dir: 'SRC' },
    'a link to the source folder': { dir: 'linked-output' },
    'a link to a folder outside the repository': { dir: 'linked-outside' },
    'a single output file that is a source file': { file: 'src/main.ts' }
  };
  for (const [label, value] of Object.entries(values)) {
    mustRefuse(base, label, () => api(root, output(value)), NO_OUTPUT_OPTION);
  }
  mustRefuse(base, 'the stable product', () => api(root, output({ dir: 'src' }), STABLE_PRODUCT), NO_OUTPUT_OPTION);
});

test('F1-RC1: no Rollup output option is accepted, not even one that names the product\'s own folder', (t) => {
  const { base, root } = fixture(t);
  const values = {
    'the product\'s own folder': { dir: 'dist-v3' },
    'an empty object': {},
    'an empty list': [],
    'a file name pattern only': { entryFileNames: 'assets/app.js' },
    'the older nested form': { output: { dir: 'src' } }
  };
  for (const [label, value] of Object.entries(values)) {
    mustRefuse(base, label, () => api(root, output(value)), NO_OUTPUT_OPTION);
  }
});

test('F1-RC1: every set of build options is checked: environments and the builder API', (t) => {
  const { base, root } = fixture(t);
  const client = (build) => ({ environments: { client: { build } } });
  const shared = (config) => ({ builder: { sharedConfigBuild: true }, ...config });

  mustRefuse(base, 'client environment: a Rollup output folder', () => api(root, client({ rollupOptions: { output: { dir: 'src' } } })), NO_OUTPUT_OPTION);
  mustRefuse(base, 'client environment: the source folder as its output folder', () => api(root, client({ outDir: 'src' })), NOT_GENERATED);
  mustRefuse(base, 'an environment that this build does not use', () => api(root, { environments: { ssr: { build: { rollupOptions: { output: { dir: 'src' } } } } } }), /"environments\.ssr\.build\.rollupOptions\.output" is set/);
  // With a shared configuration Vite resolves the options once, and "build" stays the top-level set.
  mustRefuse(base, 'builder API, shared configuration: the source folder as the output folder of the client environment', () => builder(root, shared(client({ outDir: 'src' }))), NOT_GENERATED);
  mustRefuse(base, 'builder API, shared configuration: a Rollup output folder of the client environment', () => builder(root, shared(client({ rollupOptions: { output: { dir: 'src' } } }))), /"environments\.client\.build\.rollupOptions\.output" is set/);
  mustRefuse(base, 'builder API, one configuration for each environment', () => builder(root, { builder: {}, ...client({ rollupOptions: { output: { dir: 'src' } } }) }), NO_OUTPUT_OPTION);
});

test('the output folder is always emptied first, so a link left inside it is removed and never written through', (t) => {
  const { base, root } = fixture(t);
  const NOT_EMPTIED = /emptyOutDir" is false\. A build of this repository always empties its output folder first/;
  mkdirSync(join(root, 'dist-v3'));
  link(join(base, 'outside'), join(root, 'dist-v3', 'assets'));
  link(join(root, 'src'), join(root, 'dist-v3', 'data'));

  mustRefuse(base, 'JavaScript API: emptyOutDir false', () => api(root, { build: { emptyOutDir: false } }), NOT_EMPTIED);
  mustRefuse(base, 'command line: --no-emptyOutDir', () => cli(root, ['--no-emptyOutDir']), NOT_EMPTIED);
  mustRefuse(base, 'client environment: emptyOutDir false', () => api(root, { environments: { client: { build: { emptyOutDir: false } } } }), NOT_EMPTIED);

  // The default: the links are removed as links, and the build writes real folders in their place.
  const built = mustBuild(base, 'a build over the links', () => cli(root), 'dist-v3');
  assert.deepEqual(built.filter((row) => row.type === 'link'), []);
  assert.deepEqual(snapshot(join(base, 'outside')), [{ path: 'deep', type: 'folder' }, { path: 'deep/owner.txt', type: 'file', bytes: 30, sha256: sha256('a file outside the repository\n') }]);
});

test('ENG-V3-01-RC1 stays in force: the configured folder and --outDir are checked in real builds', (t) => {
  const { base, root } = fixture(t);
  for (const dir of ['SRC', 'src', '../outside', '.variant/experimental-v3/public']) {
    mustRefuse(base, `command line: --outDir ${dir}`, () => cli(root, ['--outDir', dir]), /is not a generated folder of this repository|Here only "build" or "work" is accepted/);
  }
  mustRefuse(base, 'JavaScript API: an absolute build.outDir', () => api(root, { build: { outDir: join(root, 'src') } }), NOT_GENERATED);

  link(join(root, 'src'), join(root, 'dist-v3'));
  mustRefuse(base, 'the product\'s own build folder is a link to the source folder', () => cli(root), /"dist-v3" is a symbolic link or a junction, not a real folder/);
  mustRefuse(base, 'the same, for the stable product, whose folder is fine', () => cli(root, [], STABLE_PRODUCT), /"dist-v3" is a symbolic link or a junction, not a real folder/);
});

test('F1-RC2: assets go to "assets" and no manifest is written, so no option names another place for a generated file', (t) => {
  const { base, root } = fixture(t);
  mustRefuse(base, 'command line: --manifest with a file name', () => cli(root, ['--manifest', '.git/main.ts']), NO_MANIFEST);
  mustRefuse(base, 'command line: --manifest with a path that leads to a source file', () => cli(root, ['--manifest', 'a/../../src/main.ts']), NO_MANIFEST);
  mustRefuse(base, 'command line: --manifest alone', () => cli(root, ['--manifest']), NO_MANIFEST);
  mustRefuse(base, 'JavaScript API: ssrManifest', () => api(root, { build: { ssrManifest: 'a/../../src/main.ts' } }), /ssrManifest" is set\. A build of this repository writes no manifest/);
  mustRefuse(base, 'command line: --assetsDir .git', () => cli(root, ['--assetsDir', '.git']), ONLY_ASSETS);
  mustRefuse(base, 'command line: --assetsDir with a path that leads to the source folder', () => cli(root, ['--assetsDir', 'a/../../src']), ONLY_ASSETS);
  mustRefuse(base, 'client environment: another assets folder', () => api(root, { environments: { client: { build: { assetsDir: 'static' } } } }), ONLY_ASSETS);
  mustRefuse(base, 'the stable product', () => cli(root, ['--manifest', '.git/main.ts'], STABLE_PRODUCT), NO_MANIFEST);
});

test('F1-RC2: an output folder that holds a ".git" entry is refused: Vite would keep that entry and write through it', (t) => {
  const { base, root } = fixture(t);
  const kept = (dir) => new RegExp(`The output folder "${dir.replaceAll('.', '\\.')}" holds an entry named "\\.git"\\. No output folder of this repository may hold a Git entry`);
  // The arrangement of the review: a real output folder, and inside it ".git" as a link.
  mkdirSync(join(root, 'dist-v3'));
  link(join(root, 'src'), join(root, 'dist-v3', '.git'));
  mkdirSync(join(root, 'dist'));
  link(join(base, 'outside'), join(root, 'dist', '.git'));

  // The three builds that the review reproduced. Each one is refused for its option already.
  mustRefuse(base, 'command line: --manifest .git/main.ts over a link to the source folder', () => cli(root, ['--manifest', '.git/main.ts']), NO_MANIFEST);
  mustRefuse(base, 'JavaScript API: manifest ".git/main.ts" over the same link', () => api(root, { build: { manifest: '.git/main.ts' } }), NO_MANIFEST);
  mustRefuse(base, 'command line: --assetsDir .git over a link to a folder outside', () => cli(root, ['--assetsDir', '.git'], STABLE_PRODUCT), ONLY_ASSETS);

  // Without any option, the entry alone stops the build: nothing may be written into it by any other way.
  mustRefuse(base, 'a plain build of the experimental product', () => cli(root), kept('dist-v3'));
  mustRefuse(base, 'a plain build of the stable product', () => cli(root, [], STABLE_PRODUCT), kept('dist'));
  mustRefuse(base, 'JavaScript API, no option', () => api(root, {}), kept('dist-v3'));
  mustRefuse(base, 'builder API with a shared configuration', () => builder(root, { builder: { sharedConfigBuild: true } }), kept('dist-v3'));

  // A real folder and a file with that name are refused as well, also in a work area.
  mkdirSync(join(root, '.rehearsal', 'kept-folder', '.git'), { recursive: true });
  writeFileSync(join(root, '.rehearsal', 'kept-folder', '.git', 'config'), 'not ours\n');
  mkdirSync(join(root, '.local', 'negative', 'kept-file'), { recursive: true });
  writeFileSync(join(root, '.local', 'negative', 'kept-file', '.git'), 'gitdir: elsewhere\n');
  mustRefuse(base, 'a real folder named ".git" in the output folder', () => api(root, { build: { outDir: '.rehearsal/kept-folder', emptyOutDir: true } }), kept('.rehearsal/kept-folder'));
  mustRefuse(base, 'a file named ".git" in the output folder', () => api(root, { build: { outDir: '.local/negative/kept-file', emptyOutDir: true } }), kept('.local/negative/kept-file'));

  // Every refusal above left both links and what they lead to exactly as they were.
  assert.equal(realpathSync.native(join(root, 'dist-v3', '.git')), join(root, 'src'));
  assert.equal(realpathSync.native(join(root, 'dist', '.git')), join(base, 'outside'));
});

test('Rollup refuses a file name that leaves the output folder, but it judges the text of the name only', async (t) => {
  // This is the part of the boundary that the repository leaves to Rollup, and the reason
  // for the two tests above: a name such as ".git/main.js" is inside the folder as text,
  // whatever lies on disk at that place. Nothing is written here: the bundle is only generated.
  const { rollup } = await import('rollup');
  const bundle = await rollup({
    input: 'entry',
    plugins: [{ name: 'entry', resolveId: (id) => (id === 'entry' ? id : null), load: (id) => (id === 'entry' ? 'export default 1;' : null) }]
  });
  t.after(() => bundle.close());
  await assert.rejects(bundle.generate({ dir: 'dist', entryFileNames: 'a/../../escape.js' }), { code: 'FILE_NAME_OUTSIDE_OUTPUT_DIRECTORY' });
  await assert.rejects(bundle.generate({ dir: 'dist', entryFileNames: '../escape.js' }));
  const { output: [chunk] } = await bundle.generate({ dir: 'dist', entryFileNames: '.git/main.js' });
  assert.equal(chunk.fileName, '.git/main.js');
});
test('both products build into their own folders: a stale file goes, and nothing else changes', (t) => {
  const { base, root } = fixture(t);
  mustBuild(base, 'stable product, command line', () => cli(root, [], STABLE_PRODUCT), 'dist');
  const first = mustBuild(base, 'experimental product, command line', () => cli(root), 'dist-v3');

  writeFileSync(join(root, 'dist-v3', 'stale.txt'), 'left over from an older build\n');
  mkdirSync(join(root, 'dist-v3', 'old'));
  writeFileSync(join(root, 'dist-v3', 'old', 'chunk.js'), 'stale\n');
  const again = mustBuild(base, 'experimental product, JavaScript API, over a stale folder', () => api(root, {}), 'dist-v3');
  assert.deepEqual(again, first);
  // The stable build is still there: emptying one product's folder never touches the other.
  assert.ok(existsSync(join(root, 'dist', 'index.html')));
});

test('the builds of the checks still run: work areas, and Rollup options that are not about output', (t) => {
  const { base, root } = fixture(t);
  const plain = mustBuild(base, 'a plain build', () => cli(root), 'dist-v3');
  // The promotion rehearsal and the negative checks build like this (scripts/rehearse-promotion.mjs, scripts/check-negative.mjs).
  for (const outDir of ['.rehearsal/promotion/build/experimental-v3', '.local/negative/control/dist']) {
    const built = mustBuild(base, `JavaScript API: ${outDir}`, () => api(root, { logLevel: 'info', build: { outDir, emptyOutDir: true } }), outDir);
    assert.deepEqual(built.map((row) => ({ ...row, path: row.path.slice(`repo/${outDir}/`.length) })), plain.map((row) => ({ ...row, path: row.path.slice('repo/dist-v3/'.length) })));
  }
  const tuned = mustBuild(base, 'Rollup options that are not output options', () => api(root, { build: { rollupOptions: { maxParallelFileOps: 4, strictDeprecations: false } } }), 'dist-v3');
  assert.deepEqual(tuned, plain);
  const viaBuilder = mustBuild(base, 'builder API with a shared configuration', () => builder(root, { builder: { sharedConfigBuild: true } }), 'dist-v3');
  assert.deepEqual(viaBuilder, plain);
});
