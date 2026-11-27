// Browser acceptance test of model storage safety (ENG-V3-R1B, ENG-V3-R1B-RC1).
//
// It runs the three built products from one origin in a real browser, on a server that
// sends no policy header, as GitHub Pages does. Every browser profile is new and
// disposable, and all learning data in it is made up by this script.
//
//   npm run prototype:build
//   npm run prototype:model
//   node scripts/acceptance/model-storage.mjs <chromium|firefox> [--out <result.json>] [--only <parts, for example A,E>]
//
// Playwright is not a dependency of this repository. Name an installed copy:
//   PROBE_PLAYWRIGHT=<folder of a "playwright" package>   and, if needed, PLAYWRIGHT_BROWSERS_PATH
//
// Parts:
//   A  what the screen says about the site's storage, and that opening it asks for nothing and writes nothing
//   B  no room, or no usable estimate: no download is offered and nothing is requested
//   C  the question before a download: numbers, the backup, the learner's own statement
//   D  a confirmed download: installed, checked file by file, learning data untouched
//   E  a write that the browser refuses after a good estimate: nothing is installed, the retry installs
//   F  a storage that fills up during the download: it ends before the next file is requested
//   G  an installation that is interrupted by closing the browser, fresh sessions, and a retry
//   H  incomplete, damaged and foreign files in the model cache: named, never loaded, removable
//   I  removing the model removes the model cache and nothing else of the site
//   J  the browser's promise to keep data: asked only on a click, denied, granted, pending, unsupported
//   K  installing and removing again and again
//   L  two tabs: while one installs, the other can neither install nor remove
//   M  backup and recovery (ENG-V3-R1A) with a model in the same storage
//   O  two tabs and a screen that is not reopened: "Load" never downloads, and "Read again" makes
//      the controls follow the cache. A model in memory and a model on the device are told apart
//   P  a browser that cannot coordinate its tabs: nothing is downloaded and nothing is removed
//   Q  a download that succeeds does not prove the headroom: the screen calls the numbers an estimate
//   N  no error on a page, and no request to another host
//
// Where a browser cannot be put into a state for real, the state is injected and the check
// says so: "(injected)". The summary lists what was real and what was injected.
//
// It exits with 1 when a check fails. It changes no tracked file and no build.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readPinned } from '../prototype/model-files.mjs';
import { HOST, createPrototypeHandler, missingInputs, verifyLocalModel } from '../prototype/server.mjs';

// ---- Arguments -----------------------------------------------------------------------

const [engine, ...rest] = process.argv.slice(2);
const option = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
const outFile = option('--out');
const only = option('--only')?.split(',').map((part) => part.trim().toUpperCase());
if (!['chromium', 'firefox'].includes(engine) || !process.env.PROBE_PLAYWRIGHT) {
  console.error('Usage: PROBE_PLAYWRIGHT=<playwright package> node scripts/acceptance/model-storage.mjs <chromium|firefox> [--out <result.json>] [--only <parts>]');
  process.exit(2);
}
const inputProblems = [...missingInputs(), ...verifyLocalModel()];
if (inputProblems.length) {
  console.error(inputProblems.join('\n'));
  process.exit(2);
}
const playwright = createRequire(import.meta.url)(process.env.PROBE_PLAYWRIGHT);
const pinned = readPinned();

// ---- Results --------------------------------------------------------------------------

const checks = [];
/** What a browser was seen to do where more than one outcome is safe, or where browsers differ. */
const observations = [];
/** Checks that a browser cannot run, with the reason. */
const notRun = [];
function check(id, title, pass, detail = '') {
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
  checks.push({ id, title, pass: Boolean(pass), detail: pass ? '' : String(text).slice(0, 1200) });
  console.log(`${pass ? 'pass' : 'FAIL'}  ${id}  ${title}${pass ? '' : `\n        ${String(text).slice(0, 1200)}`}`);
}
const observe = (id, text) => {
  observations.push({ id, text });
  console.log(`note  ${id}  ${text}`);
};

// ---- Names and made-up data -------------------------------------------------------------

const V3_NAME = 'eng-trainer-v3';
const V2_NAME = 'eng-trainer-v2';
const V1_STATE_KEY = 'englishAssessmentTrainer.svelteState.v1';
const V1_THEME_KEY = 'englishAssessmentTrainer.theme.v1';
const OWN = 'experimental-v3';
const MODEL_CACHE = 'eng-trainer-v3-models';
const UNRELATED_CACHE = 'acceptance-unrelated-cache';
const FILLER_CACHE = 'acceptance-filler';
const MEGABYTE = 1_000_000;

/** The pinned files in the order of an installation, as the model cache names them below its version. */
const PINNED_IDS = [...pinned.model.files.map((file) => `model/${file.path}`), `runtime/${pinned.runtime.file.path}`];
const PINNED_BYTES = Object.fromEntries([...pinned.model.files.map((file) => [`model/${file.path}`, file.bytes]), [`runtime/${pinned.runtime.file.path}`, pinned.runtime.file.bytes]]);
const TOTAL_BYTES = Object.values(PINNED_BYTES).reduce((sum, bytes) => sum + bytes, 0);
const LARGEST_BYTES = Math.max(...Object.values(PINNED_BYTES));
const RESERVE_BYTES = 64_000_000;
const NEED_BYTES = TOTAL_BYTES + LARGEST_BYTES + RESERVE_BYTES;
const megabytes = (bytes) => (bytes / MEGABYTE).toFixed(1);
const size = (bytes) => (bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${megabytes(bytes)} MB`);

/** Complete made-up learning data of one database product. `digit` keeps the two products' identities apart. */
function syntheticStores(digit) {
  const collection = `user:${String(digit).repeat(8)}-0000-4000-8000-000000000000`;
  const entry = (number) => `${collection}:entry:0000000${number}-0000-4000-8000-00000000000${digit}`;
  const pass = `pass-synthetic-${digit}`;
  return {
    progress: {
      learnedPhrases: [`phrase-${digit}01`, `phrase-${digit}02`, entry(1)],
      hiddenPhrases: [`phrase-${digit}03`],
      hiddenWords: [`word-${digit}04`],
      hiddenIrregular: [],
      favoriteBlocks: ['block-synthetic'],
      favoritePhrases: [`phrase-${digit}05`, entry(1)],
      favoriteWords: [],
      favoriteIrregular: [`verb-${digit}06`],
      selectedLearnPassId: pass
    },
    learnPasses: {
      [pass]: { id: pass, name: `Synthetic pass ${digit}`, description: 'Made up for a test', blockIds: [], createdAt: '2026-01-02T03:04:05.000Z', updatedAt: '2026-01-03T03:04:05.000Z' }
    },
    flashcardSessions: {
      all: { order: [`phrase-${digit}07`, entry(1), `phrase-${digit}08`], index: 1 },
      'topic:Small talk': { order: [], index: 0 }
    },
    settings: { activePage: 'collections', indexPageSize: 12, showHiddenWords: true, speechRepeatCount: 20, theme: 'dark' },
    userCollections: {
      [collection]: {
        id: collection, name: `Synthetic collection ${digit}`, description: 'Made up for a test', version: 1,
        createdAt: '2026-01-04T03:04:05.000Z', updatedAt: '2026-01-05T03:04:05.000Z', revision: 2,
        lastImport: { fileName: 'synthetic.csv', format: 'csv', importedAt: '2026-01-05T03:04:05.000Z', added: 2, skipped: 0 }
      }
    },
    userEntries: {
      [entry(1)]: { id: entry(1), kind: 'phrase', english: `a made-up phrase ${digit}`, translation: 'synthetic translation', topic: 'Synthetic', examples: [{ en: 'This is a made-up phrase.' }], collectionId: collection, position: 0 },
      [entry(2)]: { id: entry(2), kind: 'word', english: `made-up-${digit}`, translation: 'synthetic word', topic: '', examples: [], sourcePhraseId: entry(1), collectionId: collection, position: 1 }
    }
  };
}
const V1_SYNTHETIC = { activePage: 'phrases', learnedPhrases: ['phrase-101', 'phrase-102'], hiddenWords: ['word-103'], favoritePhrases: ['phrase-104'], flashcardSessions: { all: { order: ['phrase-105', 'phrase-106'], index: 1 } } };

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
const same = (a, b) => canonical(a) === canonical(b);
const digestOf = (value) => createHash('sha256').update(canonical(value), 'utf8').digest('hex').slice(0, 16);

// ---- Server ---------------------------------------------------------------------------

const BASE = '/eng-trainer/v3/';
const MODEL_MOUNT = `${BASE}models/${pinned.model.id}/`;
const RUNTIME_REQUEST = /^\/eng-trainer\/v3\/assets\/ort-wasm-simd-threaded-[\w-]+\.wasm$/;
const WORKER_REQUEST = /^\/eng-trainer\/v3\/assets\/recognizer\.worker-[\w-]+\.js$/;

const gate = () => {
  let open;
  const promise = new Promise((done) => { open = done; });
  return { promise, open };
};

/** Every request the application's server received, in order. */
const appLog = [];
/** A model file whose answer is held back until the test lets it go: { file, arrived, release }. */
let held = null;
function holdFile(file) {
  held = { file, arrived: gate(), release: gate() };
  return held;
}
function releaseHold() {
  held?.release.open();
  held = null;
}

async function intercept({ path }) {
  appLog.push(path);
  const holding = held;
  if (holding && path === `${MODEL_MOUNT}${holding.file}`) {
    holding.arrived.open();
    await holding.release.promise;
  }
  return false;
}

const server = createServer(createPrototypeHandler({ intercept }));
await new Promise((resolveStart, reject) => { server.once('error', reject); server.listen(0, HOST, resolveStart); });
const origin = `http://${HOST}:${server.address().port}`;
const V3 = `${origin}${BASE}`;
const V2 = `${origin}/eng-trainer/`;
const V1 = `${origin}/eng-trainer/v1/`;
/** A file of the site that runs no application: the test prepares and reads storage from here. */
const NEUTRAL = `${origin}/eng-trainer/fonts/OFL-Literata.txt`;
const KEY_BASE = `${origin}/eng-trainer/model-cache/`;
const VERSION_PREFIX = `/eng-trainer/model-cache/${pinned.version}/`;
/** The complete installation, as paths of cache entries. */
const COMPLETE_ENTRIES = [...PINNED_IDS.map((id) => `${VERSION_PREFIX}${id}`), `${VERSION_PREFIX}complete.json`].sort();

/** The model files and the runtime that were requested since `from`, by their pinned names. */
const modelRequests = (from = 0) => appLog.slice(from).flatMap((path) => {
  if (path.startsWith(MODEL_MOUNT)) return [`model/${path.slice(MODEL_MOUNT.length)}`];
  if (RUNTIME_REQUEST.test(path)) return [`runtime/${pinned.runtime.file.path}`];
  return [];
});

// ---- What a page does with storage, and the faults that a test switches on ----------------

/**
 * Counts what a page asks of the browser's storage, and can make three things fail the way
 * a browser makes them fail. While `paused` is set the test itself reads or prepares
 * storage, and that is not counted.
 *
 *   __faults.put       a pattern: storing a matching cache entry fails like a full storage
 *   __faults.estimate  { free }: the estimate leaves this much room; "reject"; "never"
 *   __faults.persist   "reject": the request to keep the data fails
 *   __faults.locks     "absent": the browser has no lock manager; "reject": it gives no lock
 *
 * `window.__initialFaults` is set before this script by the profile and can also take
 * interfaces away, as an older browser or an insecure page lacks them.
 */
const WATCH = `(() => {
  if (window.__storage) return;
  const initial = window.__initialFaults || {};
  const log = (window.__storage = { paused: false, estimate: 0, persisted: 0, persist: 0, cachesKeys: 0, cachesOpen: [], cachesHas: [], cachesDelete: [], deleteDatabase: [], setItem: [], removeItem: [], clear: 0, locks: [] });
  window.__faults = { locks: null, put: null, estimate: initial.estimate && typeof initial.estimate === 'object' || initial.estimate === 'reject' || initial.estimate === 'never' ? initial.estimate : null, persist: initial.persist === 'reject' ? 'reject' : null };
  const note = (list, value) => { if (!log.paused) list.push(value); };
  if (typeof StorageManager !== 'undefined') {
    const estimate = StorageManager.prototype.estimate;
    StorageManager.prototype.estimate = function () {
      if (!log.paused) log.estimate += 1;
      const fault = log.paused ? null : window.__faults.estimate;
      if (fault === 'reject') return Promise.reject(new DOMException('The operation is insecure.', 'SecurityError'));
      if (fault === 'never') return new Promise(() => {});
      if (fault) return estimate.call(this).then((real) => ({ usage: real.usage, quota: real.usage + fault.free }));
      return estimate.call(this);
    };
    const persisted = StorageManager.prototype.persisted;
    StorageManager.prototype.persisted = function () { if (!log.paused) log.persisted += 1; return persisted.call(this); };
    const persist = StorageManager.prototype.persist;
    StorageManager.prototype.persist = function () {
      if (!log.paused) log.persist += 1;
      if (window.__faults.persist === 'reject') return Promise.reject(new DOMException('Not allowed.', 'NotAllowedError'));
      return persist.call(this);
    };
    if (initial.estimate === 'absent') StorageManager.prototype.estimate = undefined;
    if (initial.persist === 'absent') StorageManager.prototype.persist = undefined;
  }
  if (initial.manager === 'absent') Object.defineProperty(Navigator.prototype, 'storage', { get() { return undefined; }, configurable: true });
  if (typeof CacheStorage !== 'undefined') {
    const keys = CacheStorage.prototype.keys;
    CacheStorage.prototype.keys = function () { if (!log.paused) log.cachesKeys += 1; return keys.call(this); };
    for (const [name, list] of [['open', log.cachesOpen], ['has', log.cachesHas], ['delete', log.cachesDelete]]) {
      const original = CacheStorage.prototype[name];
      CacheStorage.prototype[name] = function (cacheName) { note(list, String(cacheName)); return original.call(this, cacheName); };
    }
    const put = Cache.prototype.put;
    Cache.prototype.put = function (request, response) {
      const url = typeof request === 'string' ? request : request.url;
      const fault = window.__faults.put;
      if (fault && new RegExp(fault).test(url)) return Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError'));
      return put.call(this, request, response);
    };
  }
  const remove = IDBFactory.prototype.deleteDatabase;
  IDBFactory.prototype.deleteDatabase = function (name) { note(log.deleteDatabase, String(name)); return remove.apply(this, arguments); };
  for (const name of ['setItem', 'removeItem']) {
    const original = Storage.prototype[name];
    Storage.prototype[name] = function (...args) { if (this === window.localStorage) note(log[name], String(args[0])); return original.apply(this, args); };
  }
  const clear = Storage.prototype.clear;
  Storage.prototype.clear = function () { if (this === window.localStorage && !log.paused) log.clear += 1; return clear.call(this); };
  if (typeof LockManager !== 'undefined') {
    const request = LockManager.prototype.request;
    LockManager.prototype.request = function (name, ...others) {
      note(log.locks, String(name));
      if (window.__faults.locks === 'reject') return Promise.reject(new DOMException('The operation is insecure.', 'SecurityError'));
      return request.call(this, name, ...others);
    };
    // A browser without Web Locks: the page finds no lock manager at all.
    const own = Object.getOwnPropertyDescriptor(Navigator.prototype, 'locks');
    if (own && own.get) Object.defineProperty(Navigator.prototype, 'locks', { configurable: true, get() { return window.__faults.locks === 'absent' ? undefined : own.get.call(this); } });
  }
})();`;

// ---- Browser helpers ------------------------------------------------------------------

const offOrigin = [];
const pageProblems = [];
const work = mkdtempSync(join(tmpdir(), 'eng-trainer-model-storage-'));
const launched = [];

async function launch(firefoxUserPrefs = {}) {
  const browser = engine === 'chromium' ? await playwright.chromium.launch() : await playwright.firefox.launch({ firefoxUserPrefs });
  launched.push(browser);
  return browser;
}

function watch(page) {
  page.on('pageerror', (error) => pageProblems.push(`${page.url()} : ${error.message}`));
  return page;
}

async function prepare(context, faults) {
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
    offOrigin.push(url);
    return route.abort();
  });
  await context.addInitScript(`window.__initialFaults = ${JSON.stringify(faults ?? {})};`);
  await context.addInitScript(WATCH);
}

/** A new, empty browser profile. Requests to any other host are refused and recorded. */
async function newProfile(browser, { faults } = {}) {
  const context = await browser.newContext({ acceptDownloads: true });
  await prepare(context, faults);
  const page = watch(await context.newPage());
  return { context, page };
}

/** A profile on disk, so that the browser can be closed and started again with the same storage. */
async function openStoredProfile(dir) {
  const context = await playwright[engine].launchPersistentContext(dir, { acceptDownloads: true });
  await prepare(context);
  const page = watch(context.pages()[0] ?? (await context.newPage()));
  return { context, page };
}

async function until(read, what, timeoutMs = 20000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await read();
      if (last) return last;
    } catch (error) {
      last = `error: ${error.message}`;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}

async function openApp(page, url, hash = '') {
  await page.goto('about:blank');
  await page.goto(`${url}${hash}`, { waitUntil: 'load' });
  await until(() => page.evaluate(() => Boolean(document.querySelector('.app-shell, .app, main'))), `the application at ${url}`);
  // The application has read its saved state when its first screen is shown.
  await page.waitForTimeout(400);
}

const text = (page, selector = 'body') => page.evaluate((target) => (document.querySelector(target)?.textContent ?? '').replace(/\s+/g, ' ').trim(), selector);
const storageLog = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__storage)));
const setFault = (page, name, value) => page.evaluate(([key, fault]) => { window.__faults[key] = fault; }, [name, value]);

/** Runs `action` in another tab of the same profile, on a page that runs no application. What it does is not counted. */
async function fromAnotherTab(context, action, argument) {
  const page = await context.newPage();
  await page.goto(NEUTRAL, { waitUntil: 'load' });
  try {
    await page.evaluate(() => { window.__storage.paused = true; });
    return await page.evaluate(action, argument);
  } finally {
    await page.close();
  }
}

/** Everything the origin's storage holds: every database with every record, the key-value storage, every cache entry. */
function readOrigin(page) {
  return page.evaluate(async (modelCache) => {
    const log = window.__storage;
    const was = log.paused;
    log.paused = true;
    try {
      const databases = {};
      for (const info of (await indexedDB.databases()).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const database = await new Promise((done, fail) => { const request = indexedDB.open(info.name); request.onsuccess = () => done(request.result); request.onerror = () => fail(request.error); });
        const stores = {};
        const names = [...database.objectStoreNames].sort();
        if (names.length) {
          const transaction = database.transaction(names, 'readonly');
          await Promise.all(names.map((name) => new Promise((done, fail) => {
            const store = transaction.objectStore(name);
            const keys = store.getAllKeys();
            const values = store.getAll();
            values.onsuccess = () => { stores[name] = keys.result.map((key, index) => [key, values.result[index]]); done(); };
            values.onerror = () => fail(values.error);
          })));
        }
        databases[info.name] = { version: database.version, stores };
        database.close();
      }
      const records = {};
      for (let index = 0; index < localStorage.length; index += 1) records[localStorage.key(index)] = localStorage.getItem(localStorage.key(index));
      const stored = {};
      for (const name of (await caches.keys()).sort()) {
        const cache = await caches.open(name);
        const entries = [];
        for (const request of await cache.keys()) {
          const bytes = await (await cache.match(request)).arrayBuffer();
          // The model's own entries are compared by name and length. Everything else also by content.
          const hash = name === modelCache ? null : [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
          entries.push([new URL(request.url).pathname, bytes.byteLength, hash]);
        }
        stored[name] = entries.sort((a, b) => (a[0] < b[0] ? -1 : 1));
      }
      return { databases, records, caches: stored };
    } finally {
      log.paused = was;
    }
  }, MODEL_CACHE);
}

/** The same, read from another tab that is closed again: the tab under test then holds no handle of any cache. */
async function readOriginElsewhere(context) {
  const page = await context.newPage();
  await page.goto(NEUTRAL, { waitUntil: 'load' });
  try {
    return await readOrigin(page);
  } finally {
    await page.close();
  }
}

/**
 * Clicks "Check the storage again" until the download is offered, and returns the seconds
 * that took. A browser's usage figure can stay high for a while after something was deleted.
 */
async function waitForRoom(page, timeoutMs = 180000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await has(page, 'install-model')) return Math.round((Date.now() - started) / 1000);
    await page.requestGC?.().catch(() => undefined);
    if (await has(page, 'check-storage')) await page.click('[data-action="check-storage"]').catch(() => undefined);
    await page.waitForTimeout(1000);
  }
  throw new Error(`The download was not offered again within ${timeoutMs / 1000} s. The screen says: ${await text(page, '[data-capacity-reason]')}`);
}

/**
 * The learning data of a snapshot: every database and every key-value record. One record is
 * left out: the experimental product's "last screen", which the application itself rewrites
 * whenever the learner goes to another screen, as this test does.
 */
function learningOf(snapshot) {
  const databases = {};
  for (const [name, database] of Object.entries(snapshot.databases)) {
    const stores = {};
    for (const [store, records] of Object.entries(database.stores)) stores[store] = name === V3_NAME && store === 'settings' ? records.filter(([key]) => key !== 'activePage') : records;
    databases[name] = { version: database.version, stores };
  }
  return { databases, records: snapshot.records };
}
/** Every cache but the model cache, with every entry. */
const otherCachesOf = (snapshot) => Object.fromEntries(Object.entries(snapshot.caches).filter(([name]) => name !== MODEL_CACHE));
/** The entries of the model cache as paths, or null when the cache does not exist. */
const modelEntriesOf = (snapshot) => (MODEL_CACHE in snapshot.caches ? snapshot.caches[MODEL_CACHE].map(([path]) => path) : null);
const isComplete = (snapshot) => same(modelEntriesOf(snapshot), COMPLETE_ENTRIES) && snapshot.caches[MODEL_CACHE].every(([path, bytes]) => path.endsWith('/complete.json') || bytes === PINNED_BYTES[path.slice(VERSION_PREFIX.length)]);

async function seedDatabase(page, name, stores) {
  await page.evaluate(async ({ name, stores }) => {
    window.__storage.paused = true;
    const database = await new Promise((done, fail) => { const request = indexedDB.open(name); request.onsuccess = () => done(request.result); request.onerror = () => fail(request.error); });
    const transaction = database.transaction(Object.keys(stores), 'readwrite');
    for (const [store, records] of Object.entries(stores)) for (const [key, value] of Object.entries(records)) transaction.objectStore(store).put(value, key);
    await new Promise((done, fail) => { transaction.oncomplete = done; transaction.onabort = () => fail(transaction.error); });
    database.close();
    window.__storage.paused = false;
  }, { name, stores });
}

/** Made-up learning data of all three products, each written the way its own product keeps it. */
async function seedAll(page) {
  await openApp(page, V2);
  await seedDatabase(page, V2_NAME, syntheticStores(2));
  await openApp(page, V1);
  await page.evaluate(([stateKey, themeKey, state]) => { window.__storage.paused = true; localStorage.setItem(stateKey, state); localStorage.setItem(themeKey, 'dark'); window.__storage.paused = false; }, [V1_STATE_KEY, V1_THEME_KEY, JSON.stringify(V1_SYNTHETIC)]);
  await openApp(page, V3);
  await seedDatabase(page, V3_NAME, syntheticStores(3));
}

// ---- The Pronunciation screen ------------------------------------------------------------

const SCREEN = '[data-experimental-feature="pronunciation-prototype"]';
const PANEL = '[data-storage-panel]';
const DIALOG = 'dialog[data-install-confirm]';
const phase = (page) => page.getAttribute(SCREEN, 'data-phase');

async function openScreen(page) {
  await page.goto('about:blank');
  await page.goto(`${V3}#pronunciation`, { waitUntil: 'load' });
  await page.waitForSelector(`${SCREEN}:not([data-phase="checking"])`, { timeout: 40000 });
}

async function waitPhase(page, name, timeout = 30000) {
  try {
    await page.waitForSelector(`${SCREEN}[data-phase="${name}"]`, { timeout });
  } catch (error) {
    const seen = await page.evaluate(() => ({
      phase: document.querySelector('[data-experimental-feature]')?.getAttribute('data-phase') ?? 'the screen is not shown',
      model: (document.querySelector('[data-model-state]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      notice: (document.querySelector('.notice--error')?.textContent ?? '').replace(/\s+/g, ' ').trim()
    })).catch(() => ({ phase: 'the page did not answer' }));
    throw new Error(`The screen did not reach "${name}" in ${timeout / 1000} s. It shows: ${JSON.stringify(seen)}. (${String(error).split('\n')[0]})`);
  }
}

/** The three states that the storage panel carries, or nulls when the panel is not shown. */
const panel = (page) => page.evaluate((selector) => {
  const element = document.querySelector(selector);
  return { capacity: element?.getAttribute('data-capacity') ?? null, persistence: element?.getAttribute('data-persistence') ?? null, installation: element?.getAttribute('data-installation') ?? null };
}, PANEL);
const fact = (page, name) => text(page, `[data-storage-fact="${name}"]`);
const has = async (page, action) => (await page.$(`[data-action="${action}"]`)) !== null;
const notice = (page) => text(page, `${SCREEN} .notice--error`);
const dialogState = (page) => page.getAttribute(DIALOG, 'data-install-confirm');

/** The click on "Download" opens the question. Returns when it is open. */
async function askToDownload(page) {
  await page.click('[data-action="install-model"]');
  await page.waitForSelector(`${DIALOG}[data-install-confirm="open"]`, { timeout: 15000 });
}

/** A download as a learner starts it: the question, the learner's own statement, the confirmation. */
async function startDownload(page) {
  await askToDownload(page);
  await page.check('[data-control="backup-acknowledged"]');
  await page.click('[data-action="confirm-install"]');
}

async function install(page) {
  await startDownload(page);
  await waitPhase(page, 'ready', 180000);
}

/** Waits until a download ended without an installation, and returns what the screen says. */
async function refusal(page) {
  await page.waitForSelector(`${SCREEN}[data-phase="no-model"] .notice--error`, { timeout: 90000 });
  return notice(page);
}

/** Random bytes, which a browser cannot compress, written into a cache of the test's own until `megabytes` are stored or the browser refuses. */
const fill = async ([name, count]) => {
  const cache = await caches.open(name);
  const existing = (await cache.keys()).length;
  let written = 0;
  try {
    for (let index = 0; index < count; index += 1) {
      const bytes = new Uint8Array(1_000_000);
      for (let offset = 0; offset < bytes.length; offset += 50_000) crypto.getRandomValues(bytes.subarray(offset, offset + 50_000));
      await cache.put(`/acceptance-filler/${existing + index}`, new Response(bytes));
      written += 1;
    }
    return { written, error: null };
  } catch (error) {
    return { written, error: error.name };
  }
};

const UNTOUCHED = 'Your learning data was not changed. Do not clear the data of this site to make room: that would remove your learning data too.';
const wants = (part) => !only || only.includes(part);
async function part(id, title, run) {
  if (!wants(id)) return;
  console.log(`\n---- ${id}. ${title}`);
  try {
    await run();
  } catch (error) {
    check(`${id}0`, `part ${id} ran to its end`, false, error.stack ?? String(error));
  } finally {
    releaseHold();
  }
}

// ---- Parts ------------------------------------------------------------------------------

const browser = await launch();
const browserVersion = browser.version();

try {
  // ---- A, C, D: one profile with made-up data of all three products -----------------------
  let source = null;
  let seeded = null;
  if (wants('A') || wants('C') || wants('D') || wants('I') || wants('K') || wants('M')) {
    source = await newProfile(browser);
    await seedAll(source.page);
    await openApp(source.page, V3);
    seeded = await readOrigin(source.page);
  }

  await part('A', 'What the screen says, and that opening it asks for nothing and writes nothing', async () => {
    const { page } = source;
    const home = await text(page);
    check('A1', 'the profile holds made-up data of all three products, and no cache',
      same(Object.keys(seeded.databases), [V2_NAME, V3_NAME]) && same(Object.keys(seeded.records).sort(), [V1_STATE_KEY, V1_THEME_KEY]) && Object.keys(seeded.caches).length === 0 && home.includes('Synthetic collection 3'), { databases: Object.keys(seeded.databases), records: Object.keys(seeded.records), caches: Object.keys(seeded.caches) });
    const idle = await storageLog(page);
    check('A2', 'another screen of the experimental product asks the browser nothing about the site\'s storage and touches no cache',
      idle.estimate === 0 && idle.persisted === 0 && idle.persist === 0 && idle.cachesKeys === 0 && !idle.cachesOpen.length && !idle.cachesHas.length && !idle.locks.length, idle);

    const from = appLog.length;
    await openScreen(page);
    const state = await panel(page);
    check('A3', 'the Pronunciation screen shows the storage panel: room for the model, no model here, and what the browser does with the data',
      (await phase(page)) === 'no-model' && state.capacity === 'sufficient' && state.installation === 'absent' && ['best-effort', 'persistent'].includes(state.persistence), state);
    const real = await page.evaluate(async () => { window.__storage.paused = true; const answer = await navigator.storage.estimate(); window.__storage.paused = false; return { usage: answer.usage, quota: answer.quota }; });
    const usage = await fact(page, 'usage');
    check('A4', 'the numbers are the browser\'s own estimate of the whole site', usage.includes(` of ${size(real.quota)}, by the browser's estimate, all versions together`), `${usage} | browser: ${JSON.stringify(real)}`);
    check('A5', 'the screen says what a download asks for, as an estimate: the files, one more copy of the largest, and headroom for learning data',
      (await fact(page, 'need')) === `${size(NEED_BYTES)} of free storage, by the browser's estimate: ${size(TOTAL_BYTES)} for the files, ${size(LARGEST_BYTES)} while a file is being stored, and ${size(RESERVE_BYTES)} of headroom for learning data`, await fact(page, 'need'));
    const said = await text(page, PANEL);
    check('A6', 'it says that the storage is shared by all versions, and that none of this is a backup',
      said.includes('Every version of the trainer keeps its data in the storage that this browser gives to this site') && said.includes('None of this is a backup.') && said.includes('Only a backup file that is kept outside this browser protects your learning data.') &&
      (await page.getAttribute(`${PANEL} [data-action="open-backup"]`, 'href')) === '#backup', said.slice(0, 500));
    const log = await storageLog(page);
    check('A7', 'opening the screen read the estimate and the state, and asked the browser for nothing', log.estimate >= 1 && log.persisted >= 1 && log.persist === 0, log);
    check('A8', 'opening the screen listed no cache, opened none and took no lock: the model cache is looked for by its name only',
      log.cachesKeys === 0 && !log.cachesOpen.length && !log.cachesDelete.length && log.cachesHas.every((name) => name === MODEL_CACHE) && log.cachesHas.length >= 1 && !log.locks.length, log);
    const after = await readOrigin(page);
    check('A9', 'opening the screen wrote nothing: the learning data of all three products is the same, and there is still no cache',
      same(learningOf(after), learningOf(seeded)) && Object.keys(after.caches).length === 0, { caches: Object.keys(after.caches) });
    check('A10', 'no model file and no runtime was requested', modelRequests(from).length === 0 && !appLog.slice(from).some((path) => WORKER_REQUEST.test(path)), modelRequests(from));
    observe('A', `${engine}: a new profile reports usage ${real.usage} and limit ${real.quota} bytes for the site; the browser says "${state.persistence}".`);
  });

  await part('C', 'The question before a download', async () => {
    const { page } = source;
    await openScreen(page);
    const from = appLog.length;
    await askToDownload(page);
    const question = await text(page, DIALOG);
    check('C1', 'the click on "Download" opens a question with the numbers and with what a browser may do',
      question.includes(`This stores ${megabytes(TOTAL_BYTES)} MB in this browser, in the same storage as your learning data.`) &&
      question.includes('A browser that runs short of storage can remove everything that this site keeps, in one step: the learning data of every version together with the model.') &&
      question.includes('Only a backup file that is kept outside this browser protects your learning data. The trainer cannot see whether you have one.'), question);
    check('C2', 'the download cannot be confirmed without the learner\'s own statement about a backup',
      (await page.isDisabled('[data-action="confirm-install"]')) && !(await page.isChecked('[data-control="backup-acknowledged"]')));
    check('C3', 'nothing was requested and nothing stored while the question is open', modelRequests(from).length === 0 && Object.keys((await readOrigin(page)).caches).length === 0, modelRequests(from));

    await page.click('[data-action="cancel-install-confirm"]');
    check('C4', 'Cancel closes the question, and nothing is downloaded', (await dialogState(page)) === 'closed' && (await phase(page)) === 'no-model' && modelRequests(from).length === 0);

    await askToDownload(page);
    await page.check('[data-control="backup-acknowledged"]');
    await page.keyboard.press('Escape');
    await until(async () => (await dialogState(page)) === 'closed', 'the question to close');
    await askToDownload(page);
    check('C5', 'Escape closes it too, and the question starts unconfirmed each time', !(await page.isChecked('[data-control="backup-acknowledged"]')) && (await page.isDisabled('[data-action="confirm-install"]')) && modelRequests(from).length === 0);

    await page.click('[data-action="open-backup-first"]');
    await page.waitForSelector('[data-experimental-feature="backup-recovery"]', { timeout: 15000 });
    await page.waitForTimeout(300);
    check('C6', '"Save a backup file first" leads to the Backup screen, and nothing was downloaded', modelRequests(from).length === 0 && Object.keys((await readOrigin(page)).caches).length === 0 && (await page.$(SCREEN)) === null);
    const log = await storageLog(page);
    check('C7', 'through all of this the browser was not asked to keep the data', log.persist === 0, log);
  });

  await part('D', 'A confirmed download', async () => {
    const { page } = source;
    await openScreen(page);
    const before = await page.evaluate(async () => { window.__storage.paused = true; const answer = await navigator.storage.estimate(); window.__storage.paused = false; return answer.usage; });
    const from = appLog.length;
    await install(page);
    check('D1', 'after the confirmation the pinned files were requested, each once and in order, and the screen is ready', same(modelRequests(from), PINNED_IDS) && (await phase(page)) === 'ready', modelRequests(from));
    const installed = await readOrigin(page);
    check('D2', 'the model cache holds exactly the pinned files with their pinned sizes, and the marker', isComplete(installed), installed.caches[MODEL_CACHE]);
    const lengths = await page.evaluate(async (name) => {
      window.__storage.paused = true;
      const cache = await caches.open(name);
      const stored = {};
      for (const request of await cache.keys()) stored[new URL(request.url).pathname] = (await cache.match(request)).headers.get('Content-Length');
      window.__storage.paused = false;
      return stored;
    }, MODEL_CACHE);
    check('D2a', 'the browser keeps the length that was stored with each file: a look at the cache reads it there and reads no file', PINNED_IDS.every((id) => lengths[`${VERSION_PREFIX}${id}`] === String(PINNED_BYTES[id])), lengths);
    check('D3', 'the learning data of all three products is the same as before the download, and no other cache exists',
      same(learningOf(installed), learningOf(seeded)) && same(Object.keys(installed.caches), [MODEL_CACHE]));
    const log = await storageLog(page);
    check('D4', 'the installation held the lock of the model cache, and every cache call named the model cache',
      log.locks.includes(MODEL_CACHE) && log.locks.every((name) => name === MODEL_CACHE) && [...log.cachesOpen, ...log.cachesHas, ...log.cachesDelete].every((name) => name === MODEL_CACHE) && log.cachesKeys === 0, log);
    check('D5', 'the browser was not asked to keep the data, and no database or key-value record was removed', log.persist === 0 && !log.deleteDatabase.length && !log.removeItem.length && log.clear === 0, log);

    await openScreen(page);
    const state = await panel(page);
    check('D6', 'a fresh session finds the installation and does not load it by itself', state.installation === 'installed' && (await phase(page)) === 'no-model' && (await has(page, 'load-model')) && !(await has(page, 'install-model')) && page.workers().length === 0, state);
    check('D7', 'the screen says what is installed', (await fact(page, 'installation')) === `Installed, ${megabytes(TOTAL_BYTES)} MB. Complete by the list of files and their sizes.`, await fact(page, 'installation'));
    await page.click('[data-action="check-files"]');
    await page.waitForSelector('[data-files-checked]', { timeout: 60000 });
    check('D8', 'on request every installed file is read and compared with its pinned SHA-256', (await text(page, '[data-files-checked]')) === 'Checked now: every installed file is the expected one, by its size and its SHA-256.' && (await has(page, 'load-model')));
    const after = await page.evaluate(async () => { window.__storage.paused = true; const answer = await navigator.storage.estimate(); window.__storage.paused = false; return answer.usage; });
    observe('D', `${engine}: the browser's estimate of the site's usage went from ${before} to ${after} bytes with the model installed (${megabytes(after - before)} MB for ${megabytes(TOTAL_BYTES)} MB of files).`);
  });

  // ---- B: no room, or no usable estimate ---------------------------------------------------
  await part('B', 'No room, or no usable estimate', async () => {
    const noDownload = async (page) => !(await has(page, 'install-model')) && (await phase(page)) === 'no-model';
    {
      // Too little room. Firefox takes a limit for the site at start. Chromium's estimate does not follow a limit, so it is injected there.
      const real = engine === 'firefox';
      const low = real ? await launch({ 'dom.quotaManager.temporaryStorage.fixedLimit': 500_000 }) : browser;
      const { context, page } = await newProfile(low, real ? {} : { faults: { estimate: { free: 100 * MEGABYTE } } });
      await seedAll(page);
      const before = await readOrigin(page);
      const from = appLog.length;
      await openScreen(page);
      const state = await panel(page);
      const warning = await text(page, `${SCREEN} .notice--warning`);
      check('B1', `with less room than a download asks for, no download is offered ${real ? '(a real limit of the browser)' : '(injected estimate)'}`, state.capacity === 'insufficient' && (await noDownload(page)), state);
      check('B2', 'the screen says how much is free, how much is asked for and how much is missing, and warns against clearing the site\'s data',
        /The browser estimates [\d.]+ MB of free storage for this site\. A download asks for 131\.0 MB, so [\d.]+ MB are missing\./.test(warning) && warning.includes('Do not clear the data of this site to make room: that would remove your learning data too.'), warning);
      const after = await readOrigin(page);
      check('B3', 'nothing was requested, no cache was created, and the learning data is the same', modelRequests(from).length === 0 && Object.keys(after.caches).length === 0 && same(learningOf(after), learningOf(before)), modelRequests(from));
      if (real) {
        notRun.push({ id: 'B4', reason: 'Firefox takes its limit for a site when it starts, so room cannot be made while the page is open. Part D shows the download with room.' });
      } else {
        await setFault(page, 'estimate', null);
        await page.click('[data-action="check-storage"]');
        await page.waitForSelector('[data-action="install-model"]', { timeout: 15000 });
        check('B4', 'with room again, "Check the storage again" offers the download (injected estimate)', (await panel(page)).capacity === 'sufficient' && modelRequests(from).length === 0);
      }
      await context.close();
      if (real) await low.close();
    }
    for (const [id, faults, title, reason] of [
      ['B5', { estimate: 'absent' }, 'a browser without an estimate', 'This browser does not say how much storage this site uses or may use.'],
      ['B6', { estimate: 'reject' }, 'an estimate that fails', 'The browser gave no estimate of this site\'s storage (The operation is insecure.).'],
      ['B7', { estimate: 'never' }, 'an estimate that never comes', 'The browser gave no estimate of this site\'s storage (the browser did not answer).'],
      ['B8', { manager: 'absent' }, 'a page without a storage manager', 'This browser does not say how much storage this site uses or may use.']
    ]) {
      const { context, page } = await newProfile(browser, { faults });
      const from = appLog.length;
      await openScreen(page);
      const state = await panel(page);
      const said = await text(page, '[data-capacity-reason]');
      check(id, `${title}: the estimate is "not known", no download is offered, and nothing is requested (injected)`,
        state.capacity === 'unknown' && (await noDownload(page)) && said === `${reason} Without an estimate the model is not downloaded.` && modelRequests(from).length === 0 && Object.keys((await readOrigin(page)).caches).length === 0, `${JSON.stringify(state)} | ${said}`);
      if (faults.manager) {
        check('B9', 'without a storage manager the screen also says that it does not know what the browser does with the data, and offers no request',
          state.persistence === 'unknown' && !(await has(page, 'ask-persistence')) && (await fact(page, 'persistence')) === 'This browser does not say whether it may remove this site\'s data by itself. Assume that it may.', await fact(page, 'persistence'));
      }
      await context.close();
    }
  });

  // ---- E: a write that the browser refuses after a good estimate -----------------------------
  await part('E', 'A write that the browser refuses after a good estimate', async () => {
    {
      const { context, page } = await newProfile(browser);
      await seedAll(page);
      const before = await readOrigin(page);
      for (const [id, target, name] of [
        ['E1', 'model/config.json', 'the first file'],
        ['E2', 'model/onnx/decoder_model_merged_quantized.onnx', 'the largest file'],
        ['E3', `runtime/${pinned.runtime.file.path}`, 'the runtime, the last file'],
        ['E4', 'complete.json', 'the marker']
      ]) {
        await openScreen(page);
        await setFault(page, 'put', `${target.replace(/[.]/g, '\\.')}$`);
        const from = appLog.length;
        await startDownload(page);
        const said = await refusal(page);
        const after = await readOrigin(page);
        const entries = modelEntriesOf(after) ?? [];
        check(id, `${name} is refused by the browser: the screen says that the storage is full, that nothing was installed and that the learning data was not changed (injected)`,
          said.includes('The browser could not store the model. Nothing was installed.') && said.includes('its storage for this site is full') && said.includes(UNTOUCHED), said);
        check(`${id}a`, '  nothing of the installation is left, no load is offered, and the learning data is the same',
          entries.length === 0 && (await panel(page)).installation === 'absent' && !(await has(page, 'load-model')) && page.workers().length === 0 && same(learningOf(after), learningOf(before)) && same(otherCachesOf(after), {}), { entries, requested: modelRequests(from).length });
      }
      await setFault(page, 'put', null);
      await install(page);
      check('E5', 'after the refusals, the next download installs', isComplete(await readOrigin(page)) && (await phase(page)) === 'ready');
      await context.close();
    }

    if (engine === 'chromium') {
      // A real limit: the browser enforces it on a write, and its estimate does not show it.
      const { context, page } = await newProfile(browser);
      await seedAll(page);
      const before = await readOrigin(page);
      await openScreen(page);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 30 * MEGABYTE });
      await page.click('[data-action="refresh-storage"]');
      await page.waitForTimeout(300);
      const offered = (await panel(page)).capacity;
      const from = appLog.length;
      await startDownload(page);
      const said = await refusal(page);
      const after = await readOrigin(page);
      check('E6', 'a real limit of 30 MB that the estimate does not show: the browser refuses a file, and the screen says that the storage is full and that nothing was installed',
        offered === 'sufficient' && said.includes('The browser could not store the model. Nothing was installed.') && said.includes('its storage for this site is full') && said.includes(UNTOUCHED), `${offered} | ${said}`);
      check('E6a', '  nothing of the installation is left, and the learning data of all three products is the same',
        (modelEntriesOf(after) ?? []).length === 0 && !(await has(page, 'load-model')) && same(learningOf(after), learningOf(before)), modelEntriesOf(after));
      observe('E', `chromium: with a limit of 30 MB set for the site, the estimate still said "sufficient". The write of ${modelRequests(from).slice(-1)[0]} was refused. An estimate is not a reservation.`);
      await cdp.send('Storage.overrideQuotaForOrigin', { origin });
      await install(page);
      check('E7', 'with the limit lifted, the next download installs', isComplete(await readOrigin(page)));
      await context.close();
    } else {
      // A real limit of 204.8 MB for the site. While the largest file arrives, something else fills the site's storage.
      const tight = await launch({ 'dom.quotaManager.temporaryStorage.fixedLimit': 1_000_000 });
      const { context, page } = await newProfile(tight);
      await seedAll(page);
      const before = await readOrigin(page);
      await openScreen(page);
      const offered = (await panel(page)).capacity;
      const holding = holdFile('onnx/decoder_model_merged_quantized.onnx');
      await startDownload(page);
      await holding.arrived.promise;
      const filled = await fromAnotherTab(context, fill, [FILLER_CACHE, 400]);
      releaseHold();
      const said = await refusal(page);
      const after = await readOriginElsewhere(context);
      check('E6', 'a real limit: the site\'s storage is filled while the largest file arrives. The browser refuses the file, and the screen says that the storage is full and that nothing was installed',
        offered === 'sufficient' && filled.error !== null && said.includes('The browser could not store the model. Nothing was installed.') && said.includes('its storage for this site is full') && said.includes(UNTOUCHED), `${offered} | filler: ${JSON.stringify(filled)} | ${said}`);
      check('E6a', '  nothing of the installation is left, the learning data is the same, and what filled the storage was not removed to make room',
        (modelEntriesOf(after) ?? []).length === 0 && !(await has(page, 'load-model')) && same(learningOf(after), learningOf(before)) && after.caches[FILLER_CACHE]?.length === filled.written, { model: modelEntriesOf(after), filler: after.caches[FILLER_CACHE]?.length, written: filled.written });
      check('E6b', '  with the storage full, the screen offers no download', (await panel(page)).capacity === 'insufficient' && !(await has(page, 'install-model')), await panel(page));
      observe('E', `firefox: with a limit of 204.8 MB for the site and ${filled.written} MB written by another tab, the write of the largest file failed as "${filled.error}" for the filler. Firefox names a refused cache write NS_ERROR_FILE_NO_DEVICE_SPACE, not QuotaExceededError.`);
      // The learner makes room elsewhere: here the test removes what it wrote.
      await fromAnotherTab(context, (name) => caches.delete(name), FILLER_CACHE);
      const seconds = await waitForRoom(page);
      observe('E-room', `firefox: after the other tab deleted what it had written, the browser's estimate left room again after ${seconds} s of asking. The screen offers the download only when the browser's own figure allows it.`);
      await install(page);
      check('E7', 'with room again, the next download installs', isComplete(await readOrigin(page)));
      await context.close();
      await tight.close();
    }
  });

  // ---- F: the storage fills up between two files ---------------------------------------------
  await part('F', 'A storage that fills up during the download', async () => {
    const real = engine === 'firefox';
    const tight = real ? await launch({ 'dom.quotaManager.temporaryStorage.fixedLimit': 1_000_000 }) : browser;
    const { context, page } = await newProfile(tight);
    await seedAll(page);
    const before = await readOrigin(page);
    await openScreen(page);
    const holding = holdFile('tokenizer.json');
    const from = appLog.length;
    await startDownload(page);
    await holding.arrived.promise;
    let filled = null;
    if (real) filled = await fromAnotherTab(context, fill, [FILLER_CACHE, 110]);
    else await setFault(page, 'estimate', { free: 100 * MEGABYTE });
    releaseHold();
    const said = await refusal(page);
    const after = await readOrigin(page);
    check('F1', `room is asked for again before each file: with too little left, the download ends, and the screen says so ${real ? '(a real limit, filled by another tab)' : '(injected estimate)'}`,
      said.includes('The model was not downloaded: there is not enough room for it in this browser, or the browser cannot say.') && said.includes('so the model is not downloaded') && said.includes(UNTOUCHED), said);
    check('F2', 'the next file was never requested', same(modelRequests(from), PINNED_IDS.slice(0, 3)), modelRequests(from));
    check('F3', 'the files that were stored are removed again, and the learning data is the same',
      (modelEntriesOf(after) ?? []).length === 0 && (await panel(page)).installation === 'absent' && same(learningOf(after), learningOf(before)), modelEntriesOf(after));
    if (real) check('F4', 'what filled the storage was not removed to make room', after.caches[FILLER_CACHE]?.length === filled.written && filled.error === null, { filler: after.caches[FILLER_CACHE]?.length, filled });
    await context.close();
    if (real) await tight.close();
  });

  // ---- G: interruption, restart, retry ---------------------------------------------------------
  await part('G', 'An interrupted installation, fresh sessions and a retry', async () => {
    const dir = mkdtempSync(join(work, 'profile-'));
    const interrupt = async (page, context) => {
      const holding = holdFile('onnx/decoder_model_merged_quantized.onnx');
      await startDownload(page);
      await holding.arrived.promise;
      await until(async () => (modelEntriesOf(await readOrigin(page)) ?? []).length === 4, 'four files to be stored', 60000);
      // The browser is closed in the middle of the installation.
      await context.close();
      releaseHold();
    };

    let session = await openStoredProfile(dir);
    await seedAll(session.page);
    const before = await readOrigin(session.page);
    await openScreen(session.page);
    await interrupt(session.page, session.context);

    session = await openStoredProfile(dir);
    let from = appLog.length;
    await openScreen(session.page);
    let state = await panel(session.page);
    let found = await readOrigin(session.page);
    // Four files were stored when the browser was closed. The page may still have begun to remove
    // them while it was closed down, so one to four are left, or none. Whatever is left has no marker.
    const left = modelEntriesOf(found) ?? [];
    const leftovers = left.length > 0;
    check('G1', 'after the browser was closed in the middle of a download, a new session finds no installation: at most the four stored files, no marker, shown as a download that did not finish',
      left.length <= 4 && !left.some((path) => path.endsWith('/complete.json')) &&
      (leftovers
        ? state.installation === 'incomplete' && new RegExp(`^This browser holds ${left.length} files? \\([\\d.]+ MB\\) of a download that did not finish\\. They are not used\\. A new download replaces them\\.$`).test(await text(session.page, '[data-model-state]'))
        : state.installation === 'absent'), `${JSON.stringify(state)} | ${left.length} entries | ${await text(session.page, '[data-model-state]')}`);
    observe('G', `${engine}: of the four files that were stored when the browser was closed, ${left.length} were found by the next session.${left.length < 4 ? ' The page had begun to remove the files of its interrupted attempt while the browser closed.' : ''}`);
    check('G2', 'nothing of it is offered for loading, nothing was requested, and no Worker runs',
      (await phase(session.page)) === 'no-model' && !(await has(session.page, 'load-model')) && (await has(session.page, 'install-model')) && (await has(session.page, 'remove-model-files')) === leftovers && modelRequests(from).length === 0 && session.page.workers().length === 0);
    check('G3', 'the learning data of all three products is the same as before the interruption', same(learningOf(found), learningOf(before)));

    if (leftovers) {
      await session.page.click('[data-action="remove-model-files"]');
      await until(async () => (await panel(session.page)).installation === 'absent', 'the leftovers to be removed');
      found = await readOrigin(session.page);
      check('G4', '"Remove these files" removes the model cache and nothing else', modelEntriesOf(found) === null && same(learningOf(found), learningOf(before)) && same(Object.keys(found.caches), []), Object.keys(found.caches));
    } else {
      notRun.push({ id: 'G4', reason: 'The page removed every file of its interrupted attempt while the browser closed, so nothing was left to remove. Part H removes leftovers.' });
    }

    // A second interruption, and this time a retry without removing anything first.
    await interrupt(session.page, session.context);
    session = await openStoredProfile(dir);
    await openScreen(session.page);
    from = appLog.length;
    await install(session.page);
    found = await readOrigin(session.page);
    check('G5', 'a retry after an interruption requests every file again and installs: a leftover is never reused', same(modelRequests(from), PINNED_IDS) && isComplete(found) && same(learningOf(found), learningOf(before)), modelRequests(from));
    await session.context.close();

    session = await openStoredProfile(dir);
    from = appLog.length;
    await openScreen(session.page);
    state = await panel(session.page);
    check('G6', 'after a restart of the browser the installation is found, and it is not loaded by itself',
      state.installation === 'installed' && (await phase(session.page)) === 'no-model' && (await has(session.page, 'load-model')) && session.page.workers().length === 0 && modelRequests(from).length === 0, state);
    await session.page.click('[data-action="load-model"]');
    await waitPhase(session.page, 'ready', 120000);
    check('G7', 'loading it requests no model file and no runtime: it is read from the browser', modelRequests(from).length === 0 && (await has(session.page, 'record')), modelRequests(from));
    await session.page.click('[data-action="delete-model"]');
    await until(async () => (await panel(session.page)).installation === 'absent', 'the model to be deleted');
    await session.context.close();

    session = await openStoredProfile(dir);
    await openScreen(session.page);
    found = await readOrigin(session.page);
    check('G8', 'after a deletion and another restart there is no model, and the learning data is still the same',
      (await panel(session.page)).installation === 'absent' && modelEntriesOf(found) === null && same(learningOf(found), learningOf(before)));
    await session.context.close();
  });

  // ---- H: incomplete, damaged and foreign files ---------------------------------------------------
  await part('H', 'Incomplete, damaged and foreign files in the model cache', async () => {
    const { context, page } = await newProfile(browser);
    await seedAll(page);
    const before = await readOrigin(page);
    await openScreen(page);
    await install(page);
    const tamper = (action, argument) => fromAnotherTab(context, action, argument);
    const entry = (id) => `${KEY_BASE}${pinned.version}/${id}`;

    // The marker is gone.
    await tamper(([name, key]) => caches.open(name).then((cache) => cache.delete(key)), [MODEL_CACHE, entry('complete.json')]);
    await openScreen(page);
    let state = await panel(page);
    check('H1', 'files without the marker are an unfinished download: never offered for loading',
      state.installation === 'incomplete' && !(await has(page, 'load-model')) && (await has(page, 'remove-model-files')) && (await fact(page, 'installation')).startsWith('6 files of a download that did not finish'), `${JSON.stringify(state)} | ${await fact(page, 'installation')}`);
    await install(page);

    // A file is gone.
    await tamper(([name, key]) => caches.open(name).then((cache) => cache.delete(key)), [MODEL_CACHE, entry('model/tokenizer.json')]);
    await openScreen(page);
    state = await panel(page);
    check('H2', 'a missing file makes the installation "damaged": it is named, it is not offered for loading, and it can be removed or replaced',
      state.installation === 'damaged' && !(await has(page, 'load-model')) && (await has(page, 'remove-model-files')) && (await has(page, 'install-model')) &&
      (await fact(page, 'installation')).includes('model/tokenizer.json is missing') && (await text(page, '[data-model-state]')) === 'The speech model in this browser is damaged, so it is not used. A new download replaces it.', `${JSON.stringify(state)} | ${await fact(page, 'installation')}`);
    const from = appLog.length;
    await install(page);
    check('H3', 'a new download replaces a damaged installation: every file is requested again', same(modelRequests(from), PINNED_IDS) && isComplete(await readOrigin(page)), modelRequests(from));

    // A file of the right length with one changed byte.
    const flipped = await tamper(async ([name, key]) => {
      const cache = await caches.open(name);
      const bytes = new Uint8Array(await (await cache.match(key)).arrayBuffer());
      bytes[Math.floor(bytes.length / 2)] ^= 0x01;
      await cache.put(key, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length) } }));
      return bytes.length;
    }, [MODEL_CACHE, entry('model/onnx/decoder_model_merged_quantized.onnx')]);
    await openScreen(page);
    state = await panel(page);
    check('H4', 'a file with one changed byte and the right length looks complete by its size: it is offered for loading, not shown as ready',
      flipped === PINNED_BYTES['model/onnx/decoder_model_merged_quantized.onnx'] && state.installation === 'installed' && (await phase(page)) === 'no-model' && (await has(page, 'load-model')), state);
    await page.click('[data-action="load-model"]');
    const said = await refusal(page);
    const problems = await page.evaluate(() => [...document.querySelectorAll('[data-file-problems] li')].map((item) => item.textContent.trim()));
    check('H5', 'the recognizer\'s Worker checks the file when it reads it and refuses: nothing is ready, no recording is offered, and the screen names the file',
      said.includes('The installed files of the speech model are incomplete or damaged, so they were not used.') && same(problems, ['model/onnx/decoder_model_merged_quantized.onnx: does not have the pinned SHA-256']) &&
      (await phase(page)) === 'no-model' && !(await has(page, 'record')) && !(await has(page, 'load-model')) && page.workers().length === 0, `${said} | ${JSON.stringify(problems)}`);

    await openScreen(page);
    await page.click('[data-action="check-files"]');
    await page.waitForSelector('[data-file-problems]', { timeout: 60000 });
    check('H6', 'in a fresh session, "Check the installed files" finds the same file without loading anything',
      same(await page.evaluate(() => [...document.querySelectorAll('[data-file-problems] li')].map((item) => item.textContent.trim())), ['model/onnx/decoder_model_merged_quantized.onnx: does not have the pinned SHA-256']) && !(await has(page, 'load-model')) && page.workers().length === 0);
    await page.click('[data-action="remove-model-files"]');
    await until(async () => (await panel(page)).installation === 'absent', 'the damaged files to be removed');
    let found = await readOrigin(page);
    check('H7', 'removing the damaged files removes the model cache and nothing else', modelEntriesOf(found) === null && same(learningOf(found), learningOf(before)));
    await install(page);
    check('H8', 'after that a download installs, and recording is offered', (await has(page, 'record')) && isComplete(await readOrigin(page)));

    // Entries of another version of the model, which this build does not use.
    await tamper(([name, key]) => caches.open(name).then((cache) => cache.put(key, new Response(new Uint8Array(5_000_000)))), [MODEL_CACHE, `${KEY_BASE}another-model-version/model/weights.bin`]);
    await openScreen(page);
    check('H9', 'entries of another version are counted apart and are not this version\'s installation', (await panel(page)).installation === 'installed' && (await text(page, '[data-storage-fact="other-version"]')) === 'Also 5.0 MB of another version of the model, which this build does not use.', await fact(page, 'installation'));
    await page.click('[data-action="delete-model"]');
    await until(async () => (await panel(page)).installation === 'absent', 'the model to be deleted');
    found = await readOrigin(page);
    check('H10', 'deleting the model removes them with it', modelEntriesOf(found) === null);

    await tamper(([name, key]) => caches.open(name).then((cache) => cache.put(key, new Response(new Uint8Array(5_000_000)))), [MODEL_CACHE, `${KEY_BASE}another-model-version/model/weights.bin`]);
    await openScreen(page);
    check('H11', 'with only another version in the cache there is no installation, and the files can be removed', (await panel(page)).installation === 'absent' && (await has(page, 'remove-model-files')) && (await has(page, 'install-model')) && !(await has(page, 'load-model')));
    await install(page);
    found = await readOrigin(page);
    check('H12', 'a completed installation removes the other version, and the learning data is still the same', isComplete(found) && same(learningOf(found), learningOf(before)), modelEntriesOf(found));
    await context.close();
  });

  // ---- I: removal removes the model cache and nothing else -------------------------------------------
  await part('I', 'Removing the model removes nothing else of the site', async () => {
    const { context, page } = source;
    await fromAnotherTab(context, async (name) => {
      const cache = await caches.open(name);
      await cache.put('/eng-trainer/acceptance/one', new Response('kept one'));
      await cache.put('/eng-trainer/acceptance/two', new Response(new Uint8Array(70_000).fill(7)));
    }, UNRELATED_CACHE);
    await openScreen(page);
    if ((await panel(page)).installation !== 'installed') await install(page);
    await openScreen(page);
    const before = await readOrigin(page);
    const idle = await storageLog(page);
    await page.click('[data-action="delete-model"]');
    await until(async () => (await panel(page)).installation === 'absent', 'the model to be deleted');
    const after = await readOrigin(page);
    const log = await storageLog(page);
    check('I1', 'before the deletion the site holds the three products\' data, the model and a cache that is not the model\'s', isComplete(before) && same(Object.keys(before.caches).sort(), [UNRELATED_CACHE, MODEL_CACHE].sort()) && before.caches[UNRELATED_CACHE].length === 2);
    check('I2', '"Delete downloaded model" removes the model cache', modelEntriesOf(after) === null && (await has(page, 'install-model')));
    check('I3', 'every database, every key-value record and the other cache are the same, entry by entry and byte by byte',
      same(learningOf(after), learningOf(before)) && same(after.databases, before.databases) && same(after.records, before.records) && same(otherCachesOf(after), otherCachesOf(before)), { before: digestOf(otherCachesOf(before)), after: digestOf(otherCachesOf(after)) });
    check('I4', 'the deletion named one cache, listed none, and removed no database and no key-value record',
      same(log.cachesDelete.slice(idle.cachesDelete.length), [MODEL_CACHE]) && log.cachesKeys === 0 && [...log.cachesOpen, ...log.cachesHas].every((name) => name === MODEL_CACHE) && !log.deleteDatabase.length && !log.removeItem.length && !log.setItem.length && log.clear === 0, log);
    check('I5', 'the deletion held the lock of the model cache', log.locks.slice(idle.locks.length).includes(MODEL_CACHE), log.locks);
    check('I6', 'the screen says what a removal touches', (await text(page, SCREEN)).includes('Not in this browser.') && !(await has(page, 'delete-model')));
  });

  // ---- J: the browser's promise to keep data ----------------------------------------------------------
  await part('J', 'The browser\'s promise to keep data', async () => {
    const answer = (page) => page.evaluate(() => document.querySelector('[data-persistence-answer]')?.getAttribute('data-persistence-answer') ?? null);
    /** Clicks the request and waits for the browser's answer to it. */
    const ask = async (page, expected) => {
      const asked = (await storageLog(page)).persist;
      await page.click('[data-action="ask-persistence"]');
      await until(async () => (await storageLog(page)).persist === asked + 1 && (await answer(page)) === expected && !(await page.evaluate(() => document.querySelector('[data-action="ask-persistence"]')?.disabled ?? false)), `the browser to answer "${expected}"`, 15000);
    };
    const denied = async (page, context, how) => {
      const before = await readOrigin(page);
      const from = appLog.length;
      await openScreen(page);
      check('J1', 'the request is offered as a control, and nothing was asked before the click', (await has(page, 'ask-persistence')) && (await storageLog(page)).persist === 0 && (await text(page, '[data-action="ask-persistence"]')) === 'Ask the browser to keep this site’s data');
      await ask(page, 'declined');
      const said = await text(page, '[data-persistence-answer]');
      check('J2', `a browser that does not agree (${how}): the screen says so, and that nothing changed`, (await answer(page)) === 'declined' && said === 'The browser did not agree. Some browsers decide this by themselves, without asking you. Nothing changed.' && (await panel(page)).persistence === 'best-effort', said);
      check('J3', 'the click asked the browser once', (await storageLog(page)).persist === 1, await storageLog(page));
      check('J4', 'a refusal blocks nothing: the download is still offered, with the same warning that this is not a backup', (await has(page, 'install-model')) && (await text(page, '[data-not-a-backup]')).includes('None of this is a backup.'));
      check('J5', 'asking wrote nothing and requested nothing', same(learningOf(await readOrigin(page)), learningOf(before)) && modelRequests(from).length === 0 && Object.keys((await readOrigin(page)).caches).length === 0);
      void context;
    };
    const granted = async (page, how) => {
      const said = await text(page, '[data-persistence-answer]');
      check('J6', `a browser that agrees (${how}): the screen reports the browser's statement, and says in the same breath that it is not a backup`,
        (await answer(page)) === 'granted' && said === 'The browser agreed to keep this site\'s data. That is not a backup.' && (await panel(page)).persistence === 'persistent' &&
        (await fact(page, 'persistence')) === 'The browser says that it will not remove this site\'s data by itself.' && !(await has(page, 'ask-persistence')), said);
      const all = await text(page, PANEL);
      check('J7', 'also then the screen says that the data is lost with the site\'s data, the profile or the device, and never calls it safe',
        all.includes('Whatever the browser says, the data of this site is lost when the site\'s data is cleared, with the browser profile, and with the device.') && !/\bsafe\b|guarantee|protected by|cannot be lost/i.test(all), all.slice(0, 600));
      await openScreen(page);
      check('J8', 'a fresh session reads the state from the browser and asks nothing', (await panel(page)).persistence === 'persistent' && (await storageLog(page)).persist === 0 && !(await has(page, 'ask-persistence')));
    };

    if (engine === 'chromium') {
      const { context, page } = await newProfile(browser);
      await seedAll(page);
      await denied(page, context, 'Chromium decides by itself and declines for a new profile');
      const target = await context.newCDPSession(page);
      const { targetInfo } = await target.send('Target.getTargetInfo');
      const control = await browser.newBrowserCDPSession();
      // The same screen, still open: the browser changes its mind, and the learner asks again.
      await control.send('Browser.grantPermissions', { origin, permissions: ['durableStorage'], browserContextId: targetInfo.browserContextId });
      await ask(page, 'granted');
      await granted(page, 'Chromium, with the permission granted to the profile');
      await context.close();
    } else {
      const refusing = await launch({ 'dom.storageManager.prompt.testing': true, 'dom.storageManager.prompt.testing.allow': false });
      {
        const { context, page } = await newProfile(refusing);
        await seedAll(page);
        await denied(page, context, 'Firefox, with its question answered "no"');
        await context.close();
      }
      await refusing.close();
      const allowing = await launch({ 'dom.storageManager.prompt.testing': true, 'dom.storageManager.prompt.testing.allow': true });
      {
        const { context, page } = await newProfile(allowing);
        await seedAll(page);
        await openScreen(page);
        await ask(page, 'granted');
        await granted(page, 'Firefox, with its question answered "yes"');
        await context.close();
      }
      await allowing.close();
    }

    if (engine === 'firefox') {
      // Firefox asks the learner. Here nobody answers.
      const { context, page } = await newProfile(browser);
      await openScreen(page);
      await page.click('[data-action="ask-persistence"]');
      await page.waitForTimeout(1500);
      const waiting = await text(page, '[data-action="ask-persistence"]');
      await page.click('[data-action="refresh-storage"]');
      await askToDownload(page);
      const open = await dialogState(page);
      await page.click('[data-action="cancel-install-confirm"]');
      check('J9', 'a question that the browser leaves open blocks nothing: the screen says that it waits, and everything else keeps working',
        waiting === 'Waiting for the browser’s answer…' && (await page.isDisabled('[data-action="ask-persistence"]')) && open === 'open' && (await answer(page)) === null && (await text(page, PANEL)).includes('The browser may be asking you now. Everything else on this screen keeps working.'), waiting);
      await context.close();
    } else {
      notRun.push({ id: 'J9', reason: 'Chromium answers a request to keep the data at once and never asks the learner, so a question that stays open cannot be produced there. The unit tests of the session cover it.' });
    }

    for (const [id, faults, expected, title] of [
      ['J10', { persist: 'absent' }, null, 'a browser that cannot be asked gets no control for asking'],
      ['J11', { persist: 'reject' }, 'failed', 'a request that fails is reported as failed, and nothing changed']
    ]) {
      const { context, page } = await newProfile(browser, { faults });
      await openScreen(page);
      if (expected === null) {
        check(id, `${title} (injected)`, !(await has(page, 'ask-persistence')) && (await panel(page)).persistence === 'best-effort' && (await has(page, 'install-model')));
      } else {
        await ask(page, expected);
        check(id, `${title} (injected)`, (await answer(page)) === expected && (await text(page, '[data-persistence-answer]')) === 'The browser could not be asked. Nothing changed.' && (await panel(page)).persistence === 'best-effort', await text(page, '[data-persistence-answer]'));
      }
      await context.close();
    }
  });

  // ---- K: cycles -----------------------------------------------------------------------------------------
  await part('K', 'Installing and removing again and again', async () => {
    const { context, page } = source;
    await openScreen(page);
    if ((await panel(page)).installation === 'installed') {
      await page.click('[data-action="delete-model"]');
      await until(async () => (await panel(page)).installation === 'absent', 'the model to be deleted');
    }
    const start = await readOrigin(page);
    const usage = [];
    const readUsage = () => page.evaluate(async () => { window.__storage.paused = true; const answer = await navigator.storage.estimate(); window.__storage.paused = false; return answer.usage; });
    usage.push(await readUsage());
    let passed = true;
    const details = [];
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      await openScreen(page);
      const from = appLog.length;
      await install(page);
      const installed = await readOrigin(page);
      const installedOk = isComplete(installed) && same(modelRequests(from), PINNED_IDS) && same(learningOf(installed), learningOf(start)) && same(otherCachesOf(installed), otherCachesOf(start));
      usage.push(await readUsage());
      await openScreen(page);
      await page.click('[data-action="delete-model"]');
      await until(async () => (await panel(page)).installation === 'absent', 'the model to be deleted');
      const removed = await readOrigin(page);
      const removedOk = modelEntriesOf(removed) === null && same(learningOf(removed), learningOf(start)) && same(otherCachesOf(removed), otherCachesOf(start));
      usage.push(await readUsage());
      details.push({ cycle, installedOk, removedOk });
      passed = passed && installedOk && removedOk;
    }
    await page.waitForTimeout(3000);
    await page.requestGC?.().catch(() => undefined);
    const later = await readUsage();
    check('K1', 'three rounds of install and delete, each from a fresh session: every round ends in the same two states', passed, details);
    check('K2', 'after the last round the site holds what it held before the first: the three products\' data and the other cache, and no model', same(await readOrigin(page), start));
    observe('K', `${engine}: the browser's usage estimate over the rounds, in MB: ${usage.map(megabytes).join(' → ')}, and ${megabytes(later)} three seconds later. The cache was gone after every deletion. The estimate is the browser's own bookkeeping and can stay high for a while after a deletion.`);
    void context;
  });

  // ---- L: two tabs ---------------------------------------------------------------------------------------
  await part('L', 'Two tabs', async () => {
    const { context, page } = await newProfile(browser);
    await seedAll(page);
    await openScreen(page);
    const holding = holdFile('onnx/decoder_model_merged_quantized.onnx');
    await startDownload(page);
    await holding.arrived.promise;
    await until(async () => (modelEntriesOf(await readOrigin(page)) ?? []).length === 4, 'four files to be stored', 60000);

    const second = watch(await context.newPage());
    await openScreen(second);
    check('L1', 'a second tab sees the files of the installation in progress as unfinished, not as a model', (await panel(second)).installation === 'incomplete' && !(await has(second, 'load-model')));
    const from = appLog.length;
    await startDownload(second);
    const said = await refusal(second);
    check('L2', 'its own download is refused at once: the model cache is being changed in another tab, and nothing was requested',
      said.includes('The speech model is being installed or removed at this moment, in this or another tab of this browser. This request changed nothing.') && modelRequests(from).length === 0, said);
    await second.click('[data-action="remove-model-files"]');
    await until(async () => (await notice(second)).includes('The model could not be deleted'), 'the refusal of the removal');
    const during = await readOrigin(second);
    check('L3', 'its removal is refused too, and the files of the first tab are still there', (await notice(second)).includes('This request changed nothing.') && (modelEntriesOf(during) ?? []).length === 4, modelEntriesOf(during));

    releaseHold();
    await waitPhase(page, 'ready', 180000);
    check('L4', 'the first tab completes its installation', isComplete(await readOrigin(page)));
    await second.click('[data-action="refresh-storage"]');
    await until(async () => (await panel(second)).installation === 'installed', 'the second tab to see the installation');
    // Without reopening the screen: "Read again" is enough for the controls to follow (ENG-V3-R1B-RC1).
    await until(() => has(second, 'load-model'), 'the Load control in the second tab');
    check('L5', 'the second tab then finds the complete installation and offers to load it, without reopening the screen', (await panel(second)).installation === 'installed' && (await has(second, 'load-model')) && !(await has(second, 'install-model')));
    await openScreen(second);
    check('L6', 'and the same after reopening the screen', (await panel(second)).installation === 'installed' && (await has(second, 'load-model')));
    await context.close();
  });

  // ---- M: backup and recovery with a model in the same storage ------------------------------------------------
  await part('M', 'Backup and recovery (ENG-V3-R1A) with a model in the same storage', async () => {
    const BACKUP = '[data-experimental-feature="backup-recovery"]';
    const makeBackup = async (page, name) => {
      await openApp(page, V3, '#backup');
      await page.waitForSelector(BACKUP, { timeout: 15000 });
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('[data-backup-action="make"]')]);
      await until(async () => (await page.getAttribute(BACKUP, 'data-export-phase')) === 'done', 'the export to finish');
      const saved = join(work, name);
      await download.saveAs(saved);
      return { path: saved, text: readFileSync(saved, 'utf8') };
    };

    const { page } = source;
    await openScreen(page);
    if ((await panel(page)).installation === 'installed') {
      await page.click('[data-action="delete-model"]');
      await until(async () => (await panel(page)).installation === 'absent', 'the model to be deleted');
    }
    const without = await makeBackup(page, 'backup-without-model.json');
    await openScreen(page);
    await install(page);
    const withModel = await makeBackup(page, 'backup-with-model.json');
    const a = JSON.parse(without.text);
    const b = JSON.parse(withModel.text);
    const normal = (file) => ({ ...file.sections, [OWN]: { ...file.sections[OWN], stores: Object.fromEntries(Object.entries(file.sections[OWN].stores).map(([store, records]) => [store, store === 'settings' ? records.filter(([key]) => key !== 'activePage') : records])) } });
    check('M1', 'a backup made with the model installed holds the same three sections as one made without it', same(Object.keys(b.sections), Object.keys(a.sections)) && same(normal(b), normal(a)), { sections: Object.keys(b.sections) });
    check('M2', 'the backup file holds learning data only: nothing of the model, and it is small', !/onnx|wasm|model-cache|eng-trainer-v3-models/i.test(withModel.text) && withModel.text.length < 200_000, withModel.text.length);
    const sourceState = await readOrigin(page);
    check('M3', 'making the backup left the model as it was', isComplete(sourceState));

    // A new profile: the model first, then the recovery of this product from the file.
    const lost = await newProfile(browser);
    await openScreen(lost.page);
    await install(lost.page);
    await openApp(lost.page, V3, '#backup');
    await lost.page.waitForSelector(BACKUP, { timeout: 15000 });
    await lost.page.setInputFiles('#backup-file', withModel.path);
    await until(async () => (await lost.page.getAttribute(BACKUP, 'data-restore-phase')) === 'preview', 'the file to be checked');
    await lost.page.click(`[data-backup-action="recover"][data-backup-product="${OWN}"]`);
    await until(() => lost.page.evaluate(() => document.querySelector('dialog.dialog')?.open === true), 'the confirmation');
    await lost.page.click('[data-backup-action="confirm-recover"]');
    await until(async () => (await lost.page.evaluate(() => document.querySelector('[data-backup-outcome]')?.getAttribute('data-backup-outcome') ?? null)) !== null, 'the result of the recovery', 30000);
    const outcome = await lost.page.evaluate(() => document.querySelector('[data-backup-outcome]')?.getAttribute('data-backup-outcome'));
    const recovered = await readOrigin(lost.page);
    check('M4', 'in a profile that holds a model, the recovery of this product succeeds and every store equals the backup',
      outcome === 'success' && same(recovered.databases[V3_NAME].stores, Object.fromEntries(Object.entries(b.sections[OWN].stores))), outcome);
    check('M5', 'the recovery left the model cache as it was', isComplete(recovered));
    await openScreen(lost.page);
    await lost.page.click('[data-action="load-model"]');
    await waitPhase(lost.page, 'ready', 120000);
    check('M6', 'after the recovery the model still loads and recording is offered', await has(lost.page, 'record'));
    await lost.page.click('[data-action="delete-model"]');
    await until(async () => (await panel(lost.page)).installation === 'absent', 'the model to be deleted');
    const end = await readOrigin(lost.page);
    check('M7', 'deleting the model afterwards leaves the recovered learning data as it is', modelEntriesOf(end) === null && same(learningOf(end), learningOf(recovered)));
    await lost.context.close();
  });

  // ---- O: two tabs, and a screen that is not reopened (ENG-V3-R1B-RC1, F1) -------------------------------------
  await part('O', 'Two tabs and a screen that is not reopened: loading never downloads', async () => {
    const GONE = 'The speech model is not in this browser any more. It may have been removed in another tab. Nothing was downloaded. To record, download the model again.';
    const { context, page: a } = await newProfile(browser);
    await seedAll(a);
    const learning = learningOf(await readOrigin(a));
    await openScreen(a);
    await install(a);
    await openScreen(a);
    const b = watch(await context.newPage());
    await openScreen(b);
    const deleteIn = async (tab) => {
      await tab.click('[data-action="delete-model"]');
      await until(async () => (await panel(tab)).installation === 'absent', 'the model to be deleted');
    };

    // B removes the model. A is not told and still offers "Load".
    await deleteIn(b);
    check('O1', 'after the other tab removed the model, this tab still shows "Load": it was not told', (await has(a, 'load-model')) && (await panel(a)).installation === 'installed');
    let from = appLog.length;
    await a.click('[data-action="load-model"]');
    await until(async () => (await notice(a)) !== '', 'the refusal of the load');
    let origin1 = await readOrigin(a);
    check('O2', 'the click on that stale "Load" requests no model file and no runtime, and the question before a download stays closed',
      modelRequests(from).length === 0 && (await dialogState(a)) === 'closed' && (await phase(a)) === 'no-model' && a.workers().length === 0, modelRequests(from));
    check('O3', 'the screen says that the model is no longer here, and offers a download in place of "Load"',
      (await notice(a)).includes(GONE) && !(await has(a, 'load-model')) && (await has(a, 'install-model')) && (await panel(a)).installation === 'absent', await notice(a));
    check('O4', 'loading created no cache, and the learning data of all three products is unchanged', Object.keys(origin1.caches).length === 0 && same(learningOf(origin1), learning), Object.keys(origin1.caches));

    // The download is a request of its own: a question first, and nothing before the confirmation.
    from = appLog.length;
    await askToDownload(a);
    check('O5', 'a download has to be asked for again: the question opens, and nothing is requested before it is confirmed', (await dialogState(a)) === 'open' && modelRequests(from).length === 0 && (await a.isDisabled('[data-action="confirm-install"]')));
    await a.check('[data-control="backup-acknowledged"]');
    await a.click('[data-action="confirm-install"]');
    await waitPhase(a, 'ready', 180000);
    check('O6', 'after the confirmation the model is installed again', same(modelRequests(from), PINNED_IDS) && isComplete(await readOrigin(a)), modelRequests(from));

    // The reviewer's sequence: B removes, A reads again, A loads.
    await openScreen(a);
    await openScreen(b);
    await deleteIn(b);
    from = appLog.length;
    await a.click('[data-action="refresh-storage"]');
    await until(async () => (await panel(a)).installation === 'absent', 'this tab to see that the model is gone');
    check('O7', '"Read again" takes the "Load" control away and offers the download, without reopening the screen', !(await has(a, 'load-model')) && !(await has(a, 'delete-model')) && (await has(a, 'install-model')) && modelRequests(from).length === 0);

    // The other direction: B installs, A reads again and loads.
    await install(b);
    from = appLog.length;
    check('O8', 'after the other tab installed the model, this tab still shows "Download": it was not told', (await has(a, 'install-model')) && (await panel(a)).installation === 'absent');
    await a.click('[data-action="refresh-storage"]');
    await until(async () => (await panel(a)).installation === 'installed', 'this tab to see the installation');
    check('O9', '"Read again" offers "Load" in place of the download, without reopening the screen', (await has(a, 'load-model')) && !(await has(a, 'install-model')));
    await a.click('[data-action="load-model"]');
    await waitPhase(a, 'ready', 120000);
    check('O10', 'loading requests no model file and no runtime: the files come from the browser', modelRequests(from).length === 0 && (await has(a, 'record')), modelRequests(from));

    // A model in memory and a model on the device. B gave its own model back when it was left; A's stays loaded.
    await openScreen(b);
    await deleteIn(b);
    await a.click('[data-action="refresh-storage"]');
    await until(async () => (await panel(a)).installation === 'absent', 'this tab to see that the files are gone');
    const said = await fact(a, 'installation');
    check('O11', 'the files are removed in the other tab while the model is loaded here: it stays loaded, and recording is still offered',
      (await phase(a)) === 'ready' && (await has(a, 'record')) && a.workers().length === 1 && modelRequests(from).length === 0, await phase(a));
    check('O12', 'the screen tells the two apart: not on the device, still in memory, and not to be loaded again without a download',
      said === 'Not in this browser. The model that is loaded now stays in memory until you leave this screen. It cannot be loaded again without a new download.' && !(await has(a, 'delete-model')) && !(await has(a, 'load-model')) && !(await has(a, 'install-model')), said);
    const end = await readOrigin(a);
    check('O13', 'through all of it the learning data of all three products stayed the same', same(learningOf(end), learning) && Object.keys(end.caches).length === 0);
    await context.close();
  });

  // ---- P: a browser that cannot coordinate its tabs (ENG-V3-R1B-RC1, F2) -----------------------------------------
  await part('P', 'A browser that cannot coordinate its tabs', async () => {
    const WHY = 'This browser has no way to make sure that only one tab changes the speech model at a time. Without that, one tab could remove files that another tab has just stored. So nothing is downloaded and nothing is removed here.';
    {
      const { context, page } = await newProfile(browser, { faults: {} });
      await seedAll(page);
      const learning = learningOf(await readOrigin(page));
      await page.goto('about:blank');
      await page.goto(`${V3}#pronunciation`, { waitUntil: 'load' });
      await setFault(page, 'locks', 'absent');
      await page.waitForSelector(`${SCREEN}:not([data-phase="checking"])`, { timeout: 40000 });
      await page.click('[data-action="refresh-storage"]');
      await until(async () => (await text(page, '[data-no-coordination]')) !== '', 'the explanation');
      const from = appLog.length;
      check('P1', 'without Web Locks no download is offered, and the screen says why (injected)', !(await has(page, 'install-model')) && !(await has(page, 'check-storage')) && (await text(page, '[data-no-coordination]')) === WHY, await text(page, '[data-no-coordination]'));
      const after = await readOrigin(page);
      check('P2', 'nothing was requested, no cache was created, no lock was asked for, and the learning data is unchanged (injected)',
        modelRequests(from).length === 0 && Object.keys(after.caches).length === 0 && (await storageLog(page)).locks.length === 0 && same(learningOf(after), learning));
      await context.close();
    }
    {
      // A model is installed while the browser has its locks. Then the locks are gone, and the screen was not told.
      const { context, page } = await newProfile(browser);
      await seedAll(page);
      await openScreen(page);
      await install(page);
      await openScreen(page);
      const before = await readOrigin(page);
      await setFault(page, 'locks', 'absent');
      check('P3', 'the "Delete" control is still on the screen: it was rendered before the locks went away (injected)', await has(page, 'delete-model'));
      await page.click('[data-action="delete-model"]');
      await until(async () => (await notice(page)).includes('The model could not be deleted'), 'the refusal of the removal');
      const said = await notice(page);
      const after = await readOrigin(page);
      check('P4', 'the removal is refused with the reason, and nothing of the model was removed (injected)',
        said.includes('This browser cannot make sure that only one tab changes the speech model at a time (it has no Web Locks).') && said.includes('This request changed nothing.') && isComplete(after) && same(after, before), said);
      check('P5', 'after that the screen offers no removal, says why, and still offers to load the model that is here (injected)',
        !(await has(page, 'delete-model')) && (await has(page, 'load-model')) && (await text(page, '[data-no-coordination]')) === `${WHY} The model that is in this browser can still be loaded.`, await text(page, '[data-no-coordination]'));
      const from = appLog.length;
      await page.click('[data-action="load-model"]');
      await waitPhase(page, 'ready', 120000);
      check('P6', 'loading changes nothing in the cache and needs no lock: the model loads, and nothing is requested (injected)', modelRequests(from).length === 0 && isComplete(await readOrigin(page)));
      await context.close();
    }
    {
      // The browser has a lock manager, and it gives no lock.
      const { context, page } = await newProfile(browser);
      await openScreen(page);
      await setFault(page, 'locks', 'reject');
      const from = appLog.length;
      await startDownload(page);
      const said = await refusal(page);
      check('P7', 'a lock that the browser does not give: the confirmed download is refused with the reason, and nothing is requested or stored (injected)',
        said.includes('This browser cannot make sure that only one tab changes the speech model at a time (the browser gave no lock: The operation is insecure.)') && modelRequests(from).length === 0 && Object.keys((await readOrigin(page)).caches).length === 0, said);
      await setFault(page, 'locks', null);
      await install(page);
      check('P8', 'with the lock given again, the same download installs', isComplete(await readOrigin(page)));
      await context.close();
    }
  });

  // ---- Q: what a successful download says about the headroom (ENG-V3-R1B-RC1, F3) ---------------------------------
  await part('Q', 'A download that succeeds does not prove the headroom', async () => {
    const LIMITS = `These numbers are the browser's estimate. They are approximate, and the trainer cannot reserve storage. A download that succeeds does not mean that ${size(RESERVE_BYTES)} are left afterwards. A later save of learning data, or a recovery from a backup, can still be refused for lack of room.`;
    const KEPT = /stays? free|kept free|keeps? free|is reserved|are reserved|guarantee/i;
    const { context, page } = await newProfile(browser);
    await seedAll(page);
    const learning = learningOf(await readOrigin(page));
    await openScreen(page);
    check('Q1', 'the screen calls the numbers an estimate and says that nothing is reserved', (await text(page, '[data-estimate-limits]')) === LIMITS, await text(page, '[data-estimate-limits]'));
    await askToDownload(page);
    const question = await text(page, DIALOG);
    check('Q2', 'the question before a download says the same: less room can be left than the estimate says, and a later save or recovery can then be refused',
      question.includes('it cannot reserve storage. The numbers are estimates: the browser can still refuse to store a file, and after the download less room can be left than the estimate says. A later save of learning data, or a recovery from a backup, can then be refused.'), question);
    check('Q3', 'neither says that room stays free, is kept, is reserved or is guaranteed', !KEPT.test(await text(page, PANEL)) && !KEPT.test(question));
    await page.click('[data-action="cancel-install-confirm"]');

    if (engine === 'chromium') {
      // The reviewer's counterexample: a limit of 60 MB that the browser enforces and that its estimate does not show.
      const cdp = await context.newCDPSession(page);
      await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 60 * MEGABYTE });
      await page.click('[data-action="refresh-storage"]');
      await page.waitForTimeout(300);
      const offered = (await panel(page)).capacity;
      await install(page);
      const real = await cdp.send('Storage.getUsageAndQuota', { origin });
      const left = real.quota - real.usage;
      check('Q4', 'with a real limit of 60 MB the estimate still allows the download, and it succeeds', offered === 'sufficient' && isComplete(await readOrigin(page)) && real.overrideActive === true && real.quota === 60 * MEGABYTE, { offered, real: { usage: real.usage, quota: real.quota } });
      check('Q5', 'what is really left is less than the headroom that was asked for: a download that succeeds proved nothing about it', left < RESERVE_BYTES && left > 0, { left, headroom: RESERVE_BYTES });
      await openScreen(page);
      check('Q6', 'the screen does not claim otherwise after the download: the same words about the estimate, and still "not a backup"',
        (await text(page, '[data-estimate-limits]')) === LIMITS && !KEPT.test(await text(page, PANEL)) && (await text(page, '[data-not-a-backup]')).includes('None of this is a backup.'));
      check('Q7', 'the learning data of all three products is unchanged', same(learningOf(await readOrigin(page)), learning));
      observe('Q', `chromium: with a limit of 60 MB the model was installed. The browser then reported usage ${real.usage} of ${real.quota} bytes: ${megabytes(left)} MB left, where ${megabytes(RESERVE_BYTES)} MB of headroom had been asked for. The page's own estimate still showed a limit of gigabytes.`);
      await cdp.send('Storage.overrideQuotaForOrigin', { origin });
    } else {
      notRun.push({ id: 'Q4', reason: 'In Firefox a limit for the site shows in the estimate, so with 60 MB the download is refused before it starts (parts B and F). The counterexample needs a limit that the estimate does not show, which is Chromium.' });
    }
    await context.close();
  });

  if (source) await source.context.close();

  await part('N', 'Pages and hosts', async () => {
    check('N1', 'no page reported an uncaught error', pageProblems.length === 0, pageProblems.slice(0, 5));
    // The first version asks a font host for its icons when it is opened to hold its made-up data. That request is refused here.
    check('N2', 'the experimental and the stable product requested nothing from another host; only the first version asked for its web fonts', offOrigin.every((url) => /fonts\.(googleapis|gstatic)\.com/.test(url)), offOrigin.slice(0, 5));
  });
} finally {
  releaseHold();
  for (const instance of launched) await instance.close().catch(() => undefined);
  server.close();
  rmSync(work, { recursive: true, force: true });
}

// ---- Summary ----------------------------------------------------------------------------

const failed = checks.filter((item) => !item.pass);
const injected = checks.filter((item) => /\(injected/.test(item.title)).map((item) => item.id);
console.log(`\n${engine} ${browserVersion}: ${checks.length - failed.length} of ${checks.length} checks passed.${notRun.length ? ` Not run: ${notRun.map((item) => item.id).join(', ')}.` : ''}`);
console.log(`Injected states (the browser could not be put into them for real): ${injected.join(', ') || 'none'}.`);
if (outFile) {
  writeFileSync(resolve(outFile), `${JSON.stringify({ test: 'model-storage', engine, version: browserVersion, parts: only ?? 'all', passed: checks.length - failed.length, total: checks.length, injected, notRun, observations, checks }, null, 2)}\n`);
}
process.exit(failed.length ? 1 : 0);
