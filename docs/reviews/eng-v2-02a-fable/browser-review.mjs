// ENG-V2-02A Fable review — native-browser review of the assembled production artifacts.
//
//   node browser-review.mjs <tools-dir> <candidate-site-dist> <baseline-site-dist> <evidence-dir>
//
// <tools-dir> must contain node_modules/playwright; set PLAYWRIGHT_BROWSERS_PATH
// when its browsers are installed elsewhere. Every scenario uses a fresh,
// isolated browser context with synthetic IndexedDB/localStorage data — never a
// user profile. The external Google Fonts stylesheet is stubbed (icon-sized glyph boxes) in
// every scenario so results do not depend on third-party network access.
//
// Scenarios:
//   requests       candidate: manifest + 11 packs under /eng-trainer/, bytes equal the artifact
//   differential   baseline vs candidate: identical seeded database -> identical UI and database
//                  across Focus, Index (Learn Pass), Phrases/Words/Verbs with filters and searches,
//                  Flashcards (saved deck position, answer, reload); plus an independent oracle
//   failures       candidate: 12 controlled manifest/pack failures, each followed by a
//                  still-failing retry and a successful retry; database never written
//   no-partial     candidate: last pack delayed; no app shell before every pack arrives
//   v1             v1 loads only its monolith, uses localStorage, never opens eng-trainer-v2
//   performance    Chromium only: cold-load timing, baseline vs candidate, gzip, three network profiles,
//                  over HTTP/1.1 and (with REVIEW_TLS_DIR) HTTP/2 like GitHub Pages
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createSecureServer } from 'node:http2';
import { gzipSync } from 'node:zlib';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { instrumentBrowser, seedDatabase, readDatabase, settle } from '../eng-v2-01-rc1-astra/browser-support.mjs';

const [toolsArg, candidateArg, baselineArg, evidenceArg] = process.argv.slice(2);
const only = (process.env.REVIEW_ONLY ?? '').split(',').filter(Boolean);
const engines = (process.env.REVIEW_ENGINES ?? 'chromium,firefox').split(',');
const tools = resolve(toolsArg);
const candidateSite = resolve(candidateArg);
const baselineSite = resolve(baselineArg);
const evidence = resolve(evidenceArg);
await mkdir(evidence, { recursive: true });
const playwright = await import(pathToFileURL(join(tools, 'node_modules/playwright/index.mjs')));

const sha = (value) => createHash('sha256').update(value).digest('hex');
const norm = (text) => text.replace(/\s+/g, ' ').trim();
// Stands in for the external icon font: keeps each ligature glyph at icon size so layout matches production.
const FONT_STUB = '.material-symbols-rounded{display:inline-block;width:1em;height:1em;overflow:hidden;line-height:1;white-space:nowrap}';
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

// ------------------------------------------------------------------ artifact data
const manifest = await readJson(join(candidateSite, 'data/manifest.json'));
const packTexts = await Promise.all(manifest.packs.map((entry) => readFile(join(candidateSite, 'data', entry.url), 'utf8')));
const packs = packTexts.map((text) => JSON.parse(text));
const released = await readJson(join(baselineSite, 'data/materials.json'));
const P = released.phrases;
const W = released.wordIndex;
const V = released.irregularVerbs;
const B = released.blocks;

// ------------------------------------------------------------------ static server
// h2: HTTP/2 over TLS (GitHub Pages serves HTTP/2). Needs REVIEW_TLS_DIR with a
// throwaway self-signed key.pem/cert.pem; contexts then use ignoreHTTPSErrors.
const tlsDir = process.env.REVIEW_TLS_DIR ? resolve(process.env.REVIEW_TLS_DIR) : null;
async function serve(siteDir, { gzip = false, h2 = false } = {}) {
  const root = resolve(siteDir);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const compressed = new Map();
  const requests = [];
  const handler = async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/_review/blank') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><title>Isolated review seed</title>');
      return;
    }
    try {
      if (!pathname.startsWith('/eng-trainer/')) throw new Error('outside mount');
      let file = resolve(root, pathname.slice('/eng-trainer/'.length));
      if (file !== root && !file.startsWith(root + sep)) throw new Error('outside root');
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      let body = await readFile(file);
      const headers = { 'Content-Type': `${types[extname(file)] ?? 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' };
      if (gzip && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '') && types[extname(file)]) {
        if (!compressed.has(file)) compressed.set(file, gzipSync(body, { level: 9 }));
        body = compressed.get(file);
        headers['Content-Encoding'] = 'gzip';
      }
      res.writeHead(200, headers);
      res.end(body);
      requests.push({ pathname, status: 200 });
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      requests.push({ pathname, status: 404 });
    }
  };
  const server = h2
    ? createSecureServer({ key: await readFile(join(tlsDir, 'key.pem')), cert: await readFile(join(tlsDir, 'cert.pem')), allowHTTP1: true }, handler)
    : createServer(handler);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `${h2 ? 'https' : 'http'}://127.0.0.1:${server.address().port}`;
  return { origin, base: `${origin}/eng-trainer/`, requests, close: () => new Promise((done) => server.close(done)) };
}

// ------------------------------------------------------------------ UI helpers
async function ready(page) {
  await page.locator('.app-shell').waitFor();
}
async function frame(page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}
async function nav(page, label) {
  await page.locator('.desktop-nav').getByRole('button', { name: label === 'Focus' ? /^Focus(?:\s+\d+)?$/ : label, exact: true }).click();
  await page.locator('.hero h1').filter({ hasText: label }).waitFor();
  await frame(page);
}
const pageText = async (page) => norm(await page.locator('.app-shell').innerText());
async function phraseCards(page) {
  return page.locator('.phrase-card').evaluateAll((cards) => cards.map((card) => ({
    text: card.querySelector('h3')?.textContent?.trim(),
    learned: card.classList.contains('learned'),
    hidden: card.classList.contains('hidden')
  })));
}
async function fillQuery(page, placeholder, value) {
  await page.getByPlaceholder(placeholder).fill(value);
  await frame(page);
}
async function reseedDatabase(page, records) {
  await page.evaluate(async () => {
    const db = await new Promise((done, fail) => { const r = indexedDB.open('eng-trainer-v2'); r.onsuccess = () => done(r.result); r.onerror = () => fail(r.error); });
    await new Promise((done, fail) => {
      const tx = db.transaction([...db.objectStoreNames], 'readwrite');
      for (const name of db.objectStoreNames) tx.objectStore(name).clear();
      tx.oncomplete = done; tx.onerror = () => fail(tx.error);
    });
    db.close();
  });
  await seedDatabase(page, records);
}
async function selectIn(page, index, value) {
  await page.locator('.section-stack select').nth(index).selectOption(value);
  await frame(page);
}

// ------------------------------------------------------------------ synthetic seed
const advancedLinking = P.filter((p) => p.category === 'Advanced Linking Words').map((p) => p.id);
const droppedBlocks = B.filter((b) => b.type === 'phraseCategory').slice(3, 8).map((b) => b.id);
const seed = {
  progress: {
    learnedPhrases: ['phrase-005', 'advanced-linking-008-that-being-said', 'presentation-phrase-085', P[0].id, P.at(-1).id],
    hiddenPhrases: ['hedging-008-to-some-extent', P[1].id],
    hiddenWords: ['word-advanced-linking-012-more-importantly', W[300].id],
    hiddenIrregular: [V[0].id, V.at(-1).id],
    favoriteBlocks: ['ai-certification-vocabulary', B.at(-1).id],
    favoritePhrases: ['phrase-084', 'advanced-linking-004-consequently', 'phrase-005', 'hedging-005-from-my-perspective', P.at(-1).id],
    favoriteWords: [W.at(-1).id, 'word-hedging-005-from-my-perspective'],
    favoriteIrregular: [V[1].id, V.at(-2).id],
    selectedLearnPassId: 'fable-pass'
  },
  learnPasses: {
    'fable-pass': { id: 'fable-pass', name: 'Fable synthetic pass', description: 'Synthetic review data', blockIds: B.map((b) => b.id).filter((id) => !droppedBlocks.includes(id)), createdAt: '2026-11-01T08:00:00.000Z', updatedAt: '2026-11-02T08:00:00.000Z' },
    'other-pass': { id: 'other-pass', name: 'Other synthetic pass', description: '', blockIds: [B[0].id], createdAt: '2026-11-03T08:00:00.000Z', updatedAt: '2026-11-03T08:00:00.000Z' }
  },
  flashcardSessions: {
    all: { order: [P[10].id, 'presentation-phrase-087', P[200].id, 'advanced-linking-004-consequently', 'phrase-084', P[400].id, P.at(-2).id], index: 3 },
    'topic:Advanced Linking Words': { order: [...advancedLinking].reverse(), index: 1 }
  },
  settings: {
    theme: 'dark', activePage: 'favorites', speechRepeatCount: 20,
    phrasePageSize: 'all', wordPageSize: 'all', irregularPageSize: 'all', indexPageSize: 'all',
    flashcardMode: 'all', flashcardTopic: 'Advanced Linking Words'
  }
};

// Independent flashcard oracle for the All deck (RC1 rules: one card per phrase id;
// a card is hidden when its phrase or a linked word is hidden; learned by its own id).
function deckOracle(progress, saved) {
  const hidden = new Set(progress.hiddenPhrases);
  for (const id of progress.hiddenWords) hidden.add(W.find((w) => w.id === id).sourcePhraseId);
  const learned = new Set(progress.learnedPhrases);
  const visible = P.filter((p) => !hidden.has(p.id));
  const learning = visible.filter((p) => !learned.has(p.id)).map((p) => p.id);
  const learningSet = new Set(learning);
  const order = [];
  let index = 0;
  saved.order.forEach((id, position) => {
    if (!learningSet.has(id) || order.includes(id)) return;
    if (position < saved.index) index++;
    order.push(id);
  });
  for (const id of learning) if (!order.includes(id)) order.push(id);
  return { max: visible.length, now: visible.length - learning.length, order, index: index < order.length ? index : 0 };
}

// ------------------------------------------------------------------ scenarios
const scenarios = [];
const scenario = (name, run, options = {}) => scenarios.push({ name, run, ...options });

scenario('requests', async ({ page, context, sites, record }) => {
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(sites.candidate.base);
  await ready(page);
  const local = requests.filter((url) => url.startsWith(sites.candidate.origin)).map((url) => new URL(url).pathname);
  const data = local.filter((path) => path.includes('/data/'));
  assert.deepEqual([...data].sort(), ['/eng-trainer/data/manifest.json', ...manifest.packs.map((p) => `/eng-trainer/data/${p.url}`)].sort());
  assert.equal(data[0], '/eng-trainer/data/manifest.json', 'manifest is requested first');
  assert.equal(new Set(data).size, data.length, 'each content file is requested once');
  assert.ok(local.every((path) => path.startsWith('/eng-trainer/')), 'every local request stays under /eng-trainer/');
  assert.equal(local.some((path) => path.startsWith('/eng-trainer/v1/') || path.endsWith('materials.json')), false);
  for (const [i, entry] of manifest.packs.entries()) {
    const response = await context.request.get(`${sites.candidate.base}data/${entry.url}`);
    assert.equal(await response.text(), packTexts[i]);
  }
  assert.match(norm(await page.locator('.hero').innerText()), /566 phrases/);
  record.localRequests = local;
  record.externalRequests = requests.filter((url) => !url.startsWith(sites.candidate.origin));
});

async function differentialRun(page, site) {
  const snap = {};
  await page.goto(`${site.origin}/_review/blank`);
  await seedDatabase(page, seed);
  await page.goto(site.base);
  await ready(page);
  await settle(page);
  snap.startupWrites = await page.evaluate(() => window.__review.writes.length);
  snap.dbAfterStartup = await readDatabase(page);
  snap.theme = await page.evaluate(() => document.documentElement.dataset.theme);
  snap.startPage = norm(await page.locator('.hero h1').innerText());
  snap.focusText = await pageText(page);
  snap.focusCards = await phraseCards(page);
  await nav(page, 'Index');
  snap.indexText = await pageText(page);

  await nav(page, 'Phrases');
  snap.phrases = [];
  const phraseCases = [
    ['All', ''], ['All', 'from my perspective'], ['All', 'CONSEQUENTLY'], ['Hedging Phrases', ''], ['Advanced Linking Words', 'As a result'],
    [P.at(-1).category, P.at(-1).phrase.toUpperCase()], ['All', P[283].translation.split(' ')[0]], ['All', P[0].phrase.slice(4, 14)],
    ['All', 'zz-no-match'], [P[140].category, P[140].tag ?? '']
  ];
  for (const [category, query] of phraseCases) {
    await selectIn(page, 0, category);
    await fillQuery(page, 'AI, otherwise, meeting…', query);
    snap.phrases.push({ category, query, cards: await phraseCards(page), textSha: sha(await pageText(page)) });
  }
  await page.getByRole('button', { name: 'Show hidden phrases' }).click();
  await selectIn(page, 0, 'All');
  await fillQuery(page, 'AI, otherwise, meeting…', 'to some extent');
  snap.phrasesShowHidden = await phraseCards(page);
  await page.getByRole('button', { name: 'Hide hidden phrases' }).click();
  await fillQuery(page, 'AI, otherwise, meeting…', '');

  await nav(page, 'Words');
  snap.words = [];
  for (const [category, query] of [['All', ''], ['All', W[2].term.toUpperCase()], [W.at(-1).category, ''], ['All', W[250].meaning.split(' ')[0]], ['Hedging Phrases', 'extent']]) {
    await selectIn(page, 0, category);
    await fillQuery(page, 'run into, lack, estimate…', query);
    snap.words.push({ category, query, textSha: sha(await pageText(page)), list: norm(await page.locator('.index-list').innerText()) });
  }

  await nav(page, 'Verbs');
  snap.verbs = [];
  const sets = [...new Set(V.map((v) => v.verbSet))];
  for (const set of sets) {
    for (const query of ['', 'BE', V.filter((v) => v.verbSet === set).at(-1).translation.split(/[ ,]/)[0]]) {
      await selectIn(page, 0, set);
      await fillQuery(page, 'be, took, been, говорити…', query);
      snap.verbs.push({ set, query, count: await page.locator('.verb-card').count(), textSha: sha(await pageText(page)) });
    }
  }
  await fillQuery(page, 'be, took, been, говорити…', '');

  await nav(page, 'Flashcards');
  const flash = async () => ({
    term: norm(await page.locator('.flashcard__term').innerText()),
    now: Number(await page.getByRole('progressbar').getAttribute('aria-valuenow')),
    max: Number(await page.getByRole('progressbar').getAttribute('aria-valuemax')),
    stats: norm(await page.locator('.flashcards-progress__stats').innerText())
  });
  snap.flashBefore = await flash();
  await page.getByRole('button', { name: /^I know it/ }).click();
  await page.locator('.flashcard__term').filter({ hasNotText: snap.flashBefore.term }).waitFor();
  await settle(page);
  snap.flashAfterAnswer = await flash();
  snap.dbAfterAnswer = await readDatabase(page);
  await page.reload();
  await ready(page);
  snap.flashAfterReload = await flash();
  await nav(page, 'Phrases');
  await selectIn(page, 0, 'All');
  await fillQuery(page, 'AI, otherwise, meeting…', 'consequently');
  snap.phrasesAfterReload = await phraseCards(page);
  await fillQuery(page, 'AI, otherwise, meeting…', '');
  await settle(page);
  snap.dbFinal = await readDatabase(page);
  return snap;
}

scenario('differential', async ({ browser, sites, record, newPage }) => {
  const runs = {};
  for (const which of ['baseline', 'candidate']) {
    const { page, context } = await newPage();
    try { runs[which] = await differentialRun(page, sites[which]); } finally { await context.close(); }
  }
  const { baseline, candidate } = runs;
  // Independent oracle on the candidate.
  assert.equal(candidate.startupWrites, 0, 'no startup writes');
  assert.deepEqual(candidate.dbAfterStartup, seed, 'seeded database unchanged by startup');
  assert.equal(candidate.theme, 'dark');
  assert.equal(candidate.startPage, 'Focus');
  const expected = deckOracle(seed.progress, seed.flashcardSessions.all);
  const current = expected.order[expected.index];
  assert.deepEqual([candidate.flashBefore.now, candidate.flashBefore.max], [expected.now, expected.max]);
  assert.equal(candidate.flashBefore.term, norm(P.find((p) => p.id === current).phrase));
  assert.deepEqual(candidate.dbAfterAnswer.progress.learnedPhrases, [...seed.progress.learnedPhrases, current], 'answer stores the phrase id');
  const afterOrder = expected.order.filter((id) => id !== current);
  assert.deepEqual(candidate.dbAfterAnswer.flashcardSessions.all, { order: afterOrder, index: expected.index < afterOrder.length ? expected.index : 0 });
  assert.equal(candidate.flashAfterReload.term, norm(P.find((p) => p.id === afterOrder[expected.index]).phrase));
  const perspective = candidate.phrases.find((c) => c.query === 'from my perspective').cards;
  assert.deepEqual(perspective.map((c) => c.learned), [true, false], 'duplicate-text pair keeps independent learned state');
  assert.equal(candidate.phrasesShowHidden.filter((c) => c.hidden).length, 1, 'hiding one duplicate-text phrase does not hide its pair');
  // Differential: released build and candidate must be indistinguishable.
  assert.deepEqual(candidate, baseline, 'candidate UI/database behaviour equals the released build');
  record.oracle = { current, expectedDeck: { now: expected.now, max: expected.max, index: expected.index }, afterReload: afterOrder[expected.index] };
  record.compared = {
    phraseCases: candidate.phrases.map((c) => ({ category: c.category, query: c.query, cards: c.cards.length, learned: c.cards.filter((x) => x.learned).length })),
    wordCases: candidate.words.map((c) => ({ category: c.category, query: c.query })),
    verbCases: candidate.verbs.map((c) => ({ set: c.set, query: c.query, count: c.count })),
    flash: { before: candidate.flashBefore, afterAnswer: candidate.flashAfterAnswer, afterReload: candidate.flashAfterReload },
    focusCards: candidate.focusCards.length,
    snapshotSha256: sha(JSON.stringify(candidate))
  };
}, { manageContexts: true });

const middle = manifest.packs[5];
const last = manifest.packs.at(-1);
const mutatePack = (entry, mutate) => {
  const pack = structuredClone(packs[manifest.packs.indexOf(entry)]);
  mutate(pack);
  return JSON.stringify(pack, null, 2);
};
const manifestWith = (mutate) => { const value = structuredClone(manifest); mutate(value); return JSON.stringify(value); };
const failures = [
  ['manifest-404', 'manifest.json', (route) => route.fulfill({ status: 404, body: 'Not found' })],
  ['manifest-html-200', 'manifest.json', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p>Captive portal</p>' })],
  ['manifest-unsafe-url', 'manifest.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: manifestWith((m) => { m.packs[0].url = '../v1/data/materials.json'; }) })],
  ['manifest-count-mismatch', 'manifest.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: manifestWith((m) => { m.counts.phrases += 1; }) })],
  ['pack-503', middle.url, (route) => route.fulfill({ status: 503, body: 'Service unavailable' })],
  ['pack-network-abort', middle.url, (route) => route.abort('failed')],
  ['pack-truncated-json', middle.url, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: packTexts[5].slice(0, packTexts[5].length >> 1) })],
  ['pack-other-pack-body', middle.url, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: packTexts[4] })],
  ['pack-record-removed', middle.url, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: mutatePack(middle, (p) => { p.content.phrases.pop(); }) })],
  ['pack-dangling-link', middle.url, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: mutatePack(middle, (p) => { p.content.wordIndex[0].sourcePhraseId = 'absent-phrase'; }) })],
  ['pack-duplicate-id', middle.url, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: mutatePack(middle, (p) => { p.content.phrases[0].id = P[0].id; }) })],
  ['last-pack-schema-2', last.url, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: mutatePack(last, (p) => { p.schemaVersion = 2; }) })]
];
scenario('failures', async ({ page, context, sites, record }) => {
  record.cases = [];
  await page.goto(`${sites.candidate.origin}/_review/blank`);
  await seedDatabase(page, seed);
  for (const [name, file, handler] of failures) {
    const pattern = `**/eng-trainer/data/${file}`;
    const urls = [];
    const onRequest = (request) => { if (request.url().includes('/eng-trainer/data/')) urls.push(new URL(request.url()).pathname); };
    page.on('request', onRequest);
    await context.route(pattern, handler);
    await page.goto(sites.candidate.base);
    await page.locator('.error-card').waitFor();
    const message = norm(await page.locator('.error-card').innerText());
    assert.equal(await page.locator('.app-shell').count(), 0, `${name}: no partial app`);
    const firstRequests = [...urls];
    // A retry while the fault persists must fail the same way without side effects.
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.locator('.error-card').waitFor();
    assert.equal(await page.locator('.app-shell').count(), 0);
    assert.deepEqual(await readDatabase(page), seed, `${name}: database unchanged after failures`);
    const writesBeforeRecovery = await page.evaluate(() => window.__review.writes.length);
    assert.equal(writesBeforeRecovery, 0, `${name}: no database writes while content is unavailable`);
    await context.unroute(pattern);
    urls.length = 0;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await ready(page);
    const recoveryRequests = [...urls];
    page.off('request', onRequest);
    assert.match(norm(await page.locator('.hero').innerText()), /566 phrases/);
    assert.equal(recoveryRequests.length, 1 + manifest.packs.length, `${name}: retry reloads manifest and every pack`);
    await settle(page);
    assert.deepEqual(await readDatabase(page), seed, `${name}: database unchanged after recovery`);
    // The restored catalog is complete: the last verb of the last pack is searchable.
    await nav(page, 'Verbs');
    const lastVerb = packs.at(-1).content.irregularVerbs.at(-2); // .at(-1) is hidden by the seed
    await selectIn(page, 0, lastVerb.verbSet);
    await fillQuery(page, 'be, took, been, говорити…', lastVerb.base);
    assert.ok(await page.locator('.verb-card').count() >= 1);
    await fillQuery(page, 'be, took, been, говорити…', '');
    await settle(page);
    const writes = await page.evaluate(() => window.__review.writes.map((w) => `${w.store}:${w.key}`));
    // Navigation saves activePage/irregularSet settings; restore exactly the seed for the next case.
    await reseedDatabase(page, seed);
    record.cases.push({ name, message: message.replace(/For local development.*$/, '').trim(), firstRequests: firstRequests.length, writesBeforeRecovery, recoveryRequests: recoveryRequests.length, writesAfterUserNavigation: writes });
  }
});

scenario('no-partial', async ({ page, context, sites, record }) => {
  let release;
  const held = new Promise((done) => { release = done; });
  await context.route(`**/eng-trainer/data/${last.url}`, async (route) => { await held; await route.continue(); });
  await page.goto(sites.candidate.base);
  await page.waitForTimeout(1500);
  record.shellWhileLastPackPending = await page.locator('.app-shell').count();
  record.loaderTextWhilePending = norm(await page.locator('main').first().innerText());
  assert.equal(record.shellWhileLastPackPending, 0);
  release();
  await ready(page);
  await nav(page, 'Verbs');
  const lastVerb = packs.at(-1).content.irregularVerbs.at(-1);
  await selectIn(page, 0, lastVerb.verbSet);
  await fillQuery(page, 'be, took, been, говорити…', lastVerb.pastParticiple.toUpperCase());
  record.lastPackVerbFound = await page.locator('.verb-card').count();
  assert.ok(record.lastPackVerbFound >= 1);
});

scenario('v1', async ({ page, context, sites, record }) => {
  const legacy = { learnedPhrases: ['phrase-002'], activePage: 'phrases', phrasePageSize: 'all', phraseCategory: 'All' };
  await page.goto(`${sites.candidate.origin}/_review/blank`);
  await page.evaluate((value) => window.__review.seedLegacy({ 'englishAssessmentTrainer.svelteState.v1': JSON.stringify(value) }), legacy);
  const requests = [];
  page.on('request', (request) => { if (request.url().startsWith(sites.candidate.origin)) requests.push(new URL(request.url()).pathname); });
  await page.goto(`${sites.candidate.base}v1/`);
  await page.locator('.app-shell').waitFor();
  await page.locator('.phrase-card').first().waitFor();
  const data = requests.filter((path) => path.includes('/data/'));
  assert.deepEqual(data, ['/eng-trainer/v1/data/materials.json']);
  assert.ok(requests.every((path) => path.startsWith('/eng-trainer/v1/')), 'v1 requests stay under /eng-trainer/v1/');
  const v1Bytes = await (await context.request.get(`${sites.candidate.base}v1/data/materials.json`)).body();
  record.v1MonolithSha256 = sha(v1Bytes);
  const releasedV1 = await readJson(join(baselineSite, 'v1/data/materials.json'));
  assert.deepEqual(JSON.parse(v1Bytes.toString('utf8')), releasedV1, 'v1 serves exactly the released v1 content');
  const learned = await page.locator('.phrase-card.learned h3').allInnerTexts();
  assert.deepEqual(learned.map(norm), [norm(P.find((p) => p.id === 'phrase-002').phrase)], 'v1 restores its localStorage progress');
  record.v1IndexedDbOpens = await page.evaluate(() => window.__review.opens);
  assert.deepEqual(record.v1IndexedDbOpens, []);
  record.v1StorageCalls = [...new Set(await page.evaluate(() => window.__review.storageCalls))];
  assert.ok(record.v1StorageCalls.includes('getItem'));
  record.v1Requests = [...requests]; // snapshot before the v2 navigation below
  requests.length = 0;
  // v2 in the same context: never reads the v1 key, opens only eng-trainer-v2.
  await page.goto(sites.candidate.base);
  await ready(page);
  record.v2IndexedDbOpens = await page.evaluate(() => window.__review.opens);
  record.v2LocalStorageCalls = [...new Set(await page.evaluate(() => window.__review.storageCalls))];
  assert.deepEqual([...new Set(record.v2IndexedDbOpens)], ['eng-trainer-v2']);
  assert.deepEqual(record.v2LocalStorageCalls, [], 'v2 never touches localStorage');
  record.v2Requests = [...requests];
  assert.equal(record.v2Requests.some((path) => path.startsWith('/eng-trainer/v1/')), false, 'v2 requests nothing from v1');
  record.v1KeyAfterV2 = await page.evaluate(() => window.__review.legacySnapshot());
  assert.deepEqual(JSON.parse(record.v1KeyAfterV2['englishAssessmentTrainer.svelteState.v1']).learnedPhrases, ['phrase-002']);
});

const profiles = [
  { name: 'unthrottled' },
  { name: 'moderate: 150 ms RTT, 1.6 Mbps down, 750 kbps up', latency: 150, down: 1.6e6 / 8, up: 750e3 / 8 },
  { name: 'high-latency: 300 ms RTT, 5 Mbps down, 1 Mbps up', latency: 300, down: 5e6 / 8, up: 1e6 / 8 }
];
scenario('performance', async ({ browser, record }) => {
  record.profiles = [];
  for (const transport of tlsDir ? ['http/1.1', 'h2'] : ['http/1.1']) {
  const h2 = transport === 'h2';
  const servers = { baseline: await serve(baselineSite, { gzip: true, h2 }), candidate: await serve(candidateSite, { gzip: true, h2 }) };
  try {
    for (const profile of profiles) {
      const result = { transport, profile: profile.name, baseline: [], candidate: [] };
      for (let run = 0; run < 5; run++) {
        for (const which of ['baseline', 'candidate']) {
          const context = await browser.newContext({ ignoreHTTPSErrors: h2 });
          await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: FONT_STUB }));
          await context.addInitScript(() => {
            new MutationObserver((_, observer) => {
              if (document.querySelector('.app-shell')) { window.__shellAt = performance.now(); observer.disconnect(); }
            }).observe(document, { childList: true, subtree: true });
          });
          const page = await context.newPage();
          const cdp = await context.newCDPSession(page);
          await cdp.send('Network.enable');
          await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
          if (profile.latency) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latency, downloadThroughput: profile.down, uploadThroughput: profile.up });
          await page.goto(servers[which].base);
          await ready(page);
          const timing = await page.evaluate(() => {
            const data = performance.getEntriesByType('resource').filter((e) => e.name.includes('/data/'));
            return {
              shellMs: Math.round(window.__shellAt),
              protocols: [...new Set(data.map((e) => e.nextHopProtocol))].join(','),
              dataRequests: data.length,
              firstDataStart: Math.round(Math.min(...data.map((e) => e.startTime))),
              lastDataEnd: Math.round(Math.max(...data.map((e) => e.responseEnd))),
              dataTransferBytes: data.reduce((sum, e) => sum + e.transferSize, 0),
              dataDecodedBytes: data.reduce((sum, e) => sum + e.decodedBodySize, 0)
            };
          });
          result[which].push(timing);
          await context.close();
        }
      }
      const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];
      for (const which of ['baseline', 'candidate']) {
        result[`${which}Median`] = Object.fromEntries(['shellMs', 'firstDataStart', 'lastDataEnd', 'dataTransferBytes', 'dataDecodedBytes', 'dataRequests'].map((key) => [key, median(result[which].map((r) => r[key]))]));
      }
      result.shellDeltaMs = result.candidateMedian.shellMs - result.baselineMedian.shellMs;
      result.shellDeltaPercent = Math.round((100 * result.shellDeltaMs) / result.baselineMedian.shellMs);
      result.negotiated = [...new Set([...result.baseline, ...result.candidate].map((r) => r.protocols))];
      record.profiles.push(result);
      console.log(`  performance [${transport} → ${result.negotiated}] ${profile.name}: baseline ${result.baselineMedian.shellMs} ms, candidate ${result.candidateMedian.shellMs} ms (${result.shellDeltaMs >= 0 ? '+' : ''}${result.shellDeltaMs} ms)`);
    }
  } finally {
    await servers.baseline.close();
    await servers.candidate.close();
  }
  }
}, { engines: ['chromium'], manageContexts: true });

// ------------------------------------------------------------------ runner
const sites = { candidate: await serve(candidateSite), baseline: await serve(baselineSite) };
let failed = false;
try {
  for (const engine of engines) {
    const browser = await playwright[engine].launch({ headless: true });
    const results = [];
    try {
      for (const { name, run, engines: allowed, manageContexts } of scenarios) {
        if (only.length && !only.includes(name)) continue;
        if (allowed && !allowed.includes(engine)) continue;
        const pageErrors = [];
        const consoleErrors = [];
        const contexts = [];
        const newPage = async () => {
          const context = await browser.newContext();
          contexts.push(context);
          await context.addInitScript(instrumentBrowser);
          await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: FONT_STUB }));
          const page = await context.newPage();
          page.setDefaultTimeout(20000);
          page.on('pageerror', (error) => pageErrors.push(error.message));
          page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
          return { page, context };
        };
        const record = { name };
        const started = Date.now();
        let page;
        try {
          const opened = manageContexts ? {} : await newPage();
          page = opened.page;
          await run({ browser, page, context: opened.context, sites, record, newPage });
          assert.deepEqual(pageErrors, [], 'no uncaught page errors');
          record.status = 'PASS';
        } catch (error) {
          failed = true;
          record.status = 'FAIL';
          record.error = String(error.message).slice(0, 4000);
          if (page) await page.screenshot({ path: join(evidence, `${engine}-${name}-failure.png`), fullPage: true }).catch(() => undefined);
        } finally {
          record.durationMs = Date.now() - started;
          record.pageErrors = pageErrors;
          record.consoleErrors = consoleErrors;
          results.push(record);
          console.log(`${engine}: ${record.status} ${name}${record.error ? ` — ${record.error.split('\n')[0]}` : ''}`);
          for (const context of contexts) await context.close().catch(() => undefined);
        }
      }
      await writeFile(join(evidence, `browser-${engine}.json`), `${JSON.stringify({ engine, version: browser.version(), results }, null, 2)}\n`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await sites.candidate.close();
  await sites.baseline.close();
}
if (failed) process.exitCode = 1;
