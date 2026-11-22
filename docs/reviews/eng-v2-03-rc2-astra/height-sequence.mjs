// Supplement the unchanged RC1 probe with restore/re-shrink and the documented extra heights.
import fs from 'node:fs';
import path from 'node:path';
import { pw, out, pause, serve, measureFocus } from './browser-support.mjs';
const sites = { rc1: await serve(path.join(out, 'local/rc1-site')), rc2: await serve('site-dist') };
const report = { method: 'Native Tab to All, exactly three more Tabs to Coffee; actual text and loaded fonts; height-only 844 -> target -> 844 -> target; no clicks, refocus helpers, scrolling or extra clearance. Unchanged RC1 0.75px oracle.', engines: {} };
fs.mkdirSync(path.join(out, 'height-shots'), { recursive: true });
try {
  for (const engine of ['chromium', 'firefox']) {
    const browser = await pw[engine].launch({ headless: true }), cases = [];
    report.engines[engine] = { version: browser.version(), cases };
    for (const [build, site] of Object.entries(sites)) for (const [width, percent, height] of [[320, 200, 480], [320, 100, 443], [390, 200, 747]]) {
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
      await ctx.route((url) => !url.href.startsWith(site.base), (r) => r.abort());
      const page = await ctx.newPage();
      const entry = { build, width, percent, targetHeight: height, failures: [], visibilityFailures: [], errors: [], measurements: [] };
      cases.push(entry);
      const check = (ok, message) => { if (!ok) entry.failures.push(message); };
      page.on('pageerror', (e) => entry.errors.push(String(e).replaceAll(site.base, '/eng-trainer/')));
      await page.addInitScript(() => { window.__rejections = []; addEventListener('unhandledrejection', (e) => window.__rejections.push(String(e.reason))); });
      try {
        await page.goto(site.base + '#topic/small-talk', { waitUntil: 'networkidle' });
        await page.locator('.chip-row').waitFor();
        if (percent === 200) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        await page.evaluate(() => document.fonts.ready); await pause();
        entry.fonts = await page.evaluate(() => ({
          loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
          chipSize: getComputedStyle(document.querySelector('.chip-row button')).fontSize,
        }));
        check(entry.fonts.loaded.includes('Eng Trainer Sans') && parseFloat(entry.fonts.chipSize) === (percent === 200 ? 28 : 14), 'Actual text and intended font');
        let entered = false;
        for (let n = 1; n <= 40; n++) {
          await page.keyboard.press('Tab');
          if (await page.evaluate(() => document.activeElement?.matches('.chip-row > button') && document.activeElement.textContent.trim() === 'All situations')) {
            entry.tabsToAll = n; entered = true; break;
          }
        }
        check(entered, 'Tab reaches All situations');
        for (let n = 0; n < 3; n++) await page.keyboard.press('Tab');
        const coffee = await page.locator('.chip-row button').nth(3).elementHandle();
        const sizes = () => page.evaluate(() => {
          const strip = document.querySelector('.chip-row'), r = strip.getBoundingClientRect();
          const chip = strip.children[3].getBoundingClientRect();
          return { stripWidth: r.width, stripHeight: r.height, clientWidth: strip.clientWidth, clientHeight: strip.clientHeight,
            scrollWidth: strip.scrollWidth, chipWidth: chip.width, chipHeight: chip.height };
        });
        const baselineSize = await sizes();
        for (const [step, currentHeight] of [['initial', 844], ['shrink', height], ['restore', 844], ['second-shrink', height]]) {
          if (step !== 'initial') await page.setViewportSize({ width, height: currentHeight });
          await pause(1000);
          const geometry = await page.evaluate(measureFocus), dimensions = await sizes();
          const sameElement = await coffee.evaluate((el) => el.isConnected && document.activeElement === el);
          const selected = await page.locator('.chip-row [aria-pressed=true]').allTextContents();
          entry.measurements.push({ step, ...geometry, dimensions, sameElement, selected });
          check(geometry.label === 'Coffee and lunch breaks' && sameElement && geometry.focusVisible, step + ': original keyboard focus owner');
          check(JSON.stringify(selected) === JSON.stringify(['All situations']), step + ': unchanged selection');
          check(Object.keys(baselineSize).every((key) => Math.abs(dimensions[key] - baselineSize[key]) < 0.001), step + ': unchanged strip/chip dimensions');
          if (!geometry.complete) entry.visibilityFailures.push(step);
          if (step === 'shrink' || step === 'second-shrink') {
            const shot = 'height-shots/' + [build, engine, width, percent, step].join('-') + '.png';
            await page.screenshot({ path: path.join(out, shot) });
            (entry.screenshots ??= []).push(shot);
          }
        }
        entry.rejections = await page.evaluate(() => window.__rejections);
        check(entry.errors.length === 0 && entry.rejections.length === 0, 'No native errors or unhandled rejections');
      } catch (e) { entry.failures.push(String(e)); }
      entry.passed = entry.failures.length === 0 && entry.visibilityFailures.length === 0;
      console.log(engine, build, width, percent, JSON.stringify({ failures: entry.failures, clipped: entry.visibilityFailures }));
      await ctx.close();
    }
    await browser.close();
  }
} finally { Object.values(sites).forEach((site) => site.close()); }
report.passed = Object.values(report.engines).every((e) => e.cases.every((c) => c.failures.length === 0 &&
  (c.build === 'rc2' ? c.visibilityFailures.length === 0 : JSON.stringify(c.visibilityFailures) === JSON.stringify(['shrink', 'second-shrink']))));
fs.writeFileSync(path.join(out, 'height-sequence.json'), JSON.stringify(report, null, 2) + '\n');
if (!report.passed) process.exitCode = 1;
