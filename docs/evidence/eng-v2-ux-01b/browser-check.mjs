// ENG-V2-UX-01B browser verification of the combined local build (site-dist), in Chromium and Firefox.
// Every scenario uses a fresh, non-persistent context and synthetic data. Usage:
//   node browser-check.mjs <playwright-node_modules> <site-dist> <output-dir>
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const [, , pwDir, siteDir, outDir] = process.argv;
const require = createRequire(import.meta.url);
const pw = require(join(pwDir, 'playwright'));
mkdirSync(join(outDir, 'shots'), { recursive: true });

// ---------------------------------------------------------------- static server for /eng-trainer/
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png' };
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/eng-trainer/__seed__') {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>seed</title>');
    return;
  }
  if (!url.pathname.startsWith('/eng-trainer/')) { response.writeHead(404); response.end(); return; }
  let path = normalize(join(siteDir, decodeURIComponent(url.pathname.slice('/eng-trainer/'.length))));
  if (!path.startsWith(normalize(siteDir))) { response.writeHead(403); response.end(); return; }
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  if (!existsSync(path)) { response.writeHead(404); response.end('not found'); return; }
  response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  response.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(4179, '127.0.0.1', resolve));
const BASE = 'http://127.0.0.1:4179/eng-trainer/';

const results = { startedAt: new Date().toISOString(), base: BASE, engines: {}, errors: [] };
const shot = (name) => join(outDir, 'shots', `${name}.png`);
const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  narrow: { viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true },
  desktop: { viewport: { width: 1440, height: 900 } }
};
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

// Optional: ONLY=name,name runs just those scenarios (the measurements run only in a full run).
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
let currentScenario = '';

const LOCAL_HOST = '127.0.0.1:4179';
const isExternal = (url) => !/^(data|blob|about):/.test(url) && new URL(url).host !== LOCAL_HOST;

/** Keeps a context hermetic: requests to any other host are refused (and recorded by watch()). */
async function isolate(ctx) {
  await ctx.route((url) => url.host !== LOCAL_HOST, (route) => route.abort('blockedbyclient'));
  return ctx;
}

// Every page error, console error, failed request and request to another host is recorded with the scenario that caused it.
function watch(page, log) {
  page.on('request', (request) => { if (isExternal(request.url())) log.push({ scenario: currentScenario, type: 'external-request', url: request.url() }); });
  page.on('pageerror', (error) => log.push({ scenario: currentScenario, type: 'pageerror', text: String(error).slice(0, 300) }));
  page.on('console', (message) => { if (message.type() === 'error') log.push({ scenario: currentScenario, type: 'console', text: message.text().slice(0, 300) }); });
  page.on('requestfailed', (request) => { if (!isExternal(request.url())) log.push({ scenario: currentScenario, type: 'requestfailed', url: request.url(), reason: request.failure()?.errorText }); });
}

async function ready(page) {
  await page.waitForSelector('.app-shell', { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await settle(200);
}

async function go(page, hash) {
  await page.evaluate((value) => { window.location.hash = value; }, hash);
  await page.waitForFunction((value) => document.querySelector('main h1') && window.location.hash === `#${value}`, hash);
  await settle(250);
}

/**
 * Visible interactive elements whose target is smaller than 44 x 44 px (the project requirement).
 * The target of an input inside a label, or of a file input with a label, is that label. Links inside
 * running text are exempt, as is the skip link while it is off-screen. Runs in the page.
 */
function SMALL_TARGETS(scopeSelector) {
  const scope = document.querySelector(scopeSelector) ?? document.body;
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
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
const smallTargets = (page, scope = 'body') => page.evaluate(SMALL_TARGETS, scope);
async function expectTargets(page, scope, what) {
  const undersized = await smallTargets(page, scope);
  if (undersized.length) throw new Error(`${what}: targets under 44 px: ${undersized.join('; ')}`);
}

async function metrics(page) {
  const undersized = await smallTargets(page);
  const measured = await page.evaluate(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const first = document.querySelector('main .entry, main .empty-state, main .import-panel, main .flashcard-stage, main .reading-card, main .prompt-card, main .reverse-card, main .panel, main .expansion-panel');
    const tabBar = document.querySelector('.tab-bar');
    const tabTop = tabBar && visible(tabBar) ? tabBar.getBoundingClientRect().top : innerHeight;
    const focusables = [...document.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && visible(el) && !el.closest('dialog:not([open])'));
    const clipped = [...document.querySelectorAll('main button, main a, main .entry__term, main h1, main h2')].filter((el) => visible(el) && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible');
    return {
      viewport: { width: innerWidth, height: innerHeight },
      firstContentTop: first ? Math.round(first.getBoundingClientRect().top + scrollY) : null,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tabBarTop: Math.round(tabTop),
      focusables: focusables.length,
      clipped: clipped.length,
      // Icon-only buttons must stay square or round, never stretched by their row.
      stretchedIconButtons: [...document.querySelectorAll('.btn--icon')].filter((el) => visible(el) && el.getBoundingClientRect().height > 60).length,
      h1: document.querySelector('main h1')?.textContent ?? null,
      h1Count: document.querySelectorAll('h1').length,
      h1InsideMain: !!document.querySelector('main h1'),
      googleFonts: [...document.querySelectorAll('link[href]')].some((link) => /fonts\.(googleapis|gstatic)/.test(link.href)),
      fonts: { literata: document.fonts.check('16px "Literata"'), sourceSans: document.fonts.check('16px "Source Sans 3"') }
    };
  });
  return { ...measured, targetsUnder44: undersized.length, undersizedTargets: undersized.slice(0, 12) };
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
        tx.addEventListener('complete', () => {});
        values.onsuccess = () => { out[name] = Object.fromEntries(keys.result.map((key, index) => [key, values.result[index]])); };
      }
      tx.oncomplete = () => { db.close(); resolve(out); };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  }));
}

async function run(engineName, name, fn) {
  if (ONLY && !ONLY.includes(name)) return;
  currentScenario = name;
  const started = Date.now();
  try {
    results.engines[engineName].scenarios[name] = { status: 'PASS', ...(await fn()), ms: Date.now() - started };
    console.log(`${engineName} PASS ${name}`);
  } catch (error) {
    results.engines[engineName].scenarios[name] = { status: 'FAIL', error: String(error?.stack ?? error).slice(0, 1200), ms: Date.now() - started };
    console.log(`${engineName} FAIL ${name}: ${String(error).slice(0, 300)}`);
  }
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const CSV_VALID = 'english,translation,topic,example,kind\nzyxwv ownership,брати відповідальність,Synthetic,"I take ownership, always.",phrase\nzyxwv reliable,надійний,Synthetic,,word';

for (const engineName of ['chromium', 'firefox']) {
  const browser = await pw[engineName].launch({ headless: true });
  results.engines[engineName] = { version: browser.version(), scenarios: {}, log: [] };
  const log = results.engines[engineName].log;
  const context = async (kind, extra = {}) => {
    const ctx = await isolate(await browser.newContext({ ...VIEWPORTS[kind], reducedMotion: 'reduce', acceptDownloads: true, ...extra }));
    ctx.on('page', (page) => watch(page, log));
    return ctx;
  };

  // 1. Layout survey: three viewports, both themes, every main screen.
  for (const [kind, schemes] of [['phone', ['light', 'dark']], ['narrow', ['light', 'dark']], ['desktop', ['light', 'dark']]]) {
    for (const scheme of schemes) {
      await run(engineName, `layout-${kind}-${scheme}`, async () => {
        const ctx = await context(kind, { colorScheme: scheme });
        const page = await ctx.newPage();
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await ready(page);
        const pages = {};
        // Every screen of the app.
        for (const hash of ['index', 'phrases', 'wordIndex', 'irregularVerbs', 'patterns', 'answers', 'flashcards', 'reverse', 'practice', 'favorites', 'collections', 'settings']) {
          await go(page, hash);
          pages[hash] = await metrics(page);
          if (kind === 'phone' && scheme === 'light') {
            mkdirSync(join(outDir, 'aria'), { recursive: true });
            writeFileSync(join(outDir, 'aria', `${engineName}-${hash}.yml`), await page.locator('body').ariaSnapshot());
          }
          if (engineName === 'chromium' || kind !== 'narrow') await page.screenshot({ path: shot(`${engineName}-${kind}-${scheme}-${hash}`) });
          check(pages[hash].horizontalOverflow <= 0, `${hash}: horizontal overflow ${pages[hash].horizontalOverflow}px`);
          check(pages[hash].h1Count === 1 && pages[hash].h1InsideMain, `${hash}: expected one h1 inside main`);
          check(!pages[hash].googleFonts, `${hash}: Google Fonts link present`);
          check(pages[hash].stretchedIconButtons === 0, `${hash}: ${pages[hash].stretchedIconButtons} stretched icon buttons`);
          check(pages[hash].targetsUnder44 === 0, `${hash}: targets under 44 px: ${pages[hash].undersizedTargets.join('; ')}`);
        }
        if (kind === 'phone') {
          // First study content within 250 px of the top on every study screen (Home and Settings are not study content).
          for (const hash of ['phrases', 'wordIndex', 'irregularVerbs', 'patterns', 'answers', 'flashcards', 'reverse', 'practice', 'favorites', 'collections']) {
            check(pages[hash].firstContentTop !== null && pages[hash].firstContentTop <= 250, `${hash}: first content at ${pages[hash].firstContentTop}px`);
          }
        }
        await ctx.close();
        return { pages };
      });
    }
  }

  // 2. Flashcard answers are reachable without scrolling.
  await run(engineName, 'flashcard-answers-reachable', async () => {
    const out = {};
    for (const kind of ['phone', 'desktop']) {
      const ctx = await context(kind, { colorScheme: 'light' });
      const page = await ctx.newPage();
      await page.goto(`${BASE}#flashcards`, { waitUntil: 'domcontentloaded' });
      await ready(page);
      const box = await page.locator('.flashcard-actions').boundingBox();
      const limit = await page.evaluate(() => { const bar = document.querySelector('.tab-bar'); return bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : innerHeight; });
      out[kind] = { actionsBottom: Math.round(box.y + box.height), visibleLimit: Math.round(limit) };
      check(box.y + box.height <= limit, `${kind}: answer buttons end at ${box.y + box.height}, visible area ends at ${limit}`);
      await page.screenshot({ path: shot(`${engineName}-${kind}-flashcards-front`) });
      await page.getByRole('button', { name: /Front of the card/ }).click();
      await settle(300);
      await page.screenshot({ path: shot(`${engineName}-${kind}-flashcards-back`) });
      await ctx.close();
    }
    return out;
  });

  // 3. Reflow with large text at 320 px, and fonts that are slow or missing.
  await run(engineName, 'reflow-large-text-and-font-fallbacks', async () => {
    const out = {};
    const ctx = await context('narrow', { colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}#phrases`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    for (const hash of ['phrases', 'collections', 'flashcards', 'settings']) {
      await go(page, hash);
      const m = await metrics(page);
      // Tab bar labels stay inside their own columns, and the space kept free matches the (taller) bar.
      const bar = await page.evaluate(() => {
        const labels = [...document.querySelectorAll('.tab-bar__label')].map((label) => {
          const r = label.getBoundingClientRect();
          const cell = label.closest('.tab-bar__item').getBoundingClientRect();
          return r.left >= cell.left - 1 && r.right <= cell.right + 1;
        });
        const tabBar = document.querySelector('.tab-bar');
        return {
          labelsInside: labels.every(Boolean),
          height: tabBar.offsetHeight,
          reserved: parseFloat(getComputedStyle(document.querySelector('.page-wrap')).paddingBottom),
          scrollPadding: parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom)
        };
      });
      out[`text200-${hash}`] = { overflow: m.horizontalOverflow, clipped: m.clipped, tabBar: bar };
      check(m.horizontalOverflow <= 0, `200% text ${hash}: overflow ${m.horizontalOverflow}`);
      check(bar.labelsInside, `200% text ${hash}: tab bar labels run into each other`);
      check(bar.reserved >= bar.height && bar.scrollPadding >= bar.height, `200% text ${hash}: ${bar.height}px tab bar, ${bar.reserved}px kept free, ${bar.scrollPadding}px scroll padding`);
    }
    await page.screenshot({ path: shot(`${engineName}-narrow-text200-settings`) });
    await ctx.close();

    for (const mode of ['slow', 'failed']) {
      const fctx = await context('phone', { colorScheme: 'light' });
      await fctx.route('**/*.woff2', async (route) => {
        if (mode === 'failed') return route.abort();
        await settle(5000);
        return route.continue();
      });
      const fpage = await fctx.newPage();
      await fpage.goto(`${BASE}#phrases`, { waitUntil: 'domcontentloaded' });
      await fpage.waitForSelector('.app-shell', { timeout: 30000 });
      await settle(400);
      const m = await fpage.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        firstEntry: Math.round(document.querySelector('.entry').getBoundingClientRect().top),
        termText: document.querySelector('.entry__term').textContent
      }));
      out[`fonts-${mode}`] = m;
      check(m.overflow <= 0 && m.termText.length > 0, `fonts ${mode}: layout broken`);
      if (engineName === 'chromium') {
        const cdp = await fctx.newCDPSession(fpage);
        const image = await cdp.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(shot(`${engineName}-phone-fonts-${mode}`), Buffer.from(image.data, 'base64'));
      }
      await fctx.close();
    }
    return out;
  });

  // 4. Keyboard: skip link, focus never under the tab bar, More sheet.
  await run(engineName, 'keyboard-and-focus', async () => {
    const ctx = await isolate(await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', reducedMotion: 'reduce' }));
    ctx.on('page', (page) => watch(page, log));
    const page = await ctx.newPage();
    await page.goto(`${BASE}#phrases`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await page.keyboard.press('Tab');
    const skip = await page.evaluate(() => ({ text: document.activeElement?.textContent, visible: document.activeElement?.getBoundingClientRect().top >= 0 }));
    check(skip.text === 'Skip to content', 'first Tab should reach the skip link');
    await page.keyboard.press('Enter');
    const afterSkip = await page.evaluate(() => document.activeElement?.id);
    check(afterSkip === 'main', 'Enter on the skip link should focus main');
    let obscured = 0;
    let reachedEntry = 0;
    for (let index = 0; index < 60; index += 1) {
      await page.keyboard.press('Tab');
      const state = await page.evaluate(() => {
        const el = document.activeElement;
        // After the last control, focus leaves the page (the body is active): that is not a covered control.
        const inPage = el && el !== document.body && el !== document.documentElement;
        const bar = document.querySelector('.tab-bar').getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return { covered: inPage && !el.closest('.tab-bar') && r.bottom > bar.top + 1 && r.top < bar.bottom, inEntry: !!el.closest('.entry'), ring: getComputedStyle(el).outlineStyle };
      });
      if (state.covered) obscured += 1;
      if (state.inEntry && !reachedEntry) {
        reachedEntry = index + 1;
        await page.screenshot({ path: shot(`${engineName}-phone-keyboard-focus`) });
      }
    }
    check(obscured === 0, `${obscured} focus positions under the tab bar`);
    check(reachedEntry > 0 && reachedEntry <= 20, `first entry control after ${reachedEntry} Tab presses`);
    // The same rule on the other long screens: Tab from the screen heading through 50 controls.
    const obscuredByScreen = {};
    for (const hash of ['wordIndex', 'irregularVerbs', 'patterns', 'favorites', 'collections', 'settings']) {
      await go(page, hash);
      let covered = 0;
      for (let index = 0; index < 50; index += 1) {
        await page.keyboard.press('Tab');
        covered += await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body || el.closest('.tab-bar')) return 0;
          const bar = document.querySelector('.tab-bar').getBoundingClientRect();
          const r = el.getBoundingClientRect();
          return r.bottom > bar.top + 1 && r.top < bar.bottom ? 1 : 0;
        });
      }
      obscuredByScreen[hash] = covered;
    }
    check(Object.values(obscuredByScreen).every((count) => count === 0), `focus under the tab bar: ${JSON.stringify(obscuredByScreen)}`);
    await go(page, 'phrases');
    // Focus ring on a list button.
    const ring = await page.evaluate(() => { const el = document.querySelector('.entry button'); el.focus(); const s = getComputedStyle(el); return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`; });
    // Hiding with the keyboard keeps the place: focus moves to the next entry; Undo brings it back to the restored one.
    const titles = await page.locator('.phrase-card h3').allTextContents();
    await page.locator('.phrase-card').first().getByRole('button', { name: 'Hide item' }).focus();
    await page.keyboard.press('Enter');
    await settle(300);
    const afterHide = await page.evaluate(() => ({ label: document.activeElement?.getAttribute('aria-label'), entry: document.activeElement?.closest('.phrase-card')?.querySelector('h3')?.textContent }));
    check(afterHide.label === 'Hide item' && afterHide.entry === titles[1], `focus after hiding: ${JSON.stringify(afterHide)}`);
    await page.locator('.toast__action').focus();
    await page.keyboard.press('Enter');
    await settle(300);
    const afterUndo = await page.evaluate(() => ({ label: document.activeElement?.getAttribute('aria-label'), entry: document.activeElement?.closest('.phrase-card')?.querySelector('h3')?.textContent }));
    check(afterUndo.label === 'Hide item' && afterUndo.entry === titles[0], `focus after Undo: ${JSON.stringify(afterUndo)}`);
    // More sheet: button semantics, Escape closes and returns focus.
    await page.locator('.tab-bar button').focus();
    await page.keyboard.press('Enter');
    await settle(200);
    const sheetOpen = await page.evaluate(() => ({ expanded: document.querySelector('.tab-bar button').getAttribute('aria-expanded'), open: document.querySelector('#more-sheet').open }));
    check(sheetOpen.expanded === 'true' && sheetOpen.open, 'More sheet should open');
    await expectTargets(page, '#more-sheet', `${engineName} More sheet`);
    await page.screenshot({ path: shot(`${engineName}-phone-more-sheet`) });
    await page.keyboard.press('Escape');
    await settle(200);
    const afterEscape = await page.evaluate(() => ({ expanded: document.querySelector('.tab-bar button').getAttribute('aria-expanded'), focus: document.activeElement?.textContent?.trim() }));
    check(afterEscape.expanded === 'false' && afterEscape.focus?.startsWith('More'), 'Escape should close the sheet and return focus to More');
    await ctx.close();
    return { skip, reachedEntry, obscured, obscuredByScreen, ring, afterHide, afterUndo, afterEscape };
  });

  // 5. Reduced motion is honoured.
  await run(engineName, 'reduced-motion', async () => {
    const ctx = await context('phone', { colorScheme: 'light', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}#flashcards`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    const durations = await page.evaluate(() => ({
      swipe: getComputedStyle(document.querySelector('.flashcard-swipe')).transitionDuration,
      inner: getComputedStyle(document.querySelector('.flashcard__inner')).transitionDuration,
      button: getComputedStyle(document.querySelector('.btn')).transitionDuration
    }));
    const before = await page.locator('.flashcard__term').textContent();
    await page.getByRole('button', { name: 'Keep learning' }).click();
    await settle(30);
    const after = await page.locator('.flashcard__term').textContent();
    check(before !== after, 'with reduced motion the next card should appear at once');
    for (const value of Object.values(durations)) check(parseFloat(value) < 0.01, `transition ${value}`);
    await ctx.close();
    return { durations };
  });

  // 6. Import guidance, F3, F6, reimport no-op, F5 conflict near the form.
  await run(engineName, 'collections-import-journey', async () => {
    const ctx = await context('phone', { colorScheme: 'light' });
    // The clipboard is replaced inside the page, so the system clipboard is never touched.
    await ctx.addInitScript(() => {
      window.__copied = [];
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.__copied.push(text); } }, configurable: true });
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}#collections`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    const out = {};
    const example = await page.locator('.help-card pre').first().textContent();
    out.example = example;
    await page.getByRole('button', { name: 'Copy example' }).click();
    await settle(200);
    out.copyStatus = await page.locator('.help-card__status').textContent();
    out.copied = await page.evaluate(() => window.__copied);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV template' }).first().click();
    const template = await downloadPromise;
    const templatePath = await template.path();
    const templateBytes = readFileSync(templatePath);
    out.template = { name: template.suggestedFilename(), bom: templateBytes[0] === 0xef && templateBytes[1] === 0xbb && templateBytes[2] === 0xbf, sameText: templateBytes.toString('utf8').replace(/^﻿/, '') === example };
    check(out.template.sameText && out.template.bom, 'template differs from the displayed example');
    check(out.copied.length === 1 && out.copied[0] === example && out.copyStatus === 'Example copied.', 'copied text differs from the displayed example');
    await page.locator('.help-details summary').click();
    await page.screenshot({ path: shot(`${engineName}-phone-collections-help`), fullPage: true });
    await expectTargets(page, '.help-card', `${engineName} import help`);
    await page.locator('.help-details summary').click();
    const storesBefore = await readStores(page);
    check(Object.keys(storesBefore.userCollections ?? {}).length === 0, 'help actions must not create collections');

    // F3 through the keyboard file chooser: an invalid file first.
    await page.locator('#import-file').focus();
    let chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Space');
    await (await chooser).setFiles({ name: 'missing.csv', mimeType: 'text/csv', buffer: Buffer.from('english,meaning\nx,y', 'utf8') });
    await page.waitForSelector('.notice--error[role="alert"]');
    await settle(200);
    out.afterError = await page.evaluate(() => ({ focus: document.activeElement?.className, title: document.querySelector('.notice--error .notice__title')?.textContent, inputCleared: document.querySelector('#import-file').value === '' }));
    check(String(out.afterError.focus).includes('notice'), `focus after error: ${out.afterError.focus}`);
    check(out.afterError.inputCleared, 'the file input keeps the old value, so the same corrected file could not be chosen again');
    await page.screenshot({ path: shot(`${engineName}-phone-collections-error`) });
    await expectTargets(page, 'main', `${engineName} import error`);

    await page.locator('#import-file').focus();
    chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Space');
    await (await chooser).setFiles({ name: 'Мої слова.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV_VALID, 'utf8') });
    await page.waitForSelector('#review-title');
    await settle(200);
    out.afterPreview = await page.evaluate(() => document.activeElement?.id);
    check(out.afterPreview === 'review-title', `focus after preview: ${out.afterPreview}`);
    check(Object.keys((await readStores(page)).userEntries ?? {}).length === 0, 'preview must not write');
    await page.screenshot({ path: shot(`${engineName}-phone-collections-review`), fullPage: true });

    await page.getByRole('button', { name: 'Import 2 entries' }).click();
    await page.waitForSelector('.notice--success');
    await settle(200);
    out.afterImport = await page.evaluate(() => ({ focus: document.activeElement?.className, text: document.querySelector('.notice--success')?.textContent?.replace(/\s+/g, ' ') }));

    const exportPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JSON: Мої слова' }).click();
    const exported = await exportPromise;
    out.exportName = exported.suggestedFilename();
    check(/^Мої-слова-\d{4}-\d{2}-\d{2}\.json$/.test(out.exportName), `export name ${out.exportName}`);
    const exportedPath = await exported.path();

    // Native reimport of the export is a no-op.
    const before = await readStores(page);
    await page.locator('#import-file').setInputFiles({ name: out.exportName, mimeType: 'application/json', buffer: readFileSync(exportedPath) });
    await page.waitForSelector('#review-title');
    await page.getByRole('button', { name: 'Confirm import' }).click();
    await page.waitForSelector('.notice--success');
    out.reimport = (await page.locator('.notice--success').first().textContent()).replace(/\s+/g, ' ');
    const after = await readStores(page);
    check(JSON.stringify(before.userEntries) === JSON.stringify(after.userEntries), 'reimport changed entries');

    // F5: another tab renames the collection first.
    const other = await ctx.newPage();
    await other.goto(`${BASE}#collections`, { waitUntil: 'domcontentloaded' });
    await ready(other);
    await other.getByRole('button', { name: 'Rename Мої слова' }).click();
    await other.locator('.rename-form input').fill('Renamed in tab B');
    await other.getByRole('button', { name: 'Save name' }).click();
    await other.waitForSelector('.collections-message');
    await other.close();
    await page.bringToFront();
    await page.getByRole('button', { name: 'Rename Мої слова' }).click();
    await page.locator('.rename-form input').fill('Renamed in tab A');
    await page.getByRole('button', { name: 'Save name' }).click();
    await page.waitForSelector('.rename-form .notice--error');
    out.conflict = (await page.locator('.rename-form .notice--error').textContent()).replace(/\s+/g, ' ');
    check(/changed in another tab/.test(out.conflict) && !/storage space/i.test(out.conflict), `conflict copy: ${out.conflict}`);
    check(await page.getByRole('button', { name: 'Reload page' }).count() === 1, 'reload action missing');
    await page.locator('.rename-form').scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot(`${engineName}-phone-collections-conflict`) });

    // Removal needs confirmation; Cancel keeps everything.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready(page);
    const beforeRemove = await readStores(page);
    await page.getByRole('button', { name: 'Remove Renamed in tab B' }).click();
    await settle(200);
    await page.screenshot({ path: shot(`${engineName}-phone-collections-remove-dialog`) });
    await expectTargets(page, 'dialog[open]', `${engineName} Remove dialog`);
    await page.getByRole('button', { name: 'Cancel' }).click();
    check(JSON.stringify(await readStores(page)) === JSON.stringify(beforeRemove), 'cancelled removal changed data');
    await page.getByRole('button', { name: 'Remove Renamed in tab B' }).click();
    await page.getByRole('button', { name: 'Remove collection' }).click();
    await page.waitForSelector('.collections-message');
    out.removed = Object.keys((await readStores(page)).userCollections ?? {}).length === 0;
    await ctx.close();
    return out;
  });

  // 7. F4: blocked upgrade, waiting guidance, check again, automatic recovery, continue without saving.
  for (const choice of ['wait', 'continue']) {
    await run(engineName, `blocked-upgrade-${choice}`, async () => {
      const ctx = await context('phone', { colorScheme: 'light' });
      const holder = await ctx.newPage();
      await holder.goto(`${BASE}__seed__`);
      await holder.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open('eng-trainer-v2', 1);
        request.onupgradeneeded = () => { for (const name of ['progress', 'learnPasses', 'flashcardSessions', 'settings']) request.result.createObjectStore(name); };
        request.onsuccess = () => { window.held = request.result; resolve(); };
        request.onerror = () => reject(request.error);
      }));
      const app = await ctx.newPage();
      await app.goto(BASE, { waitUntil: 'domcontentloaded' });
      await app.waitForSelector('text=Close other eng-trainer tabs', { timeout: 20000 });
      await app.getByRole('button', { name: 'Check again' }).click();
      await app.getByRole('button', { name: 'Check again' }).click();
      await settle(400);
      const waiting = (await app.locator('main').textContent()).replace(/\s+/g, ' ');
      check(waiting.includes('Still waiting for the other tabs to close.'), 'guidance lost after Check again');
      await app.screenshot({ path: shot(`${engineName}-phone-blocked-${choice}`) });
      await expectTargets(app, 'body', `${engineName} blocked-upgrade screen`);
      let outcome;
      if (choice === 'wait') {
        await holder.evaluate(() => window.held.close());
        await app.waitForSelector('.app-shell', { timeout: 15000 });
        outcome = { recovered: true, savingOff: await app.locator('.storage-notice').count() };
        check(outcome.savingOff === 0, 'recovered app should save');
      } else {
        await app.getByRole('button', { name: 'Continue without saving' }).click();
        await app.waitForSelector('.app-shell');
        await holder.evaluate(() => window.held.close());
        await settle(800);
        outcome = { notice: (await app.locator('.storage-notice').textContent()).replace(/\s+/g, ' ') };
        check(outcome.notice.includes('Saving is off'), 'late connection replaced continue-without-saving');
        await app.evaluate(() => { window.location.hash = 'phrases'; });
        await app.waitForSelector('.phrase-card');
        await app.locator('.phrase-card button[aria-label="Mark as learned"]').first().click();
        await settle(400);
        const stores = await readStores(app);
        outcome.progressWritten = Object.keys(stores.progress ?? {}).length;
        check(outcome.progressWritten === 0, 'changes were saved although saving was off');
      }
      await ctx.close();
      return { waiting: waiting.slice(0, 160), ...outcome };
    });
  }

  // 8. Safeguards: Hide/Undo, Unhide all confirmation, Reset in Settings.
  await run(engineName, 'safeguards', async () => {
    const ctx = await context('desktop', { colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}#phrases`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    const first = page.locator('.phrase-card').first();
    const term = await first.locator('h3').textContent();
    await first.getByRole('button', { name: 'Mark as learned' }).click();
    await first.getByRole('button', { name: 'Add to Focus List' }).click();
    await page.locator('.phrase-card').nth(1).getByRole('button', { name: 'Hide item' }).click();
    await first.getByRole('button', { name: 'Hide item' }).click();
    await settle(200);
    await page.screenshot({ path: shot(`${engineName}-desktop-hide-undo-toast`) });
    await expectTargets(page, '.toast-region', `${engineName} Undo message`);
    await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
    await settle(400);
    const progress = (await readStores(page)).progress;
    check(progress.learnedPhrases.length === 1 && progress.favoritePhrases.length === 1 && progress.hiddenPhrases.length === 1, `undo restored wrong state ${JSON.stringify(progress)}`);
    check((await page.locator('.phrase-card h3').first().textContent()) === term, 'undone entry not back in place');

    await page.getByRole('button', { name: 'Unhide all phrases' }).click();
    await settle(200);
    await page.screenshot({ path: shot(`${engineName}-desktop-unhide-dialog`) });
    await expectTargets(page, 'dialog[open]', `${engineName} Unhide all dialog`);
    await page.getByRole('button', { name: 'Cancel' }).click();
    check((await readStores(page)).progress.hiddenPhrases.length === 1, 'cancel changed hidden state');
    await page.getByRole('button', { name: 'Unhide all phrases' }).click();
    await page.getByRole('button', { name: 'Show all hidden phrases' }).click();
    await settle(300);
    check((await readStores(page)).progress.hiddenPhrases.length === 0, 'unhide all did not apply');

    await page.evaluate(() => { window.location.hash = 'settings'; });
    await page.waitForSelector('text=Reset learning progress…');
    await page.getByRole('button', { name: 'Reset learning progress…' }).click();
    await settle(200);
    const focusInDialog = await page.evaluate(() => document.activeElement?.textContent);
    await page.screenshot({ path: shot(`${engineName}-desktop-reset-dialog`) });
    await expectTargets(page, 'dialog[open]', `${engineName} Reset dialog`);
    await page.keyboard.press('Escape');
    await settle(200);
    check((await readStores(page)).progress.learnedPhrases.length === 1, 'Escape changed progress');
    await page.getByRole('button', { name: 'Reset learning progress…' }).click();
    await page.getByRole('button', { name: 'Reset progress' }).click();
    await settle(400);
    const reset = (await readStores(page)).progress;
    check(reset.learnedPhrases.length === 0 && reset.favoritePhrases.length === 0, 'reset did not clear progress');
    await ctx.close();
    return { focusInDialog };
  });

  // 9. The study material cannot be loaded: plain wording, then Try again succeeds. (Injected failure.)
  await run(engineName, 'content-error-screen', async () => {
    const ctx = await context('phone', { colorScheme: 'light' });
    await ctx.route('**/data/manifest.json', (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' }));
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#content-error-title', { timeout: 20000 });
    const text = (await page.locator('body').textContent()).replace(/\s+/g, ' ').trim();
    check(!/\bnpm\b|vite|content:generate/i.test(text), `developer wording on the content error screen: ${text}`);
    await page.screenshot({ path: shot(`${engineName}-phone-content-error`) });
    await expectTargets(page, 'body', `${engineName} content error screen`);
    await ctx.unroute('**/data/manifest.json');
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.waitForSelector('.app-shell', { timeout: 20000 });
    await ctx.close();
    return { text: text.slice(0, 300) };
  });

  // 10. v1 is still independent.
  await run(engineName, 'v1-isolation', async () => {
    const ctx = await context('desktop', { colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}v1/`, { waitUntil: 'networkidle' });
    const databases = await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map((db) => db.name) : 'n/a'));
    const title = await page.title();
    check(!String(databases).includes('eng-trainer-v2'), 'v1 opened the v2 database');
    await ctx.close();
    return { title, databases };
  });

  await browser.close();
}

// ---------------------------------------------------------------- Chromium-only measurements
if (!ONLY) {
  currentScenario = 'measurements';
  const browser = await pw.chromium.launch({ headless: true });
  const log = [];
  results.measurements = {};
  // First-load transfer: cold cache, one route each, everything until the network is idle.
  for (const hash of ['index', 'phrases', 'wordIndex']) {
    const ctx = await isolate(await browser.newContext({ viewport: { width: 390, height: 844 } }));
    const page = await ctx.newPage();
    watch(page, log);
    const responses = [];
    page.on('requestfinished', async (request) => {
      const sizes = await request.sizes().catch(() => null);
      responses.push({ url: request.url(), type: request.resourceType(), host: new URL(request.url()).host, body: sizes?.responseBodySize ?? 0 });
    });
    await page.goto(`${BASE}#${hash}`, { waitUntil: 'networkidle' });
    await ready(page);
    await settle(500);
    const byType = {};
    let gzipEstimate = 0;
    for (const response of responses) {
      byType[response.type] = (byType[response.type] ?? 0) + response.body;
      const local = response.url.replace(BASE, '').split('#')[0].split('?')[0] || 'index.html';
      const file = join(siteDir, local);
      if (existsSync(file) && statSync(file).isFile()) gzipEstimate += /\.woff2$/.test(file) ? statSync(file).size : gzipSync(readFileSync(file), { level: 9 }).length;
    }
    results.measurements[`firstLoad-${hash}`] = {
      requests: responses.length,
      hosts: [...new Set(responses.map((response) => response.host))],
      bytesByType: byType,
      totalBytes: responses.reduce((sum, response) => sum + response.body, 0),
      gzipEstimateBytes: gzipEstimate,
      fonts: responses.filter((response) => response.type === 'font').map((response) => response.url.split('/').pop())
    };
    await ctx.close();
  }
  // Theme at start-up: saved Dark preference, light system theme, 4x CPU slowdown.
  const ctx = await isolate(await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' }));
  await ctx.addInitScript(() => {
    const log = [];
    window.__themeLog = log;
    const theme = () => (document.documentElement ? document.documentElement.getAttribute('data-theme') : null);
    new MutationObserver((mutations) => { for (const m of mutations) if (m.type === 'attributes' && m.target === document.documentElement) log.push({ t: Math.round(performance.now()), theme: theme(), ready: document.documentElement.hasAttribute('data-theme-ready'), attr: m.attributeName }); })
      .observe(document, { subtree: true, attributes: true, attributeFilter: ['data-theme', 'data-theme-ready'] });
    new PerformanceObserver((list) => { for (const e of list.getEntries()) log.push({ t: Math.round(e.startTime), label: e.name }); }).observe({ type: 'paint', buffered: true });
    new MutationObserver(() => { if (!window.__shellAt && document.querySelector('.app-shell')) window.__shellAt = Math.round(performance.now()); })
      .observe(document, { subtree: true, childList: true });
  });
  const page = await ctx.newPage();
  watch(page, log);
  await page.goto(`${BASE}#settings`, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.getByRole('radio', { name: 'Dark' }).check();
  await settle(500);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const runs = [];
  for (let index = 0; index < 6; index += 1) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready(page);
    const entries = await page.evaluate(() => window.__themeLog.map((entry) => ({ ...entry })));
    const firstPaint = entries.find((entry) => entry.label === 'first-paint');
    const dark = entries.find((entry) => entry.attr === 'data-theme' && entry.theme === 'dark');
    const readyAt = entries.find((entry) => entry.attr === 'data-theme-ready' && entry.ready);
    const shellAt = await page.evaluate(() => window.__shellAt ?? null);
    // The loader may paint in the system theme; the study screens must not appear before the saved theme.
    runs.push({ firstPaint: firstPaint?.t ?? null, darkAt: dark?.t ?? null, shellAt, shellBeforeDark: Boolean(shellAt !== null && dark && shellAt < dark.t), transitionsEnabledAt: readyAt?.t ?? null, transitionsBeforeDark: Boolean(readyAt && dark && readyAt.t < dark.t) });
  }
  results.measurements.themeStartup4x = runs;
  results.measurements.log = log;
  await ctx.close();
  await browser.close();
}

server.close();
results.finishedAt = new Date().toISOString();
writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
const summary = Object.fromEntries(Object.entries(results.engines).map(([engine, data]) => [engine, { version: data.version, pass: Object.values(data.scenarios).filter((s) => s.status === 'PASS').length, fail: Object.values(data.scenarios).filter((s) => s.status === 'FAIL').length, logByScenario: data.log.reduce((acc, entry) => ({ ...acc, [entry.scenario]: (acc[entry.scenario] ?? 0) + 1 }), {}) }]));
summary.measurementLog = results.measurements?.log?.length ?? 'not run';
console.log(JSON.stringify(summary));
