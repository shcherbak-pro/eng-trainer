import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  EXPERIMENTAL_PRODUCT, LEGACY_PRODUCT, STABLE_PRODUCT,
  appProducts, loadSiteConfig, productBuild, publishedRoutes, repoRoot, routeOf, routeUrl, validateSiteConfig, versionLinks
} from './site-config.mjs';

const site = loadSiteConfig();
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');

/** A changed copy of the committed configuration. */
const changed = (edit) => {
  const raw = structuredClone(site);
  edit(raw);
  return raw;
};
const rejects = (edit, pattern) => assert.throws(() => validateSiteConfig(changed(edit)), pattern);
const routeFor = (raw, product) => raw.routes.find((route) => route.product === product);

test('the committed configuration is valid and names three products with one route each', () => {
  assert.deepEqual(Object.keys(site.products).sort(), [EXPERIMENTAL_PRODUCT, LEGACY_PRODUCT, STABLE_PRODUCT].sort());
  assert.deepEqual(site.routes.map(({ path, product }) => [path, product]), [['', STABLE_PRODUCT], ['v1/', LEGACY_PRODUCT], ['v3/', EXPERIMENTAL_PRODUCT]]);
  assert.equal(site.base, '/eng-trainer/');
  assert.deepEqual(appProducts(site), [STABLE_PRODUCT, EXPERIMENTAL_PRODUCT]);
  assert.equal(routeUrl(site, routeOf(site, LEGACY_PRODUCT)), '/eng-trainer/v1/');
});

test('stable defaults are explicit: the released database, folders and no pronunciation capability', () => {
  assert.deepEqual(site.products[STABLE_PRODUCT], { database: 'eng-trainer-v2', pronunciation: false, publicDir: 'public', outDir: 'dist' });
  const stable = productBuild(site, STABLE_PRODUCT);
  assert.equal(stable.base, '/eng-trainer/');
  assert.equal(stable.publicDir, 'public');
  assert.equal(stable.outDir, 'dist');
  assert.deepEqual(stable.define, {
    __SITE_BASE__: '"/eng-trainer/"',
    __ENG_PRODUCT__: '"stable-v2"',
    __ENG_DATABASE__: '"eng-trainer-v2"',
    __ENG_PRONUNCIATION__: 'false',
    __ENG_VERSION_LINKS__: '[{"product":"legacy-v1","href":"/eng-trainer/v1/"}]'
  });
});

test('without ENG_PRODUCT the build is the stable product; the experimental one must be asked for by name', () => {
  const config = read('vite.config.ts');
  assert.match(config, /productBuild\(loadSiteConfig\(\), process\.env\.ENG_PRODUCT \?\? STABLE_PRODUCT\)/);
  // ENG_PRODUCT is the only environment variable the build configuration reads.
  assert.deepEqual([...config.matchAll(/process\.env\.(\w+)/g)].map((match) => match[1]), ['ENG_PRODUCT']);
  assert.throws(() => productBuild(site, 'experimental-v4'), /unknown product "experimental-v4"/);
  assert.throws(() => productBuild(site, LEGACY_PRODUCT), /frozen project/);
  assert.throws(() => productBuild(site, ''), /unknown product/);
});

test('the experimental product has its own database, folders and base path, and the capability constant', () => {
  const experimental = productBuild(site, EXPERIMENTAL_PRODUCT);
  assert.equal(experimental.base, '/eng-trainer/v3/');
  assert.equal(experimental.outDir, 'dist-v3');
  assert.equal(experimental.publicDir, '.variant/experimental-v3/public');
  assert.equal(experimental.define.__ENG_DATABASE__, '"eng-trainer-v3"');
  assert.equal(experimental.define.__ENG_PRODUCT__, '"experimental-v3"');
  assert.equal(experimental.define.__ENG_PRONUNCIATION__, 'true');
  assert.equal(experimental.define.__SITE_BASE__, '"/eng-trainer/"');
  assert.deepEqual(versionLinks(site, EXPERIMENTAL_PRODUCT), [
    { product: STABLE_PRODUCT, href: '/eng-trainer/' },
    { product: LEGACY_PRODUCT, href: '/eng-trainer/v1/' }
  ]);
});

test('ENG-V3-01: the experimental route is committed as unpublished, and only published routes are assembled', () => {
  // Publishing /v3/ needs a new, owner-approved change of site.config.json and of this test.
  assert.equal(routeOf(site, EXPERIMENTAL_PRODUCT).publish, false);
  assert.deepEqual(publishedRoutes(site).map((route) => route.product), [STABLE_PRODUCT, LEGACY_PRODUCT]);
  // The stable product never links to an unpublished product.
  assert.deepEqual(versionLinks(site, STABLE_PRODUCT), [{ product: LEGACY_PRODUCT, href: '/eng-trainer/v1/' }]);
});

test('product identity survives a route swap: only addresses change', () => {
  const promoted = validateSiteConfig(changed((raw) => {
    Object.assign(routeFor(raw, EXPERIMENTAL_PRODUCT), { path: '', publish: true });
    Object.assign(routeFor(raw, STABLE_PRODUCT), { path: 'v2/' });
  }));
  const before = { stable: productBuild(site, STABLE_PRODUCT), experimental: productBuild(site, EXPERIMENTAL_PRODUCT) };
  const after = { stable: productBuild(promoted, STABLE_PRODUCT), experimental: productBuild(promoted, EXPERIMENTAL_PRODUCT) };

  assert.equal(after.stable.base, '/eng-trainer/v2/');
  assert.equal(after.experimental.base, '/eng-trainer/');
  for (const name of ['stable', 'experimental']) {
    for (const key of ['__ENG_PRODUCT__', '__ENG_DATABASE__', '__ENG_PRONUNCIATION__', '__SITE_BASE__']) {
      assert.equal(after[name].define[key], before[name].define[key], `${name} ${key}`);
    }
    assert.equal(after[name].outDir, before[name].outDir);
    assert.equal(after[name].publicDir, before[name].publicDir);
  }
  assert.deepEqual(versionLinks(promoted, EXPERIMENTAL_PRODUCT), [
    { product: STABLE_PRODUCT, href: '/eng-trainer/v2/' },
    { product: LEGACY_PRODUCT, href: '/eng-trainer/v1/' }
  ]);
  assert.deepEqual(versionLinks(promoted, STABLE_PRODUCT), [
    { product: LEGACY_PRODUCT, href: '/eng-trainer/v1/' },
    { product: EXPERIMENTAL_PRODUCT, href: '/eng-trainer/' }
  ]);
});

test('the validated configuration is frozen', () => {
  assert.throws(() => { site.routes[2].publish = true; }, TypeError);
  assert.throws(() => { site.products[STABLE_PRODUCT].database = 'eng-trainer-v3'; }, TypeError);
  assert.throws(() => { site.routes.push({ path: 'v4/', product: STABLE_PRODUCT, publish: true }); }, TypeError);
});

test('unknown products, unknown keys and missing parts fail closed', () => {
  rejects((raw) => { raw.products['experimental-v4'] = { ...raw.products[EXPERIMENTAL_PRODUCT] }; }, /unknown product "experimental-v4"/);
  rejects((raw) => { routeFor(raw, EXPERIMENTAL_PRODUCT).product = 'beta'; }, /is not a configured product/);
  rejects((raw) => { delete raw.products[STABLE_PRODUCT]; }, /"stable-v2" is required/);
  rejects((raw) => { delete raw.products[LEGACY_PRODUCT]; }, /"legacy-v1" is required/);
  rejects((raw) => { raw.publishAll = true; }, /exactly the keys base, products, routes/);
  rejects((raw) => { raw.products[EXPERIMENTAL_PRODUCT].publish = true; }, /products\.experimental-v3 must have exactly the keys/);
  rejects((raw) => { delete raw.products[EXPERIMENTAL_PRODUCT].database; }, /products\.experimental-v3 must have exactly the keys/);
  rejects((raw) => { raw.routes[2].override = true; }, /routes\[2\] must have exactly the keys/);
  rejects((raw) => { delete raw.routes[2].publish; }, /routes\[2\] must have exactly the keys/);
  rejects((raw) => { raw.routes = []; }, /non-empty list/);
  rejects((raw) => { raw.routes = raw.routes.filter((route) => route.product !== EXPERIMENTAL_PRODUCT); }, /"experimental-v3" has no route/);
  for (const value of [null, [], 'text', 1]) assert.throws(() => validateSiteConfig(value), /must be an object/);
});

test('missing, duplicate, colliding and malformed routes fail closed', () => {
  rejects((raw) => { routeFor(raw, EXPERIMENTAL_PRODUCT).path = 'v1/'; }, /is used twice/);
  rejects((raw) => { routeFor(raw, EXPERIMENTAL_PRODUCT).path = ''; }, /is used twice/);
  rejects((raw) => { raw.routes.push({ path: 'beta/', product: EXPERIMENTAL_PRODUCT, publish: false }); }, /has more than one route/);
  for (const path of ['assets/', 'data/', 'fonts/']) {
    rejects((raw) => { routeFor(raw, EXPERIMENTAL_PRODUCT).path = path; }, /collides with a folder/);
  }
  for (const path of ['v3', '/v3/', 'V3/', 'v3//', 'a/b/', '../v3/', './v3/', 'v3/../', 'v 3/', '..', '.', 'v3\\', 'https://example.org/']) {
    rejects((raw) => { routeFor(raw, EXPERIMENTAL_PRODUCT).path = path; }, /must be "" or one lower-case segment/);
  }
  rejects((raw) => { routeFor(raw, EXPERIMENTAL_PRODUCT).path = 3; }, /must be "" or one lower-case segment/);
});

test('every product folder is fixed: the file cannot choose what a script empties or deletes', () => {
  // ENG-V3-01-RC1. Each folder has one accepted value, compared as exact text.
  const fixed = {
    [STABLE_PRODUCT]: { outDir: 'dist', publicDir: 'public' },
    [EXPERIMENTAL_PRODUCT]: { outDir: 'dist-v3', publicDir: '.variant/experimental-v3/public' },
    [LEGACY_PRODUCT]: { outDir: 'v1/dist' }
  };
  for (const [id, folders] of Object.entries(fixed)) {
    assert.deepEqual(Object.fromEntries(Object.keys(folders).map((key) => [key, site.products[id][key]])), folders);
  }

  const others = [
    // Path traversal and paths that are not plain relative folders.
    '../outside', 'dist-v3/../../outside', '/abs', 'C:/abs', 'C:\\abs', 'a\\b', './dist-v3', 'dist-v3/', 'a//b', '', '.', '..', 'a b',
    // Sources, tools and repository files.
    'src', 'src/generated', 'content/v3', 'scripts', 'docs/out', 'node_modules/x', '.git', '.github/x',
    'index.html', 'vite.config.ts', 'site.config.json', 'package.json',
    // The frozen v1 project, the assemblies and the work areas.
    'v1', 'v1/dist/v3', 'v1/public', 'site-dist', 'site-dist/v3', '.site-test', '.rehearsal', '.local/negative',
    // Folders of another product, in either direction of nesting.
    'dist/v3', 'public/v3', 'dist-v3/public', '.variant', '.variant/experimental-v3',
    // Other spellings of protected and of generated folders (aliases on Windows).
    'SRC', 'Src', 'src.', 'V1/public', 'Dist', 'DIST-V3', 'Public', 'NODE_M~1', '.Variant/experimental-v3/public', 'dist-v3 ',
    // A new folder of any name.
    'out', 'dist-v4', '.variant/experimental-v3/public2',
    // Not text.
    7, null, true, ['dist-v3'], { dir: 'dist-v3' }
  ];
  for (const [id, folders] of Object.entries(fixed)) {
    // The accepted values of all products are wrong everywhere but in their own place.
    const candidates = [...others, 'dist', 'public', 'dist-v3', '.variant/experimental-v3/public', 'v1/dist'];
    for (const [key, accepted] of Object.entries(folders)) {
      for (const value of candidates.filter((item) => item !== accepted)) {
        const expected = new RegExp(`^Error: site\\.config\\.json: products\\.${id}\\.${key} must be ${JSON.stringify(accepted).replaceAll('.', '\\.').replaceAll('/', '\\/')} \\(found `);
        rejects((raw) => { raw.products[id][key] = value; }, expected);
      }
    }
  }
  // The message says why the value cannot be configured.
  rejects((raw) => { raw.products[EXPERIMENTAL_PRODUCT].publicDir = 'SRC'; }, /\(found "SRC"\)\. Product folders are fixed in code and cannot be configured, because scripts empty and delete them\.$/);
});

test('incompatible identities and publication settings fail closed', () => {
  // The stable product cannot be turned into something else by configuration.
  rejects((raw) => { raw.products[STABLE_PRODUCT].database = 'eng-trainer-v3'; }, /share the database|must be "eng-trainer-v2"/);
  rejects((raw) => { raw.products[STABLE_PRODUCT].database = 'eng-trainer-v4'; }, /must be "eng-trainer-v2"/);
  rejects((raw) => { raw.products[STABLE_PRODUCT].pronunciation = true; }, /products\.stable-v2\.pronunciation must be false/);
  rejects((raw) => { raw.products[STABLE_PRODUCT].outDir = 'dist-v2'; }, /products\.stable-v2\.outDir must be "dist"/);
  rejects((raw) => { raw.products[STABLE_PRODUCT].publicDir = 'public-v2'; }, /products\.stable-v2\.publicDir must be "public"/);
  rejects((raw) => { raw.products[EXPERIMENTAL_PRODUCT].database = 'eng-trainer-v2'; }, /share the database/);
  rejects((raw) => { raw.products[EXPERIMENTAL_PRODUCT].database = 'other'; }, /must look like eng-trainer-v<number>/);
  rejects((raw) => { raw.products[EXPERIMENTAL_PRODUCT].pronunciation = 'yes'; }, /pronunciation must be true or false/);
  // The frozen v1 project is compiled for v1/ and cannot move or take the site root.
  rejects((raw) => { raw.products[LEGACY_PRODUCT].outDir = 'legacy/dist'; }, /products\.legacy-v1\.outDir must be "v1\/dist"/);
  rejects((raw) => { routeFor(raw, LEGACY_PRODUCT).path = 'old/'; }, /compiled for the path "v1\/"/);
  // `publish` is a boolean and nothing else.
  for (const value of ['true', 'false', 1, 0, null, undefined, 'yes']) {
    rejects((raw) => { routeFor(raw, EXPERIMENTAL_PRODUCT).publish = value; }, /publish must be true or false|must have exactly the keys/);
  }
  // Every deployment replaces the whole site: the root must exist and be published.
  rejects((raw) => { routeFor(raw, STABLE_PRODUCT).publish = false; }, /site root must be published/);
  rejects((raw) => { routeFor(raw, STABLE_PRODUCT).path = 'v2/'; }, /no route has the path ""/);
  for (const base of ['eng-trainer/', '/eng-trainer', '/Eng-Trainer/', '/eng trainer/', '', '//', '/a/../b/', 'https://example.org/']) {
    rejects((raw) => { raw.base = base; }, /base ".*" must be an absolute path/);
  }
});

test('the publish flag has one source: the committed file. No argument, environment variable or workflow input', () => {
  assert.equal(loadSiteConfig.length, 0);
  for (const file of ['scripts/site-config.mjs', 'scripts/generated-dirs.mjs', 'scripts/site-assembly.mjs', 'scripts/assemble-site.mjs', 'scripts/check-products.mjs', 'scripts/product-gates.mjs']) {
    const source = read(file);
    assert.doesNotMatch(source, /process\.env/, `${file} must not read the environment`);
    assert.doesNotMatch(source, /process\.argv/, `${file} must not read arguments`);
  }
  const workflow = read('.github/workflows/deploy.yml');
  assert.doesNotMatch(workflow, /^\s*inputs:/m, 'the workflow must not define inputs');
  assert.doesNotMatch(workflow, /github\.event\.inputs|\binputs\./, 'the workflow must not read inputs');
  assert.doesNotMatch(workflow, /ENG_PRODUCT|publish:/, 'the workflow must not choose products or publication');
  // One publisher, and it uploads the production assembly only.
  assert.equal([...workflow.matchAll(/uses: actions\/upload-pages-artifact@/g)].length, 1);
  assert.equal([...workflow.matchAll(/uses: actions\/deploy-pages@/g)].length, 1);
  assert.match(workflow, /uses: actions\/upload-pages-artifact@v\d+\s+with:\s+path: \.\/site-dist\n/);
  // The gate runs after the assembly, in the same job. No command of the repository runs
  // between the gate and the upload (only the Configure GitHub Pages action does), so
  // nothing can change the site after it was checked.
  const steps = [...workflow.matchAll(/- name: (.+)/g)].map((match) => match[1]);
  const gate = steps.indexOf('Check the products and the released-site lock');
  assert.ok(gate > steps.indexOf('Assemble the site'));
  assert.deepEqual(steps.slice(gate + 1, gate + 3), ['Configure GitHub Pages', 'Upload the assembled site']);
  const commands = [...workflow.matchAll(/^\s+run: (.+)$/gm)].map((match) => match[1]);
  for (const command of ['npm run test:v3', 'npm run build:v3', 'npm run check:negative', 'npm run rehearse:promotion', 'npm run check:products']) {
    assert.ok(commands.includes(command), command);
  }
  // One job tests, builds and checks, so the suites never run in parallel.
  const jobs = workflow.slice(workflow.indexOf('\njobs:\n'));
  assert.deepEqual([...jobs.matchAll(/^ {2}(\w+):$/gm)].map((match) => match[1]), ['build', 'deploy']);
  // The triggers are the released ones.
  assert.deepEqual([...workflow.slice(workflow.indexOf('\non:\n'), workflow.indexOf('\npermissions:')).matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]), ['pull_request', 'push', 'workflow_dispatch']);
  assert.equal(commands.every((command) => !/&\s*$|\bparallel\b/.test(command)), true);
});
