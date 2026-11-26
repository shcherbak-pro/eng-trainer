// Browser acceptance test of backup and recovery (ENG-V3-R1A, ENG-V3-R1A-RC1, ENG-V3-R1A-RC2, ENG-V3-R1A-RC3).
//
// It runs the three built products from one origin in a real browser, on a server that
// sends no policy header, as GitHub Pages does. Every browser profile is new and
// disposable, and all learning data in it is made up by this script.
//
//   npm run prototype:build
//   node scripts/acceptance/backup.mjs <chromium|firefox> [--out <result.json>] [--keep <backup.json>]
//
// Playwright is not a dependency of this repository. Name an installed copy:
//   PROBE_PLAYWRIGHT=<folder of a "playwright" package>   and, if needed, PLAYWRIGHT_BROWSERS_PATH
//
// Parts:
//   A  a profile with made-up data of all three products, each accepted by its own product
//   B  making a backup: explicit, read-only, complete, with matching digests
//   C  recovery of the experimental product in a new profile, from the file alone
//   D  files and destinations that are refused, with nothing changed
//   E  an interrupted recovery of the experimental product, and one that was written but whose
//      check failed: the tab then saves nothing of its old state, whatever the learner does
//   F  recovery of the stable product through the Backup screen: its storage is never created
//      from here, it is written in one transaction, and refused, failed and interrupted
//      recoveries leave it as it was. A recovery whose check failed is not "nothing recovered"
//   G  recovery of the first version through the Backup screen: two records, and a recovery
//      that stops between them is reported as incomplete and can be completed. Every
//      confirmation warns about other tabs
//   H  all three products from one file after a complete loss, and the products stay apart
//   J  the handover from the running application to a recovery of the experimental product:
//      a save that is being written, a change queued behind it and a change that could not be
//      saved are all kept, a refused or rolled-back recovery loads nothing again, and while the
//      recovery writes the tab accepts no change and keeps the Backup screen open
//   I  no error on a page, and no request to another host
//
// It exits with 1 when a check fails. It changes no tracked file and no build.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TEST_SITE_DIR } from '../generated-dirs.mjs';
import { HOST, createPrototypeHandler } from '../prototype/server.mjs';
import { repoRoot } from '../site-config.mjs';

// ---- Arguments -----------------------------------------------------------------------

const [engine, ...rest] = process.argv.slice(2);
const option = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
const outFile = option('--out');
const keepFile = option('--keep');
if (!['chromium', 'firefox'].includes(engine) || !process.env.PROBE_PLAYWRIGHT) {
  console.error('Usage: PROBE_PLAYWRIGHT=<playwright package> node scripts/acceptance/backup.mjs <chromium|firefox> [--out <result.json>] [--keep <backup.json>]');
  process.exit(2);
}
if (!existsSync(join(repoRoot, TEST_SITE_DIR, 'v3', 'index.html'))) {
  console.error(`The local assembly is missing (${TEST_SITE_DIR}/). Run: npm run prototype:build`);
  process.exit(2);
}
const playwright = createRequire(import.meta.url)(process.env.PROBE_PLAYWRIGHT);

// ---- Results --------------------------------------------------------------------------

const checks = [];
/** What a browser was seen to do where more than one outcome is safe. */
const observations = [];
function check(id, title, pass, detail = '') {
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
  checks.push({ id, title, pass: Boolean(pass), detail: pass ? '' : String(text).slice(0, 900) });
  console.log(`${pass ? 'pass' : 'FAIL'}  ${id}  ${title}${pass ? '' : `\n        ${String(text).slice(0, 900)}`}`);
}

// ---- Made-up data ---------------------------------------------------------------------

const V3_NAME = 'eng-trainer-v3';
const V2_NAME = 'eng-trainer-v2';
const V1_STATE_KEY = 'englishAssessmentTrainer.svelteState.v1';
const V1_THEME_KEY = 'englishAssessmentTrainer.theme.v1';
const STORES = ['progress', 'learnPasses', 'flashcardSessions', 'settings', 'userCollections', 'userEntries'];
const OWN = 'experimental-v3';
const STABLE = 'stable-v2';
const LEGACY = 'legacy-v1';

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
/** Learning data that a product holds on a device where a recovery must be refused. */
const OTHER_LEARNING = { progress: { learnedPhrases: ['phrase-learned-on-this-device'] } };

// ---- Canonical JSON and digests, written again here so the application's own are checked from outside --------

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const same = (a, b) => canonical(a) === canonical(b);
const pairsOf = (records) => Object.keys(records).sort().map((key) => [key, records[key]]);

// ---- Server ---------------------------------------------------------------------------

/** Every request the application's server received, in order. */
const appLog = [];
const server = createServer(createPrototypeHandler({ intercept: ({ path }) => { appLog.push(path); return false; } }));
await new Promise((resolveStart, reject) => { server.once('error', reject); server.listen(0, HOST, resolveStart); });
const origin = `http://${HOST}:${server.address().port}`;
const V3 = `${origin}/eng-trainer/v3/`;
const V2 = `${origin}/eng-trainer/`;
const V1 = `${origin}/eng-trainer/v1/`;
/** A file of the site that runs no application: the test prepares storage from here. */
const NEUTRAL = `${origin}/eng-trainer/fonts/OFL-Literata.txt`;
/** The request for the recovery writer, as the server sees it. */
const isWriterRequest = (path) => /\/v3\/assets\/recoveryWriter-[\w-]+\.js$/.test(path);

// ---- Browser helpers ------------------------------------------------------------------

const browser = await playwright[engine].launch({ headless: true });
const work = mkdtempSync(join(tmpdir(), 'eng-trainer-backup-acceptance-'));
const offOrigin = [];
const pageProblems = [];

/**
 * Records what a page does with storage. It changes no behaviour. While `paused` is set the
 * test itself is reading or seeding storage, and that is not recorded.
 */
const STORAGE_LOG = `(() => {
  const log = (window.__storageLog = { paused: false, open: [], modes: [], created: [], getItem: [], setItem: [], removeItem: [], clear: [], deleteDatabase: [] });
  const note = (list, value) => { if (!log.paused) list.push(value); };
  const open = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (name, version) { note(log.open, version === undefined ? String(name) : String(name) + '@' + version); return open.apply(this, arguments); };
  const remove = IDBFactory.prototype.deleteDatabase;
  IDBFactory.prototype.deleteDatabase = function (name) { note(log.deleteDatabase, String(name)); return remove.apply(this, arguments); };
  const transaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (stores, mode) { note(log.modes, this.name + ':' + (mode || 'readonly')); return transaction.apply(this, arguments); };
  const create = IDBDatabase.prototype.createObjectStore;
  IDBDatabase.prototype.createObjectStore = function (name) { note(log.created, this.name + ':' + name); return create.apply(this, arguments); };
  for (const name of ['getItem', 'setItem', 'removeItem', 'clear']) {
    const original = Storage.prototype[name];
    Storage.prototype[name] = function (...args) { if (this === window.localStorage) note(log[name], String(args[0])); return original.apply(this, args); };
  }
})();`;

/**
 * Faults for parts E, F and G, switched on from the test.
 *
 * - `window.__fault` is for a database: a write that throws, a page that stops before write
 *   number `at`, and a page that stops between the two requests of the guard (`hang-add`).
 * - `window.__recordFault` is for the key-value storage: the write of one record throws, or
 *   the page stops before it.
 *
 * A stopped page runs no further script, so the test can close it while a part of the
 * writes was issued and the rest was not.
 */
const WRITE_FAULTS = `(() => {
  const stop = (holdMs) => {
    console.log('__fault:hang');
    const end = Date.now() + holdMs;
    while (Date.now() < end) { /* the page is busy and cannot continue the recovery */ }
  };
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const fault = window.__fault;
    if (fault && this.transaction.db.name === fault.db && fault.kind !== 'hang-add') {
      fault.calls += 1;
      if (fault.calls === fault.at) {
        if (fault.kind === 'throw') throw new DOMException('injected write failure', 'UnknownError');
        if (fault.kind === 'hang') stop(fault.holdMs);
      }
    }
    return put.apply(this, args);
  };
  const add = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (...args) {
    const fault = window.__fault;
    if (fault && this.transaction.db.name === fault.db && fault.kind === 'hang-add') stop(fault.holdMs);
    return add.apply(this, args);
  };
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    const fault = window.__recordFault;
    if (fault && this === window.localStorage && key === fault.key) {
      if (fault.kind === 'throw') throw new DOMException('injected write failure', 'QuotaExceededError');
      if (fault.kind === 'hang') stop(fault.holdMs);
    }
    return setItem.apply(this, arguments);
  };
})();`;

/**
 * Holds and faults for part J, installed in a page that is already open and switched on from
 * the test (`window.__handover`). Everything else stays real: the saves, the recovery, the
 * loading of the state. This follows the probe of the independent review.
 *
 * - `holdOpen`: the next request of this product's database without a version (that is the
 *   recovery's own) is answered, and its answer is handed over only when `releaseOpen()` is called;
 * - `holdSave`: the next save of the running application is kept open by extra reads in its
 *   transaction until `releaseSave` is set. `holdRecovery` and `releaseRecovery` do the same
 *   for the recovery's transaction. No record is made up;
 * - `failSave`: the browser refuses every save of the running application;
 * - `recoveryTransactions` counts the transactions of a recovery, and `stateReads` the reads
 *   of the whole saved state, as the application does one at start-up and after a recovery.
 */
const HANDOVER_HOOKS = `(() => {
  if (window.__handover) return;
  const state = (window.__handover = { holdOpen: false, openHeld: false, releaseOpen: null, holdSave: false, saveHeld: false, releaseSave: false, failSave: false, failedSaves: 0, holdRecovery: false, recoveryHeld: false, releaseRecovery: false, recoveryTransactions: 0, stateReads: 0, timedOut: false });
  const OWN = 'eng-trainer-v3';
  const RECOVERY_STORES = 7;
  const STATE_STORES = 6;
  const testReads = () => Boolean(window.__storageLog && window.__storageLog.paused);
  const open = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (...args) {
    const request = open.apply(this, args);
    if (state.holdOpen && args[0] === OWN && args.length === 1 && !testReads()) {
      state.holdOpen = false;
      Object.defineProperty(request, 'onsuccess', { configurable: true, set(handler) {
        request.addEventListener('success', (event) => { state.openHeld = true; state.releaseOpen = () => handler.call(request, event); }, { once: true });
      } });
    }
    return request;
  };
  const keepOpen = (store, released) => {
    const deadline = Date.now() + 20000;
    const keep = () => {
      if (Date.now() >= deadline) { state.timedOut = true; return; }
      if (released()) return;
      store.get('__kept_open_by_the_test__').onsuccess = keep;
    };
    keep();
  };
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const transaction = this.transaction;
    const own = transaction.db.name === OWN && !testReads();
    const recovery = own && transaction.objectStoreNames.length === RECOVERY_STORES;
    const save = own && !recovery;
    if (save && state.failSave) { state.failedSaves += 1; throw new DOMException('injected: the save was refused', 'QuotaExceededError'); }
    const request = put.apply(this, args);
    if (save && state.holdSave && !state.saveHeld) { state.saveHeld = true; keepOpen(this, () => state.releaseSave); }
    if (recovery && state.holdRecovery && !state.recoveryHeld) { state.recoveryHeld = true; keepOpen(this, () => state.releaseRecovery); }
    return request;
  };
  const transaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (names, mode, ...rest) {
    if (this.name === OWN && !testReads()) {
      const stores = typeof names === 'string' ? 1 : Array.from(names).length;
      if (mode === 'readwrite' && stores === RECOVERY_STORES) state.recoveryTransactions += 1;
      if ((mode || 'readonly') === 'readonly' && stores === STATE_STORES) state.stateReads += 1;
    }
    return transaction.call(this, names, mode, ...rest);
  };
})();`;

/** Reports errors of a page of the experimental product. */
function watch(page) {
  page.on('pageerror', (error) => pageProblems.push(`${page.url()} : ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && page.url().startsWith(V3)) pageProblems.push(`${page.url()} : console: ${message.text()}`);
  });
  return page;
}

/** A new, empty browser profile. Requests to any other host are refused and recorded. */
async function newProfile({ faults = false } = {}) {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith('blob:') || url.startsWith('data:')) return route.continue();
    offOrigin.push(url);
    return route.abort();
  });
  await context.addInitScript(STORAGE_LOG);
  if (faults) await context.addInitScript(WRITE_FAULTS);
  const page = watch(await context.newPage());
  return { context, page };
}

async function until(read, what, timeoutMs = 15000) {
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
  await page.goto(`${url}${hash}`, { waitUntil: 'load' });
  await until(() => page.evaluate(() => Boolean(document.querySelector('.app-shell, .app, main'))), `the application at ${url}`);
  // The application has read its saved state when its first screen is shown.
  await page.waitForTimeout(400);
}

/** Another tab of the same profile opens a product once and is closed again, as a learner does who follows a link. */
async function openOnce(context, url) {
  const page = watch(await context.newPage());
  await openApp(page, url);
  await page.close();
}

const text = (page, selector = 'body') => page.evaluate((target) => (document.querySelector(target)?.textContent ?? '').replace(/\s+/g, ' ').trim(), selector);
const storageLog = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__storageLog)));
/** The part of the storage log that was recorded after an earlier reading of it. */
async function logSince(page, earlier) {
  const now = await storageLog(page);
  return Object.fromEntries(Object.entries(now).filter(([, list]) => Array.isArray(list)).map(([name, list]) => [name, list.slice(earlier[name].length)]));
}
const pauseLog = (page, paused) => page.evaluate((value) => { if (window.__storageLog) window.__storageLog.paused = value; }, paused);
/** True when a recorded list holds no write of any kind. */
const wroteNoRecord = (log) => !log.setItem.length && !log.removeItem.length && !log.clear.length && !log.deleteDatabase.length;

/** Everything the origin's storage holds: every database with every record, the key-value storage, the caches. */
async function snapshot(page) {
  await pauseLog(page, true);
  try {
    return await readStorage(page);
  } finally {
    await pauseLog(page, false);
  }
}

function readStorage(page) {
  return page.evaluate(async () => {
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
    return { databases, records, caches: 'caches' in self ? await caches.keys() : [] };
  });
}

/** Writes records into a database that already exists, as an earlier session of its product would have. */
async function seedDatabase(page, name, stores) {
  await pauseLog(page, true);
  await page.evaluate(async ({ name, stores }) => {
    const database = await new Promise((done, fail) => { const request = indexedDB.open(name); request.onsuccess = () => done(request.result); request.onerror = () => fail(request.error); });
    const transaction = database.transaction(Object.keys(stores), 'readwrite');
    for (const [store, records] of Object.entries(stores)) for (const [key, value] of Object.entries(records)) transaction.objectStore(store).put(value, key);
    await new Promise((done, fail) => { transaction.oncomplete = done; transaction.onabort = () => fail(transaction.error); });
    database.close();
  }, { name, stores });
  await pauseLog(page, false);
}

/** Creates a database with a version and stores of the test's choosing: a schema that the application must leave alone. */
async function createDatabase(page, name, version, storeNames) {
  await pauseLog(page, true);
  await page.evaluate(async ({ name, version, storeNames }) => {
    const database = await new Promise((done, fail) => {
      const request = indexedDB.open(name, version);
      request.onupgradeneeded = () => { for (const store of storeNames) request.result.createObjectStore(store); };
      request.onsuccess = () => done(request.result);
      request.onerror = () => fail(request.error);
    });
    database.close();
  }, { name, version, storeNames });
  await pauseLog(page, false);
}

/** Writes storage from another tab of the same profile, while the Backup screen stays open. */
async function fromAnotherTab(context, action) {
  const page = await context.newPage();
  await page.goto(NEUTRAL, { waitUntil: 'load' });
  try {
    return await action(page);
  } finally {
    await page.close();
  }
}

const backupScreen = '[data-experimental-feature="backup-recovery"]';
const phaseOf = (page, attribute) => page.evaluate(([selector, name]) => document.querySelector(selector)?.getAttribute(name) ?? null, [backupScreen, attribute]);

async function openBackupScreen(page) {
  await openApp(page, V3, '#backup');
  await until(() => page.evaluate((selector) => Boolean(document.querySelector(selector)), backupScreen), 'the Backup screen');
}

/** Selects a file on the Backup screen and waits until it was checked. */
async function chooseFile(page, file) {
  await page.setInputFiles('#backup-file', file);
  await until(async () => (await phaseOf(page, 'data-restore-phase')) === 'preview' || (await page.evaluate(() => Boolean(document.querySelector('[data-backup-problem]')))), 'the file to be checked');
}

const sectionOf = (product) => `[data-backup-section="${product}"]`;
const recoverButton = (product) => `[data-backup-action="recover"][data-backup-product="${product}"]`;
const destinationOf = (page, product) => page.evaluate((selector) => document.querySelector(`${selector} [data-backup-destination]`)?.getAttribute('data-backup-destination') ?? null, sectionOf(product));
/** Whether the recovery of one part is offered: its button exists only then. */
const offered = (page, product) => page.evaluate((selector) => Boolean(document.querySelector(selector)), recoverButton(product));
const offeredParts = (page) => page.evaluate(() => [...document.querySelectorAll('[data-backup-action="recover"]')].map((button) => button.getAttribute('data-backup-product')));
const outcomeOf = (page) => page.evaluate(() => document.querySelector('[data-backup-outcome]')?.getAttribute('data-backup-outcome') ?? null);
const dialogOpen = (page) => page.evaluate(() => document.querySelector('dialog.dialog')?.open === true);
const waitForDestination = (page, product, state) => until(async () => (await destinationOf(page, product)) === state, `the destination of ${product} to be ${state}`);

/** Opens the confirmation for one part of the file. */
async function askFor(page, product) {
  await page.click(recoverButton(product));
  await until(() => dialogOpen(page), 'the confirmation');
}

/** Asks for one part, confirms, and waits for the result. Returns "success" or "error". */
async function recoverPart(page, product) {
  await askFor(page, product);
  await page.click('[data-backup-action="confirm-recover"]');
  // The confirmation stays open while the recovery runs, and the result is set before it closes.
  await until(async () => !(await dialogOpen(page)) && (await phaseOf(page, 'data-restore-phase')) !== 'restoring' && (await outcomeOf(page)) !== null, `the result of the recovery of ${product}`);
  return outcomeOf(page);
}

/** Confirms a recovery during which the page stops, and closes the page while it is stopped. */
async function stopAndClose(page, product) {
  const stopped = new Promise((done) => page.on('console', (message) => { if (message.text() === '__fault:hang') done(true); }));
  await askFor(page, product);
  // The click is not awaited: the page stops while it handles it.
  page.click('[data-backup-action="confirm-recover"]', { noWaitAfter: true, timeout: 20000 }).catch(() => undefined);
  const reached = await Promise.race([stopped, new Promise((done) => setTimeout(() => done(false), 10000))]);
  const closedWhileStopped = await Promise.race([page.close({ runBeforeUnload: false }).then(() => true), new Promise((done) => setTimeout(() => done(false), 5000))]);
  return { reached, closedWhileStopped };
}

/**
 * The fault of the independent review: a listing of the databases is refused by the storage.
 * `once` refuses the next listing only: in a recovery that is the read-back after the commit.
 * `always` refuses every listing until it is switched off. The test's own reading of the
 * storage uses the listing too, so it reads only while no fault is armed.
 */
const armListingFault = (page, mode) => page.evaluate((value) => {
  if (!window.__listing) {
    const list = indexedDB.databases.bind(indexedDB);
    window.__listing = { mode: null, refused: 0 };
    indexedDB.databases = () => {
      const fault = window.__listing;
      if (fault.mode === null) return list();
      if (fault.mode === 'once') fault.mode = null;
      fault.refused += 1;
      return Promise.reject(new DOMException('Injected post-commit read failure', 'UnknownError'));
    };
  }
  window.__listing.mode = value;
}, mode);
const listingsRefused = (page) => page.evaluate(() => window.__listing?.refused ?? 0);
/** Confirms the open confirmation and waits for the result, without reading the storage. */
async function confirmAndWait(page, what) {
  await page.click('[data-backup-action="confirm-recover"]');
  await until(async () => (await outcomeOf(page)) !== null && !(await dialogOpen(page)), what);
  return outcomeOf(page);
}
const reloadOffered = (page) => page.evaluate((selector) => [...document.querySelectorAll(`${selector} button`)].some((button) => button.textContent.trim() === 'Reload page'), backupScreen);
const OTHER_TABS_OF_V1 = 'Close every tab of the previous version first. A tab that stays open could later save its older state over the recovered data.';

const asFile = (name, content) => ({ name, mimeType: 'application/json', buffer: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8') });
/** A database without the one record that the guard of a recovery may leave: an empty list of learned phrases. */
const withoutEmptyGuardRecord = (database) => ({ ...database, stores: { ...database.stores, progress: database.stores.progress.filter(([key, value]) => !(key === 'learnedPhrases' && Array.isArray(value) && value.length === 0)) } });

// ---- The run --------------------------------------------------------------------------

let exported = null;
try {
  // ---- A. A profile with made-up data of all three products ---------------------------
  const source = await newProfile();
  {
    const { page } = source;
    await openApp(page, V2);
    await seedDatabase(page, V2_NAME, syntheticStores(2));
    await openApp(page, V2);
    const stable = await text(page);
    check('A1', 'the stable product starts on the made-up data: its strict reader accepts the collection', stable.includes('Synthetic collection 2') && stable.includes('2 entries'), stable.slice(0, 300));
    check('A2', 'the stable product applies the saved theme', (await page.evaluate(() => document.documentElement.dataset.themePreference)) === 'dark');

    await openApp(page, V1);
    await page.evaluate(([stateKey, themeKey, state]) => { localStorage.setItem(stateKey, state); localStorage.setItem(themeKey, 'dark'); }, [V1_STATE_KEY, V1_THEME_KEY, JSON.stringify(V1_SYNTHETIC)]);
    await openApp(page, V1);
    const legacyState = JSON.parse(await page.evaluate((key) => localStorage.getItem(key), V1_STATE_KEY));
    check('A3', 'the first version starts on the made-up data and keeps it in its own form', same(legacyState.learnedPhrases, V1_SYNTHETIC.learnedPhrases) && same(legacyState.flashcardSessions, V1_SYNTHETIC.flashcardSessions) && (await page.evaluate((key) => localStorage.getItem(key), V1_THEME_KEY)) === 'dark', legacyState);

    await openApp(page, V3);
    await seedDatabase(page, V3_NAME, syntheticStores(3));
    await openApp(page, V3);
    const experimental = await text(page);
    check('A4', 'the experimental product starts on its own made-up data, and shows nothing of the stable product', experimental.includes('Synthetic collection 3') && !experimental.includes('Synthetic collection 2'), experimental.slice(0, 300));
  }

  // ---- B. Making a backup -------------------------------------------------------------
  let before;
  {
    const { page } = source;
    await openBackupScreen(page);
    before = await snapshot(page);
    check('B1', 'the origin holds the two databases and the two records of the first version, and no cache',
      same(Object.keys(before.databases), [V2_NAME, V3_NAME]) && same(Object.keys(before.records).sort(), [V1_STATE_KEY, V1_THEME_KEY]) && before.caches.length === 0, { databases: Object.keys(before.databases), records: Object.keys(before.records), caches: before.caches });

    const idle = await storageLog(page);
    check('B2', 'opening the Backup screen reads nothing of another product: only this product\'s database is opened',
      same(idle.open, [`${V3_NAME}@1`]) && idle.getItem.length === 0 && idle.modes.every((mode) => mode.startsWith(`${V3_NAME}:`)), idle);

    const requestsBefore = appLog.length;
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('[data-backup-action="make"]')]);
    await until(async () => (await phaseOf(page, 'data-export-phase')) === 'done', 'the export to finish');
    const fileName = download.suggestedFilename();
    const saved = join(work, 'exported.json');
    await download.saveAs(saved);
    const fileText = readFileSync(saved, 'utf8');
    exported = { fileName, path: saved, text: fileText, file: JSON.parse(fileText) };
    check('B3', 'the browser received one file, named after the format and the time', /^eng-trainer-backup-\d{8}-\d{6}\.json$/.test(fileName), fileName);

    const log = await logSince(page, idle);
    check('B4', 'the click read this product\'s database and the stable one, each without a version',
      same(log.open, [V3_NAME, V2_NAME]), log.open);
    check('B5', 'every transaction of the export was read-only, in both databases',
      same(log.modes, [`${V3_NAME}:readonly`, `${V2_NAME}:readonly`]), log.modes);
    check('B6', 'the two records of the first version were read, and no record was written, removed or cleared',
      same(log.getItem, [V1_STATE_KEY, V1_THEME_KEY]) && wroteNoRecord(log), log);
    check('B7', 'making the backup sent no request: the recovery writer was not loaded either', appLog.length === requestsBefore, appLog.slice(requestsBefore));

    const after = await snapshot(page);
    check('B8', 'making the backup changed nothing: every database, record and cache is the same', same(after, before));

    const { file } = exported;
    check('B9', 'the file is a version 1 backup written by the experimental product, with the three sections in order',
      file.format === 'eng-trainer-backup' && file.version === 1 && file.exportedBy.product === OWN && same(Object.keys(file.sections), [OWN, STABLE, LEGACY]), Object.keys(file.sections));
    check('B10', 'the experimental section is the database: schema 1, six stores and meta, every record',
      file.sections[OWN].database === V3_NAME && file.sections[OWN].schemaVersion === 1 && same(file.sections[OWN].stores, before.databases[V3_NAME].stores) && Object.keys(file.sections[OWN].stores).length === 7);
    check('B11', 'the stable section is the database: schema 2, six stores, every record',
      file.sections[STABLE].database === V2_NAME && file.sections[STABLE].schemaVersion === 2 && same(file.sections[STABLE].stores, before.databases[V2_NAME].stores) && Object.keys(file.sections[STABLE].stores).length === 6);
    check('B12', 'the section of the first version is its two records, as the exact text',
      file.sections[LEGACY].storage === 'localStorage' && same(file.sections[LEGACY].records, before.records));
    check('B13', 'every identity is the original one: entries, collections, the Learn pass, deck keys and positions',
      STORES.every((store) => same(file.sections[OWN].stores[store].filter(([key]) => key !== 'activePage'), pairsOf(syntheticStores(3)[store]).filter(([key]) => key !== 'activePage'))) &&
      STORES.every((store) => same(file.sections[STABLE].stores[store], pairsOf(syntheticStores(2)[store]))));
    check('B14', 'each section has the SHA-256 digest of its canonical text, computed here independently',
      Object.keys(file.sections).every((product) => file.integrity.sections[product] === sha256(canonical(file.sections[product]))) && file.integrity.algorithm === 'SHA-256', file.integrity);
    check('B15', 'the file holds learning data only: no model, cache or recording', !/onnx|wasm|model-cache|audio\/|recording/i.test(fileText));
    const said = await text(page, backupScreen);
    check('B16', 'the screen names the file and says that it cannot know whether the file was kept',
      said.includes(`Backup file made: ${fileName}`) && said.includes('The application cannot check that you kept the file.'), said.slice(0, 400));
    if (keepFile) copyFileSync(saved, resolve(keepFile));
  }
  await source.context.close();
  const expected = { own: before.databases[V3_NAME], stable: before.databases[V2_NAME], legacy: before.records };
  const stableHref = new URL(V2).pathname;
  const legacyHref = new URL(V1).pathname;

  // ---- C. Recovery of this product in a new profile, from the file alone -----------------
  const lost = await newProfile();
  {
    const { page } = lost;
    await openBackupScreen(page);
    const empty = await snapshot(page);
    check('C1', 'the new profile holds nothing of the earlier one: one fresh database of this product, no record, no cache',
      same(Object.keys(empty.databases), [V3_NAME]) && Object.keys(empty.records).length === 0 && empty.caches.length === 0 && STORES.filter((store) => store !== 'settings').every((store) => empty.databases[V3_NAME].stores[store].length === 0), empty);
    await openBackupScreen(page);
    check('C2', 'the screen says that this version holds no learning data and that the application cannot tell why',
      (await text(page, '[data-backup-empty-profile]')).includes('The application cannot tell.'));

    const requestsBefore = appLog.length;
    const beforeFile = await storageLog(page);
    await chooseFile(page, exported.path);
    const preview = await text(page, backupScreen);
    check('C3', 'the file is checked and shown before anything is written',
      (await phaseOf(page, 'data-restore-phase')) === 'preview' && preview.includes('The file passed every check') && preview.includes('Synthetic collection 3') && preview.includes('Synthetic collection 2'), preview.slice(0, 500));
    check('C4', 'the destination of the experimental section is this product, which holds no learning data', (await destinationOf(page, OWN)) === 'empty' && (await offered(page, OWN)));
    const stablePart = await text(page, sectionOf(STABLE));
    check('C5', 'the stable section waits: the stable product has no storage here, only it may create that, and the screen says how to go on',
      (await destinationOf(page, STABLE)) === 'absent' && !(await offered(page, STABLE)) && stablePart.includes('It creates that storage when it is opened, and nothing else may.') &&
      (await page.evaluate(([selector, href]) => document.querySelector(`${selector} [data-backup-open-first]`)?.getAttribute('href') === href, [sectionOf(STABLE), stableHref])), stablePart);
    check('C6', 'the first version\'s section can be recovered: its storage holds no learning data', (await destinationOf(page, LEGACY)) === 'empty' && (await offered(page, LEGACY)));
    const previewLog = await logSince(page, beforeFile);
    check('C7', 'the preview only read: this product\'s database and the two records of the first version. The stable database does not exist and was not requested',
      previewLog.modes.length > 0 && previewLog.modes.every((mode) => mode === `${V3_NAME}:readonly`) && previewLog.open.every((name) => name === V3_NAME) && same(previewLog.getItem, [V1_STATE_KEY, V1_THEME_KEY]) && wroteNoRecord(previewLog) && !previewLog.created.length, previewLog);

    await askFor(page, OWN);
    const dialog = await text(page, 'dialog.dialog');
    check('C8', 'an explicit confirmation names the file, the data, the replaced preferences and the untouched other versions',
      dialog.includes('Recover into this version?') && dialog.includes('exported.json') && dialog.includes('are replaced by those of the backup') && dialog.includes('The stable version and the previous version (v1) are not changed.'), dialog);
    const beforeConfirm = await storageLog(page);
    check('C9', 'opening the confirmation wrote nothing', same((await logSince(page, beforeFile)).modes, previewLog.modes));

    await page.click('[data-backup-action="confirm-recover"]');
    await until(async () => (await outcomeOf(page)) !== null && !(await dialogOpen(page)), 'the result of the recovery');
    const result = await text(page, backupScreen);
    check('C10', 'the result is reported as a success, after the data was read back', (await outcomeOf(page)) === 'success' && result.includes('Recovery complete') && result.includes('matches the backup file'), result.slice(0, 400));
    await waitForDestination(page, OWN, 'recovered');

    const log = await logSince(page, beforeConfirm);
    const writing = log.modes.filter((mode) => mode.endsWith(':readwrite'));
    check('C11', 'the recovery used one read-write transaction, in this product\'s database', same(writing, [`${V3_NAME}:readwrite`]), log.modes);
    check('C12', 'the recovery opened no other database and touched no key-value record',
      log.open.every((name) => name === V3_NAME || name === `${V3_NAME}@1`) && !log.getItem.length && wroteNoRecord(log), log);
    check('C13', 'the recovery sent no request: this product\'s own recovery does not load the recovery writer', appLog.length === requestsBefore, appLog.slice(requestsBefore));

    const restored = await snapshot(page);
    check('C14', 'every store of this product is deeply equal to the backed-up state, meta included', same(restored.databases[V3_NAME], expected.own));
    check('C15', 'nothing was written for the other two products: no stable database, no record of the first version, no cache',
      same(Object.keys(restored.databases), [V3_NAME]) && Object.keys(restored.records).length === 0 && restored.caches.length === 0, { databases: Object.keys(restored.databases), records: Object.keys(restored.records) });
    check('C16', 'the file stays open for its other parts: this part is marked as recovered and is not offered again',
      (await phaseOf(page, 'data-restore-phase')) === 'preview' && !(await offered(page, OWN)) && (await offered(page, LEGACY)) && (await text(page, sectionOf(OWN))).includes('Recovered from this file'));

    // The running application shows the recovered state without a reload.
    await page.evaluate(() => { window.location.hash = 'collections'; });
    await until(async () => (await text(page)).includes('Synthetic collection 3'), 'the recovered collection on the Collections screen');
    check('C17', 'the running application shows the recovered data at once', (await page.evaluate(() => document.documentElement.dataset.themePreference)) === 'dark');

    await openApp(page, V3, '#collections');
    const reloaded = await text(page);
    check('C18', 'after a reload the product starts on the recovered data', reloaded.includes('Synthetic collection 3') && reloaded.includes('2 entries') && (await page.evaluate(() => document.documentElement.dataset.themePreference)) === 'dark', reloaded.slice(0, 300));
    // Opening the Collections screen is ordinary use: it saved that screen as the last one opened.
    const afterReload = await snapshot(page);
    const withoutLastPage = (database) => ({ ...database, stores: { ...database.stores, settings: database.stores.settings.filter(([key]) => key !== 'activePage') } });
    check('C19', 'after a reload and ordinary use every store is still the backed-up state, except the last opened screen',
      same(withoutLastPage(afterReload.databases[V3_NAME]), withoutLastPage(expected.own)) && same(afterReload.databases[V3_NAME].stores.settings.find(([key]) => key === 'activePage'), ['activePage', 'collections']));
  }

  // ---- D. Refusals -------------------------------------------------------------------
  {
    const { page } = lost;
    await openBackupScreen(page);
    await chooseFile(page, exported.path);
    const own = await text(page, sectionOf(OWN));
    check('D0', 'the same file, chosen on the profile that was recovered from it, finds exactly its data: nothing to recover, and no advice to reset',
      (await destinationOf(page, OWN)) === 'identical' && !(await offered(page, OWN)) && own.includes('already holds exactly this data') && !own.includes('Reset'), own);

    // The learner goes on learning: the profile now holds data that is not the backup's.
    await fromAnotherTab(lost.context, (other) => seedDatabase(other, V3_NAME, { progress: { learnedPhrases: ['phrase-301', 'phrase-learned-since-the-recovery'] } }));
    const full = await snapshot(page);
    const beforeRefusals = await storageLog(page);
    await chooseFile(page, exported.path);
    const occupied = await text(page, sectionOf(OWN));
    check('D1', 'a destination that holds other learning data is refused: the recovery is not offered',
      (await destinationOf(page, OWN)) === 'occupied' && !(await offered(page, OWN)) && occupied.includes('A recovery never overwrites data.'), occupied);

    const cases = [
      ['D2', 'a file with one changed value', asFile('changed.json', exported.text.replace('"phrase-301"', '"phrase-999"')), 'does not match its digest'],
      ['D3', 'a file with one changed value of the stable version', asFile('changed-stable.json', exported.text.replace('"phrase-201"', '"phrase-999"')), 'The section "stable-v2" does not match its digest'],
      ['D4', 'a file that was cut short', asFile('cut.json', exported.text.slice(0, Math.floor(exported.text.length / 2))), 'not complete JSON'],
      ['D5', 'a backup of a newer format version', asFile('newer.json', exported.text.replace('"version": 1', '"version": 2')), 'made by a newer version'],
      ['D6', 'a backup with an unknown member', asFile('unknown.json', exported.text.replace('"format": "eng-trainer-backup",', '"format": "eng-trainer-backup", "note": "x",')), 'unknown: note'],
      ['D7', 'a vocabulary export', asFile('vocabulary.json', '{"format":"eng-trainer-vocabulary","version":1,"collection":{},"entries":[]}'), 'import it on the Collections screen'],
      ['D8', 'a file that is not text', asFile('bytes.json', Buffer.from([0xff, 0xfe, 0x00, 0x01])), 'not UTF-8 text'],
      ['D9', 'an empty file', asFile('empty.json', ''), 'The file is empty.']
    ];
    for (const [id, title, file, reason] of cases) {
      await chooseFile(page, file);
      const problem = await text(page, '[data-backup-problem]');
      check(id, `${title} is refused with its reason, and no part of it is offered`, problem.includes(reason) && (await phaseOf(page, 'data-restore-phase')) === 'idle' && (await offeredParts(page)).length === 0, problem);
    }
    {
      // A section whose record is not acceptable, with a digest that matches it.
      const file = JSON.parse(exported.text);
      file.sections[OWN].stores.settings = file.sections[OWN].stores.settings.map(([key, value]) => [key, key === 'theme' ? 'purple' : value]);
      file.integrity.sections[OWN] = sha256(canonical(file.sections[OWN]));
      await chooseFile(page, asFile('record.json', JSON.stringify(file)));
      const problem = await text(page, '[data-backup-problem]');
      check('D10', 'a record that the application does not accept is refused, also when the digest matches', problem.includes('settings: "theme" has a value that the application does not accept'), problem);
    }
    {
      // The same for the stable version: one unacceptable record refuses the whole file, also its good parts.
      const file = JSON.parse(exported.text);
      file.sections[STABLE].stores.settings = file.sections[STABLE].stores.settings.map(([key, value]) => [key, key === 'theme' ? 'purple' : value]);
      file.integrity.sections[STABLE] = sha256(canonical(file.sections[STABLE]));
      await chooseFile(page, asFile('record-stable.json', JSON.stringify(file)));
      const problem = await text(page, '[data-backup-problem]');
      check('D11', 'an unacceptable record of the stable version refuses the whole file: no part of it is offered', problem.includes('settings: "theme" has a value that the application does not accept') && (await offeredParts(page)).length === 0, problem);
    }
    const log = await logSince(page, beforeRefusals);
    check('D12', 'no refusal wrote anything, requested another database or loaded the recovery writer',
      log.modes.every((mode) => mode === `${V3_NAME}:readonly`) && log.open.every((name) => name === V3_NAME) && wroteNoRecord(log) && log.getItem.every((key) => key === V1_STATE_KEY || key === V1_THEME_KEY) && !appLog.some(isWriterRequest), log);
    const after = await snapshot(page);
    check('D13', 'after every refusal the profile is exactly as it was', same(after, full));
  }
  await lost.context.close();

  // ---- E. An interrupted recovery of this product ------------------------------------------
  /** Write requests of one recovery of a made-up database section: the guard's record first, then every record. */
  const writesOf = (product) => 1 + Object.values(exported.file.sections[product].stores).reduce((sum, pairs) => sum + pairs.length, 0);
  {
    const writes = writesOf(OWN);
    {
      const { context, page } = await newProfile({ faults: true });
      await openBackupScreen(page);
      await chooseFile(page, exported.path);
      const beforeAttempt = await snapshot(page);
      await page.evaluate((db) => { window.__fault = { kind: 'throw', db, at: 6, calls: 0 }; }, V3_NAME);
      check('E0', 'the recovery issues more write requests than the fault lets through', writes > 6, writes);
      const outcome = await recoverPart(page, OWN);
      const result = await text(page, backupScreen);
      check('E1', 'a write that fails in the middle is reported as a failure with nothing recovered',
        outcome === 'error' && result.includes('Nothing was recovered') && result.includes('nothing was changed'), result.slice(0, 400));
      const calls = await page.evaluate(() => window.__fault.calls);
      await page.evaluate(() => { delete window.__fault; });
      const afterAttempt = await snapshot(page);
      check('E2', 'the failed recovery rolled everything back: the database is exactly as before, after 5 accepted writes', calls === 6 && same(afterAttempt, beforeAttempt), { calls });
      await waitForDestination(page, OWN, 'empty');
      check('E3', 'the destination is still eligible, and the recovery is offered again', await offered(page, OWN));
      check('E4', 'the next attempt recovers everything', (await recoverPart(page, OWN)) === 'success' && same((await snapshot(page)).databases[V3_NAME], expected.own));
      await context.close();
    }
    // The page stops before write number `at` and is closed while it is stopped: a closed tab or a crash
    // in the middle of a recovery. The profile is then opened again in a new page.
    for (const at of [1, 2, Math.ceil(writes / 2), writes]) {
      const { context, page } = await newProfile({ faults: true });
      await openBackupScreen(page);
      await chooseFile(page, exported.path);
      const beforeAttempt = await snapshot(page);
      await page.evaluate(([db, value]) => { window.__fault = { kind: 'hang', db, at: value, calls: 0, holdMs: 8000 }; }, [V3_NAME, at]);
      const { reached, closedWhileStopped } = await stopAndClose(page, OWN);
      check(`E5.${at}`, `the page stopped before write ${at} of ${writes} and was closed while it was stopped`, reached === true && closedWhileStopped === true, { reached, closedWhileStopped });

      const reopened = watch(await context.newPage());
      await openBackupScreen(reopened);
      const afterwards = await snapshot(reopened);
      const complete = same(afterwards.databases[V3_NAME], expected.own);
      check(`E6.${at}`, `after the interruption the database is exactly as before the recovery: none of the ${at - 1} accepted writes was kept`, same(afterwards, beforeAttempt), complete ? 'the recovery had completed' : afterwards.databases[V3_NAME]);
      check(`E7.${at}`, 'the interruption touched no other storage', same(Object.keys(afterwards.databases), [V3_NAME]) && Object.keys(afterwards.records).length === 0 && afterwards.caches.length === 0);
      await chooseFile(reopened, exported.path);
      check(`E8.${at}`, 'the destination is still eligible after the interruption', (await destinationOf(reopened, OWN)) === 'empty');
      check(`E9.${at}`, 'the recovery can be done again, and completes', (await recoverPart(reopened, OWN)) === 'success' && same((await snapshot(reopened)).databases[V3_NAME], expected.own));
      await context.close();
    }
    {
      // The one moment that the guard cannot cover: the page stops between the guard's own two requests.
      const { context, page } = await newProfile({ faults: true });
      await openBackupScreen(page);
      await chooseFile(page, exported.path);
      const beforeAttempt = await snapshot(page);
      await page.evaluate((db) => { window.__fault = { kind: 'hang-add', db, holdMs: 8000 }; }, V3_NAME);
      const { reached, closedWhileStopped } = await stopAndClose(page, OWN);
      const reopened = watch(await context.newPage());
      await openBackupScreen(reopened);
      const afterwards = await snapshot(reopened);
      check('E10', 'a page closed between the two requests of the guard leaves at most the guard\'s record, an empty list of learned phrases, and nothing else',
        reached === true && closedWhileStopped === true && same(withoutEmptyGuardRecord(afterwards.databases[V3_NAME]), withoutEmptyGuardRecord(beforeAttempt.databases[V3_NAME])) && same(Object.keys(afterwards.databases), [V3_NAME]), afterwards.databases[V3_NAME].stores.progress);
      observations.push(`E10: after a page closed between the guard's two requests, the progress store of this product held ${JSON.stringify(afterwards.databases[V3_NAME].stores.progress)}`);
      await chooseFile(reopened, exported.path);
      check('E11', 'the profile is still an empty one of this product: the recovery is offered and completes',
        (await destinationOf(reopened, OWN)) === 'empty' && (await recoverPart(reopened, OWN)) === 'success' && same((await snapshot(reopened)).databases[V3_NAME], expected.own));
      await context.close();
    }
  }

  {
    // The finding of the independent review. The recovery commits, and the storage then refuses the
    // first read of the check. The tab holds the state from before the recovery.
    const { context, page } = await newProfile();
    await openBackupScreen(page);
    await chooseFile(page, exported.path);
    await askFor(page, OWN);
    await armListingFault(page, 'once');
    const outcome = await confirmAndWait(page, 'the result of a recovery whose check fails');
    const result = await text(page, backupScreen);
    check('E12', 'a recovery that was written, and whose check then failed, is reported as written but not checked, never as nothing recovered',
      outcome === 'error' && (await listingsRefused(page)) === 1 && result.includes('Written, but not checked') && !result.includes('Nothing was recovered') && !result.includes('Recovery complete') && result.includes('The data was written, but it could not be read back to check it.'), result.slice(0, 500));
    check('E13', 'the screen asks for a reload, and tells nobody to reset or remove what was just recovered',
      (await reloadOffered(page)) && result.includes('This tab saves nothing until the page is reloaded') && !result.includes('Reset learning progress') && !result.includes('remove your collections') && (await offeredParts(page)).length === 0, result.slice(0, 500));
    const written = await snapshot(page);
    check('E14', 'the transaction did complete: this product\'s database is deeply equal to the backed-up state', same(written.databases[V3_NAME], expected.own));

    // The learner goes on in the SAME tab, without a reload, as in the review's probe.
    await page.evaluate(() => { window.location.hash = 'phrases'; });
    const mark = page.getByRole('button', { name: 'Mark as learned', exact: true }).first();
    await mark.waitFor({ timeout: 15000 });
    const shown = await text(page);
    await mark.click();
    await page.evaluate(() => { window.location.hash = 'words'; });
    // Longer than any save takes: a save of the old state would have reached the database by now.
    await page.waitForTimeout(1500);
    const afterUse = await snapshot(page);
    check('E15', 'the same tab, used without a reload: a phrase is marked as learned and another screen is opened, and nothing of that reaches the database',
      same(afterUse.databases[V3_NAME], expected.own) && same(Object.keys(afterUse.databases), [V3_NAME]), afterUse.databases[V3_NAME].stores.progress);
    check('E16', 'the tab says that saving is off, on every screen', shown.includes('Saving is off.') && (await text(page)).includes('Saving is off.'), shown.slice(0, 200));

    // A real reload, as the screen asks for. Going to another screen of the same page is not one.
    await page.reload({ waitUntil: 'load' });
    await openApp(page, V3, '#collections');
    const reloaded = await text(page);
    check('E17', 'after the reload the product starts on the recovered data, and saving is on again',
      reloaded.includes('Synthetic collection 3') && reloaded.includes('2 entries') && !reloaded.includes('Saving is off.') && (await page.evaluate(() => document.documentElement.dataset.themePreference)) === 'dark', reloaded.slice(0, 300));
    await openBackupScreen(page);
    await chooseFile(page, exported.path);
    const part = await text(page, sectionOf(OWN));
    check('E18', 'the file, chosen again after the reload, checks the recovery: this product holds exactly its data',
      (await destinationOf(page, OWN)) === 'identical' && part.includes('already holds exactly this data') && !part.includes('Reset') && same((await snapshot(page)).databases[V3_NAME], expected.own), part);
    await context.close();
  }

  // ---- F. Recovery of the stable product ---------------------------------------------------
  {
    // After a complete loss the stable product has no storage. Nothing but the stable product creates it.
    const { context, page } = await newProfile();
    const firstRequest = appLog.length;
    await openBackupScreen(page);
    await chooseFile(page, exported.path);
    const start = await snapshot(page);
    check('F1', 'after a complete loss the stable section waits, and looking at it created nothing', (await destinationOf(page, STABLE)) === 'absent' && !(await offered(page, STABLE)) && same(Object.keys(start.databases), [V3_NAME]));
    const beforeLook = await storageLog(page);
    await page.click(`[data-backup-action="check-again"][data-backup-product="${STABLE}"]`);
    await page.waitForTimeout(400);
    const lookLog = await logSince(page, beforeLook);
    check('F2', '"Check again" only looks: the stable database still does not exist, and nothing was requested with a version or created',
      (await destinationOf(page, STABLE)) === 'absent' && same(Object.keys((await snapshot(page)).databases), [V3_NAME]) && lookLog.open.every((name) => !name.includes('@')) && !lookLog.created.length && wroteNoRecord(lookLog), lookLog);

    await openOnce(context, V2);
    const opened = await snapshot(page);
    check('F3', 'the stable product, opened once in another tab, created its own storage: version 2, six stores, no learning data',
      opened.databases[V2_NAME]?.version === 2 && same(Object.keys(opened.databases[V2_NAME].stores), [...STORES].sort()) && ['learnPasses', 'flashcardSessions', 'userCollections', 'userEntries'].every((store) => opened.databases[V2_NAME].stores[store].length === 0), opened.databases[V2_NAME]);
    await page.click(`[data-backup-action="check-again"][data-backup-product="${STABLE}"]`);
    await waitForDestination(page, STABLE, 'empty');
    check('F4', 'looked at again, the stable section can be recovered', await offered(page, STABLE));
    check('F5', 'up to here the recovery writer was not loaded: no request for it reached the server', !appLog.slice(firstRequest).some(isWriterRequest), appLog.slice(firstRequest).filter(isWriterRequest));

    await askFor(page, STABLE);
    const dialog = await text(page, 'dialog.dialog');
    check('F6', 'the confirmation names the stable version as the storage that is written, and what is not changed',
      dialog.includes('Recover into the stable version?') && dialog.includes('into the storage of the stable version in this browser') && dialog.includes('Synthetic collection 2') && dialog.includes('This version and the previous version (v1) are not changed.') && dialog.includes('Close every tab of the stable version first.'), dialog);
    const beforeConfirm = await storageLog(page);
    const requestsBefore = appLog.length;
    check('F7', 'opening the confirmation wrote nothing and loaded nothing', same((await snapshot(page)).databases[V2_NAME], opened.databases[V2_NAME]) && !appLog.slice(firstRequest).some(isWriterRequest));

    await page.click('[data-backup-action="confirm-recover"]');
    await until(async () => (await outcomeOf(page)) !== null && !(await dialogOpen(page)), 'the result of the recovery of the stable version');
    const result = await text(page, backupScreen);
    check('F8', 'the result is a success, after the data was read back, with a link to the stable version',
      (await outcomeOf(page)) === 'success' && result.includes('The data of the stable version from') && result.includes('matches the backup file') && (await page.evaluate((href) => document.querySelector('[data-backup-open]')?.getAttribute('href') === href, stableHref)), result.slice(0, 400));
    await waitForDestination(page, STABLE, 'recovered');
    const log = await logSince(page, beforeConfirm);
    check('F9', 'the recovery used one read-write transaction, in the stable database, and every other transaction was read-only',
      same(log.modes.filter((mode) => mode.endsWith(':readwrite')), [`${V2_NAME}:readwrite`]) && log.modes.every((mode) => mode.startsWith(`${V2_NAME}:`)), log.modes);
    check('F10', 'it requested the stable database only, never with a version, created no store, deleted nothing and touched no key-value record',
      log.open.length > 0 && log.open.every((name) => name === V2_NAME) && !log.created.length && !log.getItem.length && wroteNoRecord(log), log);
    const loaded = appLog.slice(requestsBefore);
    check('F11', 'the confirmation loaded the recovery writer, and requested nothing but files of the experimental build', loaded.filter(isWriterRequest).length === 1 && loaded.every((path) => path.startsWith('/eng-trainer/v3/assets/')), loaded);

    const restored = await snapshot(page);
    check('F12', 'the stable database is deeply equal to the backed-up state: version 2, six stores, every record', same(restored.databases[V2_NAME], expected.stable));
    check('F13', 'this product\'s database and the first version\'s records are exactly as before', same(restored.databases[V3_NAME], start.databases[V3_NAME]) && Object.keys(restored.records).length === 0 && restored.caches.length === 0);

    await openApp(page, V2);
    const stable = await text(page);
    check('F14', 'the released stable product starts on the recovered data and shows it', stable.includes('Synthetic collection 2') && stable.includes('2 entries') && (await page.evaluate(() => document.documentElement.dataset.themePreference)) === 'dark', stable.slice(0, 300));
    const afterStable = await snapshot(page);
    check('F15', 'starting the stable product changed none of its records and kept its schema', same(afterStable.databases[V2_NAME], expected.stable));
    await context.close();
  }
  {
    // A stable product that holds learning data on this device is never written.
    const { context, page } = await newProfile();
    await openApp(page, V2);
    await seedDatabase(page, V2_NAME, OTHER_LEARNING);
    await openBackupScreen(page);
    const holding = await snapshot(page);
    await chooseFile(page, exported.path);
    const part = await text(page, sectionOf(STABLE));
    check('F16', 'a stable product that holds learning data is refused: the recovery is not offered, and the screen says how to go on',
      (await destinationOf(page, STABLE)) === 'occupied' && !(await offered(page, STABLE)) && part.includes('The stable version already holds learning data in this browser: 1 learned, hidden or Focus item. A recovery never overwrites data.'), part);
    check('F17', 'the refusal changed nothing', same(await snapshot(page), holding));
    await context.close();
  }
  {
    // Learning data that appears after the preview, from a tab of the stable product, stops the recovery at the last moment.
    const { context, page } = await newProfile();
    await openOnce(context, V2);
    await openBackupScreen(page);
    await chooseFile(page, exported.path);
    await askFor(page, STABLE);
    await fromAnotherTab(context, (other) => seedDatabase(other, V2_NAME, OTHER_LEARNING));
    const holding = await snapshot(page);
    await page.click('[data-backup-action="confirm-recover"]');
    await until(async () => (await outcomeOf(page)) !== null && !(await dialogOpen(page)), 'the refusal at the last moment');
    const result = await text(page, backupScreen);
    check('F18', 'learning data that appeared after the preview stops the recovery: the destination is judged again inside the writing transaction',
      (await outcomeOf(page)) === 'error' && result.includes('Nothing was recovered') && result.includes('The stable version already holds learning data in this browser.'), result.slice(0, 400));
    await waitForDestination(page, STABLE, 'occupied');
    check('F19', 'nothing was written over it, and the recovery is not offered any more', same(await snapshot(page), holding) && !(await offered(page, STABLE)));
    await context.close();
  }
  for (const [id, title, version, storeNames] of [
    ['F20', 'a stable database of a newer version', 3, STORES],
    ['F21', 'a stable database of the older version 1, with four stores', 1, STORES.slice(0, 4)],
    ['F22', 'a stable database of version 2 with one more store', 2, [...STORES, 'meta']]
  ]) {
    const { context, page } = await newProfile();
    await page.goto(NEUTRAL, { waitUntil: 'load' });
    await createDatabase(page, V2_NAME, version, storeNames);
    await openBackupScreen(page);
    const holding = await snapshot(page);
    const beforeFile = await storageLog(page);
    await chooseFile(page, exported.path);
    const part = await text(page, sectionOf(STABLE));
    const log = await logSince(page, beforeFile);
    check(id, `${title} is left alone: not offered, not written, not upgraded`,
      (await destinationOf(page, STABLE)) === 'unavailable' && !(await offered(page, STABLE)) && part.includes('It is never changed or upgraded from here.') && same(await snapshot(page), holding) && log.open.every((name) => !name.includes('@')) && !log.created.length, { part, log });
    await context.close();
  }
  {
    const writes = writesOf(STABLE);
    {
      const { context, page } = await newProfile({ faults: true });
      await openOnce(context, V2);
      await openBackupScreen(page);
      await chooseFile(page, exported.path);
      const beforeAttempt = await snapshot(page);
      await page.evaluate((db) => { window.__fault = { kind: 'throw', db, at: 6, calls: 0 }; }, V2_NAME);
      const outcome = await recoverPart(page, STABLE);
      const result = await text(page, backupScreen);
      const calls = await page.evaluate(() => window.__fault.calls);
      await page.evaluate(() => { delete window.__fault; });
      check('F23', 'a write into the stable database that fails in the middle is reported as a failure, and everything is rolled back',
        outcome === 'error' && result.includes('Nothing was recovered') && result.includes('nothing was changed') && calls === 6 && same(await snapshot(page), beforeAttempt), { calls, result: result.slice(0, 300) });
      await waitForDestination(page, STABLE, 'empty');
      check('F24', 'the next attempt recovers everything', (await recoverPart(page, STABLE)) === 'success' && same((await snapshot(page)).databases[V2_NAME], expected.stable));
      await context.close();
    }
    for (const at of [1, 2, Math.ceil(writes / 2), writes]) {
      const { context, page } = await newProfile({ faults: true });
      await openOnce(context, V2);
      await openBackupScreen(page);
      await chooseFile(page, exported.path);
      const beforeAttempt = await snapshot(page);
      await page.evaluate(([db, value]) => { window.__fault = { kind: 'hang', db, at: value, calls: 0, holdMs: 8000 }; }, [V2_NAME, at]);
      const { reached, closedWhileStopped } = await stopAndClose(page, STABLE);
      const reopened = watch(await context.newPage());
      await openBackupScreen(reopened);
      const afterwards = await snapshot(reopened);
      check(`F25.${at}`, `a page closed before write ${at} of ${writes} into the stable database leaves the whole origin exactly as before: none of the ${at - 1} accepted writes was kept`,
        reached === true && closedWhileStopped === true && same(afterwards, beforeAttempt), same(afterwards.databases[V2_NAME], expected.stable) ? 'the recovery had completed' : afterwards.databases[V2_NAME]);
      await chooseFile(reopened, exported.path);
      check(`F26.${at}`, 'the recovery is offered again, and completes',
        (await destinationOf(reopened, STABLE)) === 'empty' && (await recoverPart(reopened, STABLE)) === 'success' && same((await snapshot(reopened)).databases[V2_NAME], expected.stable));
      await context.close();
    }
    {
      const { context, page } = await newProfile({ faults: true });
      await openOnce(context, V2);
      await openBackupScreen(page);
      await chooseFile(page, exported.path);
      const beforeAttempt = await snapshot(page);
      await page.evaluate((db) => { window.__fault = { kind: 'hang-add', db, holdMs: 8000 }; }, V2_NAME);
      const { reached, closedWhileStopped } = await stopAndClose(page, STABLE);
      const reopened = watch(await context.newPage());
      await openBackupScreen(reopened);
      const afterwards = await snapshot(reopened);
      check('F27', 'a page closed between the two requests of the guard leaves at most an empty list of learned phrases in the stable database, and nothing else',
        reached === true && closedWhileStopped === true && same(withoutEmptyGuardRecord(afterwards.databases[V2_NAME]), withoutEmptyGuardRecord(beforeAttempt.databases[V2_NAME])) && same(afterwards.databases[V3_NAME], beforeAttempt.databases[V3_NAME]), afterwards.databases[V2_NAME].stores.progress);
      observations.push(`F27: after a page closed between the guard's two requests, the progress store of the stable product held ${JSON.stringify(afterwards.databases[V2_NAME].stores.progress)}`);
      await openOnce(context, V2);
      const afterStart = await snapshot(reopened);
      check('F28', 'the released stable product starts on that storage, and it still holds no learning data',
        ['learnPasses', 'flashcardSessions', 'userCollections', 'userEntries'].every((store) => afterStart.databases[V2_NAME].stores[store].length === 0) && afterStart.databases[V2_NAME].stores.progress.every(([key, value]) => (key === 'selectedLearnPassId' ? value === 'default' : Array.isArray(value) && value.length === 0)), afterStart.databases[V2_NAME].stores.progress);
      await chooseFile(reopened, exported.path);
      check('F29', 'the recovery is offered again, and completes',
        (await destinationOf(reopened, STABLE)) === 'empty' && (await recoverPart(reopened, STABLE)) === 'success' && same((await snapshot(reopened)).databases[V2_NAME], expected.stable));
      await context.close();
    }
  }

  {
    // The same finding for the stable product: the check after the commit is refused once.
    const { context, page } = await newProfile();
    await openOnce(context, V2);
    await openBackupScreen(page);
    await chooseFile(page, exported.path);
    const start = await snapshot(page);
    await askFor(page, STABLE);
    await armListingFault(page, 'once');
    const outcome = await confirmAndWait(page, 'the result of a recovery of the stable version whose check fails');
    const result = await text(page, backupScreen);
    check('F30', 'the stable version: a recovery that was written, and whose check then failed, is reported as written but not checked, never as nothing recovered',
      outcome === 'error' && (await listingsRefused(page)) === 1 && result.includes('Written, but not checked') && !result.includes('Nothing was recovered') && result.includes('The data of the stable version was written, but it could not be read back to check it.'), result.slice(0, 500));
    check('F31', 'the learner is sent to the stable version to look, is told not to reset anything, and this tab needs no reload',
      result.includes('Do not reset anything because of this message.') && (await page.evaluate((href) => document.querySelector('[data-backup-open]')?.getAttribute('href') === href, stableHref)) && !(await reloadOffered(page)), result.slice(0, 500));
    await waitForDestination(page, STABLE, 'identical');
    const part = await text(page, sectionOf(STABLE));
    check('F32', 'looked at again, the stable database is seen to hold exactly the data of the file: no advice to reset, and no second attempt',
      part.includes('already holds exactly this data') && !part.includes('Reset learning progress') && !part.includes('Cannot be recovered') && !(await offered(page, STABLE)), part);
    const written = await snapshot(page);
    check('F33', 'the stable database is deeply equal to the backed-up state, and this product\'s database is as before', same(written.databases[V2_NAME], expected.stable) && same(written.databases[V3_NAME], start.databases[V3_NAME]));
    await openApp(page, V2);
    const stable = await text(page);
    check('F34', 'the released stable product starts on that data and changes none of it', stable.includes('Synthetic collection 2') && same((await snapshot(page)).databases[V2_NAME], expected.stable), stable.slice(0, 300));
    await context.close();
  }
  {
    // The storage keeps refusing: the part then says that it was written but not checked.
    const { context, page } = await newProfile();
    await openOnce(context, V2);
    await openBackupScreen(page);
    await chooseFile(page, exported.path);
    await askFor(page, STABLE);
    await armListingFault(page, 'always');
    await confirmAndWait(page, 'the result of a recovery of the stable version while the storage cannot be listed');
    await waitForDestination(page, STABLE, 'unverified');
    const part = await text(page, sectionOf(STABLE));
    check('F35', 'while the storage cannot be read, the stable part says written but not checked, links to the stable version, and gives no advice to reset',
      part.includes('Written, but not checked. The data of this part may already be in the stable version in this browser. Do not reset or remove anything because of this message.') && !part.includes('Reset learning progress') && !(await offered(page, STABLE)) &&
      (await page.evaluate(([selector, href]) => document.querySelector(`${selector} [data-backup-open-first]`)?.getAttribute('href') === href, [sectionOf(STABLE), stableHref])), part);
    await armListingFault(page, null);
    await page.click(`[data-backup-action="check-again"][data-backup-product="${STABLE}"]`);
    await waitForDestination(page, STABLE, 'identical');
    check('F36', '"Check again", once the storage answers, compares it with the file: the stable database holds exactly its data', same((await snapshot(page)).databases[V2_NAME], expected.stable));
    await context.close();
  }

  // ---- G. Recovery of the first version ----------------------------------------------------
  const onlyLegacyKeys = (list) => list.every((key) => key === V1_STATE_KEY || key === V1_THEME_KEY);
  {
    const { context, page } = await newProfile();
    await openBackupScreen(page);
    await chooseFile(page, exported.path);
    const start = await snapshot(page);
    await askFor(page, LEGACY);
    const dialog = await text(page, 'dialog.dialog');
    check('G1', 'the confirmation names the previous version, its data and theme, says that its two records cannot be written in one step, and warns about other tabs',
      dialog.includes('Recover into the previous version (v1)?') && dialog.includes('into the storage of the previous version in this browser') && dialog.includes('Theme: dark.') && dialog.includes('a browser cannot write them in one step') && dialog.includes('This version and the stable version are not changed.') && dialog.includes(OTHER_TABS_OF_V1), dialog);
    const beforeConfirm = await storageLog(page);
    check('G2', 'opening the confirmation wrote nothing', Object.keys((await snapshot(page)).records).length === 0);
    await page.click('[data-backup-action="confirm-recover"]');
    await until(async () => (await outcomeOf(page)) !== null && !(await dialogOpen(page)), 'the result of the recovery of the first version');
    const result = await text(page, backupScreen);
    check('G3', 'the result is a success, after both records were read back, with a link to the previous version',
      (await outcomeOf(page)) === 'success' && result.includes('The data of the previous version (v1) from') && result.includes('matches the backup file') && (await page.evaluate((href) => document.querySelector('[data-backup-open]')?.getAttribute('href') === href, legacyHref)), result.slice(0, 400));
    await waitForDestination(page, LEGACY, 'recovered');
    const log = await logSince(page, beforeConfirm);
    check('G4', 'two records were written, the state first, and nothing was removed or cleared', same(log.setItem, [V1_STATE_KEY, V1_THEME_KEY]) && !log.removeItem.length && !log.clear.length && !log.deleteDatabase.length, log);
    check('G5', 'only those two records were read, and no database was requested or written', onlyLegacyKeys(log.getItem) && log.getItem.length >= 4 && !log.open.length && !log.modes.length && !log.created.length, log);
    const restored = await snapshot(page);
    check('G6', 'the two records are the backed-up text, character for character, and nothing else is in the key-value storage', same(restored.records, expected.legacy));
    check('G7', 'this product\'s database is exactly as before, and no stable database was created', same(restored.databases, start.databases));

    await openApp(page, V1);
    const legacyState = JSON.parse(await page.evaluate((key) => localStorage.getItem(key), V1_STATE_KEY));
    check('G8', 'the released first version starts on its recovered records and keeps the learning state',
      same(legacyState.learnedPhrases, V1_SYNTHETIC.learnedPhrases) && same(legacyState.flashcardSessions, V1_SYNTHETIC.flashcardSessions) && same(legacyState.favoritePhrases, V1_SYNTHETIC.favoritePhrases) && (await page.evaluate(() => document.documentElement.dataset.themePreference)) === 'dark', legacyState);
    check('G9', 'the first version keeps its records in the same text after it started', same((await snapshot(page)).records, expected.legacy));
    await context.close();
  }
  {
    // The first version was opened before: it wrote its records of a first start. They hold no learning data.
    const { context, page } = await newProfile();
    await openOnce(context, V1);
    await openBackupScreen(page);
    const firstStart = await snapshot(page);
    await chooseFile(page, exported.path);
    check('G10', 'records of a first start are no learning data: the recovery is offered, and it replaces them',
      same(Object.keys(firstStart.records).sort(), [V1_STATE_KEY, V1_THEME_KEY]) && (await destinationOf(page, LEGACY)) === 'empty' && (await recoverPart(page, LEGACY)) === 'success' && same((await snapshot(page)).records, expected.legacy), firstStart.records);
    await context.close();
  }
  {
    const { context, page } = await newProfile();
    await page.goto(NEUTRAL, { waitUntil: 'load' });
    const held = { [V1_STATE_KEY]: JSON.stringify({ learnedPhrases: ['phrase-learned-on-this-device'] }), [V1_THEME_KEY]: 'light' };
    await page.evaluate((records) => { for (const [key, value] of Object.entries(records)) localStorage.setItem(key, value); }, held);
    await openBackupScreen(page);
    const beforeFile = await storageLog(page);
    await chooseFile(page, exported.path);
    const part = await text(page, sectionOf(LEGACY));
    check('G11', 'a first version that holds learning data is refused: not offered, nothing written',
      (await destinationOf(page, LEGACY)) === 'occupied' && !(await offered(page, LEGACY)) && part.includes('The previous version (v1) already holds learning data in this browser: 1 learned, hidden or Focus item.') && same((await snapshot(page)).records, held) && wroteNoRecord(await logSince(page, beforeFile)), part);
    await context.close();
  }
  {
    // The second record cannot be written: the storage refuses it.
    const { context, page } = await newProfile({ faults: true });
    await openBackupScreen(page);
    await chooseFile(page, exported.path);
    await page.evaluate((key) => { window.__recordFault = { kind: 'throw', key }; }, V1_THEME_KEY);
    const outcome = await recoverPart(page, LEGACY);
    await page.evaluate(() => { delete window.__recordFault; });
    const result = await text(page, backupScreen);
    check('G12', 'a recovery that stops after the first record is reported as not complete, never as a success',
      outcome === 'error' && result.includes('The recovery is not complete') && !result.includes('Recovery complete') && result.includes('Its learning data is in this browser and was checked. Its theme could not be written.') && result.includes('its storage for this site is full'), result.slice(0, 500));
    const partial = await snapshot(page);
    check('G13', 'the learning data is the backed-up text, the theme was not written, and nothing else was touched',
      same(partial.records, { [V1_STATE_KEY]: expected.legacy[V1_STATE_KEY] }) && same(Object.keys(partial.databases), [V3_NAME]), partial.records);
    await waitForDestination(page, LEGACY, 'partial');
    const part = await text(page, sectionOf(LEGACY));
    check('G14', 'the destination is judged again: the learning data is proven unchanged, so the completion is offered',
      part.includes('Partly recovered. The learning data of this backup is already in the previous version (v1) in this browser, unchanged.') && part.includes('Complete the recovery of the previous version (v1)'), part);
    await askFor(page, LEGACY);
    const dialog = await text(page, 'dialog.dialog');
    check('G15', 'the second confirmation says that only the theme is written, and warns about other tabs like the first', dialog.includes('Complete the recovery of the previous version (v1)?') && dialog.includes('This writes only what is still missing: the theme (dark).') && dialog.includes('The learning data is not written again.') && dialog.includes(OTHER_TABS_OF_V1), dialog);
    const beforeConfirm = await storageLog(page);
    await page.click('[data-backup-action="confirm-recover"]');
    await until(async () => (await outcomeOf(page)) === 'success' && !(await dialogOpen(page)), 'the completion');
    const log = await logSince(page, beforeConfirm);
    check('G16', 'the completion wrote the theme and nothing else: the learning data was not written again', same(log.setItem, [V1_THEME_KEY]) && onlyLegacyKeys(log.getItem) && !log.removeItem.length && !log.clear.length, log);
    check('G17', 'both records are now the backed-up text', same((await snapshot(page)).records, expected.legacy));
    await context.close();
  }
  {
    // The page is closed between the two writes. Nothing of that session survives but the first record.
    const { context, page } = await newProfile({ faults: true });
    await openBackupScreen(page);
    await chooseFile(page, exported.path);
    await page.evaluate((key) => { window.__recordFault = { kind: 'hang', key, holdMs: 8000 }; }, V1_THEME_KEY);
    const { reached, closedWhileStopped } = await stopAndClose(page, LEGACY);
    const reopened = watch(await context.newPage());
    await openBackupScreen(reopened);
    const afterwards = await snapshot(reopened);
    // The browser has kept the first record, or it has kept nothing: both are states from which the recovery goes on.
    const keptFirst = same(afterwards.records, { [V1_STATE_KEY]: expected.legacy[V1_STATE_KEY] });
    const keptNothing = same(afterwards.records, {});
    observations.push(`G18: after a page closed between the two writes, the key-value storage held ${keptFirst ? 'the first record (the learning data) and no theme' : keptNothing ? 'no record' : JSON.stringify(afterwards.records)}`);
    check('G18', 'a page closed between the two writes leaves the first record alone, or nothing: never a theme without the learning data, and never another text',
      reached === true && closedWhileStopped === true && (keptFirst || keptNothing), afterwards.records);
    await chooseFile(reopened, exported.path);
    check('G19', 'from the file alone, the new session knows where the recovery stands: partly done when the first record is there, not started otherwise',
      (await destinationOf(reopened, LEGACY)) === (keptFirst ? 'partial' : 'empty') && (await offered(reopened, LEGACY)));
    const beforeConfirm = await storageLog(reopened);
    check('G20', 'the recovery goes on from there, writes only what is missing, and both records are then the backed-up text',
      (await recoverPart(reopened, LEGACY)) === 'success' && same((await logSince(reopened, beforeConfirm)).setItem, keptFirst ? [V1_THEME_KEY] : [V1_STATE_KEY, V1_THEME_KEY]) && same((await snapshot(reopened)).records, expected.legacy));
    await openApp(reopened, V1);
    check('G21', 'the released first version starts on the completed records and keeps them', same((await snapshot(reopened)).records, expected.legacy) && (await reopened.evaluate(() => document.documentElement.dataset.themePreference)) === 'dark');
    await context.close();
  }
  {
    // The first record cannot be written: nothing is changed, and nothing is half done.
    const { context, page } = await newProfile({ faults: true });
    await openOnce(context, V1);
    await openBackupScreen(page);
    const firstStart = await snapshot(page);
    await chooseFile(page, exported.path);
    await page.evaluate((key) => { window.__recordFault = { kind: 'throw', key }; }, V1_STATE_KEY);
    const outcome = await recoverPart(page, LEGACY);
    await page.evaluate(() => { delete window.__recordFault; });
    const result = await text(page, backupScreen);
    check('G22', 'a recovery whose first record cannot be written is a failure with nothing changed: the theme is not attempted',
      outcome === 'error' && result.includes('Nothing was recovered') && result.includes('could not be written, and nothing was changed') && same((await snapshot(page)).records, firstStart.records), result.slice(0, 400));
    await waitForDestination(page, LEGACY, 'empty');
    check('G23', 'the next attempt recovers both records', (await recoverPart(page, LEGACY)) === 'success' && same((await snapshot(page)).records, expected.legacy));
    await context.close();
  }
  {
    // After a partly done recovery the first version was used: its state is no longer the text of the backup.
    const { context, page } = await newProfile();
    await page.goto(NEUTRAL, { waitUntil: 'load' });
    const used = JSON.stringify({ ...JSON.parse(expected.legacy[V1_STATE_KEY]), learnedPhrases: ['phrase-101', 'phrase-102', 'phrase-learned-since'] });
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [V1_STATE_KEY, used]);
    await openBackupScreen(page);
    const beforeFile = await storageLog(page);
    await chooseFile(page, exported.path);
    check('G24', 'learning data that was changed after it was recovered is never written over: no completion is offered',
      (await destinationOf(page, LEGACY)) === 'occupied' && !(await offered(page, LEGACY)) && same((await snapshot(page)).records, { [V1_STATE_KEY]: used }) && wroteNoRecord(await logSince(page, beforeFile)));
    await context.close();
  }

  {
    // The second finding of the review. A new session that finds the learning data already in place goes
    // straight to the completion: its confirmation is the only one that the learner sees.
    const { context, page } = await newProfile();
    await page.goto(NEUTRAL, { waitUntil: 'load' });
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [V1_STATE_KEY, expected.legacy[V1_STATE_KEY]]);
    await openBackupScreen(page);
    await chooseFile(page, exported.path);
    check('G25', 'a new session with the learning data of the backup already in place offers the completion at once', (await destinationOf(page, LEGACY)) === 'partial' && (await offered(page, LEGACY)));
    await askFor(page, LEGACY);
    const dialog = await text(page, 'dialog.dialog');
    check('G26', 'that confirmation, the only one of this session, carries the warning about other tabs of the previous version',
      dialog.includes('Complete the recovery of the previous version (v1)?') && dialog.includes(OTHER_TABS_OF_V1) && dialog.includes('The learning data is not written again.'), dialog);
    const beforeConfirm = await storageLog(page);
    check('G27', 'the completion still writes the theme only, and both records are then the backed-up text',
      (await confirmAndWait(page, 'the completion in a new session')) === 'success' && same((await logSince(page, beforeConfirm)).setItem, [V1_THEME_KEY]) && same((await snapshot(page)).records, expected.legacy));
    await context.close();
  }

  // ---- H. All three products from one file, and the products stay apart ---------------------
  {
    const { context, page } = await newProfile();
    await page.goto(NEUTRAL, { waitUntil: 'load' });
    const empty = await snapshot(page);
    check('H1', 'the new profile holds nothing at all', Object.keys(empty.databases).length === 0 && Object.keys(empty.records).length === 0 && empty.caches.length === 0);
    await openOnce(context, V2);
    await openBackupScreen(page);
    await chooseFile(page, exported.path);
    check('H2', 'each part of the file has its own destination, and all three can be recovered', same(await offeredParts(page), [OWN, STABLE, LEGACY]));

    // The other two products first: this product must not see any of their data.
    check('H3', 'the stable version and the previous version are recovered, one after the other', (await recoverPart(page, STABLE)) === 'success' && (await recoverPart(page, LEGACY)) === 'success');
    const others = await snapshot(page);
    check('H4', 'recovering them left this product\'s database without learning data', STORES.filter((store) => store !== 'settings').every((store) => others.databases[V3_NAME].stores[store].length === 0) && same(others.databases[V2_NAME], expected.stable) && same(others.records, expected.legacy));
    await openApp(page, V3, '#collections');
    const experimental = await text(page);
    check('H5', 'the experimental product, next to the other two products\' data, starts empty and shows none of it', experimental.includes('No collections yet') && !experimental.includes('Synthetic collection 2'), experimental.slice(0, 300));

    await openBackupScreen(page);
    const disguised = JSON.parse(exported.text);
    disguised.sections[OWN] = disguised.sections[STABLE];
    disguised.integrity.sections[OWN] = disguised.integrity.sections[STABLE];
    await chooseFile(page, asFile('disguised.json', JSON.stringify(disguised)));
    const problem = await text(page, '[data-backup-problem]');
    check('H6', 'the stable product\'s data under this product\'s name is refused: a section is judged by its own storage identity', problem.includes('names the storage "eng-trainer-v2", not "eng-trainer-v3"'), problem);
    const swapped = JSON.parse(exported.text);
    swapped.sections[STABLE] = swapped.sections[OWN];
    swapped.integrity.sections[STABLE] = swapped.integrity.sections[OWN];
    await chooseFile(page, asFile('swapped.json', JSON.stringify(swapped)));
    const second = await text(page, '[data-backup-problem]');
    check('H7', 'this product\'s data under the stable product\'s name is refused in the same way', second.includes('names the storage "eng-trainer-v3", not "eng-trainer-v2"'), second);

    await chooseFile(page, exported.path);
    check('H8', 'this product is recovered next to the other two, which are seen to hold exactly their data', (await destinationOf(page, STABLE)) === 'identical' && (await destinationOf(page, LEGACY)) === 'identical' && (await recoverPart(page, OWN)) === 'success');
    await waitForDestination(page, OWN, 'recovered');
    const all = await snapshot(page);
    check('H9', 'after the three recoveries the whole origin is deeply equal to the origin that the backup was made from: every database, every record, no cache',
      same(all, before), { databases: Object.keys(all.databases), records: Object.keys(all.records) });
    await chooseFile(page, exported.path);
    check('H10', 'chosen again, the same file finds exactly its data in every destination, offers nothing, and gives no advice to reset',
      same([await destinationOf(page, OWN), await destinationOf(page, STABLE), await destinationOf(page, LEGACY)], ['identical', 'identical', 'identical']) && (await offeredParts(page)).length === 0 && !(await text(page, backupScreen)).includes('Reset'));
    check('H11', 'looking at the destinations again changed nothing', same(await snapshot(page), before));
    await context.close();
  }
  {
    // A backup that holds only the other two products.
    const { context, page } = await newProfile();
    await openOnce(context, V2);
    await openBackupScreen(page);
    const start = await snapshot(page);
    const others = { ...exported.file, sections: { [STABLE]: exported.file.sections[STABLE], [LEGACY]: exported.file.sections[LEGACY] }, integrity: { algorithm: 'SHA-256', sections: { [STABLE]: exported.file.integrity.sections[STABLE], [LEGACY]: exported.file.integrity.sections[LEGACY] } } };
    await chooseFile(page, asFile('others.json', JSON.stringify(others)));
    check('H12', 'a backup without this product\'s data shows its two parts, offers them, and offers nothing for this product',
      same(await offeredParts(page), [STABLE, LEGACY]) && (await page.evaluate((selector) => document.querySelector(selector) === null, sectionOf(OWN))));
    check('H13', 'both are recovered, and this product\'s database is exactly as before',
      (await recoverPart(page, STABLE)) === 'success' && (await recoverPart(page, LEGACY)) === 'success' && same((await snapshot(page)).databases[V3_NAME], start.databases[V3_NAME]) && same((await snapshot(page)).databases[V2_NAME], expected.stable) && same((await snapshot(page)).records, expected.legacy));
    await context.close();
  }

  // ---- J. The handover from the running application to a recovery of this product ------------
  // Finding 3 of the independent review: changes that this tab accepted while a recovery was being
  // prepared were dropped, a change that could not be saved too, and a refused recovery then loaded
  // the state again. The steps of the review's probe are repeated here: the confirmation, the Back
  // button, "Mark as learned".
  const learnButton = (page) => page.getByRole('button', { name: 'Mark as learned', exact: true }).first();
  const learnedOnScreen = (page) => page.getByRole('button', { name: 'Mark as not learned', exact: true }).count();
  const noticeOf = (page) => page.evaluate(() => (document.querySelector('.storage-notice')?.textContent ?? '').replace(/\s+/g, ' ').trim());
  const handover = (page) => page.evaluate(() => { const { releaseOpen, ...state } = window.__handover; return state; });
  const arm = (page, flags) => page.evaluate((values) => Object.assign(window.__handover, values), flags);
  const learnedIn = (stored) => stored.databases[V3_NAME].stores.progress.find(([key]) => key === 'learnedPhrases')?.[1] ?? [];
  /** The Phrases screen first, then the Backup screen: the Back button then leads to Phrases. */
  async function openBackupAfterPhrases(page) {
    await openApp(page, V3, '#phrases');
    await learnButton(page).waitFor({ timeout: 15000 });
    await page.evaluate(() => { window.location.hash = 'backup'; });
    await until(() => page.evaluate((selector) => Boolean(document.querySelector(selector)), backupScreen), 'the Backup screen');
    await page.evaluate(HANDOVER_HOOKS);
  }

  {
    // A save that is being written and a change that waits behind it, made while the recovery is prepared.
    const { context, page } = await newProfile();
    await openBackupAfterPhrases(page);
    await chooseFile(page, exported.path);
    await askFor(page, OWN);
    await arm(page, { holdOpen: true, holdSave: true });
    await page.click('[data-backup-action="confirm-recover"]');
    await page.waitForFunction(() => window.__handover.openHeld);
    await page.goBack();
    await learnButton(page).waitFor({ timeout: 15000 });
    await learnButton(page).click();
    await page.waitForFunction(() => window.__handover.saveHeld);
    await learnButton(page).click();
    const before = await learnedOnScreen(page);
    check('J1', 'the learner goes back while the recovery is still being prepared and marks two phrases: both are accepted, the first is being saved and the second waits behind it',
      before === 2 && !(await page.evaluate((selector) => Boolean(document.querySelector(selector)), backupScreen)), { before });
    await page.evaluate(() => window.__handover.releaseOpen());
    // Longer than the recovery needs to go on. The first save is still held: the recovery has to wait for it.
    await page.waitForTimeout(700);
    const waiting = await handover(page);
    check('J2', 'the recovery waits for these saves: it opens no transaction and switches nothing off while one of them is still being written',
      waiting.recoveryTransactions === 0 && waiting.stateReads === 0 && (await noticeOf(page)) === '' && (await learnedOnScreen(page)) === 2, waiting);
    await arm(page, { releaseSave: true });
    const stored = await until(async () => { const now = await snapshot(page); return learnedIn(now).length === 2 ? now : null; }, 'both changes to be saved');
    const state = await handover(page);
    check('J3', 'nothing is lost: both phrases are learned on screen and in the database, in the order in which they were marked',
      (await learnedOnScreen(page)) === 2 && learnedIn(stored).length === 2 && !state.timedOut, learnedIn(stored));
    check('J4', 'the recovery did not start, because its screen was closed: no transaction of it, no state loaded again, no notice',
      state.recoveryTransactions === 0 && state.stateReads === 0 && (await noticeOf(page)) === '', state);
    await page.evaluate(() => { window.location.hash = 'backup'; });
    await until(() => page.evaluate((selector) => Boolean(document.querySelector(selector)), backupScreen), 'the Backup screen');
    await chooseFile(page, exported.path);
    check('J5', 'the destination holds those two phrases now, so the file is not offered for this version, and nothing was recovered',
      (await destinationOf(page, OWN)) === 'occupied' && !(await offered(page, OWN)) && learnedIn(await snapshot(page)).length === 2);
    await context.close();
  }

  {
    // A change that could not be saved, made while the recovery is prepared.
    const { context, page } = await newProfile();
    await openBackupAfterPhrases(page);
    await chooseFile(page, exported.path);
    await askFor(page, OWN);
    await arm(page, { holdOpen: true });
    await page.click('[data-backup-action="confirm-recover"]');
    await page.waitForFunction(() => window.__handover.openHeld);
    await page.goBack();
    await learnButton(page).waitFor({ timeout: 15000 });
    await arm(page, { failSave: true });
    await learnButton(page).click();
    await page.getByText('Your latest changes are not saved.', { exact: true }).waitFor({ timeout: 15000 });
    const database = (await snapshot(page)).databases[V3_NAME];
    await arm(page, { failSave: false });
    await page.evaluate(() => window.__handover.releaseOpen());
    await page.waitForTimeout(1500);
    const state = await handover(page);
    const notice = await noticeOf(page);
    check('J6', 'a change that could not be saved while the recovery was being prepared stays on screen, with the notice that it is not saved and the way to try again',
      (await learnedOnScreen(page)) === 1 && notice.includes('Your latest changes are not saved.') && notice.includes('Try saving again') && state.failedSaves >= 1, { notice, state });
    check('J7', 'the recovery wrote nothing and loaded nothing: no transaction of it, and the database is as it was',
      state.recoveryTransactions === 0 && state.stateReads === 0 && same((await snapshot(page)).databases[V3_NAME], database), state);
    await page.getByRole('button', { name: 'Try saving again', exact: true }).click();
    const saved = await until(async () => { const now = await snapshot(page); return learnedIn(now).length === 1 ? now : null; }, 'the change to be saved');
    check('J8', '"Try saving again" saves the change: it was never dropped', learnedIn(saved).length === 1 && (await noticeOf(page)) === '' && (await learnedOnScreen(page)) === 1, learnedIn(saved));
    await context.close();
  }

  {
    // A change that could not be saved before the recovery was confirmed, with the Backup screen open.
    const { context, page } = await newProfile();
    await openApp(page, V3, '#phrases');
    await learnButton(page).waitFor({ timeout: 15000 });
    await page.evaluate(HANDOVER_HOOKS);
    await arm(page, { failSave: true });
    await learnButton(page).click();
    await page.getByText('Your latest changes are not saved.', { exact: true }).waitFor({ timeout: 15000 });
    await page.evaluate(() => { window.location.hash = 'backup'; });
    await until(() => page.evaluate((selector) => Boolean(document.querySelector(selector)), backupScreen), 'the Backup screen');
    await chooseFile(page, exported.path);
    const database = (await snapshot(page)).databases[V3_NAME];
    await askFor(page, OWN);
    const outcome = await confirmAndWait(page, 'the result of a recovery next to a change that is not saved');
    const result = await text(page, backupScreen);
    const state = await handover(page);
    check('J9', 'with a change that is not saved, the recovery is refused as nothing recovered, and the screen says how to save the change first',
      outcome === 'error' && result.includes('Nothing was recovered') && result.includes('The latest changes in this tab could not be saved, so nothing was recovered') && result.includes('Try saving again') && state.recoveryTransactions === 0, result.slice(0, 500));
    check('J10', 'no reload is offered or asked for, nothing was loaded again, and the database is as it was: the change is still in this tab, reported as not saved',
      !(await reloadOffered(page)) && !/reload/i.test(await text(page, '[data-backup-outcome]')) && state.stateReads === 0 && (await noticeOf(page)).includes('Your latest changes are not saved.') && same((await snapshot(page)).databases[V3_NAME], database), state);
    await arm(page, { failSave: false });
    await page.getByRole('button', { name: 'Try saving again', exact: true }).click();
    const saved = await until(async () => { const now = await snapshot(page); return learnedIn(now).length === 1 ? now : null; }, 'the change to be saved');
    await askFor(page, OWN);
    const second = await confirmAndWait(page, 'the result of a recovery after the change was saved');
    const refused = await text(page, '[data-backup-outcome]');
    check('J11', 'once the change is saved it is learning data in the database, and the recovery is refused for that reason: it never overwrites',
      second === 'error' && refused.includes('already holds learning data') && same(learnedIn(await snapshot(page)), learnedIn(saved)) && (await handover(page)).stateReads === 0, refused);
    await context.close();
  }

  {
    // While the recovery writes: its transaction is kept open, as a slow disk does.
    const { context, page } = await newProfile();
    await openBackupAfterPhrases(page);
    await chooseFile(page, exported.path);
    await askFor(page, OWN);
    await arm(page, { holdRecovery: true });
    await page.click('[data-backup-action="confirm-recover"]');
    await page.waitForFunction(() => window.__handover.recoveryHeld);
    await page.goBack();
    await page.waitForTimeout(400);
    const afterBack = await page.evaluate((selector) => ({ hash: window.location.hash, screen: Boolean(document.querySelector(selector)), dialog: document.querySelector('dialog.dialog')?.open === true, phrases: Boolean(document.querySelector('.phrase-card')) }), backupScreen);
    await page.evaluate(() => { window.location.hash = 'words'; });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const afterAddress = await page.evaluate((selector) => ({ hash: window.location.hash, screen: Boolean(document.querySelector(selector)), dialog: document.querySelector('dialog.dialog')?.open === true }), backupScreen);
    check('J12', 'while the recovery writes, the Back button, a typed address and Escape change nothing: the Backup screen stays open, at its address',
      same(afterBack, { hash: '#backup', screen: true, dialog: true, phrases: false }) && same(afterAddress, { hash: '#backup', screen: true, dialog: true }), { afterBack, afterAddress });
    const holding = await text(page, '[data-backup-holding]');
    check('J13', 'the confirmation says that this tab accepts no changes until the recovery has finished',
      holding === 'Recovering… Until this has finished, this tab accepts no changes and keeps this screen open.' && (await noticeOf(page)) === '', holding);
    await arm(page, { releaseRecovery: true });
    await until(async () => (await outcomeOf(page)) !== null && !(await dialogOpen(page)), 'the result of the recovery');
    const state = await handover(page);
    check('J14', 'the recovery then completes: one transaction, the database is deeply equal to the backed-up state, and nothing of the old state was written',
      (await outcomeOf(page)) === 'success' && state.recoveryTransactions === 1 && !state.timedOut && same((await snapshot(page)).databases[V3_NAME], expected.own), state);
    // The recovered Learn pass has no Phrases screen, so the next change is made in Settings.
    await page.evaluate(() => { window.location.hash = 'settings'; });
    await page.waitForSelector('input[name="theme"][value="dark"]:checked', { timeout: 15000 });
    await page.check('input[name="theme"][value="light"]');
    const themeOf = (stored) => stored.databases[V3_NAME].stores.settings.find(([key]) => key === 'theme')?.[1];
    const saved = await until(async () => { const now = await snapshot(page); return themeOf(now) === 'light' ? now : null; }, 'a change after the recovery to be saved');
    const withRecoveredTheme = { ...saved.databases[V3_NAME], stores: { ...saved.databases[V3_NAME].stores, settings: saved.databases[V3_NAME].stores.settings.map(([key, value]) => (key === 'theme' ? [key, 'dark'] : [key, value])) } };
    check('J15', 'after the recovery the tab navigates and saves again, on the state it loaded from the database: Settings shows the recovered theme, and a new choice is saved on top of the recovered data, which is otherwise unchanged',
      same(withRecoveredTheme.stores.progress, expected.own.stores.progress) && same(withRecoveredTheme.stores.userEntries, expected.own.stores.userEntries) && same(withRecoveredTheme.stores.settings.filter(([key]) => key !== 'activePage'), expected.own.stores.settings.filter(([key]) => key !== 'activePage')) && (await noticeOf(page)) === '' && (await page.evaluate(() => window.location.hash)) === '#settings',
      saved.databases[V3_NAME].stores.settings);
    await context.close();
  }

  {
    // A recovery that is rolled back, with the screen open.
    const { context, page } = await newProfile({ faults: true });
    await openApp(page, V3, '#settings');
    await page.check('input[name="theme"][value="light"]');
    await until(async () => (await snapshot(page)).databases[V3_NAME].stores.settings.some(([key, value]) => key === 'theme' && value === 'light'), 'the theme to be saved');
    await page.evaluate(() => { window.location.hash = 'backup'; });
    await until(() => page.evaluate((selector) => Boolean(document.querySelector(selector)), backupScreen), 'the Backup screen');
    await page.evaluate(HANDOVER_HOOKS);
    await chooseFile(page, exported.path);
    const database = (await snapshot(page)).databases[V3_NAME];
    await page.evaluate((db) => { window.__fault = { kind: 'throw', db, at: 9, calls: 0 }; }, V3_NAME);
    const outcome = await recoverPart(page, OWN);
    await page.evaluate(() => { delete window.__fault; });
    const state = await handover(page);
    check('J16', 'a recovery that is rolled back loads nothing again and switches nothing off: one transaction, no read of the saved state, no notice, the theme of this tab kept',
      outcome === 'error' && state.recoveryTransactions === 1 && state.stateReads === 0 && (await noticeOf(page)) === '' && !(await reloadOffered(page)) && (await page.evaluate(() => document.documentElement.dataset.themePreference)) === 'light' && same((await snapshot(page)).databases[V3_NAME], database), state);
    await page.evaluate(() => { window.location.hash = 'phrases'; });
    await learnButton(page).waitFor({ timeout: 15000 });
    await learnButton(page).click();
    const saved = await until(async () => { const now = await snapshot(page); return learnedIn(now).length === 1 ? now : null; }, 'a change after the rollback to be saved');
    check('J17', 'the tab goes on as it was: the next change is accepted and saved', learnedIn(saved).length === 1 && (await noticeOf(page)) === '', learnedIn(saved));
    await context.close();
  }

  check('I1', 'no page of the experimental product reported an error', pageProblems.length === 0, pageProblems);
  check('I2', 'the experimental and the stable product requested nothing from another host; only the first version asked for its web fonts', offOrigin.every((url) => /fonts\.(googleapis|gstatic)\.com/.test(url)), offOrigin.slice(0, 5));
} catch (error) {
  check('RUN', 'the acceptance run completed', false, error.stack ?? error.message);
} finally {
  const version = browser.version();
  await browser.close();
  await new Promise((done) => server.close(done));
  rmSync(work, { recursive: true, force: true });

  const failed = checks.filter((item) => !item.pass);
  const result = {
    milestone: 'ENG-V3-R1A-RC3',
    browser: `${engine} ${version}`,
    data: 'made up by the script; every browser profile was new and disposable',
    passed: checks.length - failed.length,
    failed: failed.length,
    blockedRequestsToOtherHosts: [...new Set(offOrigin.map((url) => new URL(url).host))],
    observations,
    checks
  };
  if (outFile) writeFileSync(resolve(outFile), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`\n${engine} ${version}: ${result.passed} of ${checks.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
}
