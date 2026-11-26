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
import { declaredPolicy, inlineScriptHashes, pagePolicy } from './pronunciation-policy.mjs';
import { readPinned } from './prototype/model-files.mjs';
import { listFiles } from './site-assembly.mjs';
import { entryAssetUrls } from './site-checks.mjs';
import { EXPERIMENTAL_PRODUCT, LEGACY_PRODUCT, STABLE_PRODUCT, repoRoot, routeOf, routeUrl } from './site-config.mjs';

export const SITE_LOCK_FILE = 'scripts/locks/released-site.files.json';
export const CATALOG_LOCK_FILE = 'src/test/fixtures/released-catalog-v2.lock.json';

/** Marker attribute of experimental-only screens. It must never reach the stable output. */
export const EXPERIMENTAL_MARKER = 'data-experimental-feature';

/**
 * Speech, model, Worker and remote-runtime tokens. The released stable output contains
 * none of them. In the experimental output the entry script contains none either: the
 * speech feature (ENG-V3-02, stage A) lives in lazily loaded files only.
 */
export const FEATURE_TOKENS = [
  'getUserMedia', 'mediaDevices', 'AudioWorklet', 'AudioContext', 'MediaRecorder', 'SpeechRecognition',
  'onnx', 'transformers', 'wasm', 'WebAssembly', 'new Worker', 'importScripts', 'SharedArrayBuffer',
  'serviceWorker', 'caches.open', 'huggingface', 'jsdelivr'
];

/** Traces of the experimental product, and of a build that lost its compile-time constants. */
export const EXPERIMENTAL_TOKENS = ['eng-trainer-v3', 'experimental-v3', '/v3/', EXPERIMENTAL_MARKER, 'PronunciationPage', 'BackupPage', 'recoveryWriter', 'eng-trainer-backup', '__ENG_', '__SITE_BASE__'];

/**
 * Tokens of the browser's key-value storage and of the first version's records. The released
 * stable output holds none: the stable product keeps everything in its own database.
 */
export const STABLE_STORAGE_TOKENS = ['localStorage', 'sessionStorage', 'englishAssessmentTrainer'];

/** Names of model hubs and public script hosts. No file of the experimental build may name one. */
export const REMOTE_HOST_TOKENS = ['huggingface', 'jsdelivr', 'unpkg', 'cdnjs', 'googleapis', 'gstatic'];

/**
 * Hosts that the experimental build's code may spell out, each for a reason that is not a
 * request: XML namespace names, and links inside error messages of Svelte and of the
 * WebAssembly runtime. A new host fails the gate until it has been looked at.
 */
export const KNOWN_TEXT_HOSTS = ['www.w3.org', 'svelte.dev', 'web.dev'];

/** The build's own files of the speech feature, by the names the bundler gives them. */
const WORKER_FILE = /^assets\/recognizer\.worker-[\w-]+\.js$/;
const WORKLET_FILE = /^assets\/pcm-collector\.worklet-[\w-]+\.js$/;

/**
 * The recovery writer for the other two products (ENG-V3-R1A-RC1), by the name the bundler
 * gives it. It is one lazily loaded file, and only the Backup screen's file loads it.
 */
export const RECOVERY_WRITER_FILE = /^assets\/recoveryWriter-[\w-]+\.js$/;
/** How any file would name the writer in order to load it. */
export const RECOVERY_WRITER_NAME = 'recoveryWriter-';

/** The two experimental screens, by the value of their marker attribute. Each is one lazily loaded file. */
export const SPEECH_SCREEN = `${EXPERIMENTAL_MARKER}="pronunciation-prototype"`;
export const BACKUP_SCREEN = `${EXPERIMENTAL_MARKER}="backup-recovery"`;

/** The name of the stable product's database, and the prefix of the two records of the first version. */
const STABLE_DATABASE = 'eng-trainer-v2';
const LEGACY_RECORD_PREFIX = 'englishAssessmentTrainer';

/**
 * Tokens of the other products' storage (ENG-V3-R1A). The experimental product reaches that
 * storage in two files and nowhere else: the Backup screen's file reads it, and the
 * recovery writer writes it (ENG-V3-R1A-RC1).
 */
export const OTHER_STORAGE_TOKENS = [STABLE_DATABASE, LEGACY_RECORD_PREFIX, 'localStorage'];

/**
 * The call that writes a record of the browser's key-value storage. Exactly one file of the
 * experimental build holds it, once: the recovery writer.
 */
export const KEY_VALUE_WRITE_TOKEN = 'setItem';

/**
 * Tokens that no file of the experimental build may hold: the call that removes a record of
 * the browser's key-value storage, another key-value storage, cookies, and the call that
 * deletes a database. A recovery writes into an empty destination. It removes nothing.
 */
export const FORBIDDEN_STORAGE_TOKENS = ['removeItem', 'sessionStorage', 'document.cookie', 'deleteDatabase'];

/** Network interfaces. Neither the Backup screen's file nor the recovery writer uses one: a backup is made, read and recovered in the browser. */
export const NETWORK_TOKENS = ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon'];

/** A request for another file of the build. The Backup screen's file holds one, for the recovery writer. The writer holds none. */
export const DYNAMIC_IMPORT_TOKEN = 'import(';

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

/**
 * Gate 7. The experimental build is its own product. Its speech feature (ENG-V3-02, stage A)
 * is loaded lazily, runs under the page policy, brings the pinned runtime and no model
 * file, and names no other host.
 */
function gateExperimentalBuild({ site, experimentalDir, experimentalFiles, pinned }) {
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

  // Each experimental screen is a lazy chunk of its own: the entry script must not contain one.
  const entryScripts = entryUrls.filter((url) => url.endsWith('.js')).map((url) => `assets/${url.slice(prefix.length)}`);
  const scripts = code.filter((file) => file.path.endsWith('.js'));
  const lazy = scripts.filter((file) => !entryScripts.includes(file.path));
  if (lazy.filter((file) => text(file).includes(SPEECH_SCREEN)).length !== 1) problems.push('expected exactly one lazy chunk that holds the Pronunciation screen');
  for (const file of scripts.filter((item) => entryScripts.includes(item.path))) {
    if (text(file).includes(EXPERIMENTAL_MARKER)) problems.push(`${file.path}: the entry script contains an experimental screen; it must be loaded lazily`);
  }
  // The entry script has no speech, model or Worker code: the other screens never load it.
  problems.push(...scanTokens(experimentalDir, experimentalFiles.filter((file) => entryScripts.includes(file.path)), FEATURE_TOKENS));

  // Page policy: exactly the committed text, with the hash of the page's inline script,
  // declared once and before the first script, so it governs every script of the page.
  const expectedPolicy = pagePolicy(inlineScriptHashes(html));
  const declared = declaredPolicy(html);
  if (declared === null) problems.push('index.html declares no Content-Security-Policy');
  else if (declared !== expectedPolicy) problems.push(`index.html declares another Content-Security-Policy than scripts/pronunciation-policy.mjs. Found: ${declared}`);
  if ((html.match(/http-equiv="Content-Security-Policy"/g) ?? []).length > 1) problems.push('index.html declares more than one Content-Security-Policy');
  if (declared !== null && html.indexOf('http-equiv="Content-Security-Policy"') > html.indexOf('<script')) problems.push('index.html: the Content-Security-Policy must come before the first script');

  // Workers: one file starts one, through a blob: address (bootstrap.ts). The Worker and the
  // worklet are single files. Nothing registers a service worker.
  const workers = scripts.filter((file) => WORKER_FILE.test(file.path));
  const worklets = scripts.filter((file) => WORKLET_FILE.test(file.path));
  if (workers.length !== 1) problems.push(`expected exactly one recognizer Worker file, found ${workers.length}`);
  if (worklets.length !== 1) problems.push(`expected exactly one recording worklet file, found ${worklets.length}`);
  const starters = scripts.filter((file) => !WORKER_FILE.test(file.path) && text(file).includes('new Worker'));
  if (starters.length !== 1 || text(starters[0]).split('new Worker').length !== 2) problems.push(`expected exactly one place that starts a Worker, outside the Worker itself. Found: ${starters.map((file) => file.path).join(', ') || 'none'}`);
  for (const file of code) if (text(file).includes('serviceWorker')) problems.push(`${file.path} names a service worker. This product registers none.`);

  // The microphone is asked for in the lazy Pronunciation screen only.
  for (const file of scripts.filter((item) => text(item).includes('getUserMedia'))) {
    if (!text(file).includes(SPEECH_SCREEN)) problems.push(`${file.path} asks for the microphone outside the experimental screen`);
  }

  // No other host: no model hub, no public script host, and no host name that has not been looked at.
  problems.push(...scanTokens(experimentalDir, experimentalFiles, REMOTE_HOST_TOKENS));
  for (const file of code) {
    for (const match of text(file).matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
      if (!KNOWN_TEXT_HOSTS.includes(match[1])) problems.push(`${file.path} names the host "${match[1]}"`);
    }
  }

  // The WebAssembly runtime is the pinned file, once. No model file is part of a build:
  // the model exists only on the local prototype server (scripts/prototype/).
  const binaries = experimentalFiles.filter((file) => file.path.endsWith('.wasm'));
  const runtime = pinned.runtime.file;
  if (binaries.length !== 1) problems.push(`expected exactly one WebAssembly file, found ${binaries.length}`);
  for (const file of binaries) {
    if (file.bytes !== runtime.bytes || file.sha256 !== runtime.sha256) problems.push(`${file.path} is not the pinned runtime ${pinned.runtime.package} ${pinned.runtime.version} (${runtime.path})`);
  }
  const modelHashes = new Set(pinned.model.files.map((file) => file.sha256));
  for (const file of experimentalFiles) {
    if (modelHashes.has(file.sha256) || /\.onnx$/.test(file.path) || /(?:^|\/)models\//.test(file.path) || /(?:^|\/)tokenizer\.json$/.test(file.path)) {
      problems.push(`${file.path} is a model file. A build must not contain one.`);
    }
  }
  return problems;
}

/**
 * Gate 8. Backup and recovery of the experimental build (ENG-V3-R1A, ENG-V3-R1A-RC1).
 *
 * The experimental product reads the stable database and the two records of the first
 * version for a backup and for the preview of a recovery. After the learner confirmed, it
 * writes them through one recovery writer. This gate keeps both in their files:
 *
 * - one file holds the Backup screen, and it is not an entry script;
 * - one more file is the recovery writer. Only the Backup screen's file names it, and that
 *   file holds exactly one request for another file: the one for the writer;
 * - only those two files name the stable database, the records of the first version or the
 *   browser's key-value storage, and each reaches that storage in one place;
 * - the Backup screen's file cannot write another product: it holds no call that writes a
 *   key-value record, creates no object store, opens a database without a version, and
 *   starts exactly one read-write transaction (the recovery into this product's own database);
 * - the writer holds exactly one call that writes a key-value record and one read-write
 *   transaction. It requests no database itself and creates no object store: it opens the
 *   stable database through the reader's request, which names no version, so it can neither
 *   create nor upgrade a database;
 * - no file of the build removes a key-value record or deletes a database;
 * - neither file makes a request or holds speech, model or Worker code.
 *
 * A gate on built files cannot see which database a transaction belongs to, or which key a
 * record is written under. The tests of the feature and the browser acceptance test show
 * that: they compare every product's storage before and after.
 */
function gateExperimentalBackup({ site, experimentalDir, experimentalFiles }) {
  const problems = [];
  const indexPath = join(experimentalDir, 'index.html');
  if (!existsSync(indexPath)) return ['index.html is missing'];
  const prefix = `${routeUrl(site, routeOf(site, EXPERIMENTAL_PRODUCT))}assets/`;
  const entryScripts = entryAssetUrls(readFileSync(indexPath, 'utf8')).filter((url) => url.endsWith('.js')).map((url) => `assets/${url.slice(prefix.length)}`);
  const code = experimentalFiles.filter((file) => isCode(file.path));
  const text = (file) => readFileSync(join(experimentalDir, file.path), 'utf8');
  const occurrences = (file, token) => text(file).split(token).length - 1;

  const screens = code.filter((file) => text(file).includes(BACKUP_SCREEN));
  if (screens.length !== 1) problems.push(`expected exactly one file that holds the Backup screen, found ${screens.length}`);
  for (const file of screens) if (entryScripts.includes(file.path)) problems.push(`${file.path}: the entry script contains the Backup screen; it must be loaded lazily`);

  const writers = code.filter((file) => RECOVERY_WRITER_FILE.test(file.path));
  if (writers.length !== 1) problems.push(`expected exactly one recovery writer file, found ${writers.length}`);
  const reaching = [...screens, ...writers];

  for (const file of code.filter((item) => !reaching.includes(item))) {
    for (const token of OTHER_STORAGE_TOKENS) {
      if (text(file).includes(token)) problems.push(`${file.path} names "${token}" outside the Backup screen and its recovery writer. Only they may reach another product's storage.`);
    }
    if (text(file).includes(RECOVERY_WRITER_NAME)) problems.push(`${file.path} names the recovery writer. Only the Backup screen's file loads it, after a confirmation.`);
  }
  for (const file of code) {
    for (const token of FORBIDDEN_STORAGE_TOKENS) {
      if (text(file).includes(token)) problems.push(`${file.path} contains "${token}". No file of this product removes a key-value record, uses another key-value storage or deletes a database.`);
    }
  }
  for (const file of code.filter((item) => !writers.includes(item))) {
    if (text(file).includes(KEY_VALUE_WRITE_TOKEN)) problems.push(`${file.path} contains "${KEY_VALUE_WRITE_TOKEN}". Only the recovery writer writes a key-value record.`);
  }

  for (const file of screens) {
    if (!text(file).includes(STABLE_DATABASE)) problems.push(`${file.path} does not name the stable database, so a backup would not hold the stable product's data`);
    if (!text(file).includes(LEGACY_RECORD_PREFIX)) problems.push(`${file.path} does not name the records of the first version, so a backup would not hold them`);
    if (occurrences(file, '.localStorage') !== 1) problems.push(`${file.path}: expected exactly one place that reaches the browser's key-value storage, found ${occurrences(file, '.localStorage')}`);
    if (occurrences(file, '"readwrite"') !== 1) problems.push(`${file.path}: expected exactly one read-write transaction (the recovery into this product's own database), found ${occurrences(file, '"readwrite"')}`);
    if (text(file).includes('createObjectStore')) problems.push(`${file.path} creates an object store. The Backup screen's file creates no database: only the recovery writer may.`);
    // One argument: the database is opened at the version it has, so this file can neither create nor upgrade one.
    const opens = [...text(file).matchAll(/indexedDB\.open\(([^()]*)\)/g)].map((match) => match[1]);
    if (occurrences(file, 'indexedDB.open(') !== 1 || opens.length !== 1 || opens[0].includes(',')) problems.push(`${file.path}: expected exactly one request that opens a database, without a version. Found: ${opens.join(' | ') || 'none'}`);
    // The only other file this one asks for is the recovery writer.
    const requested = [...text(file).matchAll(/import\("\.\/([^"]+)"\)/g)].map((match) => `assets/${match[1]}`);
    if (occurrences(file, DYNAMIC_IMPORT_TOKEN) !== 1 || requested.length !== 1 || !writers.some((writer) => writer.path === requested[0])) {
      problems.push(`${file.path}: expected exactly one dynamic import, of the recovery writer. Found ${occurrences(file, DYNAMIC_IMPORT_TOKEN)}: ${requested.join(', ') || 'none that names a file of this build'}`);
    }
  }
  for (const file of writers) {
    if (entryScripts.includes(file.path)) problems.push(`${file.path}: the recovery writer is an entry script; it must be loaded after a confirmation`);
    if (text(file).includes(EXPERIMENTAL_MARKER)) problems.push(`${file.path}: the recovery writer holds an experimental screen. It is a writer and nothing else.`);
    if (occurrences(file, KEY_VALUE_WRITE_TOKEN) !== 1 || occurrences(file, '.setItem(') !== 1) problems.push(`${file.path}: expected exactly one call that writes a key-value record, found ${occurrences(file, KEY_VALUE_WRITE_TOKEN)}`);
    if (occurrences(file, '.localStorage') !== 1) problems.push(`${file.path}: expected exactly one place that reaches the browser's key-value storage, found ${occurrences(file, '.localStorage')}`);
    if (occurrences(file, '"readwrite"') !== 1) problems.push(`${file.path}: expected exactly one read-write transaction (the recovery into the stable database), found ${occurrences(file, '"readwrite"')}`);
    if (text(file).includes('indexedDB')) problems.push(`${file.path}: the recovery writer requests a database itself. It may only use the reader's request, which names no version, so that it can neither create nor upgrade a database.`);
    if (text(file).includes('createObjectStore')) problems.push(`${file.path} creates an object store. The recovery writer creates no database: only the product that owns it does.`);
  }
  problems.push(...scanTokens(experimentalDir, screens, [...NETWORK_TOKENS, ...FEATURE_TOKENS]));
  problems.push(...scanTokens(experimentalDir, writers, [...NETWORK_TOKENS, DYNAMIC_IMPORT_TOKEN, ...FEATURE_TOKENS]));
  return problems;
}

/**
 * Runs every gate. `siteDir` is the assembled site and `experimentalDir` the build of
 * the experimental product; both are relative to `root`.
 */
export async function runProductGates({ site, siteDir, experimentalDir, locks, root = repoRoot }) {
  const { siteLock, catalogLock } = locks;
  // The pinned list of the checked-out sources, also when the builds lie in another folder.
  const pinned = readPinned();
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
      title: 'Stable product: no speech, model, Worker, remote-runtime, key-value storage or experimental-product token',
      problems: scanTokens(stableDir, stableFiles, [...FEATURE_TOKENS, ...EXPERIMENTAL_TOKENS, ...STABLE_STORAGE_TOKENS])
    },
    { id: 'stable-content', title: `Stable product: released manifest and all ${catalogLock.packs.length} packs`, problems: contentProblems(stableFiles, stableDir, catalogLock) },
    {
      id: 'experimental-content',
      title: `Experimental product: empty overlay, so the released manifest and all ${catalogLock.packs.length} packs`,
      problems: contentProblems(experimentalFiles, experimentalPath, catalogLock)
    },
    {
      id: 'experimental-build',
      title: 'Experimental product: own database and base path, noindex, page policy, lazy speech feature, pinned runtime, no model file, no other host',
      problems: gateExperimentalBuild({ site, experimentalDir: experimentalPath, experimentalFiles, pinned })
    },
    {
      id: 'experimental-backup',
      title: 'Experimental product: backup in one lazy file, one recovery writer loaded by it alone, other products\' storage named in those two only, one key-value write, no removal, no database deletion, no request',
      problems: gateExperimentalBackup({ site, experimentalDir: experimentalPath, experimentalFiles })
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
