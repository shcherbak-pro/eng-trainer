// Direct scope check for the four other consumers of .chip-toggle.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pw, out, pause, serve } from './browser-support.mjs';
const sites = { before: await serve(path.join(out, 'local/before-site')), rc1: await serve('site-dist') };
const report = { method: 'Fresh 320x844 contexts, 200% actual text; hide a synthetic-state item, toggle Show hidden, compare styles with authenticated original.', engines: {} };
try {
  for (const engine of ['chromium', 'firefox']) {
    const browser = await pw[engine].launch({ headless: true });
    const results = [];
    report.engines[engine] = { version: browser.version(), results };
    for (const route of ['phrases', 'wordIndex', 'irregularVerbs', 'topic/small-talk']) {
      const entry = { route, builds: {} }; results.push(entry);
      for (const [build, site] of Object.entries(sites)) {
        const ctx = await browser.newContext({ viewport: { width: 320, height: 844 } });
        await ctx.route((url) => !url.href.startsWith(site.base), (r) => r.abort());
        const page = await ctx.newPage(), errors = [];
        page.on('pageerror', (e) => errors.push(String(e).replaceAll(site.base, '/eng-trainer/')));
        await page.goto(site.base + '#' + route, { waitUntil: 'networkidle' });
        await page.locator('.entry-hide').first().waitFor();
        await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        await page.evaluate(() => document.fonts.ready);
        await page.locator('.entry-hide').first().click(); await pause();
        const control = page.getByRole('button', { name: 'Show hidden (1)', exact: true });
        await control.click(); await pause();
        const facts = await control.evaluate((el) => {
          const s = getComputedStyle(el), r = el.getBoundingClientRect();
          return { selected: el.getAttribute('aria-pressed'), type: el.type, situationRuleApplies: el.matches('.chip-row > .chip-toggle'),
            styles: Object.fromEntries(['whiteSpace', 'paddingTop', 'paddingBottom', 'minHeight', 'fontSize', 'fontFamily',
              'flexGrow', 'flexShrink', 'maxWidth'].map((p) => [p, s[p]])),
            width: r.width, height: r.height,
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        });
        assert.equal(facts.selected, 'true'); assert.equal(facts.situationRuleApplies, false);
        assert.equal(facts.type, 'button'); assert(facts.height >= 44); assert(facts.pageOverflow <= 0.75);
        assert.equal(await page.locator('.entry.hidden').count(), 1);
        await page.keyboard.press('Space'); await pause();
        assert.equal(await control.getAttribute('aria-pressed'), 'false');
        assert.equal(await page.locator('.entry.hidden').count(), 0);
        assert.equal(errors.length, 0);
        entry.builds[build] = { facts, errors, togglesPassed: true };
        await ctx.close();
      }
      assert.deepEqual(entry.builds.rc1.facts, entry.builds.before.facts);
      entry.unchanged = true;
      console.log(engine, route, 'PASS');
    }
    await browser.close();
  }
} finally { for (const site of Object.values(sites)) site.close(); }
report.passed = true;
fs.writeFileSync(path.join(out, 'shared-controls.json'), JSON.stringify(report, null, 2) + '\n');
