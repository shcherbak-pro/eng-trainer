// ENG-V2-03-RC2 height-only resize checks, identical for every build. From the worktree root:
//   node docs/evidence/eng-v2-03-rc2/height-resize.mjs <site-directory> <result-name>
// Real keyboard focus only: no test-side focus, click, reveal or scroll of chips. The one deliberate
// pointer-wheel scroll is a labelled setup. Geometry comes from Astra's measureFocus oracle, copied
// with an output-path change only (astra-probe/browser-support.mjs): complete outline footprint, every
// non-space character, clipping ancestors, viewport and fixed tab bar, 0.75 CSS px tolerance.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const site = path.resolve(process.argv[2] ?? '');
const name = process.argv[3];
if (!fs.existsSync(path.join(site, 'index.html')) || !/^[a-z0-9-]+$/.test(name ?? '')) throw new Error('Usage: height-resize.mjs <site-directory> <result-name>');
const out = path.resolve('docs/evidence/eng-v2-03-rc2/height-resize');
process.env.RC2_PROBE_OUT ??= out;
const { pw, pause, serve, measureFocus } = await import('./astra-probe/browser-support.mjs');
fs.mkdirSync(path.join(out, 'shots'), { recursive: true });

const COFFEE = 'Coffee and lunch breaks';
const SETTLE = 1000;
const report = {
  runnerSha256: createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex'),
  oracleSha256: createHash('sha256').update(fs.readFileSync(new URL('./astra-probe/browser-support.mjs', import.meta.url))).digest('hex'),
  buildIndexSha256: createHash('sha256').update(fs.readFileSync(path.join(site, 'index.html'))).digest('hex'),
  method: 'Fresh isolated contexts (reduced motion, as in Astra\'s probe); intended fonts loaded; html font-size 100% or 200%; real Tab/Shift+Tab/Enter; viewport height changed with the width kept; 1000 ms settling; no test-side chip focus, reveal or scroll.',
  engines: {}
};

const active = (page) => page.evaluate(() => {
  const el = document.activeElement;
  if (el?.matches('.chip-row > button')) return el.textContent.trim();
  if (el?.matches('input[type="search"]')) return '<search>';
  return el?.tagName ?? null;
});
async function press(page, key, until, max = 40) {
  for (let i = 1; i <= max; i += 1) {
    await page.keyboard.press(key);
    if (await active(page) === until) return i;
  }
  throw new Error(`${key} did not reach ${until}`);
}
// Element sizes and positions (observation only). Height-only resizes must leave the sizes alone.
const layout = (page) => page.evaluate(() => {
  const strip = document.querySelector('.chip-row');
  const button = document.activeElement?.matches('.chip-row > button') ? document.activeElement : null;
  const s = strip.getBoundingClientRect(), b = button?.getBoundingClientRect();
  return {
    strip: { width: s.width, height: s.height, clientWidth: strip.clientWidth, clientHeight: strip.clientHeight, scrollWidth: strip.scrollWidth, scrollLeft: strip.scrollLeft },
    button: b ? { label: button.textContent.trim(), width: b.width, height: b.height } : null,
    selected: [...strip.querySelectorAll('[aria-pressed="true"]')].map((item) => item.textContent.trim()),
    activeIsMarked: document.activeElement === window.__rc2Owner,
    scrollY, viewport: { width: innerWidth, height: innerHeight },
    navTop: document.querySelector('.tab-bar')?.getBoundingClientRect().top ?? null
  };
});
const sameSizes = (a, b) => ['width', 'height', 'clientWidth', 'clientHeight', 'scrollWidth'].every((key) => Math.abs(a.strip[key] - b.strip[key]) < 0.01)
  && Math.abs((a.button?.width ?? 0) - (b.button?.width ?? 0)) < 0.01 && Math.abs((a.button?.height ?? 0) - (b.button?.height ?? 0)) < 0.01;
const trim = (m) => m.missing ? m : ({
  label: m.label, complete: m.complete, focusVisible: m.focusVisible, ariaPressed: m.ariaPressed, paintedOverflow: m.paintedOverflow,
  clippedCharacters: m.clippedCharacters.length, characterCount: m.characterCount, box: m.box, footprint: m.footprint, effective: m.effective,
  fontSize: m.fontSize, lineCount: m.lineCount, scrollY: m.scrollY, viewport: m.viewport, navTop: m.navTop, pageOverflow: m.pageOverflow
});

async function open(browser, base, width, text, errors) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
  await ctx.route((url) => !url.href.startsWith(base), (route) => route.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (error) => errors.push(String(error).replaceAll(base, '/eng-trainer/')));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text().replaceAll(base, '/eng-trainer/')}`); });
  await page.goto(base + '#topic/small-talk', { waitUntil: 'networkidle' });
  await page.locator('.chip-row').waitFor();
  if (text === 200) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await page.evaluate(() => document.fonts.ready);
  await pause();
  const fonts = await page.evaluate(() => [...document.fonts].filter((face) => face.family.replace(/["']/g, '') === 'Eng Trainer Sans' && face.status === 'loaded').length);
  return { ctx, page, fonts };
}
/** Native Tab to All situations, then three more Tabs to Coffee, exactly as reported. */
async function tabToCoffee(page) {
  const toAll = await press(page, 'Tab', 'All situations');
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('Tab');
  if (await active(page) !== COFFEE) throw new Error(`Three Tabs after All situations reached ${await active(page)}`);
  await pause();
  // Remember the focus owner for identity checks (a page variable; the DOM is not touched).
  await page.evaluate(() => { window.__rc2Owner = document.activeElement; });
  return toAll;
}
/** A height at which the focused outline would end `cover` px below the tab bar without a reveal. */
const coveringHeight = (measured, cover = 30) => Math.round(measured.footprint.bottom - cover + (measured.viewport.height - measured.navTop));

const SCENARIOS = {
  // 1. The exact reported sequence, then restore and shrink once more.
  async 'decisive-320-200'(page, s, check) {
    s.tabsToAllSituations = await tabToCoffee(page);
    s.before = trim(await page.evaluate(measureFocus));
    s.layoutBefore = await layout(page);
    check(s.before.label === COFFEE && s.before.complete, 'Coffee not completely visible before the resize');
    check(s.before.fontSize === 28, `chip text is ${s.before.fontSize}px, not 28px`);
    await page.screenshot({ path: path.join(out, 'shots', `${s.shot}-before.png`) });
    await page.setViewportSize({ width: 320, height: 480 });
    await pause(SETTLE);
    s.resized = trim(await page.evaluate(measureFocus));
    s.layoutResized = await layout(page);
    await page.screenshot({ path: path.join(out, 'shots', `${s.shot}-480.png`) });
    s.sizesUnchangedByResize = sameSizes(s.layoutBefore, s.layoutResized);
    check(s.sizesUnchangedByResize, 'the height-only resize changed strip or button sizes');
    check(s.layoutResized.activeIsMarked && s.resized.label === COFFEE, 'Coffee lost keyboard focus');
    check(JSON.stringify(s.layoutResized.selected) === JSON.stringify(['All situations']), `selection changed to ${s.layoutResized.selected}`);
    check(s.resized.complete, `after 320x480: ${s.resized.paintedOverflow}px of the outline covered, ${s.resized.clippedCharacters} characters clipped`);
    await page.setViewportSize({ width: 320, height: 844 });
    await pause(SETTLE);
    s.restored = trim(await page.evaluate(measureFocus));
    check(s.restored.complete, 'not completely visible after restoring 320x844');
    await page.setViewportSize({ width: 320, height: 480 });
    await pause(SETTLE);
    s.shrunkAgain = trim(await page.evaluate(measureFocus));
    s.layoutShrunkAgain = await layout(page);
    await page.screenshot({ path: path.join(out, 'shots', `${s.shot}-480-again.png`) });
    check(s.layoutShrunkAgain.activeIsMarked && s.shrunkAgain.complete, `second shrink: ${s.shrunkAgain.paintedOverflow}px covered`);
    check(JSON.stringify(s.layoutShrunkAgain.selected) === JSON.stringify(['All situations']), 'selection changed on the second shrink');
  },
  // 2-3. Ordinary text at 320 px and enlarged text at 390 px, each shrunk so the outline would end under the bar.
  async 'normal-320-100'(page, s, check) { await heightOnly(page, s, check, 320); },
  async 'enlarged-390-200'(page, s, check) { await heightOnly(page, s, check, 390); },
  // 4. Focus on Search: no chip reveal, no focus theft.
  async 'search-focus-320-200'(page, s, check) {
    await tabToCoffee(page);
    const coffee = await page.evaluate(measureFocus);
    s.height = coveringHeight(coffee);
    s.shiftTabsToSearch = await press(page, 'Shift+Tab', '<search>');
    s.layoutBefore = await layout(page);
    await page.setViewportSize({ width: 320, height: s.height });
    await pause(SETTLE);
    s.layoutResized = await layout(page);
    s.active = await active(page);
    check(s.active === '<search>', `focus moved to ${s.active}`);
    check(s.layoutResized.scrollY === s.layoutBefore.scrollY, `page scrolled from ${s.layoutBefore.scrollY} to ${s.layoutResized.scrollY}`);
    check(s.layoutResized.strip.scrollLeft === s.layoutBefore.strip.scrollLeft, 'strip scrolled');
  },
  // 5. A selected chip without focus, after manual horizontal scrolling, keeps the manual position.
  async 'manual-scroll-unfocused-320-100'(page, s, check) {
    await press(page, 'Tab', 'All situations');
    await press(page, 'Tab', 'Traveling');
    await page.keyboard.press('Enter');
    await pause();
    s.height = coveringHeight(await page.evaluate(measureFocus));
    await press(page, 'Shift+Tab', '<search>');
    const strip = await page.locator('.chip-row').boundingBox();
    // Labelled setup: Shift+Tab back to Search revealed All situations at the left edge; the user
    // then scrolls the strip part of the way with a horizontal wheel gesture, away from Traveling.
    await page.mouse.move(strip.x + strip.width / 2, strip.y + strip.height / 2);
    await page.mouse.wheel(120, 0);
    await pause(400);
    s.layoutBefore = await layout(page);
    check(s.layoutBefore.strip.scrollLeft > 0 && s.layoutBefore.strip.scrollLeft < s.layoutBefore.strip.scrollWidth - s.layoutBefore.strip.clientWidth, `manual scroll setup left scrollLeft at ${s.layoutBefore.strip.scrollLeft}`);
    await page.setViewportSize({ width: 320, height: s.height });
    await pause(SETTLE);
    s.layoutResized = await layout(page);
    check(s.layoutResized.strip.scrollLeft === s.layoutBefore.strip.scrollLeft, `manual position ${s.layoutBefore.strip.scrollLeft} became ${s.layoutResized.strip.scrollLeft}`);
    check(JSON.stringify(s.layoutResized.selected) === JSON.stringify(['Traveling']), 'selection changed');
    check(await active(page) === '<search>', 'focus moved');
    check(s.layoutResized.scrollY === s.layoutBefore.scrollY, 'page scrolled');
  },
  // 6. Resize, then focus moves to the next chip before the work runs: the new owner ends up visible.
  async 'focus-moves-after-resize-320-200'(page, s, check) {
    await tabToCoffee(page);
    await Promise.all([page.setViewportSize({ width: 320, height: 480 }), page.keyboard.press('Tab')]);
    await pause(SETTLE);
    s.after = trim(await page.evaluate(measureFocus));
    check(s.after.label === 'Free time and weekends' && s.after.complete, `owner after the move: ${s.after.label}, complete ${s.after.complete}`);
  },
  // 7. Resize, then navigate away at once: no errors and no late scrolling of the old screen.
  async 'navigate-after-resize-320-200'(page, s, check) {
    await tabToCoffee(page);
    await page.setViewportSize({ width: 320, height: 480 });
    await page.evaluate(() => { window.location.hash = 'index'; });
    await pause(SETTLE);
    s.heading = await page.evaluate(() => document.querySelector('main h1')?.textContent);
    s.scrollY = await page.evaluate(() => scrollY);
    check(s.heading === 'Home' && s.scrollY === 0, `after navigation: ${s.heading}, scrollY ${s.scrollY}`);
  },
  // 8. A burst of resizes: the reveal settles once and does not keep scrolling.
  async 'resize-burst-320-200'(page, s, check) {
    await tabToCoffee(page);
    await page.evaluate(() => { window.__rc2Scrolls = 0; addEventListener('scroll', () => { window.__rc2Scrolls += 1; }); });
    for (const height of [700, 620, 540, 500, 470, 480]) await page.setViewportSize({ width: 320, height });
    await pause(SETTLE);
    s.after = trim(await page.evaluate(measureFocus));
    s.scrollEvents = await page.evaluate(() => window.__rc2Scrolls);
    await pause(SETTLE);
    s.scrollEventsOneSecondLater = await page.evaluate(() => window.__rc2Scrolls);
    check(s.after.label === COFFEE && s.after.complete, `after the burst: ${s.after.paintedOverflow}px covered`);
    check(s.scrollEventsOneSecondLater === s.scrollEvents, `scrolling continued: ${s.scrollEvents} then ${s.scrollEventsOneSecondLater}`);
    check(s.scrollEvents <= 6, `${s.scrollEvents} scroll events for six resizes`);
  }
};

async function heightOnly(page, s, check, width) {
  await tabToCoffee(page);
  s.before = trim(await page.evaluate(measureFocus));
  s.layoutBefore = await layout(page);
  check(s.before.complete, 'not completely visible before the resize');
  s.height = coveringHeight(s.before);
  await page.setViewportSize({ width, height: s.height });
  await pause(SETTLE);
  s.resized = trim(await page.evaluate(measureFocus));
  s.layoutResized = await layout(page);
  await page.screenshot({ path: path.join(out, 'shots', `${s.shot}-resized.png`) });
  s.sizesUnchangedByResize = sameSizes(s.layoutBefore, s.layoutResized);
  check(s.sizesUnchangedByResize, 'the height-only resize changed strip or button sizes');
  check(s.layoutResized.activeIsMarked && s.resized.complete, `after ${width}x${s.height}: ${s.resized.paintedOverflow}px covered`);
  check(JSON.stringify(s.layoutResized.selected) === JSON.stringify(['All situations']), 'selection changed');
}

const server = await serve(site);
try {
  for (const engine of ['chromium', 'firefox']) {
    const browser = await pw[engine].launch({ headless: true });
    const result = report.engines[engine] = { version: browser.version(), scenarios: {} };
    for (const [id, run] of Object.entries(SCENARIOS)) {
      const [width, text] = id.match(/(\d+)-(\d+)$/).slice(1).map(Number);
      const errors = [];
      const failures = [];
      const s = { width, text, shot: `${name}-${engine}-${id}` };
      const { ctx, page, fonts } = await open(browser, server.base, width, text, errors);
      s.fontsLoaded = fonts;
      const check = (condition, message) => { if (!condition) failures.push(message); };
      check(fonts > 0, 'Eng Trainer Sans is not loaded');
      try { await run(page, s, check); } catch (error) { failures.push(`error: ${String(error).split('\n')[0]}`); }
      check(errors.length === 0, `page errors: ${errors.join(' | ')}`);
      result.scenarios[id] = { pass: failures.length === 0, failures, errors, ...s };
      console.log(engine, id, failures.length ? `FAIL ${failures.join(' | ')}` : 'pass');
      await ctx.close();
    }
    await browser.close();
  }
} finally { server.close(); }
report.summary = Object.fromEntries(Object.entries(report.engines).map(([engine, value]) => [engine, {
  passed: Object.values(value.scenarios).filter((item) => item.pass).length, total: Object.keys(value.scenarios).length
}]));
report.passed = Object.values(report.summary).every((item) => item.passed === item.total);
fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary));
if (!report.passed) process.exitCode = 1;
