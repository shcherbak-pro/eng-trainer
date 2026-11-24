// Tests of the shared guard for generated folders (ENG-V3-01-RC1, RC2).
// The regressions for the review findings themselves are in safe-destinations.test.mjs
// (staging and assembly) and build-destinations.test.mjs (real Vite builds).
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  EXPERIMENTAL_BUILD_DIR, EXPERIMENTAL_PUBLIC_DIR, GENERATED_DIRS, NEGATIVE_WORK_DIR, PRODUCTION_SITE_DIR, REHEARSAL_WORK_DIR, STABLE_BUILD_DIR, TEST_SITE_DIR, WORK_AREAS,
  BUILD_ASSETS_DIR, assertBuildDestinations, assertBuildOutDir, assertGeneratedDir, generatedDirUse, removeGeneratedDir
} from './generated-dirs.mjs';
import { EXPERIMENTAL_PRODUCT, LEGACY_PRODUCT, STABLE_PRODUCT, loadSiteConfig, repoRoot } from './site-config.mjs';

const ALL_USES = ['build', 'staged-public', 'site', 'work'];

/** A temporary folder that stands for a repository, with sentinel sources. */
async function tempRepo(t, files = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'eng-trainer-dirs-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'repo');
  await write(root, { 'src/main.ts': 'source', 'index.html': 'entry', '../outside/keep.txt': 'outside', ...files });
  return root;
}

async function write(root, files) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

/** Every entry below a folder, as sorted text. Links are listed, not followed. */
function tree(dir, prefix = '') {
  return readdirSync(dir).sort().flatMap((name) => {
    const stats = lstatSync(join(dir, name));
    if (stats.isSymbolicLink()) return [`${prefix}${name} -> link`];
    return stats.isDirectory() ? [`${prefix}${name}/`, ...tree(join(dir, name), `${prefix}${name}/`)] : [`${prefix}${name}`];
  });
}

const link = (target, path) => symlink(target, path, 'junction');

test('the list of generated folders is exact, small and frozen', () => {
  assert.deepEqual(GENERATED_DIRS, {
    dist: 'build',
    'dist-v3': 'build',
    '.variant/experimental-v3/public': 'staged-public',
    'site-dist': 'site',
    '.site-test': 'site'
  });
  assert.deepEqual(WORK_AREAS, ['.rehearsal', '.local/negative']);
  assert.deepEqual([STABLE_BUILD_DIR, EXPERIMENTAL_BUILD_DIR, EXPERIMENTAL_PUBLIC_DIR, PRODUCTION_SITE_DIR, TEST_SITE_DIR, REHEARSAL_WORK_DIR, NEGATIVE_WORK_DIR],
    ['dist', 'dist-v3', '.variant/experimental-v3/public', 'site-dist', '.site-test', '.rehearsal', '.local/negative']);
  assert.ok(Object.isFrozen(GENERATED_DIRS) && Object.isFrozen(WORK_AREAS));
});

test('the committed configuration names exactly these folders, and no script can remove the others', () => {
  const site = loadSiteConfig();
  assert.equal(site.products[STABLE_PRODUCT].outDir, STABLE_BUILD_DIR);
  assert.equal(site.products[EXPERIMENTAL_PRODUCT].outDir, EXPERIMENTAL_BUILD_DIR);
  assert.equal(site.products[EXPERIMENTAL_PRODUCT].publicDir, EXPERIMENTAL_PUBLIC_DIR);
  // The stable public folder holds sources, and the frozen project builds itself: neither is on the list.
  for (const dir of [site.products[STABLE_PRODUCT].publicDir, site.products[LEGACY_PRODUCT].outDir, 'public/data', 'v1']) {
    assert.throws(() => generatedDirUse(dir), /is not a generated folder of this repository/, dir);
  }
});

test('every generated folder is ignored by Git, and none shares a name with a source of the repository', async () => {
  const ignored = (await readFile(join(repoRoot, '.gitignore'), 'utf8')).split(/\r?\n/).map((line) => line.trim().replace(/^\//, '').replace(/\/$/, '')).filter((line) => line && !line.startsWith('#'));
  const generated = [...Object.keys(GENERATED_DIRS), ...WORK_AREAS];
  for (const dir of generated) {
    assert.ok(ignored.some((rule) => dir === rule || dir.startsWith(`${rule}/`)), `${dir} must be ignored by Git`);
  }
  // No generated folder lies inside another one, so emptying one never empties another.
  for (const a of generated) {
    for (const b of generated) assert.equal(a !== b && a.toLowerCase().startsWith(`${b.toLowerCase()}/`), false, `${a} lies inside ${b}`);
  }
  // Sources and tools at the top of the repository. On a disk that ignores case, a generated
  // folder with the same letters would be the source itself.
  const top = new Set(generated.map((dir) => dir.split('/')[0].toLowerCase()));
  const sources = ['src', 'content', 'scripts', 'docs', 'public', 'v1', 'node_modules', '.git', '.github',
    ...(await readdir(repoRoot, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name)];
  for (const name of sources) assert.equal(top.has(name.toLowerCase()), false, name);
  for (const name of ['index.html', 'package.json', 'site.config.json', 'vite.config.ts']) assert.ok(sources.includes(name), name);
});

test('a generated folder is recognised by its exact text only', () => {
  assert.equal(generatedDirUse('dist'), 'build');
  assert.equal(generatedDirUse('.variant/experimental-v3/public'), 'staged-public');
  assert.equal(generatedDirUse('.rehearsal'), 'work');
  assert.equal(generatedDirUse('.rehearsal/promotion/build/stable-v2'), 'work');
  assert.equal(generatedDirUse('.local/negative/leak-guard-removed/dist'), 'work');

  const others = [
    // Other spellings of listed folders.
    'Dist', 'DIST', 'dist/', './dist', 'dist/.', ' dist', 'dist ', 'dist.', 'dist\\', 'Dist-V3', 'Site-Dist', '.Site-Test', '.Rehearsal', '.Local/negative', '.local/Negative',
    '.variant/experimental-v3/Public', '.variant\\experimental-v3\\public', '.variant//experimental-v3/public', '.variant/./experimental-v3/public',
    // Paths that only lead to a listed folder, and parts of one.
    'src/../dist', 'dist/../dist', 'dist/assets', 'dist-v3/v3', 'site-dist/v1', '.variant', '.variant/experimental-v3', '.variant/experimental-v3/public/data', '.local',
    // Sources, files and everything else.
    'src', 'SRC', 'public', 'Public', 'public/data', 'v1', 'v1/dist', 'V1/public', 'content', 'scripts', 'docs', 'node_modules', '.git',
    'index.html', 'package.json', 'site.config.json', 'vite.config.ts', '', '.', '..', '../dist', '/dist', 'C:/dist', 'C:\\dist', 'out',
    // Below a work area, a name is lower-case words joined by hyphens.
    '.rehearsal/', '.rehearsal/..', '.rehearsal/../src', '.rehearsal/./x', '.rehearsal//x', '.rehearsal/Promotion', '.rehearsal/a b', '.rehearsal/x.', '.rehearsal/.x', '.rehearsal/x~1',
    '.rehearsal\\x', '.local/negative/../astra', '.local/negative/..', '.local/negativ', '.local/negative-2', '.rehearsalx',
    // Not text.
    undefined, null, 7, true, ['dist'], { dir: 'dist' }
  ];
  for (const value of others) assert.throws(() => generatedDirUse(value), /is not a generated folder of this repository, so no script may empty or delete it/, JSON.stringify(value) ?? String(value));
});

test('each caller accepts only the uses it names', async (t) => {
  const root = await tempRepo(t);
  const accepted = { dist: 'build', 'dist-v3': 'build', '.variant/experimental-v3/public': 'staged-public', 'site-dist': 'site', '.site-test': 'site', '.rehearsal/rollback/site': 'work', '.local/negative': 'work' };
  for (const [dir, use] of Object.entries(accepted)) {
    assert.deepEqual(assertGeneratedDir(root, dir, [use]), { path: join(root, ...dir.split('/')), exists: false });
    for (const other of ALL_USES.filter((item) => item !== use)) {
      assert.throws(() => assertGeneratedDir(root, dir, [other]), new RegExp(`is a generated folder for "${use}"\\. Here only "${other}" is accepted\\.`), `${dir} as ${other}`);
    }
    assert.throws(() => assertGeneratedDir(root, dir, []), /Here only {2}is accepted/);
  }
  assert.throws(() => assertGeneratedDir(root, 'src', ALL_USES), /is not a generated folder/);
  assert.deepEqual(tree(dirname(root)), ['outside/', 'outside/keep.txt', 'repo/', 'repo/index.html', 'repo/src/', 'repo/src/main.ts']);
});

test('a folder that does not exist yet is accepted, and a real folder is accepted as existing', async (t) => {
  const root = await tempRepo(t, { '.variant/keep.txt': 'x', 'dist/index.html': 'build', '.rehearsal/promotion/site/index.html': 'site' });
  assert.deepEqual(assertGeneratedDir(root, 'dist', ['build']), { path: join(root, 'dist'), exists: true });
  assert.deepEqual(assertGeneratedDir(root, '.rehearsal/promotion/site', ['work']), { path: join(root, '.rehearsal', 'promotion', 'site'), exists: true });
  // Only the first part exists: the caller creates the rest.
  assert.deepEqual(assertGeneratedDir(root, EXPERIMENTAL_PUBLIC_DIR, ['staged-public']), { path: join(root, '.variant', 'experimental-v3', 'public'), exists: false });
  assert.equal(existsSync(join(root, '.variant', 'experimental-v3')), false);
});

test('a link or a file anywhere on the path is refused, and nothing changes', async (t) => {
  const cases = {
    'the folder itself is a link to a source folder': [(root) => link(join(root, 'src'), join(root, 'dist-v3')), 'dist-v3', ['build'], /"dist-v3" is a symbolic link or a junction, not a real folder/],
    'the folder itself is a link to a folder outside': [(root) => link(join(root, '..', 'outside'), join(root, 'site-dist')), 'site-dist', ['site'], /"site-dist" is a symbolic link or a junction/],
    'the folder itself is a link that leads nowhere': [(root) => link(join(root, 'missing'), join(root, 'dist')), 'dist', ['build'], /"dist" is a symbolic link or a junction/],
    'the first part is a link': [(root) => link(join(root, 'src'), join(root, '.variant')), EXPERIMENTAL_PUBLIC_DIR, ['staged-public'], /"\.variant" is a symbolic link or a junction/],
    'a middle part is a link to the repository itself': [async (root) => { await mkdir(join(root, '.variant')); await link(root, join(root, '.variant', 'experimental-v3')); }, EXPERIMENTAL_PUBLIC_DIR, ['staged-public'], /"\.variant\/experimental-v3" is a symbolic link or a junction/],
    'a work area is a link': [(root) => link(join(root, 'src'), join(root, '.rehearsal')), '.rehearsal/promotion/site', ['work'], /"\.rehearsal" is a symbolic link or a junction/],
    'the parent of a work area is a link': [(root) => link(join(root, 'src'), join(root, '.local')), '.local/negative', ['work'], /"\.local" is a symbolic link or a junction/],
    'the folder itself is a file': [(root) => write(root, { 'dist-v3': 'a file' }), 'dist-v3', ['build'], /"dist-v3" is a file, not a folder/],
    'the first part is a file': [(root) => write(root, { '.variant': 'a file' }), EXPERIMENTAL_PUBLIC_DIR, ['staged-public'], /"\.variant" is a file, not a folder/],
    'a middle part is a file': [(root) => write(root, { '.variant/experimental-v3': 'a file' }), EXPERIMENTAL_PUBLIC_DIR, ['staged-public'], /"\.variant\/experimental-v3" is a file, not a folder/]
  };
  for (const [label, [arrange, dir, uses, pattern]] of Object.entries(cases)) {
    const root = await tempRepo(t);
    await arrange(root);
    const before = tree(dirname(root));
    assert.throws(() => assertGeneratedDir(root, dir, uses), pattern, label);
    await assert.rejects(removeGeneratedDir(root, dir, uses), /Nothing was removed or created\. Look at it by hand: the scripts never repair this\.$/, label);
    assert.deepEqual(tree(dirname(root)), before, label);
    assert.equal(await readFile(join(root, 'src', 'main.ts'), 'utf8'), 'source', label);
    assert.equal(await readFile(join(root, '..', 'outside', 'keep.txt'), 'utf8'), 'outside', label);
  }
});

test('a folder that the disk holds under another spelling is refused where the disk ignores case, and left alone elsewhere', async (t) => {
  const root = await tempRepo(t, { 'DIST-V3/keep.txt': 'not ours', '.Variant/experimental-v3/public/keep.txt': 'not ours' });
  const before = tree(root);
  const ignoresCase = existsSync(join(root, 'dist-v3'));
  if (ignoresCase) {
    assert.throws(() => assertGeneratedDir(root, 'dist-v3', ['build']), /"dist-v3" exists on disk under another spelling/);
    await assert.rejects(removeGeneratedDir(root, EXPERIMENTAL_PUBLIC_DIR, ['staged-public']), /"\.variant" exists on disk under another spelling/);
  } else {
    // Here they are other folders: the generated one does not exist, and nothing is removed.
    assert.equal(assertGeneratedDir(root, 'dist-v3', ['build']).exists, false);
    await removeGeneratedDir(root, EXPERIMENTAL_PUBLIC_DIR, ['staged-public']);
  }
  assert.deepEqual(tree(root), before);
});

test('removal deletes the generated folder with its content and nothing beside it', async (t) => {
  const root = await tempRepo(t, {
    'site-dist/index.html': 'old', 'site-dist/.hidden': 'old', 'site-dist/v1/deep/file.txt': 'old', 'site-distx/keep.txt': 'beside',
    '.local/negative/control/index.html': 'old', '.local/review-copy/keep.txt': 'another owner'
  });
  assert.equal(await removeGeneratedDir(root, 'site-dist', ['site']), join(root, 'site-dist'));
  assert.equal(await removeGeneratedDir(root, '.local/negative', ['work']), join(root, '.local', 'negative'));
  // A folder that is not there is not an error, and nothing is created for it.
  assert.equal(await removeGeneratedDir(root, 'dist-v3', ['build']), join(root, 'dist-v3'));
  assert.deepEqual(tree(root), ['.local/', '.local/review-copy/', '.local/review-copy/keep.txt', 'index.html', 'site-distx/', 'site-distx/keep.txt', 'src/', 'src/main.ts']);
});

test('a link inside a generated folder is removed as a link: what it leads to stays', async (t) => {
  const root = await tempRepo(t, { 'dist/index.html': 'build', 'dist/assets/app.js': 'script' });
  await link(join(root, 'src'), join(root, 'dist', 'to-sources'));
  await link(join(root, '..', 'outside'), join(root, 'dist', 'assets', 'to-outside'));
  await removeGeneratedDir(root, 'dist', ['build']);
  assert.deepEqual(tree(dirname(root)), ['outside/', 'outside/keep.txt', 'repo/', 'repo/index.html', 'repo/src/', 'repo/src/main.ts']);
});

test('a build may write to a product build folder or a work area, and to nothing else', async (t) => {
  const root = await tempRepo(t, { 'dist/index.html': 'build' });
  assert.deepEqual(assertBuildOutDir(root, 'dist'), { path: join(root, 'dist'), exists: true });
  assert.equal(assertBuildOutDir(root, join(root, 'dist-v3')).exists, false);
  assert.equal(assertBuildOutDir(root, '.rehearsal/promotion/build/experimental-v3').exists, false);
  assert.equal(assertBuildOutDir(root, '.local/negative/leak-static-import/dist').exists, false);
  // Vite resolves the folder before it empties it; the resolved folder is what counts.
  assert.equal(assertBuildOutDir(root, './dist').exists, true);
  assert.equal(assertBuildOutDir(root, 'dist-v3/../dist').exists, true);

  const refused = ['src', 'SRC', 'Dist', 'public', 'v1/dist', 'index.html', 'site-dist', '.site-test', EXPERIMENTAL_PUBLIC_DIR, 'dist/../src', 'dist/assets', '', '.', '..', '../outside', join(root, 'src'), join(root, '..', 'outside'), 'not-a-generated-folder'];
  for (const outDir of refused) {
    assert.throws(() => assertBuildOutDir(root, outDir), /is not a generated folder of this repository|Here only "build" or "work" is accepted/, JSON.stringify(outDir));
  }
  await link(join(root, 'src'), join(root, 'dist-v3'));
  assert.throws(() => assertBuildOutDir(root, 'dist-v3'), /"dist-v3" is a symbolic link or a junction/);
});

test('a build has one destination: no Rollup output option and no skipped emptying, in any set of build options', async (t) => {
  const root = await tempRepo(t, { 'dist-v3/index.html': 'build' });
  // The shape Vite 6 resolves: the top-level options, and one set for each environment.
  const options = (extra = {}) => ({ outDir: 'dist-v3', emptyOutDir: null, assetsDir: 'assets', manifest: false, ssrManifest: false, rollupOptions: {}, ...extra });
  const config = ({ top = {}, client = {}, ssr } = {}) => ({ root, build: options(top), environments: { client: { build: options(client) }, ...(ssr ? { ssr: { build: options(ssr) } } : {}) } });
  const before = tree(dirname(root));

  for (const accepted of [
    config(),
    config({ top: { emptyOutDir: true }, client: { emptyOutDir: true } }),
    config({ top: { rollupOptions: { treeshake: false, external: ['x'], output: undefined } } }),
    config({ top: { outDir: '.rehearsal/promotion/build/stable-v2' }, client: { outDir: '.local/negative/control/dist' } }),
    config({ ssr: {} })
  ]) assert.equal(assertBuildDestinations(accepted), undefined);

  const outputs = [{ dir: 'src' }, { dir: 'dist-v3' }, { dir: join(root, 'src') }, [{ dir: 'dist-v3' }, { dir: 'src' }], [{ dir: 'src' }, { dir: 'dist-v3' }], [], [{}], {}, { file: 'src/main.ts' }, { entryFileNames: 'app.js' }, { output: { dir: 'src' } }, null, 'src', false, 0];
  for (const output of outputs) {
    for (const [set, value] of [['build', config({ top: { rollupOptions: { output } } })], ['environments.client.build', config({ client: { rollupOptions: { output } } })], ['environments.ssr.build', config({ ssr: { rollupOptions: { output } } })]]) {
      assert.throws(() => assertBuildDestinations(value), new RegExp(`^Error: "${set.replaceAll('.', '\\.')}\\.rollupOptions\\.output" is set\\. A build of this repository accepts no Rollup output option.* The build stopped before any folder was emptied\\.$`), `${set} ${JSON.stringify(output)}`);
    }
  }
  for (const [set, value] of [['build', config({ top: { emptyOutDir: false } })], ['environments.client.build', config({ client: { emptyOutDir: false } })], ['environments.ssr.build', config({ ssr: { emptyOutDir: false } })]]) {
    assert.throws(() => assertBuildDestinations(value), new RegExp(`^Error: "${set.replaceAll('.', '\\.')}\\.emptyOutDir" is false\\. A build of this repository always empties its output folder first`), set);
  }
  for (const value of [config({ top: { outDir: 'src' } }), config({ client: { outDir: 'SRC' } }), config({ ssr: { outDir: join(root, 'src') } }), config({ client: { outDir: 'site-dist' } })]) {
    assert.throws(() => assertBuildDestinations(value), /is not a generated folder of this repository|Here only "build" or "work" is accepted/);
  }
  // Without the sets of Vite 6 nothing can be checked, so nothing is accepted.
  assert.throws(() => assertBuildDestinations({ root, build: options() }));
  assert.throws(() => assertBuildDestinations({ root, build: options(), environments: { client: {} } }));
  assert.deepEqual(tree(dirname(root)), before);
});

test('a build writes its assets to "assets" and no manifest: no option names another place for a generated file', async (t) => {
  const root = await tempRepo(t, { 'dist-v3/index.html': 'build' });
  const options = (extra = {}) => ({ outDir: 'dist-v3', emptyOutDir: null, assetsDir: 'assets', manifest: false, ssrManifest: false, rollupOptions: {}, ...extra });
  const inEachSet = (extra) => [
    ['build', { root, build: options(extra), environments: { client: { build: options() } } }],
    ['environments.client.build', { root, build: options(), environments: { client: { build: options(extra) } } }],
    ['environments.ssr.build', { root, build: options(), environments: { client: { build: options() }, ssr: { build: options(extra) } } }]
  ];
  const before = tree(dirname(root));
  assert.equal(BUILD_ASSETS_DIR, 'assets');

  for (const assetsDir of ['.git', 'static', '', '.', 'assets/', './assets', 'Assets', 'assets/..', '../src', 'a/../../src', join(root, 'src'), undefined, null, false]) {
    for (const [set, config] of inEachSet({ assetsDir })) {
      assert.throws(() => assertBuildDestinations(config), new RegExp(`^Error: "${set.replaceAll('.', '\\.')}\\.assetsDir" is .*\\. A build of this repository writes its assets to "assets" below its output folder and nowhere else\\. The build stopped before any folder was emptied\\.$`), `${set} ${JSON.stringify(assetsDir)}`);
    }
  }
  for (const option of ['manifest', 'ssrManifest']) {
    for (const value of [true, '.git/main.ts', 'manifest.json', 'a/../../src/main.ts', join(root, 'src', 'main.ts'), '', undefined, null, 0]) {
      for (const [set, config] of inEachSet({ [option]: value })) {
        assert.throws(() => assertBuildDestinations(config), new RegExp(`^Error: "${set.replaceAll('.', '\\.')}\\.${option}" is set\\. A build of this repository writes no manifest, so no option may name a file for one\\. The build stopped before any folder was emptied\\.$`), `${set} ${option} ${JSON.stringify(value)}`);
      }
    }
  }
  assert.deepEqual(tree(dirname(root)), before);
});

test('an output folder that holds a ".git" entry is refused, whatever the entry is, and the entry stays as it is', async (t) => {
  const options = (outDir) => ({ outDir, emptyOutDir: null, assetsDir: 'assets', manifest: false, ssrManifest: false, rollupOptions: {} });
  const config = (root, outDir = 'dist-v3') => ({ root, build: options(outDir), environments: { client: { build: options(outDir) } } });
  const refusal = (dir, name = '\\.git') => new RegExp(`^Error: The output folder "${dir}" holds an entry named "${name}"\\. No output folder of this repository may hold a Git entry: Vite does not remove "\\.git" when it empties the folder, so a build could write into it, or through it if it is a link\\. Nothing was removed or changed\\. Look at it by hand: the scripts never repair this\\.$`);

  const cases = {
    'a link to the source folder': [(root) => link(join(root, 'src'), join(root, 'dist-v3', '.git')), 'dist-v3'],
    'a link to a folder outside the repository': [(root) => link(join(root, '..', 'outside'), join(root, 'dist-v3', '.git')), 'dist-v3'],
    'a link that leads nowhere': [(root) => link(join(root, 'missing'), join(root, 'dist-v3', '.git')), 'dist-v3'],
    'a real folder': [(root) => write(root, { 'dist-v3/.git/config': 'not ours' }), 'dist-v3'],
    'a file': [(root) => write(root, { 'dist-v3/.git': 'gitdir: elsewhere' }), 'dist-v3'],
    'in the stable build folder': [(root) => link(join(root, 'src'), join(root, 'dist', '.git')), 'dist'],
    'in a work-area folder': [(root) => write(root, { '.rehearsal/promotion/build/stable-v2/.git/config': 'not ours' }), '.rehearsal/promotion/build/stable-v2']
  };
  for (const [label, [arrange, dir]] of Object.entries(cases)) {
    const root = await tempRepo(t, { 'dist-v3/index.html': 'build', 'dist/index.html': 'build' });
    await arrange(root);
    const before = tree(dirname(root));
    assert.throws(() => assertBuildDestinations(config(root, dir)), refusal(dir.replaceAll('.', '\\.')), label);
    // The folder as Vite resolves it from other spellings is the same folder.
    assert.throws(() => assertBuildDestinations(config(root, `./${dir}`)), refusal(dir.replaceAll('.', '\\.')), label);
    assert.deepEqual(tree(dirname(root)), before, label);
    assert.equal(await readFile(join(root, 'src', 'main.ts'), 'utf8'), 'source', label);
    assert.equal(await readFile(join(root, '..', 'outside', 'keep.txt'), 'utf8'), 'outside', label);
  }

  // Another spelling of the name is refused as well, wherever the disk can hold it.
  {
    const root = await tempRepo(t, { 'dist-v3/.GIT/config': 'not ours' });
    assert.throws(() => assertBuildDestinations(config(root)), refusal('dist-v3', '\\.GIT'));
  }
  // A ".git" deeper inside the folder is not kept by Vite: the folder is emptied with it. The same holds for other names.
  {
    const root = await tempRepo(t, { 'dist-v3/assets/.git/config': 'stale', 'dist-v3/.gitignore': 'stale', 'dist-v3/git/x': 'stale' });
    await link(join(root, 'src'), join(root, 'dist-v3', 'data'));
    assert.equal(assertBuildDestinations(config(root)), undefined);
  }
  // A folder that does not exist yet holds nothing.
  {
    const root = await tempRepo(t);
    assert.equal(assertBuildDestinations(config(root)), undefined);
  }
});

test('the reader of the configuration checks the product folders on disk', async () => {
  const source = await readFile(join(repoRoot, 'scripts', 'site-config.mjs'), 'utf8');
  const load = source.slice(source.indexOf('export function loadSiteConfig()'));
  assert.match(load.slice(0, load.indexOf('\n}\n')), /const site = validateSiteConfig\(raw\);\s+verifyProductFolders\(site\);\s+return site;/);
  assert.match(source, /assertGeneratedDir\(repoRoot, product\[key\], \[use\]\)/);
  // In this checkout the folders are absent or real folders, so the reader accepts them.
  const site = loadSiteConfig();
  for (const [dir, use] of [[site.products[STABLE_PRODUCT].outDir, 'build'], [site.products[EXPERIMENTAL_PRODUCT].outDir, 'build'], [site.products[EXPERIMENTAL_PRODUCT].publicDir, 'staged-public']]) {
    assert.equal(typeof assertGeneratedDir(repoRoot, dir, [use]).exists, 'boolean');
  }
});

test('every recursive removal of the scripts goes through the guard, and every build through its check', async () => {
  const scripts = (await readdir(join(repoRoot, 'scripts'))).filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'));
  const removing = [];
  for (const name of scripts) {
    const source = await readFile(join(repoRoot, 'scripts', name), 'utf8');
    if (/\brm(?:Sync)?\([^;]*recursive|\brmdir(?:Sync)?\(|\bforce:\s*true/.test(source)) removing.push(name);
  }
  assert.deepEqual(removing, ['generated-dirs.mjs']);
  const guard = await readFile(join(repoRoot, 'scripts', 'generated-dirs.mjs'), 'utf8');
  assert.equal([...guard.matchAll(/\brm\(/g)].length, 1);
  assert.match(guard, /const \{ path, exists \} = assertGeneratedDir\(root, dir, uses\);\s+if \(exists\) await rm\(path, \{ recursive: true \}\);/);
  assert.equal(/force\s*:/.test(guard), false, 'the guard never forces a removal');

  // Vite empties its output folder itself. The build configuration checks the resolved
  // build options first, for both products and for the builds of the rehearsal and of the
  // negative checks. The real builds are in build-destinations.test.mjs.
  const config = await readFile(join(repoRoot, 'vite.config.ts'), 'utf8');
  assert.match(config, /apply: 'build',\s+configResolved\(config\) \{\s+assertBuildDestinations\(config\);/);
  assert.match(config, /plugins: \[svelte\(\), ownedOutputFolder\(\), /);
  assert.match(guard, /for \(const \[name, build\] of sets\) \{[^]*?const \{ path, exists \} = assertBuildOutDir\(config\.root, build\.outDir\);\s+const kept = exists \? readdirSync\(path\)/);
});
