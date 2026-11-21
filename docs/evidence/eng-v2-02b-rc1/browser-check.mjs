// Run after npm run build:site; only fresh synthetic browser contexts are used.
// node docs/evidence/eng-v2-02b-rc1/browser-check.mjs <playwright-tools> [output-dir]
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serveArtifact, instrumentBrowser, readDatabase, settle } from '../../reviews/eng-v2-01-rc1-astra/browser-support.mjs';

const root = process.cwd();
const out = resolve(process.argv[3] ?? 'docs/evidence/eng-v2-02b-rc1/browser');
const { chromium, firefox } = await import(pathToFileURL(join(resolve(process.argv[2]), 'node_modules/playwright/index.mjs')));
const artifact = join(root, 'site-dist');
const server = await serveArtifact(artifact);
const base = server.origin + '/eng-trainer/';
const manifest = JSON.parse(await readFile(join(artifact, 'data/manifest.json'), 'utf8'));
const packs = await Promise.all(manifest.packs.map(async (pack) => JSON.parse(await readFile(join(artifact, 'data', pack.url), 'utf8'))));
const phrases = packs.flatMap((pack) => pack.content.phrases ?? []);
const words = packs.flatMap((pack) => pack.content.wordIndex ?? []);
assert.equal(phrases.length, 566); assert.equal(words.length, 566);
const topic = phrases[0].category;
const [a, b, c] = phrases.filter((item) => item.category === topic);
const cid = (n) => `user:00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const eid = (collection, n) => `${cid(collection)}:entry:00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const entry = (collection, n, kind, english, translation) => ({ id: eid(collection, n), kind, english, translation, topic, examples: [] });
const x = { format: 'eng-trainer-vocabulary', version: 1, collection: { id: cid(1), name: 'RC1 collection X', description: 'Synthetic restoration fixture' }, entries: [
  entry(1, 1, 'word', 'RC1 bank', 'банк'), entry(1, 2, 'phrase', 'RC1 bank', 'берег'),
  entry(1, 3, 'phrase', 'RC1 learned phrase', 'вивчена фраза'), entry(1, 4, 'word', 'RC1 hidden word', 'приховане слово'),
  entry(1, 5, 'phrase', 'RC1 hidden phrase', 'прихована фраза')
] };
const y = { format: x.format, version: 1, collection: { id: cid(2), name: 'RC1 collection Y', description: '' }, entries: [
  entry(2, 1, 'word', 'RC1 unrelated word', 'інше слово'), entry(2, 2, 'phrase', 'RC1 unrelated phrase', 'інша фраза')
] };
const collectionKey = (id) => `collection:${JSON.stringify([id, 'all'])}`;
const xKey = collectionKey(cid(1)); const yKey = collectionKey(cid(2));
const titleById = new Map([...phrases.map((item) => [item.id, item.phrase]), ...x.entries.map((item) => [item.id, item.english]), ...y.entries.map((item) => [item.id, item.english])]);
await mkdir(out, { recursive: true });

async function fonts(page) { await page.evaluate(async () => { await new Promise(requestAnimationFrame); await document.fonts.ready; }); }
async function ready(page) { await page.goto(base, { waitUntil: 'networkidle' }); await page.locator('.app-shell').waitFor(); await fonts(page); await settle(page); }
async function reload(page) { await fonts(page); await page.reload({ waitUntil: 'networkidle' }); await page.locator('.app-shell').waitFor(); await fonts(page); await settle(page); }
async function nav(page, label) { await fonts(page); await page.locator('.desktop-nav').getByRole('button', { name: label, exact: true }).click(); await page.locator('.hero h1').filter({ hasText: label }).waitFor(); await fonts(page); await settle(page); }
async function importFile(page, document) {
  const text = typeof document === 'string' ? document : JSON.stringify(document);
  await page.getByLabel('Import vocabulary file').setInputFiles({ name: 'synthetic-native.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await page.waitForFunction(() => !document.querySelector('input[type=file]').disabled);
  const ack = page.getByLabel('I reviewed these possible duplicates');
  if (await ack.count()) await ack.check();
  await page.getByRole('button', { name: 'Confirm import', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /Imported|No changes needed/ }).waitFor(); await settle(page);
}
async function setup(page) { await ready(page); await nav(page, 'Collections'); await importFile(page, x); await importFile(page, y); }
async function backup(page, engine) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: `Export ${x.collection.name} as JSON`, exact: true }).click();
  const download = await event; const path = join(out, `${engine}-synthetic-export.json`);
  await download.saveAs(path);
  const text = await readFile(path, 'utf8'); assert.deepEqual(JSON.parse(text), x); return text;
}
async function removeX(page) {
  await nav(page, 'Collections');
  await page.getByRole('button', { name: `Remove ${x.collection.name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Collection removed.' }).waitFor(); await settle(page);
}
async function mode(page, key) {
  await page.getByRole('button', { name: key === 'all' ? 'All Vocabulary' : 'By Topic', exact: true }).click();
  if (key !== 'all') await page.getByLabel(/^Topic/).selectOption(topic);
  await settle(page);
}
async function answer(page, known = false) {
  await page.getByRole('button', { name: known ? /^I know it/ : 'Keep learning', exact: !known }).click();
  await settle(page);
}
const term = (page) => page.locator('.flashcard__term').innerText();
function otherUnchanged(actual, before) {
  assert.deepEqual(actual.userCollections[cid(2)], before.userCollections[cid(2)]);
  for (const item of y.entries) assert.deepEqual(actual.userEntries[item.id], before.userEntries[item.id]);
  assert.deepEqual(actual.flashcardSessions[yKey], before.flashcardSessions[yKey]);
}

// Seed a nontrivial saved order in the existing schema, then exercise all changes
// through the application. This interleaves X with built-ins instead of relying
// on a random shuffle to put removed entries in the middle of a shared deck.
async function savedOrders(page) {
  const order = (items) => [a.id, eid(1, 1), b.id, eid(1, 2), c.id,
    ...items.filter((item) => ![a.id, b.id, c.id].includes(item.id)).map((item) => item.id), eid(2, 1), eid(2, 2)];
  await page.evaluate(async (records) => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('eng-trainer-v2'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    assertVersion(db.version);
    function assertVersion(version) { if (version !== 2) throw new Error(`Unexpected schema ${version}`); }
    await new Promise((resolve, reject) => {
      const tx = db.transaction(Object.keys(records), 'readwrite');
      for (const [name, values] of Object.entries(records)) for (const [key, value] of Object.entries(values)) tx.objectStore(name).put(value, key);
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error);
    }); db.close();
  }, {
    progress: { learnedPhrases: [eid(1, 3)], hiddenWords: [eid(1, 4)], hiddenPhrases: [eid(1, 5)], favoriteWords: [eid(1, 1)], favoritePhrases: [eid(1, 2), eid(2, 2)] },
    flashcardSessions: {
      all: { order: order(phrases), index: 0 }, [`topic:${topic}`]: { order: order(phrases.filter((item) => item.category === topic)), index: 0 },
      [xKey]: { order: [eid(1, 2), eid(1, 1)], index: 1 }, [yKey]: { order: [eid(2, 2), eid(2, 1)], index: 1 }
    }, settings: { activePage: 'flashcards', collectionFilter: '', flashcardMode: 'all', flashcardTopic: topic }
  }); await reload(page); await nav(page, 'Flashcards');
}

const cases = [];
for (const key of ['all', `topic:${topic}`]) cases.push({ name: `F1-${key === 'all' ? 'all' : 'topic'}-delete-learn-reload-restore`, async run(page, record) {
  await setup(page); const exported = await backup(page, record.engine); await savedOrders(page);
  // Persist both decks via real answers; each cursor reaches built-in b.
  for (const deck of ['all', `topic:${topic}`]) { await mode(page, deck); assert.equal(await term(page), a.phrase); await answer(page); assert.equal(await term(page), 'RC1 bank'); await answer(page); assert.equal(await term(page), b.phrase); }
  await mode(page, key);
  const before = await readDatabase(page); record.before = before.flashcardSessions;
  await removeX(page);
  const removed = await readDatabase(page);
  assert.deepEqual(removed.progress, before.progress); assert.deepEqual(removed.flashcardSessions, before.flashcardSessions); otherUnchanged(removed, before);
  await nav(page, 'Flashcards');
  assert.equal(await page.getByLabel('Collection', { exact: true }).locator(`option[value="${cid(1)}"]`).count(), 0);
  assert.equal(await term(page), b.phrase); await answer(page); assert.equal(await term(page), c.phrase); await answer(page, true);
  const nextId = before.flashcardSessions[key].order[5];
  assert.equal(await term(page), titleById.get(nextId));
  const expected = { order: before.flashcardSessions[key].order.filter((id) => id !== c.id), index: 4 };
  const afterLearning = await readDatabase(page);
  assert.deepEqual(afterLearning.flashcardSessions, { ...before.flashcardSessions, [key]: expected });
  assert.deepEqual(afterLearning.progress, { ...before.progress, learnedPhrases: [eid(1, 3), c.id] });
  await reload(page); assert.equal(await term(page), titleById.get(nextId));
  assert.deepEqual((await readDatabase(page)).flashcardSessions, afterLearning.flashcardSessions);
  await nav(page, 'Collections'); await importFile(page, exported);
  const restored = await readDatabase(page);
  assert.deepEqual(restored.progress, afterLearning.progress); assert.deepEqual(restored.flashcardSessions, afterLearning.flashcardSessions);
  assert.deepEqual(restored.userEntries, before.userEntries); otherUnchanged(restored, before);
  // The native no-op reimport still writes no records.
  const writes = await page.evaluate(() => window.__review.writes.length); await importFile(page, exported);
  assert.equal(await page.evaluate(() => window.__review.writes.length), writes);
  await nav(page, 'Flashcards'); assert.equal(await term(page), titleById.get(nextId));
  assert.equal(expected.order[1], eid(1, 1)); assert.equal(expected.order[3], eid(1, 2));
  await reload(page); assert.equal(await term(page), titleById.get(nextId));
  record.afterLearning = afterLearning.flashcardSessions; record.restoredProgress = restored.progress;
  record.restoredCurrentId = nextId; record.independentSimilarTextIds = [eid(1, 1), eid(1, 2)];
  await page.screenshot({ path: join(out, `${record.engine}-${record.name}.png`), fullPage: true });
  await page.getByLabel('Collection', { exact: true }).selectOption(cid(1)); await mode(page, 'all');
  assert.equal(await term(page), 'RC1 bank');
  assert.match(await page.locator('.flashcards-progress__stats').innerText(), /Card 2 of 2/);
  assert.deepEqual((await readDatabase(page)).flashcardSessions[xKey], before.flashcardSessions[xKey]);
  // A new entry still appends; restored IDs retain their earlier slots.
  await nav(page, 'Collections'); const extra = entry(1, 6, 'word', 'RC1 genuinely new', 'нове слово');
  await importFile(page, { ...x, entries: [...x.entries, extra] });
  await nav(page, 'Flashcards'); await page.getByLabel('Collection', { exact: true }).selectOption(''); await mode(page, key); await answer(page);
  const appended = await readDatabase(page);
  assert.deepEqual(appended.flashcardSessions[key].order, [...expected.order, extra.id]); otherUnchanged(appended, before);
  record.newEntryAppended = extra.id; record.collectionDeckPreserved = true; record.otherCollectionUnchanged = true;
} });

async function search(page, kind, collection, text) {
  await nav(page, kind === 'word' ? 'Words' : 'Phrases');
  await page.getByLabel('Collection', { exact: true }).selectOption(collection);
  await page.getByPlaceholder(kind === 'word' ? 'run into, lack, estimate…' : 'AI, otherwise, meeting…').fill(text);
  if (kind === 'word') await page.locator('.index-list button').first().click();
  await settle(page);
}
async function hide(page, kind, collection, text) {
  await search(page, kind, collection, text);
  const card = page.locator(kind === 'word' ? '.word-card' : '.phrase-card').first();
  await card.getByRole('button', { name: 'Hide item', exact: true }).click(); await settle(page);
}
cases.push({ name: 'F2-mixed-hidden-unhide-delete-reimport', async run(page, record) {
  await setup(page); const exported = await backup(page, record.engine);
  for (const item of x.entries.filter((item) => item.id !== eid(1, 3))) await hide(page, item.kind, cid(1), item.english);
  for (const item of y.entries) await hide(page, item.kind, cid(2), item.english);
  await hide(page, 'phrase', 'built-in', a.phrase); await hide(page, 'word', 'built-in', words[0].term);
  const before = await readDatabase(page);
  await removeX(page); assert.deepEqual((await readDatabase(page)).progress, before.progress);
  // The bulk action retains its pre-existing global scope, including when a
  // collection/search filter is selected. Only catalog-known flags are removed.
  for (const [label, list, ids] of [['Words', 'hiddenWords', [eid(1, 1), eid(1, 4)]], ['Phrases', 'hiddenPhrases', [eid(1, 2), eid(1, 5)]]]) {
    await nav(page, label); await page.getByLabel('Collection', { exact: true }).selectOption(cid(2));
    await page.getByRole('button', { name: `Unhide all ${label.toLowerCase()}`, exact: true }).click(); await settle(page);
    assert.deepEqual((await readDatabase(page)).progress[list], ids);
    assert.equal(await page.getByRole('button', { name: `Unhide all ${label.toLowerCase()}`, exact: true }).count(), 0);
  }
  await reload(page);
  for (const label of ['Words', 'Phrases']) {
    await nav(page, label); await page.getByLabel('Collection', { exact: true }).selectOption('');
    assert.equal(await page.getByRole('button', { name: `Unhide all ${label.toLowerCase()}`, exact: true }).count(), 0);
  }
  const retained = await readDatabase(page); record.retainedWhileAbsent = retained.progress;
  await nav(page, 'Collections'); await importFile(page, exported);
  assert.deepEqual((await readDatabase(page)).progress, retained.progress);
  await reload(page); const restored = await readDatabase(page);
  assert.deepEqual(restored.progress, retained.progress); assert.deepEqual(restored.userEntries, before.userEntries); otherUnchanged(restored, before);
  for (const [label, query, count] of [['Words', 'run into, lack, estimate…', 2], ['Phrases', 'AI, otherwise, meeting…', 3]]) {
    await nav(page, label); await page.getByLabel('Collection', { exact: true }).selectOption(cid(1)); await page.getByPlaceholder(query).fill('');
    assert.equal(await page.locator(label === 'Words' ? '.index-list button' : '.phrase-card').count(), label === 'Words' ? 0 : 1);
    await page.getByRole('button', { name: `Show hidden ${label.toLowerCase()}`, exact: true }).click();
    assert.equal(await page.locator(label === 'Words' ? '.index-list button' : '.phrase-card').count(), count);
    await page.getByRole('button', { name: `Unhide all ${label.toLowerCase()}`, exact: true }).click(); await settle(page);
    assert.deepEqual((await readDatabase(page)).progress[label === 'Words' ? 'hiddenWords' : 'hiddenPhrases'], []);
  }
  record.restoredHiddenState = true; record.availableBuiltInAndImportedUnhidden = true; record.otherCollectionVocabularyUnchanged = true;
} });

let failed = false;
try {
  for (const [engine, type] of Object.entries({ chromium, firefox })) {
    const browser = await type.launch({ headless: true }); const results = [];
    try {
      for (const test of cases) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
        await context.addInitScript(instrumentBrowser);
        const page = await context.newPage(); page.setDefaultTimeout(15000);
        const record = { engine, name: test.name, pageErrors: [], consoleErrors: [], failedRequests: [], unhandledRejections: [] };
        await page.exposeFunction('__rc1Unhandled', (message) => record.unhandledRejections.push(message));
        await page.addInitScript(() => window.addEventListener('unhandledrejection', (event) => window.__rc1Unhandled(String(event.reason))));
        page.on('pageerror', (error) => record.pageErrors.push(error.message));
        page.on('console', (message) => { if (message.type() === 'error') record.consoleErrors.push(message.text()); });
        page.on('requestfailed', (request) => record.failedRequests.push({ url: request.url().replace(server.origin, '<local-origin>'), error: request.failure()?.errorText }));
        try {
          await test.run(page, record); await fonts(page); await page.waitForLoadState('networkidle');
          for (const key of ['pageErrors', 'consoleErrors', 'failedRequests', 'unhandledRejections']) assert.deepEqual(record[key], [], key);
          record.status = 'PASS';
        } catch (error) {
          failed = true; record.status = 'FAIL'; record.error = error.message.replaceAll(root, '<repo>').replaceAll(server.origin, '<local-origin>');
          console.error(error.stack);
          await page.screenshot({ path: join(out, `${engine}-${test.name}-failure.png`), fullPage: true }).catch(() => {});
        } finally { results.push(record); console.log(`${engine}: ${record.status} ${test.name}${record.error ? ': ' + record.error : ''}`); await context.close(); }
      }
      await writeFile(join(out, `browser-${engine}.json`), JSON.stringify({ engine, version: browser.version(), isolatedSyntheticStorage: true, results }, null, 2) + '\n');
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
if (failed) process.exitCode = 1;
