// Theme-flash timings (fixed logger) and F3 focus behaviour in Chromium and Firefox.
// Fresh, non-persistent contexts; synthetic data only.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , pwDir, outFile] = process.argv;
const require = createRequire(import.meta.url);
const pw = require(join(pwDir, 'playwright'));
const BASE = 'https://shcherbak-pro.github.io/eng-trainer/';
const out = { versions: {} };
const median = (values) => { const v = values.filter((x) => x !== null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };

// ---- Theme flash (Chromium) ------------------------------------------------
{
  const browser = await pw.chromium.launch({ headless: true });
  out.versions.chromium = browser.version();
  for (const throttle of [1, 4]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
    await context.addInitScript(() => {
      const log = [];
      window.__themeLog = log;
      const theme = () => (document.documentElement ? document.documentElement.getAttribute('data-theme') : null);
      const push = (label) => log.push({ t: Math.round(performance.now()), theme: theme(), label });
      push('init');
      let shell = false;
      new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && m.target === document.documentElement) push('data-theme');
          if (!shell && m.type === 'childList' && document.querySelector('.app-shell')) { shell = true; push('app-shell'); }
        }
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-theme'] });
      new PerformanceObserver((list) => { for (const e of list.getEntries()) log.push({ t: Math.round(e.startTime), theme: theme(), label: e.name }); })
        .observe({ type: 'paint', buffered: true });
    });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.app-shell', { timeout: 45000 });
    await page.locator('.theme-toggle').click();
    await page.locator('.theme-toggle').click();
    await page.waitForTimeout(700);
    const label = await page.locator('.theme-toggle').getAttribute('aria-label');
    if (throttle > 1) { const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
    const runs = [];
    for (let i = 0; i < 6; i += 1) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.app-shell', { timeout: 60000 });
      await page.waitForTimeout(300);
      const log = await page.evaluate(() => window.__themeLog.map((e) => ({ ...e })));
      const fp = log.find((e) => e.label === 'first-paint');
      const dark = log.find((e) => e.label === 'data-theme' && e.theme === 'dark');
      const shellAt = log.find((e) => e.label === 'app-shell');
      runs.push({ firstPaint: fp?.t ?? null, themeAtFirstPaint: fp?.theme ?? null, darkAppliedAt: dark?.t ?? null, appShellAt: shellAt?.t ?? null, lightVisibleMs: fp && dark ? Math.max(0, dark.t - fp.t) : null });
      if (i === 0) out[`rawLog_x${throttle}`] = log;
    }
    out[`theme_x${throttle}`] = { toggleLabel: label, runs, medianLightVisibleMs: median(runs.map((r) => r.lightVisibleMs)), medianFirstPaint: median(runs.map((r) => r.firstPaint)), medianDarkAt: median(runs.map((r) => r.darkAppliedAt)) };
    await context.close();
  }
  await browser.close();
}

// ---- F3: keyboard file chooser, preview and error paths --------------------
for (const engine of ['chromium', 'firefox']) {
  const browser = await pw[engine].launch({ headless: true });
  out.versions[engine] = browser.version();
  const result = {};
  for (const [kind, csv] of [['preview', 'english,translation\nsynthetic word,синтетичне слово'], ['error', 'english,topic\nwithout translation,Synthetic']]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(BASE + '#collections', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.app-shell', { timeout: 45000 });
    await page.locator('input[type="file"]').focus();
    const chooserPromise = page.waitForEvent('filechooser');
    await page.keyboard.press('Space');
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: `synthetic-${kind}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await page.waitForSelector(kind === 'preview' ? '.import-preview' : '.notice[role="alert"]', { timeout: 15000 });
    await page.waitForTimeout(400);
    result[kind] = await page.evaluate(() => { const el = document.activeElement; return `${el?.tagName}${el?.getAttribute('type') ? `[type=${el.getAttribute('type')}]` : ''}`; });
    await page.keyboard.press('Tab');
    result[`${kind}NextTab`] = await page.evaluate(() => { const el = document.activeElement; return (el?.getAttribute('aria-label') || el?.textContent || el?.tagName || '').trim().slice(0, 40); });
    await context.close();
  }
  out[`f3_${engine}`] = result;
  await browser.close();
}

writeFileSync(outFile, JSON.stringify(out, null, 2));
const { rawLog_x1, rawLog_x4, ...summary } = out;
console.log(JSON.stringify({ ...summary, rawLog_x1: rawLog_x1?.slice(0, 10) }, null, 1));
