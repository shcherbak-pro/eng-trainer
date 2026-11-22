// Same native assertions for the preserved reviewed build and RC1. Run from the worktree:
// node docs/evidence/eng-v2-03-rc1/focused-chips.mjs <site-directory> <result-name>
// No test-side chip focus/scroll/reveal before visibility measurements: only real keyboard events.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const out = path.resolve('docs/evidence/eng-v2-03-rc1');
const site = path.resolve(process.argv[2]);
const name = process.argv[3];
if (!/^[a-z0-9-]+$/.test(name ?? '')) throw new Error('Supply a result name');
const common = path.resolve(execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim());
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(common, 'eng-v2-02b-release/browsers');
const pw = createRequire(import.meta.url)(path.join(common, 'eng-v2-02b-release/tools/node_modules/playwright'));
const labels = ['All situations', 'Meeting new people', 'Before a work meeting', 'Coffee and lunch breaks',
  'Free time and weekends', 'Conferences and events', 'Traveling'];
const pack = JSON.parse(fs.readFileSync('content/packs/small-talk.json', 'utf8')).content;
const topic = pack.topics[0];
const phrases = new Map(pack.phrases.map((phrase) => [phrase.id, phrase.phrase]));
const expectedRows = [pack.phrases.map((phrase) => phrase.phrase), ...topic.sections.map((section) => section.items.map((id) => phrases.get(id)))];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (!url.pathname.startsWith('/eng-trainer/')) { response.writeHead(404).end(); return; }
  let file = path.resolve(site, '.' + decodeURIComponent(url.pathname.slice('/eng-trainer'.length)));
  if (!file.startsWith(site + path.sep) && file !== site) { response.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  response.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/eng-trainer/`;
const report = {
  runnerSha256: createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex'),
  buildIndexSha256: createHash('sha256').update(fs.readFileSync(path.join(site, 'index.html'))).digest('hex'),
  method: 'Fresh isolated native contexts; intended fonts loaded; html font-size 100% or 200%; real Tab/Shift+Tab/Enter/Space. 250 ms settling. No test-side chip revelation. Geometry intersects every clipping ancestor client area with viewport and fixed tab bar; expands border box by computed outline width + offset. Text Range rectangles must fit inside the control. Fractional-pixel tolerance 0.75 CSS px.',
  engines: {}
};
fs.mkdirSync(path.join(out, 'shots'), { recursive: true });
const pause = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
const activeLabel = (page) => page.evaluate(() => document.activeElement?.matches('.chip-row > button') ? document.activeElement.textContent.trim() : null);
const selectedLabel = (page) => page.locator('.chip-row [aria-pressed=true]').textContent();

// Read-only geometric oracle, deliberately independent of the production reveal algorithm.
function geometry() {
  const node = document.activeElement;
  const strip = document.querySelector('.chip-row');
  if (!node || node.parentElement !== strip) return { focusMissing: true, active: node?.tagName };
  const rect = (r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height });
  const box = node.getBoundingClientRect(), css = getComputedStyle(node);
  const outline = css.outlineStyle === 'none' ? 0 : parseFloat(css.outlineWidth) + Math.max(0, parseFloat(css.outlineOffset));
  const clip = { left: 0, right: document.documentElement.clientWidth, top: 0, bottom: innerHeight };
  const ancestors = [];
  for (let parent = node.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
    const style = getComputedStyle(parent), r = parent.getBoundingClientRect();
    const bounds = { left: r.left + parent.clientLeft, right: r.left + parent.clientLeft + parent.clientWidth,
      top: r.top + parent.clientTop, bottom: r.top + parent.clientTop + parent.clientHeight };
    const clipsX = /(auto|scroll|hidden|clip)/.test(style.overflowX);
    const clipsY = /(auto|scroll|hidden|clip)/.test(style.overflowY);
    if (clipsX) { clip.left = Math.max(clip.left, bounds.left); clip.right = Math.min(clip.right, bounds.right); }
    if (clipsY) { clip.top = Math.max(clip.top, bounds.top); clip.bottom = Math.min(clip.bottom, bounds.bottom); }
    if (clipsX || clipsY) ancestors.push({ className: parent.className, ...bounds, clipsX, clipsY });
  }
  const bar = document.querySelector('.tab-bar');
  if (bar && getComputedStyle(bar).position === 'fixed' && bar.getBoundingClientRect().height > 0) clip.bottom = Math.min(clip.bottom, bar.getBoundingClientRect().top);
  const painted = { left: box.left - outline, right: box.right + outline, top: box.top - outline, bottom: box.bottom + outline };
  const range = document.createRange(); range.selectNodeContents(node);
  const text = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0).map(rect);
  const tolerance = 0.75;
  const inside = (r, b) => r.left >= b.left - tolerance && r.right <= b.right + tolerance && r.top >= b.top - tolerance && r.bottom <= b.bottom + tolerance;
  return { label: node.textContent.trim(), connected: node.isConnected, focusVisible: node.matches(':focus-visible'),
    selected: node.getAttribute('aria-pressed'), box: rect(box), outline, painted, clip, ancestors, text,
    textFits: text.length > 0 && text.every((r) => inside(r, box)), fullVisibility: inside(painted, clip),
    scrollLeft: strip.scrollLeft, scrollY, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    font: css.font, whiteSpace: css.whiteSpace, textOverflow: css.textOverflow };
}

try {
  for (const engine of ['chromium', 'firefox']) {
    const browser = await pw[engine].launch({ headless: true });
    const scenarios = [];
    report.engines[engine] = { version: browser.version(), scenarios };
    async function scenario(id, width, scale, run) {
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
      await ctx.route((url) => !url.href.startsWith(base), (route) => route.abort());
      await ctx.addInitScript(() => {
        window.__rc1Rejections = [];
        addEventListener('unhandledrejection', (event) => window.__rc1Rejections.push(String(event.reason)));
        const speech = { speaking: false, pending: false, paused: false, speak() {}, cancel() {}, pause() {}, resume() {}, getVoices() { return []; }, addEventListener() {}, removeEventListener() {} };
        Object.defineProperty(window, 'speechSynthesis', { value: speech });
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} } });
      });
      const page = await ctx.newPage();
      const result = { id, width, textPercent: scale, failures: [], errors: [], measurements: [] };
      scenarios.push(result);
      page.on('pageerror', (error) => result.errors.push(String(error).replaceAll(base, '/eng-trainer/')));
      page.on('console', (message) => { if (message.type() === 'error') result.errors.push(message.text().replaceAll(base, '/eng-trainer/')); });
      const check = (ok, message) => { if (!ok) result.failures.push(message); };
      const measure = async (step, expected) => {
        await pause();
        const facts = await page.evaluate(geometry);
        result.measurements.push({ step, ...facts });
        check(facts.label === expected && facts.connected && facts.focusVisible, `${step}: focus ownership/indicator ${facts.label}`);
        check(facts.fullVisibility === true, `${step}: label/outline clipped`);
        check(facts.textFits === true && facts.textOverflow !== 'ellipsis', `${step}: text clipped within button`);
        check(facts.outline >= 4, `${step}: missing original 2px outline + 2px offset`);
        check(facts.pageOverflow <= 0.75, `${step}: page overflow`);
        return facts;
      };
      const enterStrip = async () => {
        for (let i = 0; i < 20; i++) {
          await page.keyboard.press('Tab');
          if (await activeLabel(page)) break;
        }
        check(await activeLabel(page) === labels[0], 'Tab order must enter at All situations');
      };
      const screenshot = async (suffix) => {
        const file = `${name}-${engine}-${id}-${suffix}.png`;
        await page.screenshot({ path: path.join(out, 'shots', file) });
        (result.screenshots ??= []).push('shots/' + file);
      };
      try {
        await page.goto(base + '#topic/small-talk', { waitUntil: 'networkidle' });
        await page.locator('.chip-row').waitFor();
        if (scale === 200) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        await page.evaluate(() => document.fonts.ready);
        await pause();
        result.fonts = await page.evaluate(() => ({ ready: document.fonts.status, ui: document.fonts.check('600 28px "Eng Trainer Sans"', 'Before a work meeting'), loaded: [...document.fonts].filter((font) => font.status === 'loaded').map((font) => font.family) }));
        check(result.fonts.ready === 'loaded' && result.fonts.ui && result.fonts.loaded.includes('Eng Trainer Sans'), 'Intended UI font must be loaded');
        check(await page.locator('.chip-row').getAttribute('role') === 'group' && await page.locator('.chip-row').getAttribute('aria-label') === 'Situations', 'Labelled button group');
        check(JSON.stringify(await page.locator('.chip-row button').allTextContents()) === JSON.stringify(labels), 'Complete authored labels/order');
        await run({ page, result, check, measure, enterStrip, screenshot });
        result.rejections = await page.evaluate(() => window.__rc1Rejections);
        check(result.errors.length === 0 && result.rejections.length === 0, 'Unexpected page error / unhandled rejection');
      } catch (error) { result.failures.push(String(error).replaceAll(base, '/eng-trainer/')); }
      result.passed = result.failures.length === 0;
      console.log(engine, id, result.passed ? 'PASS' : `FAIL (${result.failures.length})`);
      await ctx.close();
    }

    for (const width of [320, 390]) for (const scale of [100, 200]) {
      await scenario(`matrix-${width}-${scale}`, width, scale, async ({ page, result, check, measure, enterStrip, screenshot }) => {
        result.initialDimensions = await page.locator('.chip-row').evaluate((strip) => ({ available: strip.clientWidth, chips: [...strip.children].map((node) => ({ label: node.textContent, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })) }));
        await enterStrip();
        let selection = labels[0];
        for (let i = 0; i < labels.length; i++) {
          if (i) await page.keyboard.press('Tab');
          check((await selectedLabel(page)).trim() === selection, `${labels[i]}: focus must not select`);
          const before = await measure(`Tab ${i}`, labels[i]);
          // All, the original failures, Coffee, Conferences and the final chip: every filter, both keys.
          for (const key of ['Enter', 'Space']) {
            const target = await page.locator('.chip-row button').nth(i).elementHandle();
            await page.keyboard.press(key);
            const after = await measure(`${key} ${i}`, labels[i]);
            check(await target.evaluate((node) => node.isConnected && document.activeElement === node), `${key} ${i}: preserve the same focused element`);
            check(after.selected === 'true', `${key} ${i}: pressed state`);
            check(JSON.stringify(await page.locator('.phrase-card .entry__term').allTextContents()) === JSON.stringify(expectedRows[i]), `${key} ${i}: expected filtered phrases`);
            check(Math.abs(after.scrollY - before.scrollY) <= 0.75, `${key} ${i}: unnecessary page jump`);
            selection = labels[i];
          }
          if ((scale === 100 && i === 2) || (scale === 200 && i === 3)) await screenshot(`selected-${i}`);
        }
        await page.keyboard.press('Tab');
        check(await activeLabel(page) === null, 'Tab leaves after last chip');
        for (let i = labels.length - 1; i >= 0; i--) {
          await page.keyboard.press('Shift+Tab');
          await measure(`Shift+Tab ${i}`, labels[i]);
          check((await selectedLabel(page)).trim() === labels[6], 'Reverse focus must not select');
        }
        // Firefox also exposes the overflow container as a native Tab stop. Leave that stop
        // intact and assert the buttons' order independently of this engine-specific stop.
        await page.keyboard.press('Shift+Tab');
        if (await page.evaluate(() => document.activeElement.matches('.chip-row'))) await page.keyboard.press('Shift+Tab');
        check(await page.evaluate(() => document.activeElement.matches('input[type=search]')), 'Tab order before strip is search');
        await page.keyboard.type('have you');
        await pause();
        check(JSON.stringify(await page.locator('.phrase-card .entry__term').allTextContents()) === JSON.stringify(['Have you been here before?', 'Have you had a chance to explore the city?']), 'Traveling plus have you returns the two expected phrases');
        await enterStrip();
        for (let i = 0; i < labels.length; i++) { if (i) await page.keyboard.press('Tab'); await measure(`Search + Tab ${i}`, labels[i]); }
        await page.keyboard.press('Space');
        await measure('Search + Space Traveling', labels[6]);
        await page.evaluate(() => { location.hash = 'index'; }); await pause();
        await page.evaluate(() => { location.hash = 'topic/small-talk'; }); await pause();
        check((await selectedLabel(page)).trim() === labels[6] && await page.locator('input[type=search]').inputValue() === 'have you', 'Selection/search retained in memory across navigation');
        await page.reload({ waitUntil: 'networkidle' }); await page.locator('.chip-row').waitFor();
        check((await selectedLabel(page)).trim() === labels[0] && await page.locator('input[type=search]').inputValue() === '', 'Selection/search reset on reload');
      });
    }

    await scenario('focused-reflow', 390, 100, async ({ page, result, check, measure, enterStrip, screenshot }) => {
      await enterStrip();
      for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
      await measure('Coffee before reflow', labels[3]);
      const target = await page.locator('.chip-row button').nth(3).elementHandle();
      await page.setViewportSize({ width: 320, height: 844 });
      await measure('390 to 320 with focus retained', labels[3]);
      const style = await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await page.evaluate(() => document.fonts.ready);
      await measure('100 to 200 percent with focus retained', labels[3]);
      check(await target.evaluate((node) => document.activeElement === node && node.isConnected), 'Reflow retains the original focus owner');
      await screenshot('200-percent');
      await style.evaluate((node) => node.remove());
      await page.setViewportSize({ width: 390, height: 844 });
      await measure('Return to 390 and 100 percent', labels[3]);
      check((await selectedLabel(page)).trim() === labels[0], 'Reflow must not select');
    });

    await scenario('vertical-and-manual-scroll', 390, 100, async ({ page, result, check, measure, enterStrip }) => {
      await enterStrip();
      const first = await measure('All visible', labels[0]);
      for (let i = 1; i < labels.length; i++) {
        await page.keyboard.press('Tab');
        const facts = await measure(`Visible strip Tab ${i}`, labels[i]);
        check(Math.abs(facts.scrollY - first.scrollY) <= 0.75, `Tab ${i}: visible strip must not jump vertically`);
      }
      await page.keyboard.press('Enter'); await pause();
      await page.keyboard.press('Tab'); // Selected Traveling is now unfocused.
      // Deliberate manual horizontal scrolling is a separate behavior check, never a visibility setup.
      const stripBox = await page.locator('.chip-row').boundingBox();
      await page.mouse.move(stripBox.x + stripBox.width / 2, stripBox.y + stripBox.height / 2);
      await page.mouse.wheel(-2000, 0); await pause();
      const manual = await page.locator('.chip-row').evaluate((node) => node.scrollLeft);
      await pause(400);
      check(manual < 5 && await page.locator('.chip-row').evaluate((node) => node.scrollLeft) === manual, 'Unfocused selected chip must not pull back a manually scrolled strip');
      // Move the strip genuinely off screen while retaining the next control's focus. The next
      // Shift+Tab must bring Traveling back through ordinary native keyboard focus.
      await page.evaluate(() => window.scrollBy(0, 650)); await pause();
      result.offscreenSetup = await page.locator('.chip-row').evaluate((node) => ({ bottom: node.getBoundingClientRect().bottom, scrollY }));
      check(result.offscreenSetup.bottom < 0, 'Offscreen precondition');
      await page.keyboard.press('Shift+Tab');
      await measure('Native focus from vertically offscreen', labels[6]);
    });

    await scenario('focus-ownership-and-unmount', 390, 100, async ({ page, result, check, measure, enterStrip }) => {
      await enterStrip(); await measure('Initial focus', labels[0]);
      // Hold scheduled animation frames to force the ownership boundary deterministically. Resize,
      // keyboard events and DOM changes are still native. Releasing canceled callbacks deliberately
      // tests the guard as well as ordinary cancellation, without observing implementation methods.
      await page.evaluate(() => {
        window.__rc1Frames = [];
        window.__rc1Raf = requestAnimationFrame;
        window.__rc1CancelRaf = cancelAnimationFrame;
        window.requestAnimationFrame = (callback) => { window.__rc1Frames.push(callback); return 1000000 + window.__rc1Frames.length; };
        window.cancelAnimationFrame = (id) => { if (id < 1000000) window.__rc1CancelRaf(id); };
      });
      await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
      // Back out of the strip entirely before any deferred reveal can execute.
      await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab');
      if (await page.evaluate(() => document.activeElement.matches('.chip-row'))) await page.keyboard.press('Shift+Tab');
      const snapshot = () => page.evaluate(() => ({ left: document.querySelector('.chip-row')?.scrollLeft, y: scrollY, active: document.activeElement?.outerHTML }));
      const before = await snapshot();
      await page.evaluate(() => { const frames = window.__rc1Frames.splice(0); for (const callback of frames) callback(performance.now()); });
      await pause();
      check(JSON.stringify(await snapshot()) === JSON.stringify(before), 'Deferred reveal must not scroll or steal focus after focus moves to search');
      await enterStrip(); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
      await page.evaluate(() => { window.__rc1OldStrip = document.querySelector('.chip-row'); location.hash = 'index'; });
      await page.locator('.home-overview').waitFor(); await pause();
      const unmounted = await page.evaluate(() => ({ oldLeft: window.__rc1OldStrip.scrollLeft, connected: window.__rc1OldStrip.isConnected, y: scrollY, active: document.activeElement?.outerHTML }));
      await page.evaluate(() => {
        const frames = window.__rc1Frames.splice(0);
        window.requestAnimationFrame = window.__rc1Raf; window.cancelAnimationFrame = window.__rc1CancelRaf;
        for (const callback of frames) callback(performance.now());
      });
      await pause();
      const released = await page.evaluate(() => ({ oldLeft: window.__rc1OldStrip.scrollLeft, connected: window.__rc1OldStrip.isConnected, y: scrollY, active: document.activeElement?.outerHTML }));
      result.unmount = { before: unmounted, after: released };
      check(!unmounted.connected && JSON.stringify(released) === JSON.stringify(unmounted), 'No obsolete reveal after topic unmount');
    });
    await browser.close();
  }
} finally { server.close(); }
report.passed = Object.values(report.engines).every((engine) => engine.scenarios.every((scenario) => scenario.passed));
fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(report, null, 2) + '\n');
console.log(report.passed ? 'ALL PASSED' : 'FAILED; see result JSON');
if (!report.passed) process.exitCode = 1;
