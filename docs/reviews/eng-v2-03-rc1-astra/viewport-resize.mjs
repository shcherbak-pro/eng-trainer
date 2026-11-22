// Follow-up to a concrete code-inspection risk: ResizeObserver watches chip/strip sizes,
// but viewport height can change their effective clipping area without changing those sizes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pw, out, pause, serve, measureFocus } from './browser-support.mjs';
const site = await serve('site-dist');
const result = { runnerSha256: createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex'),
  method: 'Real Tab to Coffee at 320x844 with actual 200% text, then height-only viewport resize to 320x480, 1000ms settlement, no test-side reveal.', engines: {} };
try {
  for (const engine of ['chromium', 'firefox']) {
    const browser = await pw[engine].launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 320, height: 844 }, reducedMotion: 'reduce' });
    await ctx.route((url) => !url.href.startsWith(site.base), (r) => r.abort());
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(String(e).replaceAll(site.base, '/eng-trainer/')));
    await page.goto(site.base + '#topic/small-talk', { waitUntil: 'networkidle' });
    await page.locator('.chip-row').waitFor();
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await page.evaluate(() => document.fonts.ready); await pause();
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => document.activeElement?.matches('.chip-row > button') &&
        document.activeElement.textContent.trim() === 'Coffee and lunch breaks')) break;
    }
    await pause(); const before = await page.evaluate(measureFocus);
    assert.equal(before.label, 'Coffee and lunch breaks'); assert(before.complete);
    await page.setViewportSize({ width: 320, height: 480 }); await pause(1000);
    const resized = await page.evaluate(measureFocus);
    const shot = 'shots/rc1-' + engine + '-height-only-480.png';
    await page.screenshot({ path: path.join(out, shot) });
    await page.keyboard.press('Tab'); await pause();
    await page.keyboard.press('Shift+Tab'); await pause();
    const refocused = await page.evaluate(measureFocus);
    const recoveryShot = 'shots/rc1-' + engine + '-height-only-480-refocused.png';
    await page.screenshot({ path: path.join(out, recoveryShot) });
    result.engines[engine] = { version: browser.version(), before, resized, refocused, errors, shot, recoveryShot };
    console.log(engine, JSON.stringify({ before: before.complete, resized: resized.complete, excess: resized.paintedOverflow, refocused: refocused.complete, errors }));
    await ctx.close(); await browser.close();
  }
} finally { site.close(); }
result.passed = Object.values(result.engines).every((e) => e.resized.complete && e.errors.length === 0);
fs.writeFileSync(path.join(out, 'viewport-resize.json'), JSON.stringify(result, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'viewport-resize.log'), Object.entries(result.engines).map(([engine, e]) =>
  engine + ': before=' + e.before.complete + ', resized=' + e.resized.complete + ', refocused=' + e.refocused.complete +
  ', clipped outline pixels=' + e.resized.paintedOverflow + ', application errors=' + e.errors.length).join('\n') +
  '\n[exit ' + (result.passed ? 0 : 1) + ']\n');
if (!result.passed) process.exitCode = 1;
