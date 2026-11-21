// ENG-V2-01-RC1: supplemental native-browser scenarios for finding F1.
//
// This script belongs to the corrective iteration, not to Astra's review. It
// reuses Astra's support module unchanged (static server without SPA fallback,
// native IndexedDB instrumentation, database reader) and runs against the
// assembled site in <candidate>/site-dist.
//
// Why it exists: Astra's scenario "distinct-entry-identities-with-similar-display-text"
// presses "I know it" once and then waits for "Deck complete". That screen only
// appeared while C++ and C# were wrongly one card. With two cards the deck is
// not complete after one answer, so the original scenario stops at that wait
// and never reaches its own assertion. The scenarios below use the same
// fixture and assert the same outcome, and then go further.
//
// Usage:
//   node docs/reviews/eng-v2-01-rc1-fable/identity-supplement.mjs <candidate-root> <tools-dir> <evidence-dir>
// Optional: REVIEW_ENGINE=chromium|firefox
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serveArtifact, instrumentBrowser, readDatabase, settle } from '../eng-v2-01-astra/browser-support.mjs';

const [candidateArg, toolsArg, evidenceArg] = process.argv.slice(2);
if (!candidateArg || !toolsArg || !evidenceArg) {
  console.error('Usage: identity-supplement.mjs <candidate-root> <tools-dir> <evidence-dir>');
  process.exit(2);
}

const candidate = resolve(candidateArg);
const evidence = resolve(evidenceArg);
mkdirSync(evidence, { recursive: true });

const { chromium, firefox } = await import(pathToFileURL(join(resolve(toolsArg), 'node_modules/playwright/index.mjs')));
const artifact = join(candidate, 'site-dist');
const materials = JSON.parse(readFileSync(join(artifact, 'data/materials.json'), 'utf8'));
const server = await serveArtifact(artifact);
const base = `${server.origin}/eng-trainer/`;

const pageNames = { phrases: 'Phrases', wordIndex: 'Words', flashcards: 'Flashcards' };

async function ready(page, url = base) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('.app-shell').waitFor();
}

async function reload(page) {
  await settle(page);
  await page.reload();
  await page.locator('.app-shell').waitFor();
}

async function nav(page, name) {
  const label = name === 'favorites' ? /^Focus(?:\s+\d+)?$/ : pageNames[name];
  await page.locator('.desktop-nav').getByRole('button', { name: label, exact: true }).click();
  await page.locator('.hero h1').waitFor();
}

const phrase = (page, text) =>
  page.locator('.phrase-card').filter({ has: page.getByRole('heading', { name: text, exact: true }) });

async function deck(page) {
  const bar = page.getByRole('progressbar');
  return { learned: await bar.getAttribute('aria-valuenow'), total: await bar.getAttribute('aria-valuemax') };
}

const learnedInDatabase = async (page) => (await readDatabase(page)).progress.learnedPhrases;

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

// Case B: Astra's synthetic fixture, two distinct entries with similar-looking text.
scenario('distinct-similar-entries-stay-independent', async ({ page, context, record }) => {
  const fixture = structuredClone(materials);
  fixture.phrases = [
    { id: 'review-cpp', category: 'Languages', phrase: 'C++', translation: 'Language C++', example: 'C++ templates' },
    { id: 'review-csharp', category: 'Languages', phrase: 'C#', translation: 'Language C#', example: 'C# records' }
  ];
  fixture.wordIndex = [];
  fixture.blocks = [{ id: 'review-languages', title: 'Languages', type: 'phraseCategory', category: 'Languages' }];
  await context.route('**/eng-trainer/data/materials.json', (route) => route.fulfill({ json: fixture }));

  await ready(page, `${base}#phrases`);
  assert.equal(await page.locator('.phrase-card').count(), 2);

  await nav(page, 'flashcards');
  record.firstCard = await page.locator('.flashcard__term').innerText();
  record.deckBefore = await deck(page);
  assert.equal(record.firstCard, 'C++');
  assert.deepEqual(record.deckBefore, { learned: '0', total: '2' }, 'C++ and C# must be two cards');

  // Learn C++ only. The deck must go on to C#, not complete.
  await page.getByRole('button', { name: /^I know it/ }).click();
  await page.locator('.flashcard__term').filter({ hasText: 'C#' }).waitFor();
  await settle(page);
  record.afterFirstAnswer = await learnedInDatabase(page);
  record.deckAfterFirstAnswer = await deck(page);
  assert.deepEqual(record.afterFirstAnswer, ['review-cpp'], 'Learning C++ must not mark distinct C# learned');
  assert.deepEqual(record.deckAfterFirstAnswer, { learned: '1', total: '2' });
  assert.equal(await page.getByRole('heading', { name: 'Deck complete', exact: true }).count(), 0);

  // After a reload the two entries still have their own state in every view.
  await reload(page);
  await nav(page, 'phrases');
  record.learnedCardsAfterReload = await page.locator('.phrase-card.learned h3').allTextContents();
  assert.deepEqual(record.learnedCardsAfterReload, ['C++']);
  assert.equal(await phrase(page, 'C#').getByRole('button', { name: 'Mark as learned', exact: true }).count(), 1);
  assert.equal(await phrase(page, 'C++').getByRole('button', { name: 'Mark as not learned', exact: true }).count(), 1);

  await nav(page, 'flashcards');
  assert.equal(await page.locator('.flashcard__term').innerText(), 'C#');
  assert.deepEqual(await deck(page), { learned: '1', total: '2' });
  await page.getByRole('button', { name: 'Review learned vocabulary', exact: true }).click();
  record.reviewedAfterReload = await page.locator('.flashcards-review__text strong').allTextContents();
  assert.deepEqual(record.reviewedAfterReload, ['C++']);
  await page.getByRole('button', { name: 'Back to flashcards', exact: true }).first().click();

  // The second entry is addressable on its own.
  await page.getByRole('button', { name: /^I know it/ }).click();
  await page.getByRole('heading', { name: 'Deck complete', exact: true }).waitFor();
  await settle(page);
  record.afterSecondAnswer = await learnedInDatabase(page);
  assert.deepEqual(record.afterSecondAnswer, ['review-cpp', 'review-csharp']);

  // Unlearning one on the Phrases page returns only that one to the deck.
  await nav(page, 'phrases');
  await phrase(page, 'C++').getByRole('button', { name: 'Mark as not learned', exact: true }).click();
  await reload(page);
  record.afterUnlearn = await learnedInDatabase(page);
  assert.deepEqual(record.afterUnlearn, ['review-csharp']);
  await nav(page, 'flashcards');
  assert.equal(await page.locator('.flashcard__term').innerText(), 'C++');
  assert.deepEqual(await deck(page), { learned: '1', total: '2' });
});

// Case A, beyond Astra's scenario: the shipped duplicate, counted in every deck.
scenario('built-in-duplicate-counts-agree-in-every-deck', async ({ page, record }) => {
  await ready(page, `${base}#phrases`);
  await page.getByLabel('Search', { exact: true }).fill('consequently');
  await phrase(page, 'consequently').getByRole('button', { name: 'Mark as learned', exact: true }).click();
  await phrase(page, 'Consequently, …').getByRole('button', { name: 'Add to Focus List', exact: true }).click();
  await reload(page);

  await nav(page, 'favorites');
  const focused = phrase(page, 'Consequently, …');
  assert.equal(await focused.getByRole('button', { name: 'Mark as learned', exact: true }).count(), 1);
  assert.equal(await focused.getByRole('button', { name: 'Mark as not learned', exact: true }).count(), 0);

  await nav(page, 'flashcards');
  await page.getByRole('button', { name: 'By Topic', exact: true }).click();
  const topic = page.getByRole('combobox', { name: /^Topic\b/ });
  await page.getByRole('button', { name: 'Review learned vocabulary', exact: true }).click();
  const reviewed = () => page.locator('.flashcards-review__text strong').allTextContents();

  await topic.selectOption('Advanced Linking Words');
  record.linking = { ...(await deck(page)), reviewed: await reviewed() };
  await topic.selectOption('Conjunctions');
  record.conjunctions = { ...(await deck(page)), reviewed: await reviewed() };
  await page.getByRole('button', { name: 'All Vocabulary', exact: true }).click();
  record.all = { ...(await deck(page)), reviewed: await reviewed() };
  record.database = (await readDatabase(page)).progress;

  assert.equal(record.linking.learned, '0');
  assert.deepEqual(record.linking.reviewed, []);
  assert.equal(record.conjunctions.learned, '1');
  assert.deepEqual(record.conjunctions.reviewed, ['consequently']);
  assert.deepEqual(record.all, { learned: '1', total: String(materials.phrases.length), reviewed: ['consequently'] });
  assert.deepEqual(record.database.learnedPhrases, ['phrase-084'], 'No unrelated id may be written to learned progress');
  assert.deepEqual(record.database.favoritePhrases, ['advanced-linking-004-consequently']);

  // Learning the Focus entry from its own card marks that id and nothing else.
  await page.getByRole('button', { name: 'Back to flashcards', exact: true }).first().click();
  await page.getByRole('button', { name: 'By Topic', exact: true }).click();
  await topic.selectOption('Advanced Linking Words');
  for (let i = 0; i < 40 && (await page.locator('.flashcard__term').innerText()) !== 'Consequently, …'; i += 1) {
    await page.getByRole('button', { name: /Keep learning$/ }).click();
  }
  assert.equal(await page.locator('.flashcard__term').innerText(), 'Consequently, …');
  await page.getByRole('button', { name: /^I know it/ }).click();
  await reload(page);
  record.afterLearningBoth = await learnedInDatabase(page);
  assert.deepEqual(record.afterLearningBoth, ['phrase-084', 'advanced-linking-004-consequently']);
  await nav(page, 'favorites');
  assert.equal(await phrase(page, 'Consequently, …').getByRole('button', { name: 'Mark as not learned', exact: true }).count(), 1);
});

// Case C: a phrase and its explicitly linked word-index entry are one identity.
scenario('phrase-and-linked-word-are-one-identity', async ({ page, record }) => {
  const first = materials.phrases[0];
  const linked = materials.wordIndex.find((item) => item.sourcePhraseId === first.id);
  assert.ok(linked, 'the first phrase has a linked word-index entry');
  record.phraseId = first.id;
  record.wordId = linked.id;

  await ready(page, `${base}#flashcards`);
  record.deckBefore = await deck(page);
  assert.deepEqual(record.deckBefore, { learned: '0', total: String(materials.phrases.length) });
  assert.equal(await page.locator('.flashcard__term').innerText(), first.phrase);

  await page.getByRole('button', { name: /^I know it/ }).click();
  await page.locator('.flashcard__term').filter({ hasText: materials.phrases[1].phrase }).waitFor();
  await reload(page);

  // One id is saved: the phrase id. The word-index id is not a second copy of the progress.
  record.database = await readDatabase(page);
  assert.deepEqual(record.database.progress.learnedPhrases, [first.id]);
  assert.equal(JSON.stringify(record.database).includes(linked.id), false);

  await nav(page, 'phrases');
  assert.equal(await phrase(page, first.phrase).getByRole('button', { name: 'Mark as not learned', exact: true }).count(), 1);

  // Unlearned on Phrases means back in the deck.
  await phrase(page, first.phrase).getByRole('button', { name: 'Mark as not learned', exact: true }).click();
  await nav(page, 'flashcards');
  assert.deepEqual(await deck(page), { learned: '0', total: String(materials.phrases.length) });

  // Hiding the linked word-index entry removes exactly this one card.
  await nav(page, 'wordIndex');
  await page.getByLabel('Search', { exact: true }).fill(linked.term);
  await page.locator('.index-list button').filter({ has: page.getByText(linked.term, { exact: true }) }).first().click();
  await page.locator('.word-card').getByRole('button', { name: 'Hide item', exact: true }).click();
  await reload(page);
  await nav(page, 'flashcards');
  record.deckAfterHidingWord = await deck(page);
  assert.deepEqual(record.deckAfterHidingWord, { learned: '0', total: String(materials.phrases.length - 1) });
  assert.notEqual(await page.locator('.flashcard__term').innerText(), first.phrase);
});

const isExternalFontMessage = (message) =>
  message.includes('downloadable font: download failed') && message.includes('https://fonts.gstatic.com/');

let failed = false;
try {
  for (const [engine, browserType] of Object.entries({ chromium, firefox })) {
    if (process.env.REVIEW_ENGINE && engine !== process.env.REVIEW_ENGINE) continue;

    const browser = await browserType.launch({ headless: true });
    const version = browser.version();
    console.log(`${engine} ${version}`);
    const results = [];

    for (const { name, fn } of scenarios) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
      await context.addInitScript(instrumentBrowser, {});
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.setDefaultNavigationTimeout(20000);

      const record = { name, status: 'PASS', errors: [], consoleErrors: [] };
      page.on('pageerror', (error) => record.errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') record.consoleErrors.push(message.text());
      });

      const start = Date.now();
      try {
        await fn({ page, context, record, engine });
        assert.deepEqual(record.errors, [], 'Unhandled application error');
        // Firefox logs an error when a page reload interrupts the download of
        // the icon font from fonts.gstatic.com. That is an external resource
        // and not application behavior, so it is recorded but does not fail the
        // scenario. Every other console error does.
        record.externalFontMessages = record.consoleErrors.filter(isExternalFontMessage).length;
        assert.deepEqual(record.consoleErrors.filter((message) => !isExternalFontMessage(message)), [], 'Console error');
      } catch (error) {
        record.status = 'FAIL';
        record.failure = String(error.stack || error);
        try {
          await page.screenshot({ path: join(evidence, `supplement-${engine}-${name}.png`), timeout: 5000 });
        } catch {
          // A screenshot is helpful, not required.
        }
      }
      record.elapsedMs = Date.now() - start;
      if (record.status === 'FAIL') failed = true;
      results.push(record);
      console.log(`${record.status} ${engine} ${name}${record.failure ? `\n${record.failure.split('\n').slice(0, 7).join('\n')}` : ''}`);
      await context.close();
    }

    writeFileSync(
      join(evidence, `identity-supplement-${engine}.json`),
      JSON.stringify({ date: new Date().toISOString(), engine, version, origin: server.origin, candidate, results }, null, 2)
    );
    await browser.close();
  }
} finally {
  await server.close();
}

if (failed) process.exitCode = 1;
