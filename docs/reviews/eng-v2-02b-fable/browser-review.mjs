// ENG-V2-02B Fable review — native Chromium/Firefox scenarios on the assembled
// production artifact. Independent of Astra's runner: own server, own
// instrumentation, own seeds and assertions. Disposable browser contexts only.
//
// Usage: node browser-review.mjs <candidate site-dist> <released 020babf dist> <playwright-tools> <out-dir> [scenario,...]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const [candidateSite, baselineSite, tools, outDir, only] = process.argv.slice(2);
const out = resolve(outDir);
await mkdir(out, { recursive: true });
const { chromium, firefox } = await import(pathToFileURL(join(resolve(tools), 'node_modules/playwright/index.mjs')).href);
const FONT_STUB = '.material-symbols-rounded{display:inline-block;width:1em;height:1em;overflow:hidden;line-height:1;white-space:nowrap}';

// ------------------------------------------------------------------ server
// One origin, so both builds share one IndexedDB. The served build can be
// switched between the released baseline and the candidate.
const server = await (async () => {
  const roots = { candidate: resolve(candidateSite), baseline: resolve(baselineSite) };
  const state = { current: 'candidate', log: [] };
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const http = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    state.log.push(path);
    if (path === '/_review/blank') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>blank</title>'); return; }
    try {
      assert.ok(path.startsWith('/eng-trainer/'));
      const root = roots[state.current];
      let file = resolve(root, path.slice('/eng-trainer/'.length));
      assert.ok(file === root || file.startsWith(root + sep));
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': (types[extname(file)] ?? 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${http.address().port}`;
  return { origin, base: `${origin}/eng-trainer/`, use: (name) => { state.current = name; }, log: state.log, close: () => new Promise((r) => http.close(r)) };
})();

// ------------------------------------------------------------------ in-page instrumentation
function instrument() {
  const R = window.__fr = { unhandled: [], writes: [], readwrite: 0, pending: 0, last: 0, opens: [], storage: 0, shellAt: 0, heroAtShell: '', fault: null, faultHits: 0 };
  addEventListener('unhandledrejection', (e) => R.unhandled.push(String(e.reason?.message ?? e.reason)));
  const tx = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
    const t = tx.call(this, stores, mode, ...rest);
    if (this.name === 'eng-trainer-v2' && mode === 'readwrite') {
      R.readwrite++; R.pending++;
      const done = () => { R.pending--; R.last = performance.now(); };
      t.addEventListener('complete', done); t.addEventListener('abort', done);
    }
    return t;
  };
  for (const m of ['put', 'delete', 'add', 'clear']) {
    const original = IDBObjectStore.prototype[m];
    IDBObjectStore.prototype[m] = function (...args) {
      const f = R.fault;
      if (this.transaction.db.name === 'eng-trainer-v2') {
        R.writes.push({ m, store: this.name, key: m === 'put' ? args[1] : args[0] });
        if (f && f.method === m && f.store === this.name) {
          if (f.kind === 'quota') { R.faultHits++; throw new DOMException('Injected quota exceeded', 'QuotaExceededError'); }
          const request = original.apply(this, args);
          const t = this.transaction;
          request.addEventListener('success', () => { if (++f.seen > f.after) { R.faultHits++; try { t.abort(); } catch {} } });
          return request;
        }
      }
      return original.apply(this, args);
    };
  }
  const open = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (name, ...rest) { R.opens.push([name, rest[0] ?? null]); return open.call(this, name, ...rest); };
  for (const k of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) {
    const o = Storage.prototype[k];
    Storage.prototype[k] = function (...a) { if (this === window.localStorage && location.pathname.startsWith('/eng-trainer/') && !location.pathname.startsWith('/eng-trainer/v1/')) R.storage++; return o.apply(this, a); };
  }
  // Upgrade-fault hooks, enabled per tab through sessionStorage before the app starts.
  const create = IDBDatabase.prototype.createObjectStore;
  IDBDatabase.prototype.createObjectStore = function (name, ...rest) {
    const mode = sessionStorage.getItem('fable-upgrade-fault');
    if (mode === 'throw' && name === 'userEntries') throw new DOMException('Injected upgrade failure', 'UnknownError');
    const store = create.call(this, name, ...rest);
    if (mode === 'abort' && name === 'userEntries') store.transaction.abort();
    return store;
  };
  new MutationObserver((_, observer) => {
    const shell = document.querySelector('.app-shell');
    if (shell) { R.shellAt = performance.now(); R.heroAtShell = document.querySelector('.hero__stats')?.textContent ?? ''; observer.disconnect(); }
  }).observe(document, { childList: true, subtree: true });
}

// ------------------------------------------------------------------ helpers
const V1_STORES = ['progress', 'learnPasses', 'flashcardSessions', 'settings'];
async function readDb(page) {
  return page.evaluate(async () => {
    const list = indexedDB.databases ? await indexedDB.databases() : null;
    if (list && !list.some((d) => d.name === 'eng-trainer-v2')) return null;
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('eng-trainer-v2'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const stores = {};
    for (const name of Array.from(db.objectStoreNames)) {
      const t = db.transaction(name, 'readonly'); const s = t.objectStore(name);
      const keys = s.getAllKeys(), values = s.getAll();
      await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
      stores[name] = Object.fromEntries(keys.result.map((k, i) => [k, values.result[i]]));
    }
    const version = db.version; db.close();
    return { version, stores };
  });
}
async function seedV1(page, records) {
  await page.evaluate(async ({ records, stores }) => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('eng-trainer-v2', 1); r.onupgradeneeded = () => stores.forEach((s) => r.result.createObjectStore(s)); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const t = db.transaction(stores, 'readwrite');
    for (const [store, entries] of Object.entries(records)) for (const [k, v] of Object.entries(entries)) t.objectStore(store).put(v, k);
    await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
    db.close();
  }, { records, stores: V1_STORES });
}
const settle = (page) => page.waitForFunction(() => window.__fr && window.__fr.pending === 0 && performance.now() - window.__fr.last > 250, null, { timeout: 15000 });
const fr = (page) => page.evaluate(() => ({ ...window.__fr, fault: undefined }));
async function openApp(page, hash = '') {
  await page.goto(server.base + hash);
  await page.locator('.app-shell, .error-card').first().waitFor();
  await settle(page);
}
async function nav(page, label) {
  await page.locator('.desktop-nav button').filter({ hasText: new RegExp(`^\\s*${label}`) }).first().click();
  await page.locator('.hero h1').filter({ hasText: label }).waitFor();
  await settle(page);
}
async function chooseFile(page, name, content) {
  await page.getByLabel('Import vocabulary file').setInputFiles({ name, mimeType: name.endsWith('.json') ? 'application/json' : 'text/csv', buffer: Buffer.isBuffer(content) ? content : Buffer.from(content) });
  await page.waitForFunction(() => { const i = document.querySelector('input[type=file]'); return i && !i.disabled; });
}
async function confirmImport(page, acknowledge = true) {
  const ack = page.getByLabel('I reviewed these possible duplicates');
  if (acknowledge && await ack.count()) await ack.check();
  await page.getByRole('button', { name: 'Confirm import', exact: true }).click();
  await page.locator('.notice').first().waitFor();
  await settle(page);
}
const statusText = (page) => page.locator('.collections-page .notice').allInnerTexts().then((t) => t.join(' | '));
async function hero(page) {
  const text = await page.locator('.hero__stats').innerText();
  return Object.fromEntries([...text.matchAll(/(\d+)\s+(phrases|words|verbs|focus|hidden)/g)].map((m) => [m[2], +m[1]]));
}
async function download(page, collectionName) {
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: `Export ${collectionName} as JSON`, exact: true }).click();
  const d = await wait;
  const path = await d.path();
  return { name: d.suggestedFilename(), text: await readFile(path, 'utf8') };
}
const userStores = (db) => ({ userCollections: db.stores.userCollections, userEntries: db.stores.userEntries });
const stateStores = (db) => Object.fromEntries(V1_STORES.map((s) => [s, db.stores[s]]));
const uuid = (a, n) => `${a.toString(16).padStart(8, '0')}-feed-4abc-8abc-${n.toString(16).padStart(12, '0')}`;
const cid = (c) => `user:${uuid(0xc0110000 + c, 0)}`;
const eid = (c, n) => `${cid(c)}:entry:${uuid(0xe0110000 + c, n)}`;
const nativeDoc = (c, name, entries, description = '') => JSON.stringify({ format: 'eng-trainer-vocabulary', version: 1, collection: { id: cid(c), name, description }, entries }, null, 2) + '\n';
async function wordsSearch(page, query, collection = '') {
  await nav(page, 'Words');
  const select = page.getByLabel('Collection', { exact: true });
  if (await select.count()) await select.selectOption(collection);
  await page.getByPlaceholder('run into, lack, estimate…').fill(query);
  await settle(page);
  return (await page.locator('.index-list button').allInnerTexts()).map((t) => t.split('\n')[0].trim());
}
/** Answers a flashcard and waits until the resulting session write has completed. */
async function answer(page, choice = /Keep learning/) {
  const count = await page.evaluate(() => window.__fr.readwrite);
  await page.getByRole('button', { name: choice }).first().click();
  await page.waitForFunction((n) => window.__fr.readwrite > n, count);
  await settle(page);
}
async function phrasesSearch(page, query, collection = '') {
  await nav(page, 'Phrases');
  const select = page.getByLabel('Collection', { exact: true });
  if (await select.count()) await select.selectOption(collection);
  await page.getByPlaceholder('AI, otherwise, meeting…').fill(query);
  await settle(page);
  return page.locator('.phrase-card h3, .phrase-card h2').allInnerTexts();
}
async function cardInfo(page) {
  const term = await page.locator('.flashcard__term').innerText().catch(() => null);
  const stats = (await page.locator('.flashcards-progress__stats').innerText()).replace(/\s+/g, ' ');
  return { term, stats };
}

// Realistic released-build seed (shapes match what 020babf writes).
const SEED = {
  progress: { learnedPhrases: ['phrase-005', 'phrase-084'], favoritePhrases: ['phrase-013'], favoriteWords: ['word-phrase-084'], favoriteBlocks: [], hiddenPhrases: ['presentation-phrase-087'], hiddenWords: ['word-hedging-008-to-some-extent'], favoriteIrregular: ['iv-001-be'], hiddenIrregular: [], selectedLearnPassId: 'default', futureKey: { preserved: true } },
  learnPasses: { 'pass-review': { id: 'pass-review', name: 'Review pass', description: 'synthetic', blockIds: ['start-answer'], createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z' } },
  flashcardSessions: { all: { order: ['phrase-002', 'phrase-003', 'phrase-004', 'phrase-006'], index: 2 }, 'topic:Linking': { order: ['phrase-013'], index: 0 } },
  settings: { theme: 'dark', activePage: 'phrases', phrasePageSize: 10, flashcardMode: 'all' }
};

// ------------------------------------------------------------------ scenarios
const scenarios = [];
const scenario = (name, run) => scenarios.push({ name, run });

scenario('fresh-database', async ({ page, record }) => {
  await page.goto(server.origin + '/_review/blank');
  assert.equal(await readDb(page), null);
  await openApp(page);
  const db = await readDb(page);
  assert.equal(db.version, 2);
  assert.deepEqual(Object.keys(db.stores).sort(), [...V1_STORES, 'userCollections', 'userEntries'].sort());
  const f = await fr(page);
  record.version = db.version; record.stores = Object.keys(db.stores).sort(); record.startupWrites = f.writes; record.records = Object.fromEntries(Object.entries(db.stores).map(([k, v]) => [k, Object.keys(v).length]));
  assert.deepEqual(f.writes, []);
});

scenario('upgrade-from-released-build-with-open-old-tab', async ({ context, page, record }) => {
  server.use('baseline');
  const old = page;
  await old.goto(server.origin + '/_review/blank');
  await seedV1(old, SEED);
  await old.goto(server.base + '#flashcards');
  await old.locator('.app-shell').waitFor(); await settle(old);
  // Authentic released-build writes through its own UI.
  await answer(old);
  await nav(old, 'Phrases');
  await old.locator('.phrase-card').first().getByRole('button', { name: 'Mark as learned', exact: true }).click(); await settle(old);
  await nav(old, 'Flashcards');
  const releasedCard = await cardInfo(old);
  await nav(old, 'Phrases');
  const releasedHero = await hero(old);
  const v1 = await readDb(old);
  assert.equal(v1.version, 1);
  record.released = { hero: releasedHero, card: releasedCard, storeNames: Object.keys(v1.stores) };

  // The candidate opens in a second tab while the released tab stays open.
  server.use('candidate');
  const fresh = await context.newPage();
  await fresh.goto(server.base);
  await fresh.locator('.app-shell, .error-card').first().waitFor(); await settle(fresh);
  assert.equal(await fresh.locator('.app-shell').count(), 1, 'candidate should upgrade without a blocked error');
  const v2 = await readDb(fresh);
  assert.equal(v2.version, 2);
  assert.deepEqual(stateStores(v2), v1.stores, 'all four version-1 stores byte-for-byte equal');
  assert.deepEqual(userStores(v2), { userCollections: {}, userEntries: {} });
  assert.deepEqual((await fr(fresh)).writes, [], 'no startup writes');
  assert.deepEqual(await hero(fresh), releasedHero);
  assert.equal((await fresh.locator('.hero h1').innerText()).trim(), 'Phrases');
  assert.equal(await fresh.locator('html').getAttribute('data-theme-preference'), 'dark');
  assert.ok((await fresh.locator('.phrase-card').first().getAttribute('class')).includes('learned'));
  await nav(fresh, 'Flashcards');
  assert.deepEqual(await cardInfo(fresh), releasedCard, 'saved deck order and position');
  await nav(fresh, 'Index');
  record.learnPassVisible = await fresh.getByText('Review pass').count() > 0;
  assert.equal((await fr(fresh)).unhandled.length, 0);
  record.candidateNavigationWrites = (await fr(fresh)).writes.map((w) => `${w.m}:${w.store}:${w.key}`);
  const current = await readDb(fresh);

  // The released tab closed its connection on versionchange: its next save fails visibly.
  await old.locator('.phrase-card').nth(1).getByRole('button', { name: 'Mark as learned', exact: true }).click();
  await old.getByText(/latest changes are not saved/i).waitFor({ timeout: 10000 });
  record.oldTabSaveFailsVisibly = true;
  assert.deepEqual(await readDb(fresh), current, 'old tab wrote nothing after the upgrade');
  // Reloading the released build against database version 2: visible error, no data loss.
  server.use('baseline');
  await old.reload(); await old.locator('.error-card').waitFor();
  record.releasedBuildAfterUpgrade = (await old.locator('.error-card').innerText()).replace(/\s+/g, ' ').slice(0, 300);
  server.use('candidate');
  assert.deepEqual(await readDb(fresh), current);
  await old.close();
  record.preserved = { learned: v1.stores.progress.learnedPhrases, sessions: Object.keys(v1.stores.flashcardSessions), learnPasses: Object.keys(v1.stores.learnPasses), settings: v1.stores.settings };
});

scenario('blocked-upgrade-retry-while-blocked-and-recovery', async ({ context, page, record }) => {
  await page.goto(server.origin + '/_review/blank');
  await seedV1(page, SEED);
  const before = await readDb(page);
  const holder = await context.newPage();
  await holder.goto(server.origin + '/_review/blank');
  await holder.evaluate(() => new Promise((resolve, reject) => { const r = indexedDB.open('eng-trainer-v2', 1); r.onsuccess = () => { window.__held = r.result; resolve(); }; r.onerror = () => reject(r.error); }));
  await page.goto(server.base);
  await page.getByText('Close other eng-trainer tabs').waitFor();
  record.blockedMessage = (await page.locator('.error-card').innerText()).replace(/\s+/g, ' ').slice(0, 260);
  // Retry while the other connection is still open.
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.waitForTimeout(3000);
  record.retryWhileBlocked = await page.locator('.error-card').count() ? 'error shown again' : (await page.locator('.app-shell').count() ? 'ready' : 'still loading');
  await holder.evaluate(() => window.__held.close());
  const recovered = await page.locator('.app-shell').waitFor({ timeout: 8000 }).then(() => 'recovered without another click', () => 'needs another click');
  record.afterHolderClosed = recovered;
  if (recovered !== 'recovered without another click') {
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.locator('.app-shell').waitFor();
  }
  await settle(page);
  const after = await readDb(page);
  assert.equal(after.version, 2);
  assert.deepEqual(stateStores(after), before.stores);
  const f = await fr(page);
  record.unhandled = f.unhandled; record.opens = f.opens.filter(([n]) => n === 'eng-trainer-v2').length;
  assert.deepEqual(f.unhandled, []);
  assert.deepEqual(f.writes, []);
});

for (const mode of ['throw', 'abort']) {
  scenario(`failed-upgrade-${mode}-rolls-back`, async ({ page, record }) => {
    await page.goto(server.origin + '/_review/blank');
    await seedV1(page, SEED);
    const before = await readDb(page);
    await page.evaluate((m) => sessionStorage.setItem('fable-upgrade-fault', m), mode);
    await page.goto(server.base);
    await page.locator('.error-card').waitFor();
    record.upgradeError = (await page.locator('.error-card code').innerText().catch(() => '')).slice(0, 200);
    const failed = await readDb(page);
    assert.equal(failed.version, 1);
    assert.deepEqual(failed.stores, before.stores);
    assert.deepEqual((await fr(page)).unhandled, []);
    await page.evaluate(() => sessionStorage.removeItem('fable-upgrade-fault'));
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.locator('.app-shell').waitFor(); await settle(page);
    const after = await readDb(page);
    assert.equal(after.version, 2);
    assert.deepEqual(stateStores(after), before.stores);
    record.retried = true; record.unhandled = (await fr(page)).unhandled;
    assert.deepEqual(record.unhandled, []);
  });
}

const CSV = [
  'english,translation,topic,example,kind',
  'bank,банк,Money,I went to the bank.,word',
  'bank,берег,Nature,"We sat on the river bank, quietly.",word',
  'consequently,отже,Linking,,word',
  '"Let me explain, briefly",Дозвольте коротко пояснити,Speaking,"Line one\r\nline two",phrase',
  'ґудзик,button (uk),Українська,,word'
].join('\r\n');

scenario('import-preview-cancel-confirm-catalog-reload', async ({ page, record }) => {
  await page.goto(server.origin + '/_review/blank');
  await seedV1(page, SEED);
  await openApp(page, '#collections');
  const startState = stateStores(await readDb(page));
  record.startupWritesWithHash = (await fr(page)).writes.map((w) => `${w.m}:${w.store}:${w.key}`);
  const builtinHero = await hero(page);
  await chooseFile(page, 'Review words.csv', '﻿' + CSV);
  await page.getByRole('heading', { name: 'Review import' }).waitFor();
  const preview = await page.locator('.import-preview').innerText();
  record.previewSummary = preview.split('\n')[1];
  const rows = await page.locator('.import-preview tbody tr').allInnerTexts();
  record.previewReview = rows.map((r) => r.split('\t').pop());
  const confirm = page.getByRole('button', { name: 'Confirm import', exact: true });
  assert.equal(await confirm.isDisabled(), true, 'duplicates require acknowledgment');
  record.duplicateCount = (preview.match(/(\d+) entries have possible text duplicates/) ?? [])[1];
  // Cancel writes nothing.
  await page.getByRole('button', { name: 'Cancel import', exact: true }).click();
  await settle(page);
  assert.equal(await page.locator('.import-preview').count(), 0);
  assert.deepEqual((await fr(page)).writes.length, record.startupWritesWithHash.length, 'preview and cancel write nothing');
  // Select again, acknowledge, confirm.
  await chooseFile(page, 'Review words.csv', '﻿' + CSV);
  await page.getByLabel('Collection name', { exact: true }).fill('Qzx review set');
  await page.getByLabel('I reviewed these possible duplicates').check();
  assert.equal(await confirm.isDisabled(), false);
  await confirmImport(page);
  record.message = await statusText(page);
  const f = await fr(page);
  record.importWrites = f.writes.slice(record.startupWritesWithHash.length).map((w) => `${w.m}:${w.store}`);
  const db = await readDb(page);
  const collection = Object.values(db.stores.userCollections)[0];
  const entries = Object.values(db.stores.userEntries).sort((a, b) => a.position - b.position);
  assert.equal(entries.length, 5);
  assert.deepEqual(entries.map((e) => [e.english, e.translation, e.kind]), [['bank', 'банк', 'word'], ['bank', 'берег', 'word'], ['consequently', 'отже', 'word'], ['Let me explain, briefly', 'Дозвольте коротко пояснити', 'phrase'], ['ґудзик', 'button (uk)', 'word']]);
  assert.deepEqual(entries[3].examples, [{ en: 'Line one\nline two' }]);
  assert.deepEqual(stateStores(db), startState, 'import touches only collection stores');
  record.collection = { name: collection.name, revision: collection.revision, lastImport: collection.lastImport };
  // Catalog updates without reload.
  const afterHero = await hero(page);
  assert.deepEqual([afterHero.phrases - builtinHero.phrases, afterHero.words - builtinHero.words], [1, 4]);
  assert.deepEqual(await wordsSearch(page, 'BANK', collection.id), ['bank', 'bank']);
  assert.deepEqual(await wordsSearch(page, 'БЕРЕГ', collection.id), ['bank']);
  assert.deepEqual(await wordsSearch(page, 'QZX REVIEW', ''), ['bank', 'bank', 'consequently', 'ґудзик']);
  assert.deepEqual(await wordsSearch(page, 'ґудзик', 'built-in'), []);
  assert.deepEqual(await wordsSearch(page, 'ҐУДЗИК', ''), ['ґудзик']);
  assert.deepEqual(await phrasesSearch(page, 'explain, briefly', collection.id), ['Let me explain, briefly']);
  // Collection + category + hidden filters together.
  await nav(page, 'Words');
  await page.getByLabel('Collection', { exact: true }).selectOption(collection.id);
  await page.getByPlaceholder('run into, lack, estimate…').fill('');
  const category = page.locator('label').filter({ hasText: /^\s*Category/ }).locator('select');
  await category.selectOption('Money'); await settle(page);
  record.collectionPlusCategory = (await page.locator('.index-list button').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  assert.deepEqual(record.collectionPlusCategory, ['bank Money']);
  await page.getByRole('button', { name: 'Hide item', exact: true }).first().click(); await settle(page);
  record.collectionCategoryHidden = await page.locator('.index-list button').count();
  assert.equal(record.collectionCategoryHidden, 0, 'hidden entry leaves the filtered list');
  await page.getByRole('button', { name: 'Show hidden words', exact: true }).click(); await settle(page);
  assert.equal(await page.locator('.index-list button').count(), 1, 'show-hidden toggle works with collection + category');
  await page.getByRole('button', { name: 'Hide hidden words', exact: true }).click();
  await page.getByLabel('Collection', { exact: true }).selectOption('built-in'); await settle(page);
  record.builtInPlusMoneyCategory = await page.locator('.index-list button').count();
  await category.selectOption('All'); await page.getByLabel('Collection', { exact: true }).selectOption(''); await settle(page);
  await nav(page, 'Flashcards');
  await page.getByLabel('Collection', { exact: true }).selectOption(collection.id);
  await settle(page);
  record.flashcardsCollectionDeck = await cardInfo(page);
  assert.match(record.flashcardsCollectionDeck.stats, /4 remaining/, 'five cards, one hidden earlier in this scenario');
  await page.getByLabel('Collection', { exact: true }).selectOption('built-in'); await settle(page);
  record.flashcardsBuiltInDeck = await cardInfo(page);
  await page.getByLabel('Collection', { exact: true }).selectOption(''); await settle(page);
  record.flashcardsAllDeck = await cardInfo(page);
  record.deckKeysSaved = Object.keys((await readDb(page)).stores.flashcardSessions);
  // Reload: imported records are present at the first complete render.
  await page.reload(); await page.locator('.app-shell').waitFor(); await settle(page);
  const atShell = (await fr(page)).heroAtShell;
  record.heroAtFirstShellRender = atShell.replace(/\s+/g, ' ').trim();
  assert.match(atShell, new RegExp(`${afterHero.phrases}\\s*phrases`));
  assert.deepEqual((await fr(page)).writes, [], 'reload writes nothing');
  record.collectionFilterSetting = (await readDb(page)).stores.settings.collectionFilter;
});

const X_ENTRIES = [
  { id: eid(1, 1), kind: 'phrase', english: 'Xavier phrase one', translation: 'Перша фраза', topic: 'X topic', examples: [{ en: 'Example X1.', translation: 'Приклад X1.' }] },
  { id: eid(1, 2), kind: 'word', english: 'xenial', translation: 'гостинний', topic: 'X topic', examples: [], sourcePhraseId: eid(1, 1) },
  { id: eid(1, 3), kind: 'word', english: 'xylograph', translation: 'ксилографія', topic: 'X topic', examples: [] },
  { id: eid(1, 4), kind: 'word', english: 'xenon', translation: 'ксенон', topic: 'X topic', examples: [] },
  { id: eid(1, 5), kind: 'phrase', english: 'Xavier phrase two', translation: 'Друга фраза', topic: 'X topic', examples: [] },
  { id: eid(1, 6), kind: 'word', english: 'xenon', translation: 'інше значення', topic: 'X topic', examples: [] }
];
const X_DOC = nativeDoc(1, 'Xavier set', X_ENTRIES, 'Synthetic review collection');
const Y_CSV = 'english,translation\nyonder,там\nyodel,йодль';

scenario('delete-retains-progress-and-reimport-restores', async ({ page, record }) => {
  await page.goto(server.origin + '/_review/blank');
  await seedV1(page, SEED);
  await openApp(page, '#collections');
  await chooseFile(page, 'xavier.json', X_DOC); await confirmImport(page);
  await chooseFile(page, 'yankee.csv', Y_CSV); await confirmImport(page);
  const yId = Object.keys((await readDb(page)).stores.userCollections).find((k) => k !== cid(1));
  const builtinOnly = { phrases: 566, words: 566 };
  // Learn, hide, focus, and a collection-specific deck.
  await phrasesSearch(page, 'Xavier phrase one', cid(1));
  await page.locator('.phrase-card').first().getByRole('button', { name: 'Mark as learned', exact: true }).click();
  await page.locator('.phrase-card').first().getByRole('button', { name: 'Add to Focus List', exact: true }).click();
  await wordsSearch(page, 'xylograph', cid(1));
  await page.getByRole('button', { name: 'Hide item', exact: true }).first().click();
  await wordsSearch(page, 'xenon', cid(1));
  await page.getByRole('button', { name: 'Add to Focus List', exact: true }).first().click();
  await settle(page);
  await nav(page, 'Flashcards');
  await page.getByLabel('Collection', { exact: true }).selectOption(cid(1)); await settle(page);
  await answer(page);
  const xDeck = await cardInfo(page);
  // Shared 'all' deck also includes X's cards before deletion.
  await page.getByLabel('Collection', { exact: true }).selectOption(''); await settle(page);
  await answer(page);
  const allKey = 'all';
  const xKey = `collection:${JSON.stringify([cid(1), 'all'])}`;
  record.collectionDeckKey = xKey;
  const heroBefore = await hero(page);
  // Export, cancel removal, confirm removal.
  await nav(page, 'Collections');
  const exported = await download(page, 'Xavier set');
  record.exportFileName = exported.name;
  const before = await readDb(page);
  assert.ok(before.stores.flashcardSessions[xKey], 'collection-specific session saved');
  const xIdsInAllBefore = before.stores.flashcardSessions[allKey].order.filter((id) => id.startsWith(cid(1))).length;
  const writesBeforeCancel = (await fr(page)).writes.length;
  await page.getByRole('button', { name: 'Remove Xavier set', exact: true }).click();
  record.removalPrompt = (await page.getByRole('group', { name: 'Confirm collection removal' }).innerText()).replace(/\s+/g, ' ');
  await page.getByRole('button', { name: 'Keep collection', exact: true }).click(); await settle(page);
  assert.equal((await fr(page)).writes.length, writesBeforeCancel, 'cancel writes nothing');
  assert.deepEqual(await readDb(page), before);
  await page.getByRole('button', { name: 'Remove Xavier set', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await page.locator('.notice').filter({ hasText: 'Collection removed' }).waitFor(); await settle(page);
  const removed = await readDb(page);
  assert.equal(removed.stores.userCollections[cid(1)], undefined);
  assert.equal(Object.keys(removed.stores.userEntries).filter((k) => k.startsWith(cid(1))).length, 0);
  assert.ok(removed.stores.userCollections[yId], 'other collection intact');
  assert.deepEqual(Object.fromEntries(Object.entries(removed.stores.userEntries)), Object.fromEntries(Object.entries(before.stores.userEntries).filter(([k]) => !k.startsWith(cid(1)))));
  assert.deepEqual(stateStores(removed), stateStores(before), 'progress, focus, hidden, sessions, settings retained');
  // No ghost entries in views or counts.
  const heroRemoved = await hero(page);
  record.hero = { before: heroBefore, removed: heroRemoved };
  assert.deepEqual([heroRemoved.phrases, heroRemoved.words], [builtinOnly.phrases, builtinOnly.words + 2]);
  assert.equal(heroBefore.focus - heroRemoved.focus, 2);
  assert.equal(heroBefore.hidden - heroRemoved.hidden, 1);
  assert.deepEqual(await wordsSearch(page, 'xenon', ''), []);
  assert.deepEqual(await phrasesSearch(page, 'Xavier', ''), []);
  record.unhideAllPhrasesShown = await page.getByRole('button', { name: 'Unhide all phrases' }).count() > 0;
  await nav(page, 'Words');
  record.unhideAllWordsShownWithOnlyOrphanedOrBuiltInHidden = await page.getByRole('button', { name: 'Unhide all words' }).count() > 0;
  await page.locator('.desktop-nav button').filter({ hasText: /^\s*Focus/ }).first().click(); await settle(page);
  assert.equal(await page.getByText('Xavier phrase one').count(), 0);
  assert.equal(await page.getByText('xenon').count(), 0);
  await nav(page, 'Flashcards');
  record.filterOptionsAfterRemoval = await page.getByLabel('Collection', { exact: true }).locator('option').allInnerTexts();
  assert.ok(!record.filterOptionsAfterRemoval.includes('Xavier set'));
  // Answer once in the shared 'all' deck while X is absent: existing reconciliation prunes absent IDs.
  await answer(page);
  const afterSharedAnswer = await readDb(page);
  record.sharedAllDeck = { xIdsBeforeDeletion: xIdsInAllBefore, xIdsAfterAnswerWhileDeleted: afterSharedAnswer.stores.flashcardSessions[allKey].order.filter((id) => id.startsWith(cid(1))).length };
  assert.deepEqual(afterSharedAnswer.stores.flashcardSessions[xKey], before.stores.flashcardSessions[xKey], 'collection-specific session untouched');
  // Reload while removed, then reimport the exported native file.
  await page.reload(); await page.locator('.app-shell').waitFor(); await settle(page);
  await nav(page, 'Collections');
  await chooseFile(page, exported.name, exported.text);
  record.reimportPreview = (await page.locator('.import-preview p').first().innerText());
  await confirmImport(page);
  const restored = await readDb(page);
  for (const [k, v] of Object.entries(before.stores.userEntries)) if (k.startsWith(cid(1))) assert.deepEqual(restored.stores.userEntries[k], v);
  assert.deepEqual(restored.stores.progress, afterSharedAnswer.stores.progress);
  const heroRestored = await hero(page);
  record.hero.restored = heroRestored;
  assert.deepEqual([heroRestored.focus, heroRestored.hidden], [heroBefore.focus, heroBefore.hidden]);
  await phrasesSearch(page, 'Xavier phrase one', cid(1));
  assert.ok((await page.locator('.phrase-card').first().getAttribute('class')).includes('learned'));
  assert.deepEqual(await wordsSearch(page, 'xylograph', cid(1)), [], 'hidden state restored');
  await nav(page, 'Flashcards');
  await page.getByLabel('Collection', { exact: true }).selectOption(cid(1)); await settle(page);
  record.collectionDeck = { beforeDeletion: xDeck, afterReimport: await cardInfo(page) };
  assert.deepEqual(record.collectionDeck.afterReimport, xDeck, 'collection-specific deck order and position restored');
  // Reset progress clears learning state but keeps vocabulary.
  await page.getByLabel('Collection', { exact: true }).selectOption(''); await settle(page);
  await page.goto(server.base + '#index'); await page.locator('.app-shell').waitFor(); await settle(page);
  await page.getByRole('button', { name: 'Reset progress', exact: true }).click(); await settle(page);
  const reset = await readDb(page);
  assert.deepEqual(userStores(reset), userStores(restored));
  record.afterReset = { learnedPhrases: reset.stores.progress.learnedPhrases, hero: await hero(page), userEntries: Object.keys(reset.stores.userEntries).length };
  assert.deepEqual((await fr(page)).unhandled, []);
});

scenario('orphaned-progress-affordances-after-removal', async ({ page, record }) => {
  // No built-in hidden items: anything shown afterwards comes from the removed collection.
  await openApp(page, '#collections');
  await chooseFile(page, 'xavier.json', X_DOC); await confirmImport(page);
  await wordsSearch(page, 'xylograph', cid(1));
  await page.getByRole('button', { name: 'Hide item', exact: true }).first().click(); await settle(page);
  await phrasesSearch(page, 'Xavier phrase two', cid(1));
  await page.locator('.phrase-card').first().getByRole('button', { name: 'Hide item', exact: true }).click(); await settle(page);
  await nav(page, 'Collections');
  await page.getByRole('button', { name: 'Remove Xavier set', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click(); await settle(page);
  const h = await hero(page);
  record.heroHiddenAfterRemoval = h.hidden;
  assert.equal(h.hidden, 0, 'hidden count excludes removed entries');
  await nav(page, 'Words');
  record.unhideAllWordsShown = await page.getByRole('button', { name: 'Unhide all words' }).count() > 0;
  await page.getByRole('button', { name: 'Show hidden words', exact: true }).click(); await settle(page);
  await page.getByPlaceholder('run into, lack, estimate…').fill('xylograph'); await settle(page);
  record.hiddenWordsListedWhenShowingHidden = await page.locator('.index-list button').count();
  await page.getByRole('button', { name: 'Hide hidden words', exact: true }).click();
  await nav(page, 'Phrases');
  record.unhideAllPhrasesShown = await page.getByRole('button', { name: 'Unhide all phrases' }).count() > 0;
  // Using the visible "Unhide all" control discards the retained hidden state of the removed collection.
  if (record.unhideAllWordsShown) {
    await nav(page, 'Words');
    await page.getByRole('button', { name: 'Unhide all words' }).click(); await settle(page);
  }
  await nav(page, 'Collections');
  await chooseFile(page, 'xavier.json', X_DOC); await confirmImport(page);
  record.wordHiddenAfterReimport = (await wordsSearch(page, 'xylograph', cid(1))).length === 0;
  record.phraseHiddenAfterReimport = (await phrasesSearch(page, 'Xavier phrase two', cid(1))).length === 0;
});

scenario('two-tabs-stale-writes-are-refused', async ({ context, page, record }) => {
  const a = page;
  await a.goto(server.origin + '/_review/blank');
  await openApp(a, '#collections');
  await chooseFile(a, 'xavier.json', X_DOC); await confirmImport(a);
  const b = await context.newPage();
  await b.goto(server.base + '#collections'); await b.locator('.app-shell').waitFor(); await settle(b);
  // B renames; A (stale) tries rename, removal and an append.
  await b.getByRole('button', { name: 'Rename Xavier set', exact: true }).click();
  await b.getByLabel('New collection name').fill('Renamed in B');
  await b.getByRole('button', { name: 'Save name', exact: true }).click(); await settle(b);
  const afterB = await readDb(b);
  const outcomes = {};
  await a.getByRole('button', { name: 'Rename Xavier set', exact: true }).click();
  await a.getByLabel('New collection name').fill('Renamed in A');
  await a.getByRole('button', { name: 'Save name', exact: true }).click();
  await a.locator('.notice[role=alert]').filter({ hasText: /not saved|another session|changed/ }).waitFor(); outcomes.rename = await a.locator('.notice[role=alert]').innerText();
  await a.getByRole('button', { name: 'Cancel rename', exact: true }).click();
  await a.getByRole('button', { name: 'Remove Xavier set', exact: true }).click();
  await a.getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await a.locator('.notice[role=alert]').filter({ hasText: /not saved|another session|changed/ }).waitFor(); outcomes.remove = await a.locator('.notice[role=alert]').innerText();
  await a.getByRole('button', { name: 'Keep collection', exact: true }).click();
  const appended = JSON.parse(X_DOC); appended.entries.push({ id: eid(1, 7), kind: 'word', english: 'xeric', translation: 'посушливий' });
  await chooseFile(a, 'append.json', JSON.stringify(appended));
  await a.getByRole('button', { name: 'Confirm import', exact: true }).click();
  await a.locator('.notice[role=alert]').filter({ hasText: /not saved|another session|changed/ }).waitFor(); outcomes.append = await a.locator('.notice[role=alert]').innerText();
  await a.getByRole('button', { name: 'Cancel import', exact: true }).click();
  await chooseFile(a, 'noop.json', X_DOC);
  await a.getByRole('button', { name: 'Confirm import', exact: true }).click();
  await a.locator('.notice[role=alert]').filter({ hasText: /not saved|another session|changed/ }).waitFor(); outcomes.noOp = await a.locator('.notice[role=alert]').innerText();
  await a.getByRole('button', { name: 'Cancel import', exact: true }).click();
  await settle(a);
  assert.deepEqual(await readDb(a), afterB, 'stale tab changed nothing');
  record.staleTabUiStillShows = await a.locator('.collection-card h3').allInnerTexts();
  // New-collection race: both preview the same native file for a new collection.
  const z = nativeDoc(2, 'Zulu set', [{ id: eid(2, 1), kind: 'word', english: 'zephyr', translation: 'зефір' }]);
  await a.reload(); await a.locator('.app-shell').waitFor(); await settle(a);
  await chooseFile(a, 'zulu.json', z);
  await chooseFile(b, 'zulu.json', z); await confirmImport(b);
  const afterZ = await readDb(b);
  await a.getByRole('button', { name: 'Confirm import', exact: true }).click();
  await a.locator('.notice[role=alert]').filter({ hasText: /not saved|another session|changed/ }).waitFor(); outcomes.newCollectionRace = await a.locator('.notice[role=alert]').innerText();
  assert.deepEqual(await readDb(a), afterZ);
  // B deletes; A's stale no-op reimport of the deleted collection is refused too.
  await a.reload(); await a.locator('.app-shell').waitFor(); await settle(a);
  await b.getByRole('button', { name: 'Remove Renamed in B', exact: true }).click();
  await b.getByRole('button', { name: 'Confirm removal', exact: true }).click(); await settle(b);
  const afterDelete = await readDb(b);
  await chooseFile(a, 'noop.json', X_DOC);
  record.previewInStaleTabAfterRemoteDelete = await a.locator('.import-preview p').first().innerText();
  await a.getByRole('button', { name: 'Confirm import', exact: true }).click();
  await a.locator('.notice[role=alert]').filter({ hasText: /not saved|another session|changed/ }).waitFor(); outcomes.noOpAfterRemoteDelete = await a.locator('.notice[role=alert]').innerText();
  assert.deepEqual(await readDb(a), afterDelete);
  for (const text of Object.values(outcomes)) assert.match(text, /not saved|another session|changed/);
  record.outcomes = Object.fromEntries(Object.entries(outcomes).map(([k, v]) => [k, v.replace(/\s+/g, ' ').slice(0, 220)]));
  record.unhandled = [...(await fr(a)).unhandled, ...(await fr(b)).unhandled];
  assert.deepEqual(record.unhandled, []);
});

scenario('native-transaction-failures-and-retry', async ({ page, record }) => {
  await page.goto(server.origin + '/_review/blank');
  await seedV1(page, SEED);
  await openApp(page, '#collections');
  const base = await readDb(page);
  const heroBase = await hero(page);
  const inject = (fault) => page.evaluate((f) => { window.__fr.fault = f ? { ...f, seen: 0 } : null; }, fault);
  const cases = {};
  // Import: abort after the collection put and two entry puts succeeded.
  await chooseFile(page, 'xavier.json', X_DOC);
  await page.getByLabel('I reviewed these possible duplicates').check();
  for (const [name, fault] of [['abortAfterRequestsSucceed', { method: 'put', store: 'userEntries', kind: 'abort', after: 2 }], ['quotaOnEntryPut', { method: 'put', store: 'userEntries', kind: 'quota' }]]) {
    await inject(fault);
    await page.getByRole('button', { name: 'Confirm import', exact: true }).click();
    await page.locator('.notice[role=alert]').waitFor(); await settle(page);
    cases[name] = (await page.locator('.notice[role=alert]').innerText()).replace(/\s+/g, ' ');
    assert.deepEqual(await readDb(page), base, `${name}: nothing saved`);
    assert.deepEqual(await hero(page), heroBase, `${name}: catalog unchanged`);
    assert.equal(await page.locator('.import-preview').count(), 1, `${name}: preview kept for retry`);
  }
  await inject(null);
  await confirmImport(page);
  const imported = await readDb(page);
  assert.equal(Object.keys(imported.stores.userEntries).length, 6);
  // Rename failure and retry.
  await page.getByRole('button', { name: 'Rename Xavier set', exact: true }).click();
  await page.getByLabel('New collection name').fill('After failure');
  await inject({ method: 'put', store: 'userCollections', kind: 'abort', after: 0 });
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await page.locator('.notice[role=alert]').waitFor(); await settle(page);
  cases.renameAbort = (await page.locator('.notice[role=alert]').innerText()).replace(/\s+/g, ' ');
  assert.deepEqual(await readDb(page), imported);
  assert.deepEqual(await page.locator('.collection-card h3').allInnerTexts(), ['Xavier set']);
  await inject(null);
  await page.getByRole('button', { name: 'Save name', exact: true }).click(); await settle(page);
  assert.deepEqual(await page.locator('.collection-card h3').allInnerTexts(), ['After failure']);
  const renamed = await readDb(page);
  // Deletion failure after the first deletes succeeded, then retry.
  await page.getByRole('button', { name: 'Remove After failure', exact: true }).click();
  await inject({ method: 'delete', store: 'userEntries', kind: 'abort', after: 1 });
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await page.locator('.notice[role=alert]').waitFor(); await settle(page);
  cases.deleteAbortAfterRequestsSucceed = (await page.locator('.notice[role=alert]').innerText()).replace(/\s+/g, ' ');
  assert.deepEqual(await readDb(page), renamed);
  assert.equal(await page.locator('.collection-card').count(), 1);
  await inject({ method: 'delete', store: 'userEntries', kind: 'quota' });
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await page.locator('.notice[role=alert]').waitFor(); await settle(page);
  assert.deepEqual(await readDb(page), renamed);
  await inject(null);
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await page.locator('.notice').filter({ hasText: 'Collection removed' }).waitFor(); await settle(page);
  const deleted = await readDb(page);
  assert.deepEqual(userStores(deleted), { userCollections: {}, userEntries: {} });
  assert.deepEqual(stateStores(deleted), stateStores(base));
  await page.reload(); await page.locator('.app-shell').waitFor(); await settle(page);
  assert.equal(await page.locator('.collection-card').count(), 0);
  const f = await fr(page);
  record.cases = cases; record.faultHits = f.faultHits; record.unhandled = f.unhandled;
  assert.deepEqual(f.unhandled, []);
});

scenario('security-inert-text-and-local-only', async ({ page, record, requests }) => {
  await openApp(page, '#collections');
  const payload = '<img src=x onerror="window.__xss=(window.__xss||0)+1"><script>window.__xss=99</script><svg onload="window.__xss=7">';
  const short = '<img src=x onerror=window.__xss=3><b>';  // fits the 100-character name/topic limits
  const doc = nativeDoc(3, `Name ${short}`, [
    { id: eid(3, 1), kind: 'phrase', english: `Phrase ${payload}`, translation: `Переклад ${payload}`, topic: `Topic ${short}`, examples: [{ en: `Example ${payload}`, translation: `Приклад ${payload}` }] },
    { id: eid(3, 2), kind: 'word', english: `Word ${payload}`, translation: 'javascript:alert(1)', topic: '{{constructor.constructor("window.__xss=5")()}}', examples: [], sourcePhraseId: eid(3, 1) }
  ], `Description ${payload}`);
  const startRequests = requests.length;
  await chooseFile(page, `file ${payload.slice(0, 30)}.json`, doc);
  await page.getByRole('heading', { name: 'Review import' }).waitFor();
  await confirmImport(page);
  await page.getByRole('button', { name: /^Remove Name/ }).click();
  await page.getByRole('button', { name: /^Rename Name/ }).click();
  const exported = await download(page, `Name ${short}`);
  record.requestsDuringImportExport = requests.slice(startRequests);
  assert.deepEqual(record.requestsDuringImportExport, []);
  await wordsSearch(page, 'Word <img', '');
  await page.locator('.index-list button').first().click();
  await phrasesSearch(page, 'Phrase <img', '');
  await nav(page, 'Flashcards');
  await page.getByLabel('Collection', { exact: true }).selectOption(cid(3)); await settle(page);
  await page.locator('.flashcard').first().click().catch(() => {});
  await page.locator('.desktop-nav button').filter({ hasText: /^\s*Focus/ }).first().click(); await settle(page);
  const views = {};
  for (const [label, hash] of [['collections', '#collections'], ['flashcards', '#flashcards']]) {
    await page.goto(server.base + hash); await page.locator('.app-shell').waitFor(); await settle(page);
    views[label] = await page.evaluate(() => ({ injectedImg: document.querySelectorAll('img[src="x"]').length, injectedSvg: document.querySelectorAll('svg[onload]').length, injectedScripts: [...document.scripts].filter((s) => s.textContent.includes('__xss')).length, literalTextShown: document.body.innerText.includes('<img src=x') }));
  }
  record.views = views;
  record.xss = await page.evaluate(() => window.__xss ?? null);
  assert.equal(record.xss, null);
  for (const v of Object.values(views)) { assert.equal(v.injectedImg, 0); assert.equal(v.injectedSvg, 0); assert.equal(v.injectedScripts, 0); assert.ok(v.literalTextShown); }
  record.exportFileName = exported.name;
  assert.equal(JSON.parse(exported.text).collection.name, `Name ${short}`);
  // Prototype keys, malformed bytes and pathological files.
  const rejected = {};
  const tryFile = async (name, content) => {
    await chooseFile(page, name, content);
    const alert = page.locator('.collections-page [role=alert]');
    await alert.first().waitFor({ timeout: 20000 }).catch(() => {});
    return (await alert.allInnerTexts()).join(' | ').replace(/\s+/g, ' ').slice(0, 160);
  };
  await page.goto(server.base + '#collections'); await page.locator('.app-shell').waitFor(); await settle(page);
  const before = await readDb(page);
  rejected.protoEnvelope = await tryFile('proto.json', `{"format":"eng-trainer-vocabulary","version":1,"__proto__":{"polluted":1},"collection":{"id":"${cid(4)}","name":"p"},"entries":[{"id":"${eid(4, 1)}","kind":"word","english":"a","translation":"b"}]}`);
  rejected.protoEntry = await tryFile('proto2.json', `{"format":"eng-trainer-vocabulary","version":1,"collection":{"id":"${cid(4)}","name":"p"},"entries":[{"id":"${eid(4, 1)}","kind":"word","english":"a","translation":"b","__proto__":{"polluted":1}}]}`);
  await page.getByRole('button', { name: 'Cancel import', exact: true }).click().catch(() => {});
  rejected.invalidUtf8 = await tryFile('bytes.csv', Buffer.from([0x65, 0x6e, 0x67, 0x6c, 0x69, 0x73, 0x68, 0x2c, 0xff, 0xfe, 0x0a]));
  rejected.utf16 = await tryFile('utf16.csv', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('english,translation\nx,y', 'utf16le')]));
  rejected.oversize = await tryFile('big.csv', Buffer.alloc(2 * 1024 * 1024 + 1, 0x61));
  rejected.deepJson = await tryFile('deep.json', '['.repeat(1_000_000) + ']'.repeat(1_000_000));
  rejected.quotes = await tryFile('quotes.csv', 'english,translation\n' + '"'.repeat(2_000_001));
  rejected.manyRows = await tryFile('rows.csv', 'english,translation\n' + 'a,b\n'.repeat(400_000));
  record.rejected = rejected;
  record.prototypePolluted = await page.evaluate(() => ({}).polluted ?? null);
  assert.equal(record.prototypePolluted, null);
  assert.deepEqual(await readDb(page), before);
  for (const [k, v] of Object.entries(rejected)) assert.ok(v.length > 0, `${k} shows an error`);
  // Export file names.
  const names = {};
  for (const [i, name] of ['../../etc/passwd', 'CON', 'Мої слова', 'Слова 2026', '😀 emoji', 'a'.repeat(100)].entries()) {
    await chooseFile(page, `n${i}.json`, nativeDoc(10 + i, name, [{ id: eid(10 + i, 1), kind: 'word', english: `w${i}`, translation: 'т' }]));
    await confirmImport(page);
    names[name.slice(0, 20)] = (await download(page, name)).name;
  }
  record.exportFileNames = names;
  for (const n of Object.values(names)) assert.match(n, /^[A-Za-z0-9_-]+\.json$/);
  assert.deepEqual((await fr(page)).unhandled, []);
});

scenario('export-roundtrip-same-and-fresh-environment', async ({ browser, page, record }) => {
  await openApp(page, '#collections');
  await chooseFile(page, 'xavier.json', X_DOC); await confirmImport(page);
  const first = await download(page, 'Xavier set');
  const second = await download(page, 'Xavier set');
  assert.equal(first.text, second.text, 'deterministic export');
  const parsed = JSON.parse(first.text);
  assert.deepEqual(Object.keys(parsed), ['format', 'version', 'collection', 'entries']);
  assert.deepEqual([parsed.format, parsed.version], ['eng-trainer-vocabulary', 1]);
  assert.deepEqual(parsed.collection, { id: cid(1), name: 'Xavier set', description: 'Synthetic review collection' });
  assert.deepEqual(parsed.entries, X_ENTRIES.map((e) => ({ topic: '', examples: [], ...e })).map(({ id, kind, english, translation, topic, examples, sourcePhraseId }) => ({ id, kind, english, translation, topic, examples, ...(sourcePhraseId ? { sourcePhraseId } : {}) })));
  assert.ok(!/learned|hidden|favorite|revision|position|createdAt|lastImport/.test(first.text), 'vocabulary only');
  const before = await readDb(page);
  const writes = (await fr(page)).writes.length;
  await chooseFile(page, first.name, first.text);
  record.sameEnvironmentPreview = await page.locator('.import-preview p').first().innerText();
  await confirmImport(page);
  record.sameEnvironmentMessage = await statusText(page);
  assert.equal((await fr(page)).writes.length, writes, 'no-op import issues no put/delete');
  assert.deepEqual(await readDb(page), before);
  // Fresh environment.
  const other = await browser.newContext({ acceptDownloads: true, reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
  await other.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: FONT_STUB }));
  await other.addInitScript(instrument);
  const page2 = await other.newPage();
  await openApp(page2, '#collections');
  await chooseFile(page2, first.name, first.text); await confirmImport(page2);
  const fresh = await readDb(page2);
  const strip = (db) => Object.fromEntries(Object.entries(db.stores.userEntries));
  assert.deepEqual(strip(fresh), strip(before));
  const again = await download(page2, 'Xavier set');
  assert.equal(again.text, first.text, 'export from the fresh environment is byte-identical');
  await other.close();
  record.bytes = Buffer.byteLength(first.text); record.entries = parsed.entries.length; record.links = parsed.entries.filter((e) => e.sourcePhraseId).length;
});

scenario('ui-keyboard-and-responsive-layout', async ({ page, record }) => {
  await openApp(page, '#collections');
  const longName = 'L'.repeat(100);
  await chooseFile(page, 'long.json', nativeDoc(5, longName, [{ id: eid(5, 1), kind: 'word', english: 'W'.repeat(300), translation: 'Т'.repeat(400), topic: 'T'.repeat(100), examples: [{ en: 'E'.repeat(600) }] }]));
  await confirmImport(page);
  await chooseFile(page, 'Review words.csv', CSV);
  // Keyboard order through the preview.
  await page.getByLabel('Import vocabulary file').focus();
  const order = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => { const e = document.activeElement; return `${e.tagName.toLowerCase()}${e.type ? `[${e.type}]` : ''}:${(e.getAttribute('aria-label') || e.labels?.[0]?.innerText || e.innerText || '').trim().slice(0, 30)}`; }));
  }
  record.tabOrderFromFileInput = order;
  assert.ok(order.some((o) => o.startsWith('input[checkbox]')));
  assert.ok(order.some((o) => o.includes('Import entries')));
  // Keyboard-only acknowledgement and confirmation.
  await page.getByLabel('I reviewed these possible duplicates').focus();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Confirm import', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.locator('.notice[role=status]').waitFor(); await settle(page);
  record.keyboardImport = await statusText(page);
  // Focus after choosing a file while the file input itself has keyboard focus.
  const describe = () => page.evaluate(() => { const e = document.activeElement; return `${e?.tagName.toLowerCase()}${e?.type ? `[${e.type}]` : ''}`; });
  await page.getByLabel('Import vocabulary file').focus();
  record.focusBeforeChoosingFile = await describe();
  await chooseFile(page, 'bad.csv', 'english,translation\n"broken');
  await page.locator('.notice[role=alert]').waitFor();
  record.focusAfterError = await describe();
  await page.getByLabel('Import vocabulary file').focus();
  await chooseFile(page, 'Review words.csv', CSV);
  await page.getByRole('heading', { name: 'Review import' }).waitFor();
  record.focusAfterPreviewAppears = await describe();
  await page.keyboard.press('Tab');
  record.focusAfterOneTabFromThere = await page.evaluate(() => { const e = document.activeElement; return `${e.tagName.toLowerCase()}:${(e.getAttribute('aria-label') || e.labels?.[0]?.innerText || e.innerText || '').trim().slice(0, 30)}`; });
  await page.getByRole('button', { name: 'Cancel import', exact: true }).click();
  await page.getByRole('button', { name: `Rename ${longName}`, exact: true }).click();
  record.focusAfterRenameOpens = await page.evaluate(() => document.activeElement?.innerText?.slice(0, 40) ?? document.activeElement?.tagName);
  await page.getByRole('button', { name: 'Cancel rename', exact: true }).click();
  // Layout checks.
  const layout = {};
  await chooseFile(page, 'Review words.csv', CSV);
  for (const [w, h] of [[1440, 1000], [1000, 900], [390, 844], [320, 640]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(150);
    const m = await page.evaluate(() => {
      const nav = [...document.querySelectorAll(getComputedStyle(document.querySelector('.bottom-nav')).display !== 'none' ? '.bottom-nav button' : '.desktop-nav button')];
      const rects = nav.map((b) => b.getBoundingClientRect());
      const overflowing = [...document.querySelectorAll('.app-shell *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > innerWidth + 1; }).map((e) => e.className || e.tagName).slice(0, 5);
      const dn = document.querySelector('.desktop-nav');
      return { docOverflow: document.documentElement.scrollWidth - innerWidth, overflowing, navButtons: nav.length, navRows: new Set(rects.map((r) => Math.round(r.top))).size, minNavHeight: Math.min(...rects.map((r) => r.height)), navInside: rects.every((r) => r.left >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5), desktopNavClipped: dn && getComputedStyle(dn).display !== 'none' ? dn.scrollWidth > dn.clientWidth + 1 : null, collectionsInNav: nav.some((b) => /Collections/.test(b.innerText)) };
    });
    // Reachability of the last action above the fixed bottom navigation.
    const remove = page.getByRole('button', { name: `Remove ${longName}`, exact: true });
    await remove.evaluate((el) => el.scrollIntoView({ block: 'center' })); await page.waitForTimeout(100);
    m.lastActionClickable = await remove.evaluate((el) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit === el || el.contains(hit) ? true : `covered by ${hit?.tagName}.${hit?.className} (rect ${Math.round(r.top)}..${Math.round(r.bottom)} of ${innerHeight})`; });
    // Scroll twice: after a viewport change Firefox can still be settling layout on the first attempt.
    for (let attempt = 0; attempt < 2; attempt++) { await page.evaluate(() => document.documentElement.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })); await page.waitForTimeout(400); }
    m.pageEndAboveNav = await page.evaluate(() => { const nav = document.querySelector('.bottom-nav'); if (getComputedStyle(nav).display === 'none') return null; const last = [...document.querySelectorAll('.collection-card')].pop().getBoundingClientRect(); return last.bottom <= nav.getBoundingClientRect().top + 1; });
    m.bottomGeometry = await page.evaluate(() => { const nav = document.querySelector('.bottom-nav'); if (getComputedStyle(nav).display === 'none') return null; const n = nav.getBoundingClientRect(); const card = [...document.querySelectorAll('.collection-card')].pop().getBoundingClientRect(); const footer = document.querySelector('.app-footer')?.getBoundingClientRect(); return { innerHeight, scrollY: Math.round(scrollY), maxScroll: document.documentElement.scrollHeight - innerHeight, navTop: Math.round(n.top), navHeight: Math.round(n.height), lastCardBottom: Math.round(card.bottom), footerBottom: footer && Math.round(footer.bottom) }; });
    if (m.bottomGeometry) {
      // Reachability does not depend on the final scroll offset: centre the last card's last button.
      const lastButton = page.locator('.collection-card').last().getByRole('button').last();
      await lastButton.evaluate((el) => el.scrollIntoView({ block: 'center' })); await page.waitForTimeout(100);
      m.lastCardButtonClickable = await lastButton.evaluate((el) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit === el || el.contains(hit); });
    }
    layout[`${w}x${h}`] = m;
    if (w === 390) await page.screenshot({ path: join(out, `${record.engine}-collections-390.png`), fullPage: false });
  }
  record.layout = layout;
  for (const [size, m] of Object.entries(layout)) {
    assert.ok(m.docOverflow <= 0, `${size}: no horizontal document scroll`);
    assert.ok(m.navInside, `${size}: navigation inside the viewport`);
    assert.ok(m.collectionsInNav, `${size}: Collections reachable from navigation`);
    assert.equal(m.lastActionClickable, true, `${size}: actions reachable`);
    if (m.pageEndAboveNav !== null) assert.equal(m.pageEndAboveNav, true, `${size}: page end clears the fixed bottom navigation`);
  }
  // Every bottom-nav destination at 390 px.
  await page.setViewportSize({ width: 390, height: 844 });
  const visited = [];
  const count = await page.locator('.bottom-nav button').count();
  for (let i = 0; i < count; i++) {
    const button = page.locator('.bottom-nav button').nth(i);
    const name = (await button.innerText()).replace(/\s+/g, ' ').trim();
    await button.click();
    await page.waitForTimeout(100);
    visited.push(`${name} -> ${(await page.locator('.hero h1').innerText()).trim()}`);
  }
  assert.ok(visited.every((v) => { const [a, b] = v.split(' -> '); return a === b; }), 'each mobile destination opens');
  record.mobileNav = visited;
});

scenario('performance-1000-entry-collections', async ({ page, record, engine }) => {
  const sizes = {};
  await openApp(page, '#collections');
  const startupEmpty = await page.evaluate(() => window.__fr.shellAt);
  const cdp = engine === 'chromium' ? await page.context().newCDPSession(page) : null;
  const heap = async () => {
    if (!cdp) return null;
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    return +(metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1e6).toFixed(1);
  };
  if (cdp) await cdp.send('Performance.enable');
  const heapBefore = await heap();
  await page.evaluate(() => { window.__long = []; try { new PerformanceObserver((l) => window.__long.push(...l.getEntries().map((e) => Math.round(e.duration)))).observe({ type: 'longtask', buffered: false }); } catch {} });
  const timings = [];
  const make = (c, heavy) => nativeDoc(20 + c, `Perf ${c}`, Array.from({ length: 1000 }, (_, i) => ({
    id: eid(20 + c, i), kind: i % 4 ? 'word' : 'phrase', english: `perf ${c} term ${i} ${['alpha', 'beta', 'gamma'][i % 3]}`,
    translation: heavy ? `переклад ${i} `.padEnd(790, 'ж') : `переклад ${i} слова`, topic: `Perf topic ${i % 12}`,
    examples: [{ en: `Perf example sentence ${i} for collection ${c}.`, translation: `Приклад ${i}.` }]
  })));
  for (let c = 0; c < 5; c++) {
    const text = make(c, c === 0);
    sizes[`Perf ${c}`] = Buffer.byteLength(text);
    const t0 = Date.now();
    await chooseFile(page, `perf${c}.json`, text);
    await page.getByRole('heading', { name: 'Review import' }).waitFor({ timeout: 60000 });
    await page.locator('.import-preview tbody tr').nth(999).waitFor({ state: 'attached' });
    const t1 = Date.now();
    await page.getByRole('button', { name: 'Confirm import', exact: true }).click();
    await page.locator('.notice[role=status]').filter({ hasText: 'Imported 1000' }).waitFor({ timeout: 60000 });
    await settle(page);
    timings.push({ collection: c, bytes: sizes[`Perf ${c}`], previewMs: t1 - t0, saveMs: Date.now() - t1 });
  }
  record.imports = timings;
  record.longTasksDuringImports = await page.evaluate(() => window.__long);
  // Search on the combined catalog: 1,132 built-in + 5,000 user entries.
  await nav(page, 'Words');
  const search = async (q) => page.evaluate(async (query) => {
    const input = document.querySelector('input[placeholder="run into, lack, estimate…"]');
    const t = performance.now(); input.value = query; input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    return Math.round(performance.now() - t);
  }, q);
  record.searchMs = {};
  for (const q of ['perf 3 term 99', 'ж', 'gamma', 'переклад 5', 'zzz-none', '']) record.searchMs[q || '(empty)'] = await search(q);
  const t2 = Date.now();
  await nav(page, 'Flashcards');
  await page.locator('.flashcard__term').waitFor();
  record.flashcardsOpenMs = Date.now() - t2;
  record.flashcardsStats = (await cardInfo(page)).stats;
  const t3 = Date.now();
  await page.getByLabel('Collection', { exact: true }).selectOption(cid(23));
  await page.locator('.flashcards-progress__stats').filter({ hasText: /^\s*\d+ remaining/ }).waitFor();
  record.flashcardsFilterMs = Date.now() - t3;
  const heapAfterImports = await heap();
  // Startup with five saved 1,000-entry collections versus empty.
  await page.reload(); await page.locator('.app-shell').waitFor(); await settle(page);
  record.startupShellMs = { empty: Math.round(startupEmpty), fiveCollections: Math.round(await page.evaluate(() => window.__fr.shellAt)) };
  record.heroAtShell = (await fr(page)).heroAtShell.replace(/\s+/g, ' ').trim();
  record.jsHeapUsedMB = { emptyAfterStartup: heapBefore, afterFiveImportsAndFlashcards: heapAfterImports, afterReloadWithFiveCollections: await heap() };
  record.engine = engine;
  // A 1,000-entry file near the 2 MiB limit was accepted; one more entry would exceed the collection limit.
  const db = await readDb(page);
  record.savedEntries = Object.keys(db.stores.userEntries).length;
  assert.equal(record.savedEntries, 5000);
});

scenario('v1-isolation-after-v2-collections', async ({ page, record }) => {
  await page.goto(server.origin + '/_review/blank');
  await page.evaluate(() => localStorage.setItem('englishAssessmentTrainer.svelteState.v1', JSON.stringify({ learnedPhrases: ['phrase-002'], activePage: 'phrases' })));
  await openApp(page, '#collections');
  await chooseFile(page, 'xavier.json', X_DOC); await confirmImport(page);
  const v2 = await readDb(page);
  record.v2LocalStorageCalls = (await fr(page)).storage;
  assert.equal(record.v2LocalStorageCalls, 0);
  const from = server.log.length;
  await page.goto(server.base + 'v1/'); await page.locator('.phrase-card').first().waitFor(); await page.waitForTimeout(500);
  const paths = server.log.slice(from);
  record.v1Requests = paths;
  assert.ok(paths.every((p) => p.startsWith('/eng-trainer/v1/')));
  assert.deepEqual(paths.filter((p) => p.includes('/data/')), ['/eng-trainer/v1/data/materials.json']);
  assert.deepEqual((await fr(page)).opens, []);
  assert.deepEqual(await readDb(page), v2);
  record.v1State = await page.evaluate(() => JSON.parse(localStorage.getItem('englishAssessmentTrainer.svelteState.v1')).learnedPhrases);
});

// ------------------------------------------------------------------ runner
const engines = Object.fromEntries(Object.entries({ chromium, firefox }).filter(([name]) => !process.env.FABLE_ENGINES || process.env.FABLE_ENGINES.split(',').includes(name)));
const selected = only ? only.split(',') : null;
let failed = false;
try {
  for (const [engine, type] of Object.entries(engines)) {
    const browser = await type.launch({ headless: true });
    const results = [];
    try {
      for (const { name, run } of scenarios) {
        if (selected && !selected.some((s) => name.startsWith(s))) continue;
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, reducedMotion: 'reduce' });
        const requests = [];
        await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: FONT_STUB }));
        await context.route((url) => /^https?:/.test(url.protocol) && !url.href.startsWith(server.origin) && !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url.href), (r) => { requests.push(`BLOCKED ${r.request().url()}`); return r.abort(); });
        context.on('request', (r) => { if (r.url().startsWith(server.origin)) requests.push(new URL(r.url()).pathname); });
        await context.addInitScript(instrument);
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        const record = { engine, name, pageErrors: [], consoleErrors: [] };
        context.on('page', (p) => { p.on('pageerror', (e) => record.pageErrors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') record.consoleErrors.push(m.text().slice(0, 200)); }); });
        page.on('pageerror', (e) => record.pageErrors.push(e.message));
        page.on('console', (m) => { if (m.type() === 'error') record.consoleErrors.push(m.text().slice(0, 200)); });
        const started = Date.now();
        try {
          // Requests made by the scenario itself are tracked from here on.
          const reqView = new Proxy(requests, {});
          await run({ browser, context, page, record, engine, requests: reqView });
          assert.deepEqual(record.pageErrors, [], 'no uncaught page errors');
          record.status = 'PASS';
        } catch (error) {
          failed = true; record.status = 'FAIL'; record.error = String(error.stack ?? error).split('\n').filter((l) => !/^\s+at /.test(l) || /browser-review\.mjs/.test(l)).slice(0, 40).join(' | ').replaceAll(server.origin, '<local>').replaceAll(resolve('.'), '<cwd>');
          await page.screenshot({ path: join(out, `${engine}-${name}-failure.png`), fullPage: true }).catch(() => {});
        } finally {
          record.seconds = +((Date.now() - started) / 1000).toFixed(1);
          record.blockedExternal = requests.filter((r) => r.startsWith('BLOCKED'));
          results.push(record);
          console.log(`${engine}: ${record.status} ${name} (${record.seconds}s)${record.error ? ' :: ' + record.error : ''}`);
          server.use('candidate');
          await context.close();
        }
      }
      await writeFile(join(out, `browser-${engine}.json`), JSON.stringify({ engine, version: browser.version(), results }, null, 2) + '\n');
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
if (failed) process.exitCode = 1;
