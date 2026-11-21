// Run from the repository root after npm run build:site.
// node docs/evidence/eng-v2-02b/browser-check.mjs <playwright-tools> [output-dir]
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serveArtifact, instrumentBrowser, seedDatabase, readDatabase, settle } from '../../reviews/eng-v2-01-rc1-astra/browser-support.mjs';
const root = process.cwd();
const out = resolve(process.argv[3] ?? 'docs/evidence/eng-v2-02b/browser');
const { chromium, firefox } = await import(pathToFileURL(join(resolve(process.argv[2]), 'node_modules/playwright/index.mjs')));
const server = await serveArtifact(join(root, 'site-dist'));
const base = server.origin + '/eng-trainer/';
await mkdir(out, { recursive: true });
const oldSeed = { progress: { learnedPhrases: ['phrase-005'], favoritePhrases: ['phrase-001'], hiddenPhrases: ['phrase-002'], unknownFutureRecord: { preserved: true } }, settings: { activePage: 'collections', theme: 'dark' }, learnPasses: { saved: { id: 'saved', name: 'Synthetic pass', blockIds: ['start-answer'], createdAt: '2026-11-21', updatedAt: '2026-11-21' } }, flashcardSessions: { all: { order: ['phrase-005', 'phrase-001'], index: 1 } } };
const csv = 'english,translation,topic,example,kind\nlocal bank,банк,Local words,I visit the local bank.,word\nlocal bank,берег,Local words,A local bank of a river.,word\nA local phrase,Місцева фраза,Local phrases,Here is a local phrase.,phrase\n<img src=x onerror=alert(1)>,Literal safe text,Local words,,word';
async function fonts(page) { await page.evaluate(async () => { await new Promise(requestAnimationFrame); await document.fonts.ready; }); }
async function ready(page, url = base) { await fonts(page); await page.goto(url, { waitUntil: 'networkidle' }); await page.locator('.app-shell').waitFor(); await fonts(page); await settle(page); }
async function reload(page) { await fonts(page); await page.reload({ waitUntil: 'networkidle' }); await page.locator('.app-shell').waitFor(); await fonts(page); await settle(page); }
async function nav(page, label) { await fonts(page); await page.locator('.desktop-nav').getByRole('button', { name: label === 'Focus' ? /^Focus(?:\s+\d+)?$/ : label, exact: true }).click(); await page.locator('.hero h1').filter({ hasText: label }).waitFor(); await fonts(page); await settle(page); }
async function file(page, content, name = 'synthetic.csv') {
  await page.getByLabel('Import vocabulary file').setInputFiles({ name, mimeType: name.endsWith('.json') ? 'application/json' : 'text/csv', buffer: Buffer.from(content) });
  await page.waitForFunction(() => !document.querySelector('input[type=file]').disabled);
}
async function confirm(page) {
  const ack = page.getByLabel('I reviewed these possible duplicates');
  if (await ack.count()) await ack.check();
  await page.getByRole('button', { name: 'Confirm import', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /Imported|No changes needed/ }).waitFor();
  await settle(page);
}
const userRecords = (data) => ({ userCollections: data.userCollections, userEntries: data.userEntries });
const phrase = (page, title) => page.locator('.phrase-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
const cases = [];
const test = (name, run) => cases.push({ name, run });

test('migration-import-search-progress-export-delete-reimport', async ({ page, context, record }) => {
  await page.goto(server.origin + '/_review/blank'); await seedDatabase(page, oldSeed);
  await ready(page);
  assert.deepEqual(await readDatabase(page), { ...oldSeed, userCollections: {}, userEntries: {} });
  assert.equal(await page.evaluate(() => window.__review.writes.length), 0);
  await file(page, csv);
  await page.getByRole('heading', { name: 'Review import' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Confirm import', exact: true }).isDisabled(), true);
  assert.deepEqual(userRecords(await readDatabase(page)), { userCollections: {}, userEntries: {} });
  assert.equal(await page.locator('.import-preview img').count(), 0);
  await page.getByLabel('Collection name', { exact: true }).fill('Browser collection');
  await confirm(page);
  const saved = await readDatabase(page);
  assert.equal(Object.keys(saved.userCollections).length, 1); assert.equal(Object.keys(saved.userEntries).length, 4);
  for (const name of ['progress', 'learnPasses', 'flashcardSessions']) assert.deepEqual(saved[name], oldSeed[name]);
  const collectionId = Object.keys(saved.userCollections)[0];
  const entries = Object.values(saved.userEntries).sort((a, b) => a.position - b.position);
  assert.ok(entries.every((item) => item.id.startsWith(collectionId + ':entry:')));
  record.collectionId = collectionId; record.entryIds = entries.map((item) => item.id);
  await nav(page, 'Words');
  await page.getByLabel('Collection', { exact: true }).selectOption(collectionId);
  await page.getByPlaceholder('run into, lack, estimate…').fill('LOCAL BANK');
  assert.equal(await page.locator('.index-list button').count(), 2);
  await page.locator('.index-list button').first().click();
  await page.getByRole('button', { name: 'Add to Focus List', exact: true }).click();
  await page.locator('.index-list button').nth(1).click();
  await page.getByRole('button', { name: 'Hide item', exact: true }).click();
  assert.equal(await page.locator('.index-list button').count(), 1);
  await nav(page, 'Phrases');
  await page.getByPlaceholder('AI, otherwise, meeting…').fill('LOCAL PHRASE');
  await phrase(page, 'A local phrase').getByRole('button', { name: 'Add to Focus List', exact: true }).click();
  await nav(page, 'Flashcards');
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuemax'), '3');
  assert.equal(await page.locator('.flashcard__term').innerText(), 'A local phrase');
  await page.getByRole('button', { name: /^I know it/ }).click();
  await page.locator('.flashcard__term').filter({ hasText: 'local bank' }).waitFor(); await settle(page);
  const afterAnswer = await readDatabase(page);
  assert.deepEqual(afterAnswer.progress.learnedPhrases, ['phrase-005', entries[2].id]);
  assert.deepEqual(afterAnswer.progress.hiddenWords, [entries[1].id]);
  await reload(page);
  assert.equal(await page.locator('.flashcard__term').innerText(), 'local bank');
  assert.deepEqual((await readDatabase(page)).flashcardSessions, afterAnswer.flashcardSessions);
  await nav(page, 'Focus');
  assert.ok((await phrase(page, 'A local phrase').getAttribute('class')).split(' ').includes('learned'));
  await nav(page, 'Collections');
  await page.getByRole('button', { name: 'Rename Browser collection', exact: true }).click();
  await page.getByLabel('New collection name').fill('Renamed collection');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Collection renamed.' }).waitFor();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Renamed collection as JSON', exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = join(out, record.engine + '-synthetic-export.json');
  await download.saveAs(downloadPath);
  const exported = await readFile(downloadPath, 'utf8');
  const native = JSON.parse(exported);
  assert.equal(native.collection.id, collectionId); assert.equal(native.entries.length, 4);
  const beforeRepeat = userRecords(await readDatabase(page));
  await file(page, exported, 'native.json'); await confirm(page);
  assert.deepEqual(userRecords(await readDatabase(page)), beforeRepeat);
  await page.getByRole('button', { name: 'Remove Renamed collection', exact: true }).click();
  await page.getByRole('button', { name: 'Keep collection', exact: true }).click();
  assert.equal(Object.keys((await readDatabase(page)).userEntries).length, 4);
  await page.getByRole('button', { name: 'Remove Renamed collection', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Collection removed.' }).waitFor();
  const removed = await readDatabase(page);
  assert.deepEqual(userRecords(removed), { userCollections: {}, userEntries: {} });
  assert.deepEqual(removed.progress, afterAnswer.progress);
  assert.deepEqual(removed.flashcardSessions, afterAnswer.flashcardSessions);
  await reload(page);
  await file(page, exported, 'native.json'); await confirm(page);
  assert.deepEqual((await readDatabase(page)).progress, removed.progress);
  await nav(page, 'Flashcards');
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '1');
  assert.equal(await page.locator('.flashcard__term').innerText(), 'local bank');
  await nav(page, 'Collections');
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: join(out, `${record.engine}-collections.png`), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator('.bottom-nav').getByRole('button', { name: 'Collections', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: join(out, `${record.engine}-mobile.png`), fullPage: true });
  record.migratedFromVersion = 1; record.databaseVersion = 2; record.noStartupWrites = true;
  record.searchAndFilters = true; record.duplicateIdentities = true; record.safeText = true;
  record.progressAndSavedDeckRestored = true; record.nativeReimportNoOp = true; record.deleteAndRestorePolicy = true;
});

test('invalid-files-and-native-id-conflicts-do-not-write', async ({ page, record }) => {
  await ready(page, base + '#collections');
  const before = userRecords(await readDatabase(page));
  const failures = [
    ['bad.csv', 'english,translation\n"broken,x', /Malformed CSV/],
    ['partial.csv', 'english,translation\nvalid,так\nmissing,', /Translation is required/],
    ['bad.json', '{', /Invalid JSON/],
    ['big.csv', 'x'.repeat(2 * 1024 * 1024 + 1), /2 MiB/]
  ];
  for (const [name, content, expected] of failures) {
    await file(page, content, name);
    await page.getByRole('alert').filter({ hasText: expected }).waitFor();
    const accept = page.getByRole('button', { name: 'Confirm import', exact: true });
    if (await accept.count()) assert.equal(await accept.isDisabled(), true);
    assert.deepEqual(userRecords(await readDatabase(page)), before);
  }
  await file(page, 'english,translation\nOriginal,Оригінал', 'original.csv'); await confirm(page);
  const saved = await readDatabase(page);
  const collection = Object.values(saved.userCollections)[0];
  const entry = Object.values(saved.userEntries)[0];
  const { collectionId, position, ...nativeEntry } = entry;
  const value = { format: 'eng-trainer-vocabulary', version: 1, collection: { id: collection.id, name: collection.name, description: collection.description }, entries: [{ ...nativeEntry, translation: 'Conflict' }] };
  await file(page, JSON.stringify(value), 'conflict.json');
  await page.getByRole('alert').filter({ hasText: 'ID conflict' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Confirm import', exact: true }).isDisabled(), true);
  assert.deepEqual(userRecords(await readDatabase(page)), userRecords(saved));
  record.invalidFiles = failures.map(([file]) => file); record.idConflictBlocked = true; record.noPartialImport = true;
});

test('transaction-abort-and-quota-failure-are-visible-and-retryable', async ({ page, record }) => {
  await page.goto(server.origin + '/_review/blank'); await seedDatabase(page, oldSeed); await ready(page);
  await file(page, 'english,translation\nFailure probe,Перевірка', 'failure.csv');
  const before = await readDatabase(page);
  await page.evaluate(() => { window.__review.failWrite = true; });
  await page.getByRole('button', { name: 'Confirm import', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Collection change was not saved' }).waitFor();
  assert.deepEqual(await readDatabase(page), before);
  assert.equal(await page.locator('.collection-card').count(), 0);
  await page.evaluate(() => { window.__review.failWrite = false; window.__releasePut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { if (this.name === 'userEntries') throw new DOMException('Synthetic quota exceeded', 'QuotaExceededError'); return window.__releasePut.apply(this, args); }; });
  await page.getByRole('button', { name: 'Confirm import', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Synthetic quota exceeded' }).waitFor();
  assert.deepEqual(await readDatabase(page), before);
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.__releasePut; });
  await confirm(page);
  assert.equal(Object.keys((await readDatabase(page)).userEntries).length, 1);
  record.abortRolledBack = true; record.quotaRolledBack = true; record.retrySucceeded = true;
});

test('blocked-upgrade-recovers-with-old-records-preserved', async ({ page, context, record }) => {
  const oldTab = await context.newPage(); await oldTab.goto(server.origin + '/_review/blank'); await seedDatabase(oldTab, oldSeed);
  await oldTab.evaluate(async () => { window.__held = await new Promise((resolve, reject) => { const request = indexedDB.open('eng-trainer-v2', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('alert').filter({ hasText: 'Close other eng-trainer tabs' }).waitFor();
  await oldTab.evaluate(() => window.__held.close()); await oldTab.close();
  await fonts(page);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('.app-shell').waitFor(); await settle(page);
  assert.deepEqual(await readDatabase(page), { ...oldSeed, userCollections: {}, userEntries: {} });
  record.blockedUpgradeReported = true; record.retryPreservedEveryRecord = true;
});

test('v1-remains-independent-after-v2-import', async ({ page, record }) => {
  await page.goto(server.origin + '/_review/blank');
  const legacy = { learnedPhrases: ['phrase-002'], activePage: 'phrases', phrasePageSize: 'all' };
  await page.evaluate((value) => window.__review.seedLegacy({ 'englishAssessmentTrainer.svelteState.v1': JSON.stringify(value) }), legacy);
  await ready(page, base + '#collections'); await file(page, 'english,translation\nOnly v2,Лише v2', 'v2.csv'); await confirm(page);
  const v2 = await readDatabase(page);
  const requests = []; const listen = (r) => { if (r.url().startsWith(server.origin)) requests.push(new URL(r.url()).pathname); };
  page.on('request', listen); await ready(page, base + 'v1/'); page.off('request', listen);
  assert.deepEqual(requests.filter((p) => p.includes('/data/')), ['/eng-trainer/v1/data/materials.json']);
  assert.ok(requests.every((p) => p.startsWith('/eng-trainer/v1/')));
  assert.deepEqual(await page.evaluate(() => window.__review.opens), []);
  assert.deepEqual(await readDatabase(page), v2);
  assert.equal(await page.locator('.phrase-card.learned').count(), 1);
  await page.getByPlaceholder('AI, otherwise, meeting…').fill('I would start by saying');
  await page.locator('.phrase-card').first().getByRole('button', { name: 'Mark as learned', exact: true }).click();
  await reload(page);
  assert.ok((await page.evaluate(() => JSON.parse(localStorage.getItem('englishAssessmentTrainer.svelteState.v1')).learnedPhrases)).includes('phrase-001'));
  assert.deepEqual(await readDatabase(page), v2);
  record.requests = requests; record.v1LocalStoragePreserved = true; record.v2Untouched = true;
});

let failed = false;
try {
  for (const [engine, type] of Object.entries({ chromium, firefox })) {
    const browser = await type.launch({ headless: true }); const results = [];
    try {
      for (const { name, run } of cases) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
        await context.addInitScript(instrumentBrowser);
        const page = await context.newPage(); page.setDefaultTimeout(15000);
        const record = { engine, name, pageErrors: [], consoleErrors: [], failedRequests: [] };
        page.on('pageerror', (error) => record.pageErrors.push(error.message));
        page.on('console', (message) => { if (message.type() === 'error') record.consoleErrors.push(message.text()); });
        page.on('requestfailed', (request) => record.failedRequests.push({ url: request.url().replace(server.origin, '<local-origin>'), error: request.failure()?.errorText }));
        try {
          await run({ page, context, record }); await fonts(page); await page.waitForLoadState('networkidle');
          assert.deepEqual(record.pageErrors, []); assert.deepEqual(record.consoleErrors, []); assert.deepEqual(record.failedRequests, []);
          record.status = 'PASS';
        } catch (error) {
          failed = true; record.status = 'FAIL'; record.error = error.message.replaceAll(root, '<repo>').replaceAll(server.origin, '<local-origin>');
          await page.screenshot({ path: join(out, `${engine}-${name}-failure.png`), fullPage: true }).catch(() => {});
        } finally { results.push(record); console.log(`${engine}: ${record.status} ${name}${record.error ? ': ' + record.error : ''}`); await context.close(); }
      }
      await writeFile(join(out, `browser-${engine}.json`), JSON.stringify({ engine, version: browser.version(), isolatedSyntheticStorage: true, results }, null, 2) + '\n');
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
if (failed) process.exitCode = 1;
