// Focused milestone checks, not a rerun or replacement of the full RC1 review.
// node docs/evidence/eng-v2-02a/browser-check.mjs <tools-directory> [evidence-directory]
// The tools directory must contain node_modules/playwright; set
// PLAYWRIGHT_BROWSERS_PATH if its browser binaries are installed separately.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readGeneratedContent, sha256 } from '../../../scripts/content-build.mjs';
import { serveArtifact, instrumentBrowser, seedDatabase, readDatabase, settle } from '../../reviews/eng-v2-01-rc1-astra/browser-support.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const evidence = process.argv[3] ? resolve(process.argv[3]) : here;
const tools = resolve(process.argv[2]);
const { chromium, firefox } = await import(pathToFileURL(join(tools, 'node_modules/playwright/index.mjs')));
const { manifest, packs, materials } = await readGeneratedContent(join(root, 'site-dist/data'));
const server = await serveArtifact(join(root, 'site-dist'));
const base = `${server.origin}/eng-trainer/`;
await mkdir(evidence, { recursive: true });

async function ready(page, url = base) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('.app-shell').waitFor();
}
async function nav(page, label) {
  await page.locator('.desktop-nav').getByRole('button', { name: label === 'Focus' ? /^Focus(?:\s+\d+)?$/ : label, exact: true }).click();
  await page.locator('.hero h1').filter({ hasText: label }).waitFor();
}
const phrase = (page, text) => page.locator('.phrase-card').filter({ has: page.getByRole('heading', { name: text, exact: true }) });
const tests = [];
const test = (name, run) => tests.push({ name, run });

test('all-built-packs-load-before-search-and-all-screens-render', async ({ page, context, record }) => {
  const requests = [];
  page.on('request', (request) => {
    if (request.url().startsWith(base)) requests.push(new URL(request.url()).pathname);
  });
  await ready(page);
  assert.equal(await page.locator('.hero').innerText().then((text) => text.replace(/\s+/g, ' ').includes('566 phrases')), true);
  const dataRequests = requests.filter((path) => path.includes('/data/'));
  assert.deepEqual([...dataRequests].sort(), [`/eng-trainer/data/manifest.json`, ...manifest.packs.map((pack) => `/eng-trainer/data/${pack.url}`)].sort());
  assert.equal(requests.some((path) => path.startsWith('/eng-trainer/v1/')), false);
  for (const file of ['manifest.json', ...manifest.packs.map((pack) => pack.url)]) {
    const response = await context.request.get(`${base}data/${file}`);
    assert.equal(response.status(), 200);
    assert.equal(sha256(await response.body()), sha256(await readFile(join(root, 'site-dist/data', file))));
  }
  await nav(page, 'Phrases');
  record.searches = [];
  for (const pack of packs.filter((pack) => pack.content.phrases)) {
    const item = pack.content.phrases.at(-1);
    await page.locator('.controls-filter-stack input').fill(item.phrase);
    await phrase(page, item.phrase).waitFor();
    record.searches.push({ pack: pack.id, kind: 'phrase', id: item.id });
  }
  await nav(page, 'Words');
  for (const pack of packs.filter((pack) => pack.content.wordIndex)) {
    const item = pack.content.wordIndex.at(-1);
    await page.getByPlaceholder('run into, lack, estimate…').fill(item.term);
    await page.locator('.index-list button').filter({ hasText: item.term }).first().waitFor();
    record.searches.push({ pack: pack.id, kind: 'word', id: item.id });
  }
  await nav(page, 'Verbs');
  for (const pack of packs.filter((pack) => pack.content.irregularVerbs)) {
    const item = pack.content.irregularVerbs.at(-1);
    await page.locator('select').first().selectOption(item.verbSet);
    await page.getByPlaceholder('be, took, been, говорити…').fill(item.base);
    await page.locator('.verb-card').filter({ hasText: item.base }).first().waitFor();
    record.searches.push({ pack: pack.id, kind: 'verb', id: item.id });
  }
  for (const label of ['Flashcards', 'Reverse', 'Patterns', 'Answers', 'Practice', 'Focus', 'Index']) await nav(page, label);
  record.dataRequests = dataRequests;
});

test('preexisting-indexeddb-focus-links-and-deck-identity-survive-reload', async ({ page, record }) => {
  const first = materials.phrases[0];
  const last = materials.phrases.at(-1);
  const second = materials.phrases[1];
  const seed = {
    progress: {
      learnedPhrases: ['phrase-084'], favoritePhrases: [first.id, last.id, 'advanced-linking-004-consequently'],
      favoriteWords: [materials.wordIndex.at(-1).id], favoriteIrregular: [materials.irregularVerbs.at(-1).id],
      favoriteBlocks: ['ai-certification-vocabulary'], hiddenPhrases: [second.id],
      hiddenWords: [materials.wordIndex[2].id], hiddenIrregular: [materials.irregularVerbs[0].id], selectedLearnPassId: 'default'
    },
    settings: { activePage: 'favorites', theme: 'dark' },
    learnPasses: { saved: { id: 'saved', name: 'Saved pass', description: '', blockIds: ['start-answer', 'ai-certification-vocabulary'], createdAt: '2026-11-20', updatedAt: '2026-11-20' } },
    flashcardSessions: { all: { order: [last.id, first.id], index: 0 } }
  };
  await page.goto(`${server.origin}/_review/blank`);
  await seedDatabase(page, seed);
  await ready(page);
  await phrase(page, first.phrase).waitFor();
  await phrase(page, last.phrase).waitFor();
  assert.equal(await phrase(page, 'Consequently, …').getAttribute('class').then((value) => value.split(' ').includes('learned')), false);
  await settle(page);
  assert.deepEqual(await readDatabase(page), seed);
  assert.equal(await page.evaluate(() => window.__review.writes.length), 0);
  await page.reload();
  await page.locator('.app-shell').waitFor();
  await settle(page);
  assert.deepEqual(await readDatabase(page), seed);
  await nav(page, 'Flashcards');
  assert.equal(Number(await page.getByRole('progressbar').getAttribute('aria-valuemax')), 564);
  assert.equal(Number(await page.getByRole('progressbar').getAttribute('aria-valuenow')), 1);
  assert.equal(await page.locator('.flashcard__term').innerText(), last.phrase);
  await page.getByRole('button', { name: /^I know it/ }).click();
  await page.locator('.flashcard__term').filter({ hasText: first.phrase }).waitFor();
  await settle(page);
  const after = await readDatabase(page);
  assert.deepEqual(after.progress.learnedPhrases, ['phrase-084', last.id]);
  assert.equal(after.progress.learnedPhrases.includes(materials.wordIndex.at(-1).id), false);
  assert.deepEqual(after.learnPasses, seed.learnPasses);
  await page.reload();
  await page.locator('.app-shell').waitFor();
  assert.equal(await page.locator('.flashcard__term').innerText(), first.phrase);
  await nav(page, 'Focus');
  assert.equal(await phrase(page, last.phrase).getAttribute('class').then((value) => value.split(' ').includes('learned')), true);
  assert.equal(await phrase(page, 'Consequently, …').getAttribute('class').then((value) => value.split(' ').includes('learned')), false);
  record.restoredWithoutWrites = true;
  record.afterAnswer = after;
});

test('missing-pack-keeps-populated-database-and-retry-recovers-complete-catalog', async ({ page, context, record }) => {
  const seed = {
    progress: { learnedPhrases: ['phrase-001'], favoritePhrases: [materials.phrases.at(-1).id] },
    settings: { activePage: 'favorites' }, learnPasses: {}, flashcardSessions: {}
  };
  await page.goto(`${server.origin}/_review/blank`);
  await seedDatabase(page, seed);
  const pattern = `**/eng-trainer/data/${manifest.packs[6].url}`;
  await context.route(pattern, (route) => route.fulfill({ status: 503, body: 'Injected unavailable pack' }));
  await page.goto(base);
  await page.locator('.error-card').waitFor();
  assert.equal(await page.locator('.app-shell').count(), 0);
  assert.deepEqual(await readDatabase(page), seed);
  assert.equal(await page.evaluate(() => window.__review.writes.length), 0);
  await context.unroute(pattern);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('.app-shell').waitFor();
  await phrase(page, materials.phrases.at(-1).phrase).waitFor();
  await settle(page);
  assert.deepEqual(await readDatabase(page), seed);
  record.databaseUnchanged = true;
  record.retryRecoveredLastPhrase = materials.phrases.at(-1).id;
});

test('v1-remains-independent-and-still-loads-its-own-monolith', async ({ page, context, record }) => {
  const dataRequests = [];
  page.on('request', (request) => {
    if (request.url().startsWith(server.origin) && request.url().includes('/data/')) dataRequests.push(new URL(request.url()).pathname);
  });
  await ready(page, `${base}v1/`);
  assert.deepEqual(dataRequests, ['/eng-trainer/v1/data/materials.json']);
  const response = await context.request.get(`${base}v1/data/materials.json`);
  assert.equal(response.status(), 200);
  assert.equal(sha256(await response.body()), sha256(await readFile(join(root, 'v1/public/data/materials.json'))));
  assert.deepEqual(await page.evaluate(() => window.__review.opens), []);
  record.dataRequests = dataRequests;
});

let failed = false;
try {
  for (const [engine, browserType] of Object.entries({ chromium, firefox })) {
    const browser = await browserType.launch({ headless: true });
    const results = [];
    try {
      for (const { name, run } of tests) {
        const context = await browser.newContext();
        await context.addInitScript(instrumentBrowser);
        const page = await context.newPage();
        page.setDefaultTimeout(12000);
        const pageErrors = [];
        const consoleErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
        const record = { name };
        try {
          await run({ page, context, record });
          assert.deepEqual(pageErrors, []);
          record.status = 'PASS';
        } catch (error) {
          failed = true;
          record.status = 'FAIL';
          record.error = error.message.replaceAll(root, '<repo>');
          await page.screenshot({ path: join(evidence, `${engine}-${name}.png`), fullPage: true });
        } finally {
          record.pageErrors = pageErrors;
          record.consoleErrors = consoleErrors;
          results.push(record);
          console.log(`${engine}: ${record.status} ${name}${record.error ? `: ${record.error}` : ''}`);
          await context.close();
        }
      }
      await writeFile(join(evidence, `browser-${engine}.json`), `${JSON.stringify({ engine, version: browser.version(), results }, null, 2)}\n`);
    } finally { await browser.close(); }
  }
  async function inventory(dir, prefix = '') {
    const files = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) files.push(...await inventory(join(dir, entry.name), `${relative}/`));
      else files.push({ path: relative, sha256: sha256(await readFile(join(dir, entry.name))) });
    }
    return files;
  }
  await writeFile(join(evidence, 'artifact.json'), `${JSON.stringify(await inventory(join(root, 'site-dist')), null, 2)}\n`);
} finally { await server.close(); }
if (failed) process.exitCode = 1;
