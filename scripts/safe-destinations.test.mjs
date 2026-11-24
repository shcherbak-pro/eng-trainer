// Regressions for review finding F1 (ENG-V3-01-RC1): a configured folder must never make
// a script empty or delete a source folder, a source file, another product's folder, or
// anything a link or another spelling leads to.
//
// Every test goes through entry points that existed before the correction: the
// configuration validator, the content command, the staging function and the assembly.
// So the same assertions fail on the reviewed code and pass on the corrected code
// (docs/evidence/eng-v3-01-rc1/ holds both runs).
//
// Nothing here can touch the real repository. Each filesystem case builds a disposable
// copy ("fixture") in the system's temporary folder: the scripts next to this file, the
// content sources, and sentinel files that stand for sources. A fixture's links point
// only into the same fixture, and a test compares every file, folder and link of the
// fixture before and after the refused operation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readGeneratedContent } from './content-build.mjs';
import { assembleRoutes } from './site-assembly.mjs';
import { EXPERIMENTAL_PRODUCT, LEGACY_PRODUCT, STABLE_PRODUCT, validateSiteConfig } from './site-config.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(scriptsDir, '..');
const committed = JSON.parse(await readFile(join(sourceRoot, 'site.config.json'), 'utf8'));
const catalogLock = JSON.parse(await readFile(join(sourceRoot, 'src', 'test', 'fixtures', 'released-catalog-v2.lock.json'), 'utf8'));
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

const STAGED = '.variant/experimental-v3/public';

/** Files that stand for sources, static files, the frozen project, documents and builds. */
const SENTINELS = {
  'index.html': '<!doctype html><title>source entry page</title>\n',
  'package.json': '{ "type": "module", "private": true }\n',
  'vite.config.ts': '// build configuration (source)\n',
  'src/main.ts': "import './app/App.svelte';\n",
  'src/app/App.svelte': '<h1>application source</h1>\n',
  'public/favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
  'public/.hidden-static': 'a hidden static file\n',
  'public/fonts/licence.txt': 'font licence (static source)\n',
  'public/data/manifest.json': '{ "generatedFor": "stable-v2" }\n',
  'v1/public/data/materials.json': '{ "frozen": "v1" }\n',
  'v1/dist/index.html': 'legacy build\n',
  'docs/handoff.md': '# documentation\n',
  'docs/experimental-v3/public/evidence.txt': 'a document that a link could expose\n',
  'dist/index.html': 'stable build\n',
  'dist/assets/app.js': 'stable script\n',
  'dist-v3/index.html': 'experimental build\n',
  '../outside/keep.txt': 'a file outside the repository\n'
};

async function write(root, files) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

/**
 * A disposable repository: `base/repo` with the scripts under test, the content sources
 * and the sentinels, and `base/outside` beside it. `config` edits the configuration.
 */
async function fixture(t, { config = () => {} } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'eng-trainer-safe-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'repo');
  await mkdir(join(root, 'scripts'), { recursive: true });
  for (const name of await readdir(scriptsDir)) {
    if (name.endsWith('.mjs') && !name.endsWith('.test.mjs')) await cp(join(scriptsDir, name), join(root, 'scripts', name));
  }
  await cp(join(sourceRoot, 'content'), join(root, 'content'), { recursive: true });
  await write(root, { 'src/content/packFormat.js': await readFile(join(sourceRoot, 'src', 'content', 'packFormat.js'), 'utf8') });
  await write(root, SENTINELS);
  const raw = structuredClone(committed);
  config(raw);
  await writeFile(join(root, 'site.config.json'), `${JSON.stringify(raw, null, 2)}\n`);
  return { base, root, raw };
}

/** A link to a folder: a junction on Windows (no privilege needed), a symbolic link elsewhere. */
const link = (target, path) => symlink(target, path, 'junction');

/** Every folder, file and link below `dir`. Links are recorded, never followed. */
async function snapshot(dir, prefix = '') {
  const rows = [];
  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name);
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) rows.push({ path: `${prefix}${name}`, type: 'link', target: await readlink(path) });
    else if (stats.isDirectory()) rows.push({ path: `${prefix}${name}`, type: 'folder' }, ...await snapshot(path, `${prefix}${name}/`));
    else rows.push({ path: `${prefix}${name}`, type: 'file', bytes: stats.size, sha256: sha256(await readFile(path)) });
  }
  return rows;
}

/** The files of a snapshot as sorted { path, bytes, sha256 } rows. */
const filesOf = (rows) => rows.filter((row) => row.type === 'file').map(({ path, bytes, sha256: hash }) => ({ path, bytes, sha256: hash })).sort((a, b) => (a.path < b.path ? -1 : 1));

/** What differs between two snapshots, as short text. Empty when they are equal. */
function difference(before, after) {
  const was = new Map(before.map((row) => [row.path, JSON.stringify(row)]));
  const now = new Map(after.map((row) => [row.path, JSON.stringify(row)]));
  const changes = [];
  for (const [path, value] of was) {
    if (!now.has(path)) changes.push(`removed ${path}`);
    else if (now.get(path) !== value) changes.push(`changed ${path}`);
  }
  for (const path of now.keys()) if (!was.has(path)) changes.push(`added ${path}`);
  return changes.length > 6 ? [...changes.slice(0, 6), `and ${changes.length - 6} more`] : changes;
}

/** The content command of the experimental product, as `npm run content:generate:v3` runs it. */
function generate(root) {
  const run = spawnSync(process.execPath, [join(root, 'scripts', 'generate-content.mjs'), EXPERIMENTAL_PRODUCT], { cwd: root, encoding: 'utf8' });
  return { refused: run.status !== 0, message: run.stderr, stdout: run.stdout };
}

/** Calls a function that must throw, and reports whether it did. */
async function calling(action) {
  try {
    await action();
    return { refused: false, message: '' };
  } catch (error) {
    return { refused: true, message: String(error?.message) };
  }
}

/** The staging function of the fixture's own copy of the scripts. */
async function stageDirectly(root, site) {
  const { stageProductPublic } = await import(pathToFileURL(join(root, 'scripts', 'product-content.mjs')).href);
  return calling(() => stageProductPublic(site, EXPERIMENTAL_PRODUCT));
}

/**
 * Runs an operation that must be refused for the stated reason, and returns what went
 * wrong: it was not refused, it failed for another reason, or a file, folder or link of
 * the fixture is no longer what it was.
 */
async function mustRefuse(label, base, operation, reason) {
  const before = await snapshot(base);
  const { refused, message } = await operation();
  const changes = difference(before, await snapshot(base));
  return [
    ...(refused ? [] : [`${label}: it was not refused`]),
    ...(refused && !reason.test(message) ? [`${label}: it failed for another reason (${message.trim().split('\n')[0].slice(0, 160)})`] : []),
    ...(changes.length ? [`${label}: the fixture changed (${changes.join('; ')})`] : [])
  ];
}

// ---- Configuration only ------------------------------------------------------------------

/** The eight values of the review, then more spellings, sources and repository files. */
const REVIEWED_VALUES = ['SRC', 'index.html', 'V1/public', 'Dist', 'Public', 'vite.config.ts', 'site.config.json', 'package.json'];
const MORE_VALUES = [
  'Src', 'CONTENT', 'Scripts', 'Docs', 'NODE_MODULES', '.GIT', '.GitHub', 'Site-Dist', '.Site-Test', '.Rehearsal', 'V1', 'v1/DIST',
  'src.', 'README.md', 'CHANGELOG.md', 'package-lock.json', 'tsconfig.json', 'svelte.config.js', 'vitest.config.ts', '.gitignore',
  'index.html/public', 'out', 'generated'
];

/** The attempts that the validator accepted. An accepted attempt is a failure. */
function acceptedAttempts(attempts) {
  const accepted = [];
  for (const [id, key, value] of attempts) {
    const raw = structuredClone(committed);
    raw.products[id][key] = value;
    try {
      validateSiteConfig(raw);
      accepted.push(`${id}.${key} = ${JSON.stringify(value)}`);
    } catch (error) {
      assert.match(error.message, new RegExp(`^site\\.config\\.json: products\\.${id}\\.${key}\\b`), `${id}.${key} = ${JSON.stringify(value)}`);
    }
  }
  return accepted;
}

test('F1: the configuration cannot name a source folder, a source file or another spelling of a folder', () => {
  const attempts = ['publicDir', 'outDir'].flatMap((key) => [...REVIEWED_VALUES, ...MORE_VALUES].map((value) => [EXPERIMENTAL_PRODUCT, key, value]));
  assert.deepEqual(acceptedAttempts(attempts), [], 'these values were accepted');
});

test('F1: no product folder can be redirected, also not to a folder that looks harmless', () => {
  assert.deepEqual(acceptedAttempts([
    [STABLE_PRODUCT, 'outDir', 'Dist'], [STABLE_PRODUCT, 'outDir', 'build'], [STABLE_PRODUCT, 'publicDir', 'Public'], [STABLE_PRODUCT, 'publicDir', 'static'],
    [LEGACY_PRODUCT, 'outDir', 'V1/dist'], [LEGACY_PRODUCT, 'outDir', 'v1/build'],
    [EXPERIMENTAL_PRODUCT, 'outDir', 'dist-v3-next'], [EXPERIMENTAL_PRODUCT, 'outDir', 'Dist-V3'],
    [EXPERIMENTAL_PRODUCT, 'publicDir', '.variant/experimental-v3/Public'], [EXPERIMENTAL_PRODUCT, 'publicDir', '.variant/other/public']
  ]), [], 'these values were accepted');

  // Route promotion changes addresses only. The folders of every product stay where they are.
  const promoted = structuredClone(committed);
  Object.assign(promoted.routes.find((route) => route.product === EXPERIMENTAL_PRODUCT), { path: '', publish: true });
  Object.assign(promoted.routes.find((route) => route.product === STABLE_PRODUCT), { path: 'v2/' });
  assert.deepEqual(validateSiteConfig(promoted).products, committed.products);
});

// ---- Files are preserved: the content command ------------------------------------------

test('F1: the content command refuses an invalid staged folder and leaves every file as it was', async (t) => {
  const problems = [];
  // A protected folder under another spelling, a source file, and the other reviewed values.
  for (const value of REVIEWED_VALUES) {
    const { base, root } = await fixture(t, { config: (raw) => { raw.products[EXPERIMENTAL_PRODUCT].publicDir = value; } });
    problems.push(...await mustRefuse(`publicDir ${JSON.stringify(value)}`, base, () => generate(root), /site\.config\.json: products\.experimental-v3\.publicDir/));
  }
  assert.deepEqual(problems, []);
});

test('F1: the content command refuses an invalid build folder before anything is generated', async (t) => {
  const problems = [];
  for (const value of ['SRC', 'index.html', 'Public', 'V1/dist']) {
    const { base, root } = await fixture(t, { config: (raw) => { raw.products[EXPERIMENTAL_PRODUCT].outDir = value; } });
    problems.push(...await mustRefuse(`outDir ${JSON.stringify(value)}`, base, () => generate(root), /site\.config\.json: products\.experimental-v3\.outDir/));
  }
  assert.deepEqual(problems, []);
});

// ---- Files are preserved: the staging function on its own -----------------------------

test('F1: the staging function refuses every folder but its own, also for a configuration that nothing validated', async (t) => {
  const problems = [];
  const values = ['SRC', 'src', 'index.html', 'package.json', 'public', 'Public', 'v1/public', 'V1/public', 'dist', 'v1/dist', 'docs', 'content', 'scripts', '../outside', '.variant', '.variant/experimental-v3'];
  for (const value of values) {
    const { base, root, raw } = await fixture(t);
    // Handed over as it is: the validator never sees this object.
    raw.products[EXPERIMENTAL_PRODUCT].publicDir = value;
    problems.push(...await mustRefuse(`publicDir ${JSON.stringify(value)}`, base, () => stageDirectly(root, raw), /is staged in "\.variant\/experimental-v3\/public" and nowhere else/));
  }
  assert.deepEqual(problems, []);
});

// ---- Links and files in the place of the generated folder ----------------------------

/** Each case puts something unexpected where the valid, configured staged folder should be. */
const UNEXPECTED_ON_DISK = {
  'a link at ".variant/experimental-v3" that leads to the repository itself, so the staged path is the stable "public/"': async (root) => {
    await mkdir(join(root, '.variant'));
    await link(root, join(root, '.variant', 'experimental-v3'));
  },
  'a link at ".variant" that leads to "docs/"': async (root) => {
    await link(join(root, 'docs'), join(root, '.variant'));
  },
  'a link at the staged folder itself that leads to "src/"': async (root) => {
    await mkdir(join(root, '.variant', 'experimental-v3'), { recursive: true });
    await link(join(root, 'src'), join(root, STAGED));
  },
  'a link at the staged folder itself that leads outside the repository': async (root) => {
    await mkdir(join(root, '.variant', 'experimental-v3'), { recursive: true });
    await link(join(root, '..', 'outside'), join(root, STAGED));
  },
  'a file where the staged folder should be': async (root) => {
    await write(root, { [STAGED]: 'an unexpected file\n' });
  }
};
const NOT_A_REAL_FOLDER = /The generated folder "\.variant\/experimental-v3\/public" cannot be used: "[^"]+" is (?:a symbolic link or a junction, not a real folder|a file, not a folder)\. Nothing was removed or created\./;

test('F1: the content command refuses a staged folder that is a link or a file, or is reached through a link', async (t) => {
  const problems = [];
  for (const [label, arrange] of Object.entries(UNEXPECTED_ON_DISK)) {
    const { base, root } = await fixture(t);
    await arrange(root);
    problems.push(...await mustRefuse(label, base, () => generate(root), NOT_A_REAL_FOLDER));
  }
  assert.deepEqual(problems, []);
});

test('F1: the staging function itself refuses a staged folder that is a link or a file, or is reached through a link', async (t) => {
  const problems = [];
  for (const [label, arrange] of Object.entries(UNEXPECTED_ON_DISK)) {
    const { base, root, raw } = await fixture(t);
    await arrange(root);
    // A valid configuration, and no check of the disk before the call.
    const site = validateSiteConfig(raw);
    problems.push(...await mustRefuse(label, base, () => stageDirectly(root, site), NOT_A_REAL_FOLDER));
  }
  assert.deepEqual(problems, []);
});

// ---- The assembly -------------------------------------------------------------------------

test('F1: the assembly empties only an assembly folder, and never a link or a file', async (t) => {
  const site = validateSiteConfig(structuredClone(committed));
  const routes = site.routes.filter((route) => route.publish);
  const problems = [];

  const targets = ['src', 'SRC', 'public', 'Public', 'docs', 'dist', 'dist-v3', 'v1/dist', STAGED, 'index.html', 'Site-Dist', 'site-dist/../src', '../outside', '.', ''];
  const notAnAssemblyFolder = /is not a generated folder of this repository|is a generated folder for "(?:build|staged-public)"\. Here only "site" or "work" is accepted/;
  for (const target of targets) {
    const { base, root } = await fixture(t);
    problems.push(...await mustRefuse(`target ${JSON.stringify(target)}`, base, () => calling(() => assembleRoutes({ site, routes, target, root })), notAnAssemblyFolder));
  }

  const unexpected = {
    'a link at "site-dist" that leads to "src/"': (root) => link(join(root, 'src'), join(root, 'site-dist')),
    'a link at "site-dist" that leads outside the repository': (root) => link(join(root, '..', 'outside'), join(root, 'site-dist')),
    'a file named "site-dist"': (root) => write(root, { 'site-dist': 'an unexpected file\n' })
  };
  for (const [label, arrange] of Object.entries(unexpected)) {
    const { base, root } = await fixture(t);
    await arrange(root);
    problems.push(...await mustRefuse(label, base, () => calling(() => assembleRoutes({ site, routes, target: 'site-dist', root })), /The generated folder "site-dist" cannot be used: "site-dist" is (?:a symbolic link or a junction, not a real folder|a file, not a folder)/));
  }
  assert.deepEqual(problems, []);
});

// ---- The spellings are real aliases on Windows -------------------------------------------

test('on a disk that ignores case, the tested spellings are the protected folders themselves', { skip: process.platform !== 'win32' && 'this disk distinguishes case; the same values are refused as plain text above' }, async (t) => {
  const { root } = await fixture(t);
  for (const [spelling, folder] of [['SRC', 'src'], ['Public', 'public'], ['V1/public', 'v1/public'], ['Dist', 'dist']]) {
    assert.equal(await realpath(join(root, ...spelling.split('/'))), join(root, ...folder.split('/')), spelling);
  }
});

// ---- The legitimate folders still work -----------------------------------------------------

test('the staged folder of the experimental product is regenerated: complete, separate, and without stale files', async (t) => {
  const { base, root } = await fixture(t);
  const staged = join(root, ...STAGED.split('/'));
  // Files of an earlier run or of another product must not survive staging.
  await write(root, {
    [`${STAGED}/data/packs/stale-pack.0000000000000000.json`]: '{}',
    [`${STAGED}/data/manifest.json`]: '{ "stale": true }',
    [`${STAGED}/stale.txt`]: 'stale',
    [`${STAGED}/.hidden`]: 'stale',
    [`${STAGED}/old/deep/file.txt`]: 'stale'
  });
  const outside = async () => (await snapshot(base)).filter((row) => !row.path.startsWith('repo/.variant'));
  const before = await outside();

  const expected = [
    ...filesOf(await snapshot(join(root, 'public'))).filter((file) => !file.path.startsWith('data/')),
    { path: 'data/manifest.json', bytes: catalogLock.manifestBytes, sha256: catalogLock.manifestSha256 },
    ...catalogLock.packs.map((pack) => ({ path: `data/${pack.url}`, bytes: pack.bytes, sha256: pack.sha256 }))
  ].sort((a, b) => (a.path < b.path ? -1 : 1));

  // Twice: the first run replaces the stale folder, the second one a folder it wrote itself.
  for (const round of ['first run', 'second run']) {
    const run = generate(root);
    assert.equal(run.refused, false, `${round}: ${run.message}`);
    assert.match(run.stdout, /Generated 14 built-in packs for experimental-v3/);
    const rows = await snapshot(staged);
    assert.deepEqual(filesOf(rows), expected, round);
    assert.equal(rows.some((row) => row.type === 'link'), false);
  }
  for (const path of ['favicon.svg', 'fonts/licence.txt', '.hidden-static']) assert.ok(expected.some((file) => file.path === path), path);
  for (const stale of ['stale.txt', '.hidden', 'old']) assert.equal(existsSync(join(staged, stale)), false, stale);

  // The published files validate as a catalog. Nothing else in the repository changed:
  // not the stable public folder, not its generated data, not a source and not a build.
  const { manifest } = await readGeneratedContent(join(staged, 'data'));
  assert.equal(manifest.packs.length, 14);
  assert.deepEqual(difference(before, await outside()), []);
});

test('the staged folder is created when it does not exist yet, and the assembly still fills its own folders', async (t) => {
  const { base, root } = await fixture(t);
  assert.equal(existsSync(join(root, '.variant')), false);
  assert.equal(generate(root).refused, false);
  assert.equal(existsSync(join(root, ...STAGED.split('/'), 'data', 'manifest.json')), true);

  const site = validateSiteConfig(structuredClone(committed));
  await write(root, { 'site-dist/stale.txt': 'old', '.site-test/stale.txt': 'old' });
  const sources = async () => (await snapshot(base)).filter((row) => !/^repo\/(?:site-dist|\.site-test|\.variant)(?:\/|$)/.test(row.path));
  const before = await sources();
  await assembleRoutes({ site, routes: site.routes.filter((route) => route.publish), target: 'site-dist', root });
  await assembleRoutes({ site, routes: site.routes, target: '.site-test', root });
  assert.deepEqual(filesOf(await snapshot(join(root, 'site-dist'))).map((file) => file.path), ['assets/app.js', 'index.html', 'v1/index.html']);
  assert.deepEqual(filesOf(await snapshot(join(root, '.site-test'))).map((file) => file.path), ['assets/app.js', 'index.html', 'v1/index.html', 'v3/index.html']);
  assert.deepEqual(difference(before, await sources()), []);
});
