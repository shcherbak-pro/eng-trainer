// Independent RC1 review. Fresh native contexts, synthetic stores; real keyboard navigation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pw, out, pause, serve, measureFocus } from './browser-support.mjs';

const labels = ['All situations', 'Meeting new people', 'Before a work meeting', 'Coffee and lunch breaks',
  'Free time and weekends', 'Conferences and events', 'Traveling'];
const beforePack = JSON.parse(fs.readFileSync('docs/reviews/eng-v2-03-astra/candidate-snapshot/content/packs/small-talk.json', 'utf8')).content;
const byId = new Map(beforePack.phrases.map((p) => [p.id, p.phrase]));
const rows = [beforePack.phrases.map((p) => p.phrase), ...beforePack.topics[0].sections.map((s) => s.items.map((id) => byId.get(id)))];
const servers = { before: await serve('docs/reviews/eng-v2-03-rc1-astra/local/before-site'), rc2: await serve('site-dist') };
const hash = (s) => createHash('sha256').update(s).digest('hex');
const report = {
  runnerSha256: hash(fs.readFileSync(new URL(import.meta.url))),
  geometrySha256: hash(fs.readFileSync(new URL('./browser-support.mjs', import.meta.url))),
  method: 'Native keyboard only before chip measurements. Fresh contexts and actual html font-size 200%, verified as 14px to 28px chip text. Intended self-hosted fonts loaded. 220ms settlement. Read-only character/line/outline geometry intersects clipping ancestors and viewport, with fixed tab-bar exclusion. 0.75 CSS px rounding tolerance.',
  engines: {},
};
fs.mkdirSync(path.join(out, 'shots'), { recursive: true });
const active = (page) => page.evaluate(() => document.activeElement?.matches('.chip-row > button') ? document.activeElement.textContent.trim() : null);
const selection = async (page) => (await page.locator('.chip-row [aria-pressed=true]').textContent()).trim();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function enter(page) {
  for (let i = 0; i < 35 && !await active(page); i++) await page.keyboard.press('Tab');
  assert.equal(await active(page), labels[0], 'Keyboard enters at All situations');
}
async function searchBeforeStrip(page) {
  for (let i = 0; i < 12; i++) {
    if (await page.evaluate(() => document.activeElement.matches('input[type=search]'))) return;
    await page.keyboard.press('Shift+Tab');
  }
  throw new Error('Keyboard did not reach preceding search');
}
async function snapshot(page) {
  return page.evaluate(() => ({
    active: { tag: document.activeElement?.tagName, id: document.activeElement?.id, text: document.activeElement?.textContent?.trim().slice(0, 80) },
    y: scrollY, left: document.querySelector('.chip-row')?.scrollLeft ?? null,
  }));
}
async function holdFrames(page) {
  await page.evaluate(() => {
    window.__held = []; window.__canceled = [];
    window.__raf = requestAnimationFrame; window.__caf = cancelAnimationFrame;
    let id = 9000000;
    window.requestAnimationFrame = (callback) => { window.__held.push({ id: ++id, callback }); return id; };
    window.cancelAnimationFrame = (value) => { window.__canceled.push(value); if (value < 9000000) window.__caf(value); };
  });
}
async function releaseFrames(page, restore = false) {
  return page.evaluate((restore) => {
    const frames = window.__held.splice(0);
    if (restore) { window.requestAnimationFrame = window.__raf; window.cancelAnimationFrame = window.__caf; }
    // Deliberately deliver canceled callbacks too: a separate forced-lifecycle diagnostic.
    for (const frame of frames) frame.callback(performance.now());
    return { delivered: frames.length, canceled: window.__canceled.length };
  }, restore);
}

try {
  for (const engine of ['chromium', 'firefox']) {
    const browser = await pw[engine].launch({ headless: true });
    const scenarios = [];
    report.engines[engine] = { version: browser.version(), scenarios };
    async function scenario(build, name, width, percent, task) {
      const base = servers[build].base;
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
      await ctx.route((url) => !url.href.startsWith(base), (route) => route.abort());
      await ctx.addInitScript(() => {
        window.__rejections = [];
        addEventListener('unhandledrejection', (e) => window.__rejections.push(String(e.reason)));
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} } });
        Object.defineProperty(window, 'speechSynthesis', { value: { speaking: false, pending: false, paused: false,
          speak() {}, cancel() {}, getVoices: () => [], addEventListener() {}, removeEventListener() {} } });
      });
      const page = await ctx.newPage();
      const result = { build, name, width, height: 844, textPercent: percent, failures: [], visibilityFailures: [], errors: [], measurements: [] };
      scenarios.push(result);
      const clean = (s) => String(s).replaceAll(base, '/eng-trainer/');
      page.on('pageerror', (e) => result.errors.push(clean(e)));
      page.on('console', (m) => { if (m.type() === 'error') result.errors.push(clean(m.text())); });
      const check = (ok, message) => { if (!ok) result.failures.push(message); };
      const measure = async (step, label) => {
        await pause();
        const facts = await page.evaluate(measureFocus);
        result.measurements.push({ step, ...facts });
        check(facts.label === label && facts.connected && facts.focusVisible, step + ': keyboard focus/indicator');
        check(facts.outlineWidth === 2 && facts.outlineOffset === 2, step + ': original 2px + 2px ring');
        check(facts.pageOverflow <= 0.75, step + ': page overflow');
        if (!facts.complete) result.visibilityFailures.push(step);
        return facts;
      };
      const shot = async (suffix) => {
        const file = 'shots/' + [build, engine, name, suffix].join('-') + '.png';
        await page.screenshot({ path: path.join(out, file) });
        (result.screenshots ??= []).push(file);
      };
      try {
        await page.goto(base + '#topic/small-talk', { waitUntil: 'networkidle' });
        await page.locator('.chip-row').waitFor();
        if (percent === 200) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        await page.evaluate(() => document.fonts.ready); await pause();
        result.fonts = await page.evaluate(() => ({
          status: document.fonts.status, loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
          fontSize: getComputedStyle(document.querySelector('.chip-row button')).fontSize,
          rootSize: getComputedStyle(document.documentElement).fontSize,
        }));
        check(result.fonts.status === 'loaded' && result.fonts.loaded.includes('Eng Trainer Sans'), 'Intended UI font loaded');
        check(parseFloat(result.fonts.fontSize) === (percent === 200 ? 28 : 14), 'Actual text enlargement');
        check(await page.locator('.chip-row').getAttribute('role') === 'group' &&
          await page.locator('.chip-row').getAttribute('aria-label') === 'Situations', 'Accessible group label');
        check(same(await page.locator('.chip-row button').allTextContents(), labels), 'Authored labels/order');
        check(await page.locator('.chip-row button').evaluateAll((els) => els.every((el) => el.type === 'button' &&
          ['true', 'false'].includes(el.getAttribute('aria-pressed')))), 'Native button/pressed semantics');
        await task({ page, result, check, measure, shot });
        result.rejections = await page.evaluate(() => window.__rejections);
        check(result.errors.length === 0 && result.rejections.length === 0, 'Error-free native execution');
      } catch (e) { result.failures.push(clean(e.stack ?? e)); }
      result.passed = result.failures.length === 0 && result.visibilityFailures.length === 0;
      console.log(engine, build, name, JSON.stringify({ checks: result.measurements.length, failures: result.failures, clipped: result.visibilityFailures.length }));
      await ctx.close();
    }

    async function matrix({ page, result, check, measure, shot }) {
      await enter(page);
      let selected = labels[0], previous;
      for (let i = 0; i < labels.length; i++) {
        if (i) await page.keyboard.press('Tab');
        check(await selection(page) === selected, 'Tab ' + i + ' does not select');
        const focused = await measure('Tab ' + i, labels[i]);
        if (previous && result.textPercent === 100) check(Math.abs(focused.scrollY - previous.scrollY) <= 0.75, 'No unnecessary vertical jump while ordinary strip is visible');
        previous = focused;
        for (const key of ['Enter', 'Space']) {
          await page.keyboard.press(key);
          const activated = await measure(key + ' ' + i, labels[i]);
          check(activated.ariaPressed === 'true' && await selection(page) === labels[i], key + ' selects ' + i);
          check(same(await page.locator('.phrase-card .entry__term').allTextContents(), rows[i]), key + ' expected rows ' + i);
          check(Math.abs(activated.scrollY - focused.scrollY) <= 0.75, key + ' preserves visible position');
          selected = labels[i];
        }
        if ((result.textPercent === 100 && i === 2) || (result.textPercent === 200 && i === 3)) await shot('selected-' + i);
      }
      await page.keyboard.press('Tab');
      check(await active(page) === null, 'Tab exits after last chip');
      for (let i = labels.length - 1; i >= 0; i--) {
        await page.keyboard.press('Shift+Tab'); await measure('Shift+Tab ' + i, labels[i]);
        check(await selection(page) === labels[6], 'Reverse focus alone does not select');
      }
    }
    // Same decisive checks on the authenticated before artifact and freshly rebuilt RC1.
    for (const [width, percent] of [[390, 100], [320, 200]]) await scenario('before', 'matrix-' + width + '-' + percent, width, percent, matrix);
    for (const width of [320, 390]) for (const percent of [100, 200]) await scenario('rc2', 'matrix-' + width + '-' + percent, width, percent, matrix);

    await scenario('rc2', 'search-memory', 320, 200, async ({ page, check, measure }) => {
      await enter(page);
      for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
      await page.keyboard.press('Space'); await measure('Traveling selected', labels[6]);
      await searchBeforeStrip(page); await page.keyboard.type('have you'); await pause();
      check(same(await page.locator('.phrase-card .entry__term').allTextContents(),
        ['Have you been here before?', 'Have you had a chance to explore the city?']), 'Search intersects Traveling');
      await enter(page); await page.keyboard.press('Enter');
      await measure('All situations with search', labels[0]);
      const count = await page.locator('.phrase-card').count();
      check(count > 2 && count < 36, 'All situations retains the active query');
      for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await page.evaluate(() => { location.hash = 'index'; }); await page.locator('.home-overview').waitFor();
      await page.evaluate(() => { location.hash = 'topic/small-talk'; }); await page.locator('.chip-row').waitFor(); await pause();
      check(await selection(page) === labels[6] && await page.locator('input[type=search]').inputValue() === 'have you', 'Memory survives navigation');
      await page.reload({ waitUntil: 'networkidle' }); await page.locator('.chip-row').waitFor();
      check(await selection(page) === labels[0] && await page.locator('input[type=search]').inputValue() === '', 'Reload resets memory-only filters');
    });

    // Additional focused reflow, manual scrolling and forced lifecycle scenarios follow.
    await extraScenarios(scenario);
    await browser.close();
  }
} finally { for (const server of Object.values(servers)) server.close(); }
for (const entry of Object.values(report.engines)) {
  const before = entry.scenarios.filter((s) => s.build === 'before'), after = entry.scenarios.filter((s) => s.build === 'rc2');
  entry.summary = {
    beforeScenarios: before.length, beforeMeasurements: before.reduce((n, s) => n + s.measurements.length, 0),
    beforeClipped: before.reduce((n, s) => n + s.visibilityFailures.length, 0),
    beforeOtherFailures: before.reduce((n, s) => n + s.failures.length, 0),
    rc2Scenarios: after.length, rc2Passed: after.filter((s) => s.passed).length,
    rc2Measurements: after.reduce((n, s) => n + s.measurements.length, 0),
    rc2Clipped: after.reduce((n, s) => n + s.visibilityFailures.length, 0),
    rc2OtherFailures: after.reduce((n, s) => n + s.failures.length, 0),
  };
}
report.passed = Object.values(report.engines).every((e) => e.summary.beforeClipped > 0 && e.summary.beforeOtherFailures === 0 &&
  e.summary.rc2Clipped === 0 && e.summary.rc2OtherFailures === 0);
fs.writeFileSync(path.join(out, 'focused.json'), JSON.stringify(report, null, 2) + '\n');
if (!report.passed) process.exitCode = 1;

async function extraScenarios(scenario) {
  await scenario('rc2', 'focused-width-text-reflow', 390, 100, async ({ page, check, measure, shot }) => {
    await enter(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
    await measure('Coffee initial', labels[3]);
    await page.setViewportSize({ width: 320, height: 844 });
    await measure('Coffee after narrower width', labels[3]);
    const style = await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await page.evaluate(() => document.fonts.ready);
    const enlarged = await measure('Coffee after text enlargement', labels[3]);
    check(enlarged.fontSize === 28 && enlarged.lineCount >= 2, 'Oversized label wraps with actual enlarged text');
    check(enlarged.unwrappedTextWidth > enlarged.box.width - 24, 'Unwrapped enlarged label exceeds available inner button width');
    await shot('wrapped');
    await page.setViewportSize({ width: 900, height: 844 });
    await measure('Coffee after desktop wrapping breakpoint', labels[3]);
    await style.evaluate((node) => node.remove());
    await page.setViewportSize({ width: 390, height: 844 });
    await measure('Coffee after returning to phone', labels[3]);
    check(await selection(page) === labels[0], 'Focused reflow does not select');
  });
  await scenario('rc2', 'focused-height-reflow', 320, 200, async ({ page, result, measure, shot }) => {
    await enter(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
    const before = await measure('Coffee before height-only resize', labels[3]);
    await page.setViewportSize({ width: 320, height: 640 });
    const after = await measure('Coffee after height-only resize to 640', labels[3]);
    result.heightResize = { before, after };
    await shot('height-640');
    await page.keyboard.press('Shift+Tab');
    await measure('Keyboard resumes after height-only resize', labels[2]);
  });
  await scenario('rc2', 'manual-scroll-and-vertical-focus', 390, 100, async ({ page, result, check, measure }) => {
    await enter(page);
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    await page.keyboard.press('Enter'); await measure('Traveling before manual scroll', labels[6]);
    await page.keyboard.press('Tab');
    const box = await page.locator('.chip-row').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(-1800, 0); await pause();
    const manual = await snapshot(page);
    await pause(600); const settled = await snapshot(page);
    check(manual.left < 5 && same(manual, settled), 'Pointer wheel scroll stays put with selected but unfocused Traveling');
    await page.setViewportSize({ width: 320, height: 844 }); await pause();
    check(await page.locator('.chip-row').evaluate((el) => el.scrollLeft) < 5, 'Unfocused selection does not pull back on resize');
    // Explicit offscreen setup only for vertical behavior; the measured chip is then reached by Shift+Tab.
    await page.evaluate(() => window.scrollBy(0, 650)); await pause();
    result.offscreen = await page.locator('.chip-row').evaluate((el) => ({ bottom: el.getBoundingClientRect().bottom, y: scrollY }));
    check(result.offscreen.bottom < 0, 'Strip genuinely offscreen before native reverse navigation');
    await page.keyboard.press('Shift+Tab');
    await measure('Shift+Tab reveals offscreen Traveling above navigation', labels[6]);
  });
  await scenario('rc2', 'deferred-focus-and-unmount', 390, 100, async ({ page, result, check, measure }) => {
    result.diagnostic = 'Deterministically held animation callbacks, including canceled callbacks, delivered after ownership changes.';
    await enter(page); await measure('Initial real keyboard focus', labels[0]); await holdFrames(page);
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    await searchBeforeStrip(page);
    const outsideBefore = await snapshot(page);
    result.outsideDelivery = await releaseFrames(page); await pause();
    result.outside = { before: outsideBefore, after: await snapshot(page) };
    check(result.outsideDelivery.delivered > 0 && result.outsideDelivery.canceled > 0, 'Held and canceled callbacks actually exercised');
    check(same(result.outside.before, result.outside.after), 'Stale callbacks leave search focus and scrolling unchanged');
    await enter(page); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    await page.evaluate(() => {
      window.__oldReads = 0;
      const old = document.activeElement, read = old.getBoundingClientRect.bind(old);
      old.getBoundingClientRect = () => { window.__oldReads++; return read(); };
    });
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    result.insideDelivery = await releaseFrames(page);
    await measure('Only latest chip retains focus after held frames', labels[4]);
    check(await page.evaluate(() => window.__oldReads) === 0, 'Canceled old owner is not measured while another chip has focus');
    await page.keyboard.press('Tab');
    await page.evaluate(() => {
      window.__detachedReads = 0;
      window.__oldStrip = document.querySelector('.chip-row');
      window.__oldChip = document.activeElement;
      for (const el of [window.__oldStrip, window.__oldChip]) {
        const read = el.getBoundingClientRect.bind(el);
        el.getBoundingClientRect = () => { window.__detachedReads++; return read(); };
      }
      location.hash = 'index';
    });
    await page.locator('.home-overview').waitFor(); await pause();
    const detached = () => page.evaluate(() => ({
      connected: window.__oldStrip.isConnected, left: window.__oldStrip.scrollLeft,
      detachedReads: window.__detachedReads, y: scrollY,
      focus: { tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.trim().slice(0, 80) },
    }));
    const unmountBefore = await detached();
    result.unmountDelivery = await releaseFrames(page, true); await pause();
    result.unmount = { before: unmountBefore, after: await detached() };
    check(result.unmountDelivery.delivered > 0, 'Unmount has pending deferred work');
    check(!unmountBefore.connected && same(result.unmount.before, result.unmount.after) &&
      result.unmount.after.detachedReads === 0, 'Late work neither measures detached controls nor scrolls/focuses Home');
  });
}
