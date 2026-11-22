// Follow-up probes: theme-flash filmstrip, F3 via keyboard file chooser, icon-font flash without font wait,
// and the icon font size a regular desktop Chrome receives. Fresh, non-persistent contexts; synthetic data only.
// NOTE (ENG-V2-UX-01A): the theme timing fields this script writes (themeRuns, throttled.*) are null because its
// init-script logger touched document.documentElement before it existed. The filmstrip frames are valid.
// Use theme-flash-and-f3.mjs for the theme timings reported in ENG-V2-UX-01A.md.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , pwDir, outDir] = process.argv;
const require = createRequire(import.meta.url);
const { chromium } = require(join(pwDir, 'playwright'));
const BASE = 'https://shcherbak-pro.github.io/eng-trainer/';
mkdirSync(join(outDir, 'probe2'), { recursive: true });
const out = {};
const browser = await chromium.launch({ headless: true });

// 1. Theme flash: saved Dark preference, light system theme.
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  await context.addInitScript(() => {
    const log = [];
    Object.defineProperty(window, '__themeLog', { value: log, configurable: true });
    const push = (label) => log.push({ t: Math.round(performance.now()), theme: document.documentElement.getAttribute('data-theme'), label });
    push('init');
    new MutationObserver(() => push('data-theme')).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    try {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) log.push({ t: Math.round(e.startTime), theme: document.documentElement.getAttribute('data-theme'), label: e.name }); })
        .observe({ type: 'paint', buffered: true });
    } catch (error) { push('paint-observer-error:' + error); }
    document.addEventListener('DOMContentLoaded', () => push('dcl'));
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-shell', { timeout: 45000 });
  await page.locator('.theme-toggle').click();
  await page.locator('.theme-toggle').click();
  await page.waitForTimeout(700);
  out.toggleLabel = await page.locator('.theme-toggle').getAttribute('aria-label');

  const runs = [];
  for (let i = 0; i < 5; i += 1) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.app-shell', { timeout: 45000 });
    await page.waitForTimeout(300);
    const log = await page.evaluate(() => window.__themeLog.map((e) => ({ ...e })));
    if (i === 0) out.rawThemeLog = log;
    const fp = log.find((e) => e.label === 'first-paint');
    const dark = log.find((e) => e.label === 'data-theme' && e.theme === 'dark');
    runs.push({ firstPaint: fp?.t ?? null, themeAtFirstPaint: fp?.theme ?? null, darkAppliedAt: dark?.t ?? null, lightVisibleMs: fp && dark ? Math.max(0, dark.t - fp.t) : null });
  }
  out.themeRuns = runs;

  // Filmstrip with a 4x CPU slowdown (approximates a mid-range phone).
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const frames = [];
  cdp.on('Page.screencastFrame', async (frame) => {
    frames.push({ ts: frame.metadata.timestamp, data: frame.data });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }); } catch { /* closed */ }
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 390, maxHeight: 844 });
  const started = Date.now() / 1000;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-shell', { timeout: 45000 });
  await page.waitForTimeout(600);
  await cdp.send('Page.stopScreencast');
  const throttledLog = await page.evaluate(() => window.__themeLog.map((e) => ({ ...e })));
  const fp = throttledLog.find((e) => e.label === 'first-paint');
  const dark = throttledLog.find((e) => e.label === 'data-theme' && e.theme === 'dark');
  out.throttled = { firstPaint: fp?.t ?? null, darkAppliedAt: dark?.t ?? null, lightVisibleMs: fp && dark ? dark.t - fp.t : null, frames: frames.length };
  const keep = frames.filter((f) => f.ts >= started - 1).slice(0, 40);
  keep.forEach((f, index) => writeFileSync(join(outDir, 'probe2', `theme-frame-${String(index).padStart(2, '0')}-${Math.round((f.ts - started) * 1000)}ms.png`), Buffer.from(f.data, 'base64')));
  out.filmstripFrames = keep.length;
  await context.close();
}

// 2. F3 through the keyboard file chooser, in Chromium.
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto(BASE + '#collections', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-shell', { timeout: 45000 });
  const input = page.locator('input[type="file"]');
  await input.focus();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.keyboard.press('Space');
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from('english,translation\nsynthetic word,синтетичне слово', 'utf8') });
  await page.waitForSelector('.import-preview');
  const samples = [];
  for (let i = 0; i < 4; i += 1) {
    samples.push(await page.evaluate(() => { const el = document.activeElement; return `${el?.tagName}${el?.getAttribute('type') ? `[type=${el.getAttribute('type')}]` : ''}`; }));
    await page.waitForTimeout(150);
  }
  out.f3KeyboardChooser = { activeElementAfterPreview: samples };
  await context.close();
}

// 3. Icon names visible while the icon font is still downloading (CDP capture does not wait for fonts).
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', isMobile: true, hasTouch: true });
  await context.route('https://fonts.gstatic.com/**', async (route) => { await new Promise((resolve) => setTimeout(resolve, 6000)); await route.continue().catch(() => undefined); });
  const page = await context.newPage();
  await page.goto(BASE + '#flashcards', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-shell', { timeout: 45000 });
  await page.waitForTimeout(400);
  const cdp = await context.newCDPSession(page);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, 'probe2', 'icon-font-flash-mobile-flashcards.png'), Buffer.from(shot.data, 'base64'));
  out.iconFontLoadedAtCapture = await page.evaluate(() => document.fonts.check('22px "Material Symbols Rounded"'));
  await context.close();
}

await browser.close();

// 4. What a regular desktop Chrome downloads for the icon font (Google Fonts varies the format by user agent).
{
  const css = await (await fetch('https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400..700,0..1,0&display=swap', {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' }
  })).text();
  const url = css.match(/url\((https:[^)]+)\)/)?.[1];
  const bytes = url ? (await (await fetch(url)).arrayBuffer()).byteLength : null;
  out.iconFontForDesktopChrome = { format: css.match(/format\('([^']+)'\)/)?.[1] ?? null, bytes, display: css.match(/font-display:\s*(\w+)/)?.[1] ?? null };
}

writeFileSync(join(outDir, 'probe2', 'results.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, rawThemeLog: out.rawThemeLog?.slice(0, 12) }, null, 1));
