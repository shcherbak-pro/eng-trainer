// ENG-V2-UX-01A read-only UX audit of the published v2 application.
// Every scenario uses a fresh, non-persistent Playwright context with synthetic data only.
// Usage: node audit.mjs <playwright-module-dir> <inventory.json> <output-dir>
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , pwDir, inventoryPath, outDir] = process.argv;
const require = createRequire(import.meta.url);
const { chromium } = require(join(pwDir, 'playwright'));

const BASE = 'https://shcherbak-pro.github.io/eng-trainer/';
const SEED = BASE + '__ux01a-seed__';
mkdirSync(join(outDir, 'shots'), { recursive: true });
mkdirSync(join(outDir, 'aria'), { recursive: true });

const results = { startedAt: new Date().toISOString(), base: BASE, scenarios: {}, errors: {}, console: [] };
const shot = (name) => join(outDir, 'shots', `${name}.png`);
const PAGES = ['index', 'phrases', 'wordIndex', 'flashcards', 'reverse', 'irregularVerbs', 'patterns', 'answers', 'practice', 'favorites', 'collections'];
const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  small: { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true }
};

const CSV_VALID = [
  'english,translation,topic,example,kind',
  'take ownership,брати відповідальність,Synthetic workplace,I take ownership of the release plan.,phrase',
  'estimate,оцінка,Synthetic workplace,Our estimate was too optimistic.,word',
  'estimate,оцінювати,Synthetic workplace,Please estimate the effort.,word',
  '<b>not bold</b>,не жирний текст,Synthetic markup,,word'
].join('\n');
const CSV_INVALID = 'english,topic\nwithout translation,Synthetic';

let browser;

async function run(name, fn) {
  const started = Date.now();
  try {
    results.scenarios[name] = { ...(await fn()), ms: Date.now() - started };
    console.log(`PASS ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    results.errors[name] = String(error?.stack ?? error).slice(0, 1500);
    console.log(`FAIL ${name}: ${String(error).slice(0, 300)}`);
  }
}

async function newContext(kind, extra = {}) {
  const context = await browser.newContext({ ...VIEWPORTS[kind], reducedMotion: 'reduce', acceptDownloads: true, ...extra });
  context.on('page', (page) => watch(page));
  return context;
}

function watch(page) {
  page.on('pageerror', (error) => results.console.push({ type: 'pageerror', text: String(error).slice(0, 300) }));
  page.on('console', (msg) => { if (msg.type() === 'error') results.console.push({ type: 'console', text: msg.text().slice(0, 300) }); });
}

async function ready(page) {
  await page.waitForSelector('.app-shell', { timeout: 45000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

async function open(page, hash = '') {
  await page.goto(BASE + (hash ? `#${hash}` : ''), { waitUntil: 'domcontentloaded' });
  await ready(page);
}

async function go(page, hash) {
  await page.evaluate((value) => { window.location.hash = value; }, hash);
  await page.waitForTimeout(350);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
}

function clickButton(page, label) {
  return page.locator('button').filter({ hasText: label }).first().click();
}

async function measure(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el || !visible(el)) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top + scrollY), height: Math.round(r.height), width: Math.round(r.width) };
    };
    const content = document.querySelector('.phrase-card, .word-card, .verb-card, .flashcard, .block-card, .practice-card, .collection-card, .cards-list > .card, .empty-state, .import-preview');
    const firstContentTop = content && visible(content) ? Math.round(content.getBoundingClientRect().top + scrollY) : null;
    const focusables = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && visible(el));
    const describe = (el) => (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 48);
    const small = (limit) => focusables.filter((el) => { const r = el.getBoundingClientRect(); return r.width < limit || r.height < limit; });
    const headings = [...document.querySelectorAll('h1,h2,h3,h4')].filter(visible).map((h) => `${h.tagName} ${h.textContent.replace(/\s+/g, ' ').trim().slice(0, 50)}`);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentHeight: document.documentElement.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      topbar: rect('.topbar'), hero: rect('.hero'), toolbar: rect('.toolbar-card'), bottomNav: rect('.bottom-nav'),
      firstContentTop,
      firstContentAboveFold: firstContentTop !== null ? firstContentTop < innerHeight : null,
      focusableCount: focusables.length,
      iconOnlyButtons: document.querySelectorAll('.btn--icon-only').length,
      targetsUnder24: small(24).length, targetsUnder44: small(44).length,
      examplesUnder44: [...new Set(small(44).map(describe))].slice(0, 12),
      headings,
      langAttributes: [...document.querySelectorAll('[lang]')].map((el) => `${el.tagName}:${el.getAttribute('lang')}`),
      translateNo: document.querySelectorAll('[translate="no"]').length,
      ariaCurrent: document.querySelectorAll('[aria-current]').length,
      skipLink: !!document.querySelector('a[href^="#"]:not([href="#"])'),
      links: document.querySelectorAll('a[href]').length
    };
  });
}

// ---------------------------------------------------------------- provenance
await run('provenance', async () => {
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  const mismatches = [];
  for (const item of inventory) {
    const response = await fetch(BASE + item.path, { cache: 'no-store' });
    const bytes = Buffer.from(await response.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (response.status !== 200 || sha256 !== item.sha256) mismatches.push({ path: item.path, status: response.status, sha256 });
  }
  return { files: inventory.length, matching: inventory.length - mismatches.length, mismatches };
});

browser = await chromium.launch({ headless: true });
results.browser = `chromium ${browser.version()}`;

// ---------------------------------------------------------------- page survey
for (const [kind, schemes] of [['desktop', ['light', 'dark']], ['mobile', ['light', 'dark']], ['small', ['light']]]) {
  for (const scheme of schemes) {
    await run(`survey-${kind}-${scheme}`, async () => {
      const context = await newContext(kind, { colorScheme: scheme });
      const page = await context.newPage();
      await open(page);
      const pages = {};
      for (const name of PAGES) {
        await go(page, name);
        pages[name] = await measure(page);
        await page.screenshot({ path: shot(`${kind}-${scheme}-${name}`) });
        if (kind === 'mobile' && scheme === 'light' && ['index', 'phrases', 'collections'].includes(name)) {
          await page.screenshot({ path: shot(`${kind}-${scheme}-${name}-full`), fullPage: true });
        }
      }
      await context.close();
      return { pages };
    });
  }
}

// ---------------------------------------------------------------- accessibility tree snapshots
await run('aria-snapshots', async () => {
  const saved = [];
  for (const [kind, hash] of [['desktop', 'index'], ['desktop', 'phrases'], ['mobile', 'flashcards'], ['mobile', 'collections'], ['desktop', 'wordIndex']]) {
    const context = await newContext(kind, { colorScheme: 'light' });
    const page = await context.newPage();
    await open(page, hash);
    const tree = await page.locator('body').ariaSnapshot();
    writeFileSync(join(outDir, 'aria', `${kind}-${hash}.yml`), tree);
    saved.push(`${kind}-${hash}`);
    await context.close();
  }
  return { saved };
});

// ---------------------------------------------------------------- learning journeys (mobile)
await run('journey-phrases-focus-hide-reset', async () => {
  const context = await newContext('mobile', { colorScheme: 'light' });
  const page = await context.newPage();
  let dialogs = 0;
  page.on('dialog', async (dialog) => { dialogs += 1; await dialog.dismiss(); });
  await open(page, 'phrases');
  const cards = page.locator('.phrase-card');
  const firstCardHeight = await cards.first().evaluate((el) => Math.round(el.getBoundingClientRect().height));
  await cards.nth(0).locator('button[aria-label="Mark as learned"]').click();
  await cards.nth(0).locator('button[aria-label="Add to Focus List"]').click();
  await cards.nth(1).locator('button[aria-label="Add to Focus List"]').click();
  const hiddenTitle = await cards.nth(2).locator('h3').textContent();
  await cards.nth(2).locator('button[aria-label="Hide item"]').click();
  await page.waitForTimeout(300);
  const stillListed = await page.locator('.phrase-card h3', { hasText: hiddenTitle }).count();
  const liveRegionsAfterHide = await page.locator('[role="status"], [aria-live]').count();
  await page.screenshot({ path: shot('journey-mobile-phrases-after-actions') });
  await go(page, 'favorites');
  await page.screenshot({ path: shot('journey-mobile-focus-list'), fullPage: true });
  const heroBefore = await page.locator('.hero__stats').innerText();
  await go(page, 'index');
  await page.locator('button[aria-label="Reset progress"]').click();
  await page.waitForTimeout(400);
  const heroAfter = await page.locator('.hero__stats').innerText();
  await context.close();
  return { firstCardHeight, hiddenItemStillListed: stillListed > 0, liveRegionsAfterHide, heroBefore, heroAfter, resetDialogsShown: dialogs };
});

await run('journey-flashcards', async () => {
  const out = {};
  for (const kind of ['mobile', 'desktop']) {
    const context = await newContext(kind, { colorScheme: 'light' });
    const page = await context.newPage();
    await open(page, 'flashcards');
    out[kind] = await measure(page);
    const card = page.locator('.flashcard-swipe');
    const box = await card.boundingBox();
    out[`${kind}Card`] = { top: Math.round(box.y), height: Math.round(box.height) };
    const actions = await page.locator('.flashcard-actions').boundingBox();
    out[`${kind}ActionsBottom`] = Math.round(actions.y + actions.height);
    await page.screenshot({ path: shot(`journey-${kind}-flashcard-front`) });
    await page.locator('.flashcard__surface').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: shot(`journey-${kind}-flashcard-back`) });
    if (kind === 'mobile') {
      await page.locator('.flashcard__surface').click();
      await page.waitForTimeout(200);
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let step = 1; step <= 10; step += 1) await page.mouse.move(cx + step * 9, cy + 2);
      await page.waitForTimeout(120);
      await page.screenshot({ path: shot('journey-mobile-flashcard-drag') });
      for (let step = 9; step >= 0; step -= 1) await page.mouse.move(cx + step * 9, cy + 2);
      await page.mouse.up();
      await page.locator('button[aria-label="Review learned vocabulary"]').click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: shot('journey-mobile-flashcard-review') });
    }
    await context.close();
  }
  return out;
});

await run('journey-word-index-mobile', async () => {
  const context = await newContext('mobile', { colorScheme: 'light' });
  const page = await context.newPage();
  await open(page, 'wordIndex');
  const before = await measure(page);
  await page.locator('.index-list button').nth(3).click();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const card = document.querySelector('.word-card').getBoundingClientRect();
    const list = document.querySelector('.index-list').getBoundingClientRect();
    return { scrollY, listTop: Math.round(list.top), listHeight: Math.round(list.height), detailTopInViewport: Math.round(card.top), viewportHeight: innerHeight, detailVisible: card.top < innerHeight - 60 };
  });
  await page.screenshot({ path: shot('journey-mobile-word-index-after-tap') });
  await context.close();
  return { before: { firstContentTop: before.firstContentTop, headings: before.headings }, after };
});

// ---------------------------------------------------------------- collections (F3, F6, previews, messages)
await run('journey-collections', async () => {
  const out = {};
  const context = await newContext('mobile', { colorScheme: 'light' });
  const page = await context.newPage();
  await open(page, 'collections');
  out.emptyStateText = await page.locator('.empty-state').innerText();
  // F3: a keyboard user focuses the file input, then chooses a file.
  await page.locator('input[type="file"]').focus();
  out.focusBeforeChoice = await page.evaluate(() => document.activeElement?.tagName + ':' + (document.activeElement?.getAttribute('type') ?? ''));
  await page.locator('input[type="file"]').setInputFiles({ name: 'Мої слова.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV_VALID, 'utf8') });
  await page.waitForSelector('.import-preview');
  await page.waitForTimeout(200);
  out.focusAfterPreview = await page.evaluate(() => document.activeElement?.tagName + (document.activeElement?.className ? '.' + document.activeElement.className : ''));
  out.previewText = (await page.locator('.import-preview').innerText()).slice(0, 700);
  out.previewTableOverflow = await page.locator('.preview-scroll').evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  await page.locator('.import-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('journey-mobile-collections-preview') });
  await page.screenshot({ path: shot('journey-mobile-collections-preview-full'), fullPage: true });
  await page.locator('.duplicate-ack input').check();
  await clickButton(page, 'Confirm import');
  await page.waitForSelector('.collection-card');
  await page.waitForTimeout(200);
  out.successMessage = await page.locator('.notice[role="status"]').innerText();
  out.successClass = await page.locator('.notice[role="status"]').evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: shot('journey-mobile-collections-imported'), fullPage: true });
  // F6: export file name of a Cyrillic collection.
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.collection-card button').filter({ hasText: 'Export' }).click();
  out.exportFileName = (await downloadPromise).suggestedFilename();
  // Inline rename and removal confirmation.
  await page.locator('.collection-card button').filter({ hasText: 'Rename' }).click();
  out.focusAfterRenameOpen = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 40));
  await page.locator('.collection-card button').filter({ hasText: 'Remove' }).click();
  await page.locator('.collection-card').scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('journey-mobile-collections-rename-remove'), fullPage: true });
  await page.locator('button').filter({ hasText: 'Keep collection' }).click();
  await page.locator('button').filter({ hasText: 'Cancel rename' }).click();
  // Invalid file.
  await page.locator('input[type="file"]').focus();
  await page.locator('input[type="file"]').setInputFiles({ name: 'broken.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV_INVALID, 'utf8') });
  await page.waitForTimeout(400);
  out.focusAfterError = await page.evaluate(() => document.activeElement?.tagName);
  out.invalidMessage = (await page.locator('.notice[role="alert"], [role="alert"]').first().innerText()).slice(0, 400);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: shot('journey-mobile-collections-error') });
  // Flashcards with a collection filter (shows the shared filter control).
  await go(page, 'flashcards');
  await page.screenshot({ path: shot('journey-mobile-flashcards-with-collections') });
  await context.close();
  return out;
});

// F5: stale write from a second tab.
await run('f5-stale-write', async () => {
  const context = await newContext('mobile', { colorScheme: 'light' });
  const a = await context.newPage();
  await open(a, 'collections');
  await a.locator('input[type="file"]').setInputFiles({ name: 'synthetic-two-tabs.csv', mimeType: 'text/csv', buffer: Buffer.from('english,translation\nsynthetic alpha,синтетичне альфа', 'utf8') });
  await a.waitForSelector('.import-preview');
  await clickButton(a, 'Confirm import');
  await a.waitForSelector('.collection-card');
  const b = await context.newPage();
  await open(b, 'collections');
  await b.locator('.collection-card button').filter({ hasText: 'Rename' }).click();
  await b.getByLabel('New collection name').fill('Renamed in tab B');
  await clickButton(b, 'Save name');
  await b.waitForTimeout(400);
  const bMessage = await b.locator('.notice').first().innerText();
  await a.bringToFront();
  await a.locator('.collection-card button').filter({ hasText: 'Rename' }).click();
  await a.getByLabel('New collection name').fill('Renamed in tab A');
  await clickButton(a, 'Save name');
  await a.waitForTimeout(500);
  const aError = await a.locator('[role="alert"]').first().innerText();
  const errorTop = await a.locator('[role="alert"]').first().evaluate((el) => Math.round(el.getBoundingClientRect().top));
  const formTop = await a.locator('.collection-card form').evaluate((el) => Math.round(el.getBoundingClientRect().top)).catch(() => null);
  await a.screenshot({ path: shot('f5-mobile-stale-write-viewport') });
  await a.evaluate(() => window.scrollTo(0, 0));
  await a.screenshot({ path: shot('f5-mobile-stale-write-top') });
  await context.close();
  return { bMessage, aError, errorTopInViewport: errorTop, renameFormTopInViewport: formTop };
});

// F4: blocked upgrade, retry while still blocked, recovery; plus "Saving is off".
async function blockingContext() {
  const context = await newContext('mobile', { colorScheme: 'light' });
  await context.route(SEED, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>seed</title>' }));
  const holder = await context.newPage();
  await holder.goto(SEED);
  await holder.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('eng-trainer-v2', 1);
    request.onupgradeneeded = () => { for (const name of ['progress', 'learnPasses', 'flashcardSessions', 'settings']) request.result.createObjectStore(name); };
    request.onsuccess = () => { window.__heldDb = request.result; resolve(); };
    request.onerror = () => reject(request.error);
  }));
  return { context, holder };
}

await run('f4-blocked-upgrade', async () => {
  const { context, holder } = await blockingContext();
  const app = await context.newPage();
  await app.goto(BASE, { waitUntil: 'domcontentloaded' });
  await app.waitForSelector('.error-card', { timeout: 20000 });
  await app.evaluate(() => document.fonts.ready);
  const firstError = await app.locator('.error-card').innerText();
  await app.screenshot({ path: shot('f4-mobile-blocked-first') });
  await clickButton(app, 'Try again');
  await app.waitForTimeout(4000);
  const afterRetry = await app.locator('main').innerText();
  await app.screenshot({ path: shot('f4-mobile-retry-while-blocked') });
  const closedAt = Date.now();
  await holder.evaluate(() => window.__heldDb.close());
  let recovered = false;
  try { await app.waitForSelector('.app-shell', { timeout: 15000 }); recovered = true; } catch { recovered = false; }
  const recoveryMs = Date.now() - closedAt;
  await context.close();
  return { firstError, afterRetry, recoveredAfterHolderClosed: recovered, recoveryMs };
});

await run('saving-off', async () => {
  const { context } = await blockingContext();
  const app = await context.newPage();
  await app.goto(BASE + '#phrases', { waitUntil: 'domcontentloaded' });
  await app.waitForSelector('.error-card', { timeout: 20000 });
  await clickButton(app, 'Continue without saving');
  await ready(app);
  const notice = await app.locator('.storage-notice').innerText();
  await app.screenshot({ path: shot('saving-off-mobile-phrases') });
  await context.close();
  return { notice };
});

await run('content-error', async () => {
  const context = await newContext('mobile', { colorScheme: 'light' });
  await context.route('**/data/manifest.json', (route) => route.fulfill({ status: 404, body: 'not found' }));
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.error-card', { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  const text = await page.locator('.error-card').innerText();
  await page.screenshot({ path: shot('content-error-mobile') });
  await context.close();
  return { text };
});

// ---------------------------------------------------------------- keyboard and focus
await run('keyboard-desktop', async () => {
  const context = await newContext('desktop', { colorScheme: 'light' });
  const page = await context.newPage();
  await open(page, 'phrases');
  let presses = 0;
  let firstCard = null;
  for (; presses < 120; presses += 1) {
    await page.keyboard.press('Tab');
    firstCard = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.closest('.phrase-card') ? (el.getAttribute('aria-label') || el.textContent.trim()) : null;
    });
    if (firstCard) break;
  }
  // Focus ring screenshots: first nav button on the dark top bar, and a button on a light surface.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const navFocus = await page.evaluate(() => {
    const el = document.activeElement;
    const style = getComputedStyle(el);
    return { text: el.textContent.trim(), outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`, boxShadow: style.boxShadow };
  });
  await page.screenshot({ path: shot('focus-desktop-topbar'), clip: { x: 0, y: 0, width: 1440, height: 90 } });
  await page.locator('.phrase-card button[aria-label="Mark as learned"]').first().focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const box = await page.locator('.phrase-card').first().boundingBox();
  await page.screenshot({ path: shot('focus-desktop-card-button'), clip: { x: box.x + box.width - 260, y: box.y, width: 260, height: 140 } });
  // Backward tabbing under the sticky header.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.locator('.pagination-footer select').focus();
  let obscured = 0; const samples = [];
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Shift+Tab');
    const hit = await page.evaluate(() => {
      const el = document.activeElement; const bar = document.querySelector('.topbar').getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { covered: r.top < bar.bottom && r.bottom > bar.top && !el.closest('.topbar'), label: (el.getAttribute('aria-label') || el.textContent).trim().slice(0, 30) };
    });
    if (hit.covered) { obscured += 1; if (samples.length < 4) samples.push(hit.label); }
  }
  await context.close();
  return { tabPressesToFirstCardControl: presses + 1, firstCardControl: firstCard, navFocus, backwardObscuredByStickyHeader: obscured, obscuredSamples: samples };
});

await run('keyboard-narrow-bottom-nav', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', reducedMotion: 'reduce' });
  const page = await context.newPage();
  await open(page, 'phrases');
  let obscured = 0; const samples = [];
  for (let i = 0; i < 45; i += 1) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate(() => {
      const el = document.activeElement; const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { covered: !el.closest('.bottom-nav') && r.bottom > nav.top && r.top < nav.bottom, label: (el.getAttribute('aria-label') || el.textContent).trim().slice(0, 30) };
    });
    if (hit.covered) { obscured += 1; if (samples.length < 4) samples.push(hit.label); }
  }
  const navHeight = await page.locator('.bottom-nav').evaluate((el) => Math.round(el.getBoundingClientRect().height));
  await context.close();
  return { forwardTabsObscuredByBottomNav: obscured, samples, bottomNavHeight: navHeight };
});

// ---------------------------------------------------------------- theme flash
await run('theme-flash', async () => {
  const measureRuns = async (throttle) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    await context.addInitScript(() => {
      window.__themeLog = [];
      const log = (label) => window.__themeLog.push({ t: Math.round(performance.now()), theme: document.documentElement.dataset.theme ?? null, label });
      new MutationObserver(() => log('data-theme')).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__themeLog.push({ t: Math.round(entry.startTime), theme: document.documentElement.dataset.theme ?? null, label: entry.name }); }).observe({ type: 'paint', buffered: true });
    });
    const page = await context.newPage();
    await open(page);
    await page.locator('.theme-toggle').click();
    await page.locator('.theme-toggle').click();
    await page.waitForTimeout(600);
    const label = await page.locator('.theme-toggle').getAttribute('aria-label');
    const cdp = await context.newCDPSession(page);
    if (throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    const runs = [];
    for (let i = 0; i < 5; i += 1) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await ready(page);
      const log = await page.evaluate(() => window.__themeLog);
      const fcp = log.find((e) => e.label === 'first-contentful-paint');
      const fp = log.find((e) => e.label === 'first-paint');
      const dark = log.find((e) => e.label === 'data-theme' && e.theme === 'dark');
      runs.push({ firstPaint: fp?.t ?? null, fcp: fcp?.t ?? null, themeAtFirstPaint: fp?.theme ?? null, darkAppliedAt: dark?.t ?? null, lightVisibleMs: fp && dark ? Math.max(0, dark.t - fp.t) : null });
    }
    await context.close();
    return { toggleLabel: label, throttle: throttle || 1, runs };
  };
  return { normal: await measureRuns(0), cpu4x: await measureRuns(4) };
});

// ---------------------------------------------------------------- icon font flash and page weight
await run('icon-font-delay', async () => {
  const context = await newContext('mobile', { colorScheme: 'light' });
  await context.route('https://fonts.gstatic.com/**', async (route) => { await new Promise((r) => setTimeout(r, 4000)); await route.continue(); });
  const page = await context.newPage();
  await page.goto(BASE + '#phrases', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-shell', { timeout: 30000 });
  await page.waitForTimeout(300);
  const iconFontLoaded = await page.evaluate(() => document.fonts.check('22px "Material Symbols Rounded"'));
  const ligatureText = await page.locator('.material-symbols-rounded').evaluateAll((els) => els.slice(0, 8).map((el) => el.textContent));
  await page.screenshot({ path: shot('icon-font-delayed-mobile-phrases') });
  await context.close();
  return { iconFontLoaded, ligatureText };
});

await run('page-weight', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const page = await context.newPage();
  const responses = [];
  page.on('requestfinished', async (request) => {
    try {
      const sizes = await request.sizes();
      responses.push({ url: request.url(), type: request.resourceType(), host: new URL(request.url()).host, body: sizes.responseBodySize, headers: sizes.responseHeadersSize });
    } catch { /* ignore */ }
  });
  await open(page);
  await page.waitForTimeout(1500);
  const byType = {}; const byHost = {};
  for (const r of responses) {
    byType[r.type] = (byType[r.type] ?? 0) + r.body;
    byHost[r.host] = (byHost[r.host] ?? 0) + r.body;
  }
  const fonts = responses.filter((r) => r.type === 'font').map((r) => ({ url: r.url.slice(0, 120), body: r.body }));
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paint = Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, Math.round(e.startTime)]));
    return { domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), ...paint };
  });
  await context.close();
  return { requests: responses.length, byType, byHost, fonts, timing };
});

await browser.close();
results.finishedAt = new Date().toISOString();
writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
console.log(`errors: ${Object.keys(results.errors).length}; console errors: ${results.console.length}`);
