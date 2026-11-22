// ENG-V2-03 browser checks of the combined local build (site-dist), in Chromium and Firefox.
// Every scenario uses a fresh, non-persistent context and synthetic data only; requests to
// other hosts are refused; speech synthesis and the clipboard are replaced inside the page.
// Usage: node browser-check.mjs <playwright-node_modules> <site-dist> <output-dir>
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const [, , pwDir, siteDir, outDir] = process.argv;
const require = createRequire(import.meta.url);
const pw = require(join(pwDir, 'playwright'));
mkdirSync(join(outDir, 'shots'), { recursive: true });

// ---------------------------------------------------------------- static server for /eng-trainer/
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png' };
const PORT = 4183;
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (!url.pathname.startsWith('/eng-trainer/')) { response.writeHead(404); response.end(); return; }
  if (failing.has(url.pathname)) { response.writeHead(503); response.end('Unavailable'); return; }
  let path = normalize(join(siteDir, decodeURIComponent(url.pathname.slice('/eng-trainer/'.length))));
  if (!path.startsWith(normalize(siteDir))) { response.writeHead(403); response.end(); return; }
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  if (!existsSync(path)) { response.writeHead(404); response.end('not found'); return; }
  response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  response.end(readFileSync(path));
});
/** Paths that answer 503 while a scenario needs a failing content request. */
const failing = new Set();
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
const HOST = `127.0.0.1:${PORT}`;
const BASE = `http://${HOST}/eng-trainer/`;

const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true },
  narrow: { viewport: { width: 320, height: 640 }, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 } }
};
const ROUTES = ['index', 'phrases', 'wordIndex', 'irregularVerbs', 'patterns', 'answers', 'flashcards', 'reverse', 'practice', 'favorites', 'collections', 'settings'];
const TOPICS = ['topic/conditionals', 'topic/small-talk', 'topic/interview-english'];
const STUDY = ['phrases', 'wordIndex', 'irregularVerbs', 'patterns', 'answers', 'flashcards', 'reverse', 'practice', 'favorites', 'collections'];
const results = { definition: 'Fresh non-persistent native contexts per scenario; synthetic data; requests to other hosts refused; speech synthesis and clipboard replaced inside the page. No owner profile.', base: BASE, engines: {} };
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const shot = (name) => join(outDir, 'shots', `${name}.png`);
let failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const COLLECTION = 'user:00000000-0000-4000-8000-0000000000e3';
const NATIVE = JSON.stringify({
  format: 'eng-trainer-vocabulary',
  version: 1,
  collection: { id: COLLECTION, name: 'Synthetic travel words', description: 'Synthetic test data' },
  entries: [
    { id: `${COLLECTION}:entry:00000000-0000-4000-8000-000000000001`, kind: 'word', english: 'zyx boarding pass', translation: 'посадковий талон', topic: 'Synthetic travel', examples: [] },
    { id: `${COLLECTION}:entry:00000000-0000-4000-8000-000000000002`, kind: 'phrase', english: 'zyx Where is gate ten?', translation: 'Де вихід десять?', topic: 'Synthetic travel', examples: [] }
  ]
});

async function context(browser, kind, extra = {}) {
  const ctx = await browser.newContext({ ...VIEWPORTS[kind], ...extra });
  await ctx.route((url) => url.host !== HOST, (route) => route.abort('blockedbyclient'));
  await ctx.addInitScript(() => {
    window.__spoken = [];
    const synth = {
      speaking: false, pending: false, paused: false,
      speak(utterance) { window.__spoken.push({ text: utterance.text, lang: utterance.lang }); setTimeout(() => utterance.onend?.(new Event('end')), 5); },
      cancel() {}, pause() {}, resume() {}, getVoices() { return []; }, addEventListener() {}, removeEventListener() {}
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    if (typeof window.SpeechSynthesisUtterance !== 'function') window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
  });
  return ctx;
}

function watch(page, log, scenario) {
  page.on('pageerror', (error) => log.push({ scenario, type: 'pageerror', text: String(error).slice(0, 300) }));
  page.on('console', (message) => { if (message.type() === 'error') log.push({ scenario, type: 'console', text: message.text().slice(0, 300) }); });
  page.on('requestfailed', (request) => { if (new URL(request.url()).host === HOST) log.push({ scenario, type: 'requestfailed', url: request.url(), reason: request.failure()?.errorText }); });
}

async function ready(page) {
  await page.waitForSelector('.app-shell', { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await settle(250);
}

async function go(page, hash) {
  await page.evaluate((value) => { window.location.hash = value; }, hash);
  await page.waitForFunction((value) => document.querySelector('main h1') && window.location.hash === `#${value}`, hash);
  await settle(250);
}

function SMALL_TARGETS(scopeSelector) {
  const scope = document.querySelector(scopeSelector) ?? document.body;
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  // As in the UX-01B runner: an input's target is its label; a file input's, the label that names it.
  const targetOf = (el) => {
    if (el.matches('input') && el.closest('label')) return el.closest('label');
    if (el.matches('input[type="file"]') && el.id) return document.querySelector(`label[for="${el.id}"]`) ?? el;
    return el;
  };
  return [...scope.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && visible(el) && !el.closest('dialog:not([open])') && !el.matches('.skip-link:not(:focus)') && !el.closest('p, li > p'))
    .map((el) => ({ el, r: targetOf(el).getBoundingClientRect() }))
    .filter(({ r }) => r.width < 44 || r.height < 44)
    .map(({ el, r }) => `${(el.getAttribute('aria-label') || el.textContent || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 40)} (${Math.round(r.width)}x${Math.round(r.height)})`);
}

/** Layout facts of the open screen. Runs in the page. */
function MEASURE() {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const first = document.querySelector('main .entry, main .empty-state, main .import-panel, main .flashcard-stage, main .reading-card, main .prompt-card, main .reverse-card, main .panel, main .expansion-panel, main .home-panel, main .topic-section');
  const header = document.querySelector('.app-header');
  const cyrillic = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // Sample file text in the import help (<pre>, unchanged since ENG-V2-02B) is file content, not a translation.
    if (!/[Ѐ-ӿ]/.test(node.textContent) || !node.parentElement || !visible(node.parentElement) || node.parentElement.closest('dialog:not([open]), .visually-hidden, pre')) continue;
    if (node.parentElement.closest('[lang]')?.getAttribute('lang') !== 'uk') cyrillic.push(node.textContent.trim().slice(0, 50));
  }
  return {
    h1: document.querySelector('main h1')?.textContent ?? null,
    h1Count: document.querySelectorAll('h1').length,
    h1InsideMain: !!document.querySelector('main h1'),
    header: header ? { height: Math.round(header.getBoundingClientRect().height * 10) / 10, top: Math.round(header.getBoundingClientRect().top), text: header.textContent.replace(/\s+/g, ' ').trim(), insideMain: !!header.closest('main'), link: header.querySelector('a')?.getAttribute('href') ?? null, digits: /\d/.test(header.textContent) } : null,
    statistics: !!document.querySelector('.home-overview, .home-meter'),
    firstContentTop: first ? Math.round(first.getBoundingClientRect().top + scrollY) : null,
    firstTopicCardTop: document.querySelector('.topic-card') ? Math.round(document.querySelector('.topic-card').getBoundingClientRect().top + scrollY) : null,
    tabBarTop: document.querySelector('.tab-bar') && visible(document.querySelector('.tab-bar')) ? Math.round(document.querySelector('.tab-bar').getBoundingClientRect().top) : innerHeight,
    horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    unmarkedCyrillic: cyrillic,
    skipLinkFirst: document.querySelector('.app-shell')?.firstElementChild?.classList.contains('skip-link') ?? null
  };
}

async function readStores(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('eng-trainer-v2');
    request.onsuccess = () => {
      const db = request.result;
      const names = [...db.objectStoreNames];
      if (!names.length) { db.close(); resolve({}); return; }
      const tx = db.transaction(names, 'readonly');
      const out = {};
      for (const name of names) {
        const store = tx.objectStore(name);
        const keys = store.getAllKeys();
        const values = store.getAll();
        tx.addEventListener('complete', () => { out[name] = Object.fromEntries(keys.result.map((key, i) => [key, values.result[i]])); });
      }
      tx.oncomplete = () => { db.close(); resolve(out); };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  }));
}

const homeTotals = (page) => page.evaluate(() => {
  const stat = (label) => [...document.querySelectorAll('.home-stat dt')].find((item) => item.textContent.trim() === label)?.nextElementSibling?.textContent.trim() ?? null;
  return {
    vocabulary: document.querySelector('.home-meter__value')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    progressbar: (() => { const bar = document.querySelector('.home-meter__bar'); return bar ? { now: bar.getAttribute('aria-valuenow'), max: bar.getAttribute('aria-valuemax'), name: document.getElementById(bar.getAttribute('aria-labelledby'))?.textContent } : null; })(),
    topicsCompleted: stat('Topics completed'), inFocus: stat('In Focus'), wordsLearned: stat('Words learned'), phrasesLearned: stat('Phrases learned'), remaining: stat('Remaining vocabulary'),
    words: stat('Words'), phrases: stat('Phrases'), verbs: stat('Verbs'), topics: stat('Topics'), collections: stat('Your collections'),
    cards: [...document.querySelectorAll('.topic-card')].map((card) => card.querySelector('.topic-card__meta')?.textContent.trim())
  };
});

const rows = (page) => page.$$eval('.topic-section .entry__term', (items) => items.map((item) => item.textContent.trim()));

async function run(browser, engine, name, body) {
  const log = [];
  failures = [];
  const started = Date.now();
  let data = null;
  let error = null;
  try {
    data = await body(log);
  } catch (caught) {
    error = String(caught?.stack ?? caught).slice(0, 1200);
  }
  const outcome = { pass: !error && failures.length === 0, failures: [...failures], error, ms: Date.now() - started, log, data };
  results.engines[engine].scenarios[name] = outcome;
  console.log(`${engine} ${name}: ${outcome.pass ? 'pass' : 'FAIL'}${error ? ` ${error.split('\n')[0]}` : ''}${failures.length ? ` ${failures.join(' | ')}` : ''}`);
}

for (const engine of ['chromium', 'firefox']) {
  const browser = await pw[engine].launch({ headless: true });
  results.engines[engine] = { version: browser.version(), scenarios: {} };

  // 1. Header and layout on every route: phone, narrow and desktop.
  for (const kind of ['phone', 'narrow', 'desktop']) {
    await run(browser, engine, `routes-${kind}`, async (log) => {
      const ctx = await context(browser, kind);
      const page = await ctx.newPage();
      watch(page, log, `routes-${kind}`);
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await ready(page);
      const pages = {};
      for (const hash of [...ROUTES, ...TOPICS]) {
        await go(page, hash);
        const measured = await page.evaluate(MEASURE);
        measured.smallTargets = await page.evaluate(SMALL_TARGETS, 'body');
        pages[hash] = measured;
        const label = `${hash}`;
        check(measured.header && !measured.header.insideMain && measured.header.top === 0, `${label}: header missing or not at the top`);
        check(measured.header?.link === '/eng-trainer/#index', `${label}: brand link ${measured.header?.link}`);
        check(measured.header && !measured.header.digits, `${label}: header shows a number`);
        check(measured.h1Count === 1 && measured.h1InsideMain, `${label}: expected one h1 inside main`);
        check(measured.skipLinkFirst === true, `${label}: skip link is not first`);
        check(measured.statistics === (hash === 'index'), `${label}: statistics ${measured.statistics ? 'shown' : 'missing'}`);
        check(measured.horizontalOverflow <= 0, `${label}: horizontal overflow ${measured.horizontalOverflow}px`);
        check(measured.smallTargets.length === 0, `${label}: targets under 44 px: ${measured.smallTargets.join('; ')}`);
        check(measured.unmarkedCyrillic.length === 0, `${label}: Cyrillic outside lang="uk": ${measured.unmarkedCyrillic.join(' | ')}`);
        if (kind === 'phone') check(measured.header.height >= 44 && measured.header.height <= 56, `${label}: header height ${measured.header.height}`);
        if (kind !== 'narrow' || ['index', ...TOPICS, 'phrases'].includes(hash)) await page.screenshot({ path: shot(`${engine}-${kind}-${hash.replace('/', '-')}`) });
      }
      if (kind === 'phone') {
        check(pages.index.firstTopicCardTop !== null && pages.index.firstTopicCardTop < pages.index.tabBarTop, `Home: first topic card at ${pages.index.firstTopicCardTop}px, tab bar at ${pages.index.tabBarTop}px`);
      }
      await ctx.close();
      return { pages, firstStudyContent: Object.fromEntries([...STUDY, ...TOPICS].map((hash) => [hash, pages[hash].firstContentTop])) };
    });
  }

  // 2. Conditionals: rules, groups, final subsection, listening, learning, practice deck, reload.
  await run(browser, engine, 'topic-conditionals', async (log) => {
    const ctx = await context(browser, 'phone');
    const page = await ctx.newPage();
    watch(page, log, 'topic-conditionals');
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await page.locator('.topic-card[href="#topic/conditionals"]').click();
    await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'Conditionals');
    await settle(200);
    const out = {};
    out.focusOnHeading = await page.evaluate(() => document.activeElement === document.querySelector('main h1'));
    out.outline = await page.$$eval('main h2, main h3:not(.entry__term)', (items) => items.map((item) => `${item.tagName}:${item.textContent.trim()}`));
    out.rows = (await rows(page)).length;
    out.finalSample = (await rows(page)).at(-1);
    out.rule = (await page.locator('.topic-rule').first().textContent()).replace(/\s+/g, ' ').trim();
    check(out.focusOnHeading, 'focus did not move to the topic heading');
    check(out.rows === 18, `rows ${out.rows}`);
    check(out.finalSample === "If I weren't afraid of flying, I would have traveled to the conference last month.", `final row ${out.finalSample}`);
    check(out.outline.includes('H2:Mixed Conditionals') && out.outline.includes('H3:General condition, past result') && out.outline.at(-1) === 'H2:Usage note', `outline ${out.outline.join(', ')}`);
    await page.getByRole('button', { name: 'Listen to all' }).click();
    await page.waitForFunction(() => window.__spoken.length >= 2);
    out.spoken = await page.evaluate(() => window.__spoken.slice(0, 2));
    check(out.spoken[0]?.text === 'If I skip breakfast, I feel hungry before lunch.' && out.spoken[0]?.lang === 'en-US' && out.spoken[1]?.lang === 'uk-UA', `spoken ${JSON.stringify(out.spoken)}`);
    await page.getByRole('button', { name: 'Stop reading' }).click().catch(() => undefined);
    const last = page.locator('.topic-section').last().locator('.phrase-card').last();
    await last.scrollIntoViewIfNeeded();
    await last.getByRole('button', { name: 'Mark as learned' }).click();
    await page.screenshot({ path: shot(`${engine}-phone-conditionals-final-subsection`) });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready(page);
    out.afterReload = await page.evaluate(() => [...document.querySelectorAll('.topic-section')].at(-1).querySelectorAll('.phrase-card.learned').length);
    check(out.afterReload === 1, `learned rows after reload ${out.afterReload}`);
    await page.getByRole('button', { name: 'Practice this topic' }).click();
    await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'Flashcards');
    await settle(200);
    out.deck = await page.evaluate(() => ({ topic: document.querySelector('.flashcards-deck select')?.value, total: document.querySelector('.flashcards-progress__bar')?.getAttribute('aria-valuemax'), learned: document.querySelector('.flashcards-progress__bar')?.getAttribute('aria-valuenow') }));
    check(out.deck.topic === 'Conditionals' && out.deck.total === '18' && out.deck.learned === '1', `deck ${JSON.stringify(out.deck)}`);
    await ctx.close();
    return out;
  });

  // 3. Small Talk: chips with keyboard, search combination, memory, final situation, progress untouched.
  await run(browser, engine, 'topic-small-talk', async (log) => {
    const ctx = await context(browser, 'phone');
    const page = await ctx.newPage();
    watch(page, log, 'topic-small-talk');
    await page.goto(`${BASE}#topic/small-talk`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    const out = {};
    const before = await readStores(page);
    out.chips = await page.$$eval('.chip-row button', (items) => items.map((item) => [item.textContent.trim(), item.getAttribute('aria-pressed')]));
    out.group = await page.evaluate(() => [document.querySelector('.chip-row')?.getAttribute('role'), document.querySelector('.chip-row')?.getAttribute('aria-label')]);
    check(out.chips.length === 7 && out.chips[0][0] === 'All situations' && out.chips[0][1] === 'true', `chips ${JSON.stringify(out.chips)}`);
    check(out.group[0] === 'group' && out.group[1] === 'Situations', `chip group ${out.group}`);
    // Keyboard: focus the last chip and activate it with Enter.
    await page.locator('.chip-row button').last().focus();
    out.chipFocusVisible = await page.evaluate(() => document.activeElement.matches(':focus-visible') || getComputedStyle(document.activeElement).outlineStyle !== 'none');
    await page.keyboard.press('Enter');
    await settle(200);
    out.travel = await rows(page);
    check(out.travel.length === 6 && out.travel.at(-1) === 'I hope you enjoy the rest of your trip.', `Traveling rows ${out.travel.join(' | ')}`);
    await page.screenshot({ path: shot(`${engine}-phone-small-talk-traveling`) });
    await page.locator('main input[type="search"]').fill('have you');
    await settle(200);
    out.combined = await rows(page);
    check(JSON.stringify(out.combined) === JSON.stringify(['Have you been here before?', 'Have you had a chance to explore the city?']), `chip + search ${out.combined.join(' | ')}`);
    await go(page, 'phrases');
    await go(page, 'topic/small-talk');
    out.kept = (await rows(page)).length;
    check(out.kept === 2, `selection not kept in memory: ${out.kept}`);
    await page.locator('main input[type="search"]').fill('');
    await page.getByRole('button', { name: 'All situations' }).click();
    out.all = (await rows(page)).length;
    check(out.all === 36, `all rows ${out.all}`);
    const after = await readStores(page);
    check(JSON.stringify(after.progress ?? {}) === JSON.stringify(before.progress ?? {}), 'filtering changed progress');
    check(Object.keys(after.settings ?? {}).every((key) => key === 'activePage'), `filtering saved settings: ${Object.keys(after.settings ?? {})}`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready(page);
    out.afterReload = (await rows(page)).length;
    check(out.afterReload === 36, `after reload ${out.afterReload}`);
    await ctx.close();
    return out;
  });

  // 4. Interview English: subheadings, labels, final category, model-answer listening.
  await run(browser, engine, 'topic-interview', async (log) => {
    const ctx = await context(browser, 'phone');
    const page = await ctx.newPage();
    watch(page, log, 'topic-interview');
    await page.goto(`${BASE}#topic/interview-english`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    const out = await page.evaluate(() => {
      const sections = [...document.querySelectorAll('.topic-section')];
      const last = sections.at(-1);
      return {
        sections: sections.length,
        subheadings: [...new Set(sections.map((section) => [...section.querySelectorAll('h3')].map((item) => item.textContent.trim()).join(' / ')))],
        lastTitle: last.querySelector('h2').textContent.trim(),
        lastFrame: [...last.querySelectorAll('.entry__term')].at(-1).textContent.trim(),
        labels: [...document.querySelectorAll('.reading-card__label')].map((item) => item.textContent.trim()),
        note: document.querySelector('.topic-intro__note')?.textContent.trim(),
        hint: document.querySelector('.topic-intro__hint')?.textContent.trim()
      };
    });
    check(out.sections === 6 && out.subheadings.length === 1 && out.subheadings[0] === 'Typical questions / Answer structure / Answer frames / Model answer / Translation', `structure ${JSON.stringify(out.subheadings)}`);
    check(out.lastTitle === 'Describing experience and solving problems' && out.lastFrame === 'As a result, [outcome]. What I learned was [lesson].', `final category ${out.lastTitle}: ${out.lastFrame}`);
    check(JSON.stringify(out.labels) === JSON.stringify(['Hypothetical server-backed application', 'Fictional practice example']), `labels ${out.labels}`);
    check(out.hint === 'Replace the text in brackets with your own details.', `hint ${out.hint}`);
    const answer = page.locator('.topic-section').last().locator('.topic-answer');
    await answer.scrollIntoViewIfNeeded();
    await answer.getByRole('button', { name: 'Listen to the model answer' }).click();
    await page.waitForFunction(() => window.__spoken.length >= 1);
    out.spoken = await page.evaluate(() => window.__spoken.at(-1));
    check(out.spoken.text.startsWith('In a practice project, a form showed the wrong error message'), `spoken ${out.spoken.text}`);
    await page.screenshot({ path: shot(`${engine}-phone-interview-final-category`) });
    await ctx.close();
    return out;
  });

  // 5. Shared search and Focus reach the new items.
  await run(browser, engine, 'search-and-focus', async (log) => {
    const ctx = await context(browser, 'phone');
    const page = await ctx.newPage();
    watch(page, log, 'search-and-focus');
    await page.goto(`${BASE}#phrases`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    const out = {};
    for (const query of ['Shall we get started?', 'Почнемо?', 'If I had known about the meeting']) {
      await page.locator('main input[type="search"]').fill(query);
      await settle(200);
      out[query] = await page.$$eval('.phrase-card .entry__term', (items) => items.map((item) => item.textContent.trim()));
    }
    check(out['Shall we get started?'].includes('Shall we get started?') && out['Почнемо?'].includes('Shall we get started?'), 'search by English and Ukrainian');
    check(out['If I had known about the meeting'].includes('If I had known about the meeting, I would have joined it.'), 'conditional search');
    await page.locator('.phrase-card').first().getByRole('button', { name: 'Add to Focus List' }).click();
    await go(page, 'favorites');
    out.focus = await page.$$eval('main .entry__term', (items) => items.map((item) => item.textContent.trim()));
    check(out.focus.includes('If I had known about the meeting, I would have joined it.'), `focus list ${out.focus}`);
    await go(page, 'index');
    out.home = await homeTotals(page);
    check(out.home.inFocus === '1', `In Focus ${out.home.inFocus}`);
    await ctx.close();
    return out;
  });

  // 6. Home counts: learning, a completed topic, details disclosure, reload.
  await run(browser, engine, 'home-counts', async (log) => {
    const ctx = await context(browser, 'phone');
    const page = await ctx.newPage();
    watch(page, log, 'home-counts');
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await ready(page);
    const out = { start: await homeTotals(page) };
    check(out.start.vocabulary === '0 / 638 0%' && out.start.topicsCompleted === '0 / 34' && out.start.words === '566' && out.start.phrases === '638' && out.start.verbs === '339' && out.start.topics === '34' && out.start.collections === '0', `start ${JSON.stringify(out.start)}`);
    check(out.start.progressbar?.name === 'Vocabulary learned' && out.start.progressbar.max === '638', `progress bar ${JSON.stringify(out.start.progressbar)}`);
    await page.screenshot({ path: shot(`${engine}-phone-home-start`) });
    await go(page, 'topic/conditionals');
    const buttons = page.locator('.topic-section .phrase-card button[aria-label="Mark as learned"]');
    while (await buttons.count()) await buttons.first().click();
    await go(page, 'index');
    out.completed = await homeTotals(page);
    check(out.completed.vocabulary === '18 / 638 2%' && out.completed.topicsCompleted === '1 / 34' && out.completed.cards[0] === '18 of 18 practice cards learned', `after Conditionals ${JSON.stringify(out.completed)}`);
    await page.locator('.home-details summary').click();
    await settle(150);
    out.details = await homeTotals(page);
    check(out.details.wordsLearned === '0 / 566' && out.details.phrasesLearned === '18 / 638' && out.details.remaining === '620', `details ${JSON.stringify(out.details)}`);
    await page.screenshot({ path: shot(`${engine}-phone-home-details`), fullPage: true });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready(page);
    out.afterReload = await homeTotals(page);
    check(out.afterReload.vocabulary === out.completed.vocabulary && out.afterReload.topicsCompleted === out.completed.topicsCompleted, `after reload ${JSON.stringify(out.afterReload)}`);
    const stores = await readStores(page);
    out.storedKeys = Object.fromEntries(Object.entries(stores).map(([store, value]) => [store, Object.keys(value)]));
    check(JSON.stringify(out.storedKeys.progress) === JSON.stringify(['learnedPhrases']) && out.storedKeys.settings.every((key) => key === 'activePage'), `stored ${JSON.stringify(out.storedKeys)}`);
    await ctx.close();
    return out;
  });

  // 7. Import, remove and reimport a synthetic collection: Home follows; learned state returns.
  await run(browser, engine, 'import-remove-reimport', async (log) => {
    const ctx = await context(browser, 'phone');
    const page = await ctx.newPage();
    watch(page, log, 'import-remove-reimport');
    await page.goto(`${BASE}#collections`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    const out = {};
    const importFile = async () => {
      await page.locator('#import-file').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(NATIVE) });
      await page.waitForSelector('#review-title');
      await page.getByRole('button', { name: /^Import 2 entries$|^Confirm import$/ }).click();
      await page.waitForSelector('.notice--success');
      await settle(200);
    };
    await importFile();
    await go(page, 'phrases');
    await page.locator('main input[type="search"]').fill('zyx Where is gate ten?');
    await settle(200);
    await page.locator('.phrase-card').first().getByRole('button', { name: 'Mark as learned' }).click();
    await go(page, 'index');
    out.imported = await homeTotals(page);
    check(out.imported.vocabulary === '1 / 640 <1%' && out.imported.collections === '1' && out.imported.topics === '35' && out.imported.words === '567' && out.imported.phrases === '639', `imported ${JSON.stringify(out.imported)}`);
    await go(page, 'collections');
    await page.getByRole('button', { name: 'Remove Synthetic travel words' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await go(page, 'index');
    out.canceled = await homeTotals(page);
    check(JSON.stringify(out.canceled) === JSON.stringify(out.imported), 'canceled removal changed Home');
    await go(page, 'collections');
    await page.getByRole('button', { name: 'Remove Synthetic travel words' }).click();
    await page.getByRole('button', { name: 'Remove collection' }).click();
    await page.waitForSelector('.collections-message');
    await go(page, 'index');
    out.removed = await homeTotals(page);
    check(out.removed.vocabulary === '0 / 638 0%' && out.removed.collections === '0' && out.removed.topics === '34', `removed ${JSON.stringify(out.removed)}`);
    out.retained = (await readStores(page)).progress?.learnedPhrases;
    check(out.retained?.includes(`${COLLECTION}:entry:00000000-0000-4000-8000-000000000002`), 'learned ID was not retained');
    await go(page, 'collections');
    await importFile();
    await go(page, 'index');
    out.reimported = await homeTotals(page);
    check(JSON.stringify(out.reimported) === JSON.stringify(out.imported), `reimported ${JSON.stringify(out.reimported)}`);
    await ctx.close();
    return out;
  });

  // 8. Keyboard: skip link, brand link to Home, focus after navigation; nothing focused under the tab bar.
  await run(browser, engine, 'keyboard', async (log) => {
    const ctx = await context(browser, 'phone');
    const page = await ctx.newPage();
    watch(page, log, 'keyboard');
    await page.goto(`${BASE}#topic/small-talk`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    const focused = () => page.evaluate(() => ({ text: document.activeElement?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 40), cls: String(document.activeElement?.className ?? ''), bottom: document.activeElement?.getBoundingClientRect().bottom, tabTop: document.querySelector('.tab-bar')?.getBoundingClientRect().top }));
    const out = { order: [] };
    for (let i = 0; i < 4; i += 1) { await page.keyboard.press('Tab'); out.order.push(await focused()); }
    check(out.order[0].cls.includes('skip-link'), `first stop ${JSON.stringify(out.order[0])}`);
    check(out.order[1].cls.includes('app-header__brand'), `second stop ${JSON.stringify(out.order[1])}`);
    check(out.order[2].text === 'Practice this topic', `third stop ${JSON.stringify(out.order[2])}`);
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      const state = await focused();
      if (!state.cls.includes('tab-bar')) check(state.bottom <= state.tabTop + 1, `focused control under the tab bar: ${JSON.stringify(state)}`);
    }
    await page.evaluate(() => document.querySelector('.app-header__brand').focus());
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'Home');
    await settle(200);
    out.afterBrand = await page.evaluate(() => ({ hash: location.hash, focusOnHeading: document.activeElement === document.querySelector('main h1') }));
    check(out.afterBrand.hash === '#index' && out.afterBrand.focusOnHeading, `brand activation ${JSON.stringify(out.afterBrand)}`);
    await ctx.close();
    return out;
  });

  // 9. Enlarged text: the header grows instead of clipping; no horizontal scrolling.
  await run(browser, engine, 'enlarged-text', async (log) => {
    const ctx = await context(browser, 'phone');
    const page = await ctx.newPage();
    watch(page, log, 'enlarged-text');
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await settle(300);
    const out = {};
    for (const hash of ['index', 'topic/small-talk', 'irregularVerbs']) {
      await go(page, hash);
      out[hash] = await page.evaluate(() => {
        const header = document.querySelector('.app-header');
        const brand = document.querySelector('.app-header__brand');
        return { header: Math.round(header.getBoundingClientRect().height), clipped: header.scrollHeight > header.clientHeight + 1 || brand.scrollWidth > brand.clientWidth + 1, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      check(!out[hash].clipped && out[hash].overflow <= 0 && out[hash].header > 56, `${hash}: ${JSON.stringify(out[hash])}`);
      await page.screenshot({ path: shot(`${engine}-phone-enlarged-${hash.replace('/', '-')}`) });
    }
    await ctx.close();
    return out;
  });

  // 10. Start-up error keeps the brand without a link; v1 stays separate.
  await run(browser, engine, 'startup-and-v1', async (log) => {
    const ctx = await context(browser, 'phone');
    const page = await ctx.newPage();
    watch(page, log, 'startup-and-v1');
    failing.add('/eng-trainer/data/manifest.json');
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.error-card');
    const out = { error: await page.evaluate(() => ({ header: document.querySelector('.app-header')?.textContent.replace(/\s+/g, ' ').trim(), link: !!document.querySelector('.app-header a'), h1: document.querySelector('h1')?.textContent })) };
    failing.clear();
    check(out.error.header === 'Eng Trainer Practice English at your pace' && !out.error.link, `error screen ${JSON.stringify(out.error)}`);
    await page.screenshot({ path: shot(`${engine}-phone-content-error`) });
    await page.goto(`${BASE}v1/`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await settle(800);
    // v1 also names its root .app-shell; the v2 header and navigation column are absent there.
    out.v1 = await page.evaluate(() => ({ title: document.title, v2Header: !!document.querySelector('.app-header, .app-chrome'), v1Brand: document.body.textContent.includes('ShcherbakPro'), text: document.body.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) }));
    check(!out.v1.v2Header && out.v1.v1Brand, `v1 ${JSON.stringify(out.v1)}`);
    const v1Databases = await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map((item) => item.name) : null));
    out.v1Databases = v1Databases;
    await ctx.close();
    return out;
  });

  await browser.close();
}

server.close();
results.finishedAt = new Date().toISOString();
results.summary = Object.fromEntries(Object.entries(results.engines).map(([engine, value]) => [engine, { version: value.version, passed: Object.values(value.scenarios).filter((item) => item.pass).length, total: Object.keys(value.scenarios).length }]));
writeFileSync(join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results.summary));
