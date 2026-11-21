// ENG-V2-02B Fable review — can the end of a long page be scrolled above the
// fixed bottom navigation? Compares the released build (020babf) with the
// candidate in Chromium and Firefox at phone widths.
// Usage: node mobile-bottom-probe.mjs <candidate site-dist> <released dist> <playwright-tools> <out-dir>
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const [candidate, released, tools, outDir] = process.argv.slice(2);
const out = resolve(outDir); await mkdir(out, { recursive: true });
const { chromium, firefox } = await import(pathToFileURL(join(resolve(tools), 'node_modules/playwright/index.mjs')).href);
const FONT_STUB = '.material-symbols-rounded{display:inline-block;width:1em;height:1em;overflow:hidden;line-height:1;white-space:nowrap}';
const roots = { candidate: resolve(candidate), released: resolve(released) };
let current = 'candidate';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const http = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const root = roots[current];
    let file = resolve(root, path.slice('/eng-trainer/'.length));
    if (!(file === root || file.startsWith(root + sep))) throw new Error('outside');
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    res.writeHead(200, { 'Content-Type': (types[extname(file)] ?? 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => http.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${http.address().port}/eng-trainer/`;

const results = [];
for (const [engine, type] of Object.entries({ chromium, firefox })) {
  const browser = await type.launch({ headless: true });
  for (const build of ['released', 'candidate']) {
    current = build;
    for (const [w, h] of [[390, 844], [320, 640]]) {
      for (const hash of ['#phrases', '#collections']) {
        const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
        await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: FONT_STUB }));
        const page = await context.newPage();
        await page.goto(base + hash); await page.locator('.app-shell').waitFor(); await page.waitForTimeout(300);
        const methods = {};
        for (const method of ['scrollTo-instant', 'End-key', 'wheel']) {
          await page.evaluate(() => document.documentElement.scrollTo({ top: 0, behavior: 'instant' }));
          if (method === 'scrollTo-instant') await page.evaluate(() => document.documentElement.scrollTo({ top: 1e9, behavior: 'instant' }));
          if (method === 'End-key') { await page.locator('body').click({ position: { x: 5, y: 200 } }).catch(() => {}); await page.keyboard.press('End'); }
          if (method === 'wheel') { await page.mouse.move(w / 2, h / 3); for (let i = 0; i < 60; i++) await page.mouse.wheel(0, 400); }
          await page.waitForTimeout(800);
          methods[method] = await page.evaluate(() => {
            const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
            const footer = document.querySelector('.app-footer').getBoundingClientRect();
            const wrap = document.querySelector('.page-wrap');
            return { scrollY: Math.round(scrollY), scrollHeightMinusViewport: document.documentElement.scrollHeight - innerHeight, scrollMaxY: window.scrollMaxY ?? null, navTop: Math.round(nav.top), navHeight: Math.round(nav.height), footerBottom: Math.round(footer.bottom), footerVisibleAboveNav: footer.bottom <= nav.top + 1, pageWrapMarginBottom: getComputedStyle(wrap).marginBottom, bodyOverflowX: getComputedStyle(document.body).overflowX };
          });
        }
        await page.screenshot({ path: join(out, `${engine}-${build}-${w}-${hash.slice(1)}-end.png`) });
        results.push({ engine, version: browser.version(), build, viewport: `${w}x${h}`, page: hash.slice(1), ...methods });
        console.log(engine, build, `${w}x${h}`, hash, JSON.stringify(Object.fromEntries(Object.entries(methods).map(([k, v]) => [k, `${v.scrollY}/${v.scrollHeightMinusViewport} footer ${v.footerBottom} navTop ${v.navTop} visible=${v.footerVisibleAboveNav}`]))));
        await context.close();
      }
    }
  }
  await browser.close();
}
await writeFile(join(out, 'mobile-bottom-probe.json'), JSON.stringify(results, null, 2) + '\n');
http.close();
