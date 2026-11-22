// Renders every <section class="frame" id="…"> of a static concept board to PNG.
// Usage: node render.mjs <playwright-module-dir> <board.html> <out-dir> [frame-id-filter]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , pwDir, board, outDir, only] = process.argv;
const require = createRequire(import.meta.url);
const { chromium } = require(join(pwDir, 'playwright'));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
for (const [kind, scale] of [['phone', 2], ['desk', 1]]) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(pathToFileURL(resolve(board)).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight} ${f.style}`));
  const ids = await page.locator(`section.frame.${kind}[id]`).evaluateAll((els) => els.map((el) => el.id));
  for (const id of ids) {
    if (only && !id.includes(only)) continue;
    await page.locator(`#${id}`).screenshot({ path: join(outDir, `${id}.png`) });
    console.log(`rendered ${id} @${scale}x`);
  }
  if (kind === 'phone') console.log(`fonts loaded: ${[...new Set(fonts.map((f) => f.split(' ')[0] + ' ' + f.split(' ')[1]))].length} faces; families: ${[...new Set(fonts.map((f) => f.replace(/ \S+ \S+$/, '')))].join(', ')}`);
  await context.close();
}
await browser.close();
