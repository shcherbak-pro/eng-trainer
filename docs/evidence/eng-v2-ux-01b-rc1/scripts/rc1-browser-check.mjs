// ENG-V2-UX-01B-RC1: native-browser checks of the F1-F5 corrections against the assembled site-dist.
// Fresh, non-persistent Chromium and Firefox contexts, synthetic data, requests to other hosts refused.
// Usage: node rc1-browser-check.mjs <playwright-node_modules> <site-dist> <output-dir>
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const [, , pwDir, siteDir, outDir] = process.argv;
const pw = createRequire(import.meta.url)(join(pwDir, 'playwright'));
mkdirSync(outDir, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/eng-trainer/__seed__') {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>seed</title>');
    return;
  }
  let path = normalize(join(siteDir, decodeURIComponent(url.pathname.slice('/eng-trainer/'.length))));
  if (!url.pathname.startsWith('/eng-trainer/') || !path.startsWith(normalize(siteDir))) { response.writeHead(404); response.end(); return; }
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  if (!existsSync(path)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  response.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(4183, '127.0.0.1', resolve));
const HOST = '127.0.0.1:4183';
const BASE = `http://${HOST}/eng-trainer/`;
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const results = { startedAt: new Date().toISOString(), base: BASE, engines: {} };
let current = '';

const packs = JSON.parse(readFileSync(join(siteDir, 'data', 'manifest.json'), 'utf8')).packs.map((pack) => JSON.parse(readFileSync(join(siteDir, 'data', pack.url ?? pack.path ?? pack.file), 'utf8')));
const phrases = packs.flatMap((pack) => pack.content?.phrases ?? []);
const [p1, p2] = phrases;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

/** Writes synthetic records straight into the v2 database (same schema as the app). */
async function seed(page, records) {
  await page.goto(`${BASE}__seed__`);
  await page.evaluate((records) => new Promise((resolve, reject) => {
    const request = indexedDB.open('eng-trainer-v2', 2);
    request.onupgradeneeded = () => {
      for (const name of ['progress', 'settings', 'learnPasses', 'flashcardSessions', 'userCollections', 'userEntries']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction([...db.objectStoreNames], 'readwrite');
      for (const [store, values] of Object.entries(records)) for (const [key, value] of Object.entries(values)) tx.objectStore(store).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(String(tx.error));
    };
    request.onerror = () => reject(String(request.error));
  }), records);
}

async function stored(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('eng-trainer-v2');
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['progress'], 'readonly');
      const keys = tx.objectStore('progress').getAllKeys();
      const values = tx.objectStore('progress').getAll();
      tx.oncomplete = () => { db.close(); resolve(Object.fromEntries(keys.result.map((key, index) => [key, values.result[index]]))); };
      tx.onerror = () => reject(String(tx.error));
    };
    request.onerror = () => reject(String(request.error));
  }));
}

async function ready(page) {
  await page.waitForSelector('.app-shell', { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await settle(200);
}

async function go(page, hash) {
  await page.evaluate((value) => { location.hash = value; }, hash);
  await page.waitForFunction((value) => location.hash === `#${value}` && document.querySelector('main h1'), hash);
  await settle(300);
}

/** What has keyboard focus, described without guessing from ARIA. */
const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return { tag: el?.tagName, id: el?.id || null, cls: String(el?.className ?? ''), label: el?.getAttribute('aria-label'), text: (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80), cardId: el?.getAttribute('data-card-id'), passDelete: el?.getAttribute('data-pass-delete') };
});

/** Focuses a control and activates it with the keyboard. */
async function press(locator, key = 'Enter') {
  await locator.focus();
  await locator.page().keyboard.press(key);
  await settle(250);
}

for (const engineName of ['chromium', 'firefox']) {
  const browser = await pw[engineName].launch({ headless: true });
  const engine = (results.engines[engineName] = { version: browser.version(), scenarios: {}, log: [] });

  async function run(name, fn, viewport = { width: 390, height: 844 }) {
    if (process.env.ONLY && !process.env.ONLY.split(',').includes(name)) return;
    current = name;
    const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce', isMobile: viewport.width < 900, hasTouch: viewport.width < 900 });
    await ctx.route((url) => url.host !== HOST, (route) => route.abort('blockedbyclient'));
    await ctx.addInitScript(() => {
      window.__rejections = [];
      addEventListener('unhandledrejection', (event) => window.__rejections.push(String(event.reason)));
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', (error) => engine.log.push({ scenario: current, type: 'pageerror', text: String(error).slice(0, 300) }));
    page.on('console', (message) => { if (message.type() === 'error') engine.log.push({ scenario: current, type: 'console', text: message.text().slice(0, 300) }); });
    page.on('request', (request) => { if (new URL(request.url()).host !== HOST && !/^(data|blob):/.test(request.url())) engine.log.push({ scenario: current, type: 'external-request', url: request.url() }); });
    const detail = {};
    try {
      await fn(page, detail);
      const rejections = await page.evaluate(() => window.__rejections);
      check(rejections.length === 0, `unhandled rejections: ${rejections.join('; ')}`);
      engine.scenarios[name] = { status: 'PASS', ...detail };
      console.log(`${engineName} PASS ${name}`);
    } catch (error) {
      engine.scenarios[name] = { status: 'FAIL', error: String(error?.stack ?? error).slice(0, 1500), ...detail };
      await page.screenshot({ path: join(outDir, `${engineName}-${name}-failure.png`) }).catch(() => {});
      console.log(`${engineName} FAIL ${name}: ${String(error).slice(0, 300)}`);
    } finally {
      await ctx.close();
    }
  }

  // F2: Learn again keeps keyboard focus in the list; Undo from the message returns it to the restored row.
  await run('f2-learn-again-focus', async (page, d) => {
    await seed(page, { progress: { learnedPhrases: [p1.id, p2.id] } });
    await page.goto(`${BASE}#flashcards`);
    await ready(page);
    await page.getByRole('button', { name: 'Review learned vocabulary (2)', exact: true }).click();
    await settle(200);
    await press(page.locator(`.learn-again[data-card-id="${p1.id}"]`));
    d.afterFirst = await focused(page);
    check(d.afterFirst.cardId === p2.id, `after Learn again: ${JSON.stringify(d.afterFirst)}`);
    await page.screenshot({ path: join(outDir, `${engineName}-learn-again-focus.png`) });
    await press(page.locator('.toast__action'));
    d.afterUndo = await focused(page);
    check(d.afterUndo.cardId === p1.id, `after Undo: ${JSON.stringify(d.afterUndo)}`);
    await press(page.locator(`.learn-again[data-card-id="${p1.id}"]`));
    await press(page.locator(`.learn-again[data-card-id="${p2.id}"]`));
    d.afterLast = await focused(page);
    check(d.afterLast.id === 'review-title', `after the last Learn again: ${JSON.stringify(d.afterLast)}`);
    await page.getByRole('button', { name: 'Back to flashcards', exact: true }).first().click();
    await settle(200);
    await press(page.locator('.toast__action'));
    d.undoWithListClosed = await focused(page);
    check(d.undoWithListClosed.text.startsWith('Review learned vocabulary'), `Undo with the list closed: ${JSON.stringify(d.undoWithListClosed)}`);
    // A message that expires never moves focus.
    await page.getByRole('button', { name: /Review learned vocabulary/ }).click();
    await settle(150);
    await page.locator(`.learn-again[data-card-id="${p2.id}"]`).click();
    await settle(150);
    await page.getByRole('button', { name: 'Back to flashcards', exact: true }).first().focus();
    await settle(6800);
    d.afterExpiry = await focused(page);
    check(d.afterExpiry.text === 'Back to flashcards' && (await page.locator('.toast').count()) === 0, `after the message expired: ${JSON.stringify(d.afterExpiry)}`);
  });

  // F2: deleting a Learn Pass removes the dialog opener; a deck reset removes its opener too.
  await run('f2-confirmation-fallbacks', async (page, d) => {
    const pass = (id, name, createdAt) => ({ id, name, blockIds: ['start-answer'], createdAt, updatedAt: createdAt });
    await seed(page, { learnPasses: { alpha: pass('alpha', 'Alpha pass', '2026-01-01'), beta: pass('beta', 'Beta pass', '2026-01-02') }, progress: { learnedPhrases: [p1.id], hiddenPhrases: [p2.id] } });
    await page.goto(`${BASE}#index`);
    await ready(page);
    await press(page.getByRole('button', { name: 'Delete Alpha pass', exact: true }));
    d.dialogStart = await focused(page);
    check(d.dialogStart.text === 'Cancel', `dialog start: ${JSON.stringify(d.dialogStart)}`);
    await page.keyboard.press('Escape');
    await settle(250);
    d.afterEscape = await focused(page);
    check(d.afterEscape.label === 'Delete Alpha pass', `after Escape: ${JSON.stringify(d.afterEscape)}`);
    await press(page.getByRole('button', { name: 'Delete Alpha pass', exact: true }));
    await press(page.locator('dialog[open] .btn--danger'));
    d.afterFirstDelete = await focused(page);
    check(d.afterFirstDelete.passDelete === 'beta', `after deleting Alpha: ${JSON.stringify(d.afterFirstDelete)}`);
    await press(page.getByRole('button', { name: 'Delete Beta pass', exact: true }));
    await press(page.locator('dialog[open] .btn--danger'));
    d.afterLastDelete = await focused(page);
    check(d.afterLastDelete.text === 'Create a Learn Pass', `after deleting the last pass: ${JSON.stringify(d.afterLastDelete)}`);

    await go(page, 'phrases');
    await press(page.getByRole('button', { name: 'Unhide all phrases', exact: true }));
    await press(page.locator('dialog[open] .btn--primary'));
    d.afterUnhideAll = await focused(page);
    check(d.afterUnhideAll.tag === 'INPUT' && (await page.evaluate(() => document.activeElement.type)) === 'search', `after Unhide all: ${JSON.stringify(d.afterUnhideAll)}`);

    await go(page, 'flashcards');
    await page.getByRole('button', { name: 'Review learned vocabulary (1)', exact: true }).click();
    await settle(200);
    await press(page.getByRole('button', { name: /Reset progress for/ }));
    await press(page.locator('dialog[open] .btn--danger'));
    d.afterDeckReset = await focused(page);
    check(d.afterDeckReset.cls.includes('flashcard__surface'), `after the deck reset: ${JSON.stringify(d.afterDeckReset)}`);
    check((await stored(page)).learnedPhrases.length === 0, 'deck reset did not clear the learned card');
  });

  // F3: a parsed file whose plan has blocking problems focuses the named issue summary.
  await run('f3-returned-issues-focus', async (page, d) => {
    const collection = 'user:11111111-1111-4111-8111-111111111111';
    const entryId = `${collection}:entry:00000000-0000-4000-8000-000000000001`;
    const entry = { id: entryId, kind: 'word', english: 'zyxwv identity', translation: 'перший', topic: '', examples: [] };
    await seed(page, {
      userCollections: { [collection]: { id: collection, name: 'Synthetic', description: '', version: 1, createdAt: '2026-11-21T00:00:00.000Z', updatedAt: '2026-11-21T00:00:00.000Z', revision: 1, lastImport: { fileName: 'synthetic.json', format: 'json', importedAt: '2026-11-21T00:00:00.000Z', added: 1, skipped: 0 } } },
      userEntries: { [entryId]: { ...entry, collectionId: collection, position: 0 } }
    });
    await page.goto(`${BASE}#collections`);
    await ready(page);
    const choose = async (name, text) => {
      await page.locator('#import-file').setInputFiles({ name, mimeType: name.endsWith('.json') ? 'application/json' : 'text/csv', buffer: Buffer.from(text) });
      await settle(350);
    };
    d.cases = {};
    const conflict = JSON.stringify({ format: 'eng-trainer-vocabulary', version: 1, collection: { id: collection, name: 'Synthetic', description: '' }, entries: [{ ...entry, translation: 'інший' }] });
    for (const [label, name, text] of [
      ['missing translation', 'invalid-record.csv', 'english,translation\ninvalid,'],
      ['invalid kind', 'invalid-kind.csv', 'english,translation,kind\nfirst,one,noun'],
      ['native identity conflict', 'conflict.json', conflict]
    ]) {
      await choose(name, text);
      const state = await page.evaluate(() => {
        const el = document.activeElement;
        const labelledBy = el?.getAttribute('aria-labelledby');
        return { cls: String(el?.className ?? ''), name: labelledBy ? document.getElementById(labelledBy)?.textContent : null, role: el?.getAttribute('role'), tabindex: el?.getAttribute('tabindex') };
      });
      d.cases[label] = state;
      check(state.cls.includes('review__problems') && state.name === 'Nothing can be imported until these problems are fixed in the file:', `${label}: ${JSON.stringify(state)}`);
      if (label === 'missing translation') await page.screenshot({ path: join(outDir, `${engineName}-issue-summary-focus.png`) });
      await page.getByRole('button', { name: 'Cancel import', exact: true }).click();
      await settle(150);
    }
    await choose('valid.csv', 'english,translation\nzyxwv valid,дійсне\nzyxwv valid,інше');
    d.cases.valid = await focused(page);
    check(d.cases.valid.id === 'review-title', `valid preview with duplicates: ${JSON.stringify(d.cases.valid)}`);
    await choose('missing.csv', 'english,meaning\nx,y');
    d.cases.wholeFile = await focused(page);
    check(d.cases.wholeFile.cls.includes('notice--error') && !d.cases.wholeFile.cls.includes('review__problems'), `whole-file error: ${JSON.stringify(d.cases.wholeFile)}`);
  });

  // F4: the renamed family is really used (no silent fallback) for English, Ukrainian and IPA text.
  await run('f4-font-family-loaded', async (page, d) => {
    const fontRequests = [];
    page.on('requestfinished', (request) => { if (request.resourceType() === 'font') fontRequests.push(request.url().split('/').pop()); });
    await page.goto(`${BASE}#wordIndex`);
    await ready(page);
    await page.evaluate(() => {
      const probe = document.createElement('p');
      probe.id = 'font-probe';
      probe.textContent = 'English іїєґ ʼ ɪəˈːʊðɑæʃɔɜʌɡˌŋʒ θ';
      probe.style.fontFamily = 'var(--font-ui)';
      document.querySelector('main').append(probe);
    });
    d.faces = await page.evaluate(async () => {
      await document.fonts.load('400 40px "Eng Trainer Sans"', 'English іїєґ ʼ ɪəˈːʊðɑæʃɔɜʌɡˌŋʒ θ');
      await document.fonts.ready;
      return [...document.fonts].filter((face) => /Trainer|Source/.test(face.family)).map((face) => ({ family: face.family, status: face.status, unicodeRange: face.unicodeRange.slice(0, 40) }));
    });
    check(d.faces.length === 4 && d.faces.every((face) => face.family.replace(/"/g, '') === 'Eng Trainer Sans'), `declared faces: ${JSON.stringify(d.faces)}`);
    check(d.faces.every((face) => face.status === 'loaded'), `not every subset loaded: ${JSON.stringify(d.faces)}`);
    d.glyphs = await page.evaluate(() => {
      const chars = 'English іїєґІЇЄҐʼɪəˈːʊðɑæʃɔɜʌɡˌŋʒθ';
      const context = document.createElement('canvas').getContext('2d');
      const missing = [];
      for (const ch of chars) {
        const widths = ['monospace', 'serif', 'cursive'].map((fallback) => { context.font = `40px "Eng Trainer Sans", ${fallback}`; return context.measureText(ch).width; });
        if (Math.max(...widths) - Math.min(...widths) > 0.01) missing.push(ch);
      }
      return { chars, missing };
    });
    check(d.glyphs.missing.length === 0, `characters falling back: ${d.glyphs.missing.join(' ')}`);
    d.reservedFamilyDeclared = await page.evaluate(() => [...document.fonts].some((face) => face.family.replace(/"/g, '') === 'Source Sans 3'));
    check(!d.reservedFamilyDeclared, 'a "Source Sans 3" face is still declared');
    d.bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    // Chromium serializes the family with quotes, Firefox without.
    check(d.bodyFont.replace(/["']/g, '').startsWith('Eng Trainer Sans,'), `body font: ${d.bodyFont}`);
    d.fontRequests = fontRequests;
    check(fontRequests.length > 0 && fontRequests.every((name) => /^(eng-trainer-sans|literata)-/.test(name)), `font requests: ${fontRequests.join(', ')}`);
    await page.locator('#font-probe').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(outDir, `${engineName}-font-sample.png`), clip: await page.locator('#font-probe').boundingBox().then((box) => ({ x: 0, y: Math.max(0, box.y - 260), width: 390, height: 320 })) });
  });

  // F5: effective language of block descriptions and the translation opt-out of English study text.
  await run('f5-language-and-translation', async (page, d) => {
    await seed(page, { progress: { favoriteBlocks: ['irregular-verbs-100', 'start-answer'] } });
    await page.goto(`${BASE}#favorites`);
    await ready(page);
    const effective = (selector) => page.locator(selector).evaluateAll((elements) => elements.map((el) => ({ text: el.textContent.trim().slice(0, 50), lang: el.closest('[lang]')?.getAttribute('lang') ?? null, translate: el.translate })));
    d.focusBlocks = await effective('.block-row .block-row__meta');
    const byStart = (rows, start) => rows.find((row) => row.text.startsWith(start));
    check(byStart(d.focusBlocks, '100 popular irregular verbs')?.lang === 'en', `Focus, English description: ${JSON.stringify(d.focusBlocks)}`);
    check(byStart(d.focusBlocks, 'Початок відповіді')?.lang === 'uk', `Focus, Ukrainian description: ${JSON.stringify(d.focusBlocks)}`);
    await go(page, 'index');
    d.homeBlocks = await effective('.block-row .block-row__meta:last-child');
    check(byStart(d.homeBlocks, 'Початок відповіді')?.lang === 'uk', `Home, Ukrainian description: ${JSON.stringify(d.homeBlocks.slice(0, 3))}`);
    await go(page, 'answers');
    d.answers = await effective('.reading-card h2');
    check(d.answers.length > 0 && d.answers.every((item) => item.translate === false && item.lang === 'en'), `Answers questions: ${JSON.stringify(d.answers[0])}`);
    d.answersIntro = await effective('main .page-stack > p.muted');
    check(d.answersIntro[0].translate === true, 'Answers introduction must stay translatable');
    await go(page, 'practice');
    d.hint = await effective('.prompt-card__text');
    check(d.hint[0].translate === true, 'the prompt hint must stay translatable');
    await page.getByRole('button', { name: 'Random prompt', exact: true }).click();
    await settle(150);
    d.prompt = await effective('.prompt-card__text');
    d.prompts = await effective('.drill-list li');
    check(d.prompt[0].translate === false && d.prompt[0].lang === 'en', `current prompt: ${JSON.stringify(d.prompt)}`);
    check(d.prompts.length > 0 && d.prompts.every((item) => item.translate === false && item.lang === 'en'), 'All prompts must be protected');
    await go(page, 'reverse');
    d.reverse = await effective('.reverse-card__prompt');
    check(d.reverse[0].translate === false, `reverse prompt: ${JSON.stringify(d.reverse)}`);
    await go(page, 'collections');
    await page.locator('#import-file').setInputFiles({ name: 'examples.csv', mimeType: 'text/csv', buffer: Buffer.from('english,translation,example\nzyxwv ownership,відповідальність,I take ownership of it.') });
    await settle(350);
    d.preview = await page.locator('.review__extra').evaluateAll((elements) => elements.filter((el) => el.textContent.includes('Example:')).map((el) => {
      const example = [...el.querySelectorAll('span')].find((span) => span.textContent === 'I take ownership of it.');
      return { label: el.translate, example: example?.translate, exampleLang: example?.closest('[lang]')?.getAttribute('lang') };
    }));
    check(d.preview[0]?.label === true && d.preview[0]?.example === false && d.preview[0]?.exampleLang === 'en', `import preview: ${JSON.stringify(d.preview)}`);
  });

  await browser.close();
}

server.close();
results.finishedAt = new Date().toISOString();
writeFileSync(join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(results.engines).map(([name, data]) => [name, { version: data.version, pass: Object.values(data.scenarios).filter((s) => s.status === 'PASS').length, fail: Object.values(data.scenarios).filter((s) => s.status === 'FAIL').length, log: data.log.length }]))));
