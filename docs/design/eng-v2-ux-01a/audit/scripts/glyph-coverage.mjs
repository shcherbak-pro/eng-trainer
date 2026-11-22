// Detects real glyph coverage: a glyph present in the candidate font renders with the same width
// whatever the fallback is; a missing glyph takes the (different) widths of the two fallbacks.
import { createRequire } from 'node:module';
import { join } from 'node:path';
const [, , pwDir] = process.argv;
const require = createRequire(import.meta.url);
const { chromium } = require(join(pwDir, 'playwright'));

const fams = ['Gentium Book Plus', 'Charis SIL', 'Literata', 'Source Sans 3', 'Source Serif 4', 'Noto Sans', 'IBM Plex Sans', 'Commissioner', 'Manrope', 'Andika'];
const chars = 'ɔɪəˈːʊðɑæʃɜʌɡˌŋʒθɒ’—…' + 'ʼіїєґІЇЄҐ₴'; // every non-ASCII symbol in content transcriptions, plus Ukrainian letters and punctuation
const link = `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${f.replace(/ /g, '+')}`).join('&')}&display=block`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(`<!doctype html><html><head><link rel="stylesheet" href="${link}"></head><body></body></html>`);
await page.waitForLoadState('networkidle');
const result = await page.evaluate(async ({ fams, chars }) => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const out = {};
  for (const fam of fams) {
    await document.fonts.load(`40px "${fam}"`, chars);
    const missing = [];
    for (const ch of chars) {
      ctx.font = `40px "${fam}", monospace`; const a = ctx.measureText(ch).width;
      ctx.font = `40px "${fam}", serif`; const b = ctx.measureText(ch).width;
      ctx.font = `40px "${fam}", cursive`; const c = ctx.measureText(ch).width;
      if (!(Math.abs(a - b) < 0.01 && Math.abs(b - c) < 0.01)) missing.push(ch);
    }
    out[fam] = { loaded: document.fonts.check(`40px "${fam}"`, 'a'), missing: missing.join(' ') || 'none' };
  }
  return out;
}, { fams, chars });
await browser.close();
for (const [fam, r] of Object.entries(result)) console.log(`${fam.padEnd(18)} loaded=${r.loaded}  missing: ${r.missing}`);
