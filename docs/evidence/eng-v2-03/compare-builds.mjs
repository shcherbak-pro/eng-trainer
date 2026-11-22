// ENG-V2-03: the released build (03f1267) against the candidate, in Chromium and Firefox.
// 1. Response-body budgets with the method of the UX-01B review harness: a cold load in a
//    fresh context at 390 x 844, a local server sending gzip -9 bodies (WOFF2 as stored),
//    response BODY bytes from the browser, headers excluded. Code = document + script +
//    stylesheet; fonts = font; content = manifest and packs; total = every response.
// 2. The released patterns and answers render with identical markup after the shared
//    PatternCard/AnswerCard extraction.
// Usage: node compare-builds.mjs <playwright-node_modules> <released-dist> <candidate-site> <output.json>
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const [, , pwDir, releasedDir, candidateDir, outFile] = process.argv;
const require = createRequire(import.meta.url);
const pw = require(join(pwDir, 'playwright'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const BUDGET = { code: 102400, fonts: 204800, total: 563200 };
const ROUTES = ['index', 'phrases', 'wordIndex', 'topic/small-talk', 'topic/interview-english'];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function serve(root, port) {
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith('/eng-trainer/')) { response.writeHead(404); response.end(); return; }
    let file = normalize(join(root, decodeURIComponent(url.pathname.slice('/eng-trainer/'.length))));
    if (!file.startsWith(normalize(root))) { response.writeHead(403); response.end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { response.writeHead(404); response.end(); return; }
    let body = readFileSync(file);
    const gzip = extname(file) !== '.woff2';
    if (gzip) body = gzipSync(body, { level: 9 });
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store', ...(gzip ? { 'content-encoding': 'gzip' } : {}), 'content-length': body.length });
    response.end(body);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

async function ready(page) {
  await page.locator('.app-shell').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await delay(100);
}

async function coldLoad(browser, base, route) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route((url) => !url.href.startsWith(base), (route) => route.abort('blockedbyclient'));
  const page = await ctx.newPage();
  const requests = [];
  const jobs = [];
  page.on('requestfinished', (request) => jobs.push((async () => {
    const sizes = await request.sizes();
    requests.push({ url: request.url().replace(base, '/eng-trainer/'), type: request.resourceType(), bodyBytes: sizes.responseBodySize });
  })()));
  await page.goto(`${base}#${route}`, { waitUntil: 'networkidle' });
  await ready(page);
  await page.waitForLoadState('networkidle');
  await delay(500);
  await Promise.all(jobs);
  const h1 = await page.evaluate(() => document.querySelector('main h1')?.textContent ?? null);
  await ctx.close();
  const sum = (filter) => requests.filter(filter).reduce((total, item) => total + item.bodyBytes, 0);
  const result = {
    h1,
    requests: requests.length,
    code: sum((item) => ['document', 'script', 'stylesheet'].includes(item.type)),
    fonts: sum((item) => item.type === 'font'),
    content: sum((item) => /\/data\/(manifest\.json|packs\/)/.test(item.url)),
    other: sum((item) => !['document', 'script', 'stylesheet', 'font'].includes(item.type) && !/\/data\/(manifest\.json|packs\/)/.test(item.url)),
    total: sum(() => true),
    files: requests.map((item) => `${item.type} ${item.url} ${item.bodyBytes}`).sort()
  };
  result.withinBudget = result.code <= BUDGET.code && result.fonts <= BUDGET.fonts && result.total <= BUDGET.total;
  return result;
}

// Svelte marks block boundaries with empty comments (<!---->). Moving markup into a shared
// component moves those markers, and an optional block that renders nothing (the new answer
// label) leaves one more whitespace text node between two block elements. Neither renders,
// so markers are removed and whitespace runs collapsed before comparing. Everything else,
// including scoped class names, must match exactly.
async function readingMarkup(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const out = {};
  for (const route of ['patterns', 'answers']) {
    await page.goto(`${base}#${route}`, { waitUntil: 'networkidle' });
    await ready(page);
    out[route] = (await page.$$eval('.reading-list > li', (items) => items.map((item) => item.outerHTML))).map((html) => html.replaceAll('<!---->', '').replace(/\s+/g, ' '));
  }
  await ctx.close();
  return out;
}

const servers = { released: await serve(releasedDir, 4191), candidate: await serve(candidateDir, 4192) };
const bases = { released: 'http://127.0.0.1:4191/eng-trainer/', candidate: 'http://127.0.0.1:4192/eng-trainer/' };
const report = { definition: 'Cold load, fresh context, 390 x 844, until network idle plus 500 ms; local server sends gzip -9 bodies except WOFF2; browser response BODY bytes, headers excluded.', budget: BUDGET, engines: {} };

for (const engine of ['chromium', 'firefox']) {
  const browser = await pw[engine].launch({ headless: true });
  const entry = { version: browser.version(), routes: {}, markup: {} };
  for (const route of ROUTES) {
    const released = await coldLoad(browser, bases.released, route);
    const candidate = await coldLoad(browser, bases.candidate, route);
    entry.routes[route] = {
      released: { ...released, note: route.startsWith('topic/') ? 'No topics in the release: the address falls back to Home.' : undefined },
      candidate,
      delta: { code: candidate.code - released.code, fonts: candidate.fonts - released.fonts, content: candidate.content - released.content, other: candidate.other - released.other, total: candidate.total - released.total }
    };
    console.log(engine, route, JSON.stringify({ released: [released.code, released.fonts, released.content, released.total], candidate: [candidate.code, candidate.fonts, candidate.content, candidate.total], within: candidate.withinBudget }));
  }
  const released = await readingMarkup(browser, bases.released);
  const candidate = await readingMarkup(browser, bases.candidate);
  entry.markup = {
    patterns: { released: released.patterns.length, candidate: candidate.patterns.length, identical: JSON.stringify(released.patterns) === JSON.stringify(candidate.patterns) },
    answers: {
      released: released.answers.length,
      candidate: candidate.answers.length,
      releasedItemsIdentical: JSON.stringify(released.answers) === JSON.stringify(candidate.answers.slice(0, released.answers.length)),
      added: candidate.answers.slice(released.answers.length).map((html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90))
    }
  };
  console.log(engine, 'markup', JSON.stringify(entry.markup));
  report.engines[engine] = entry;
  await browser.close();
}
for (const server of Object.values(servers)) server.close();
report.pass = Object.values(report.engines).every((entry) => Object.values(entry.routes).every((route) => route.candidate.withinBudget) && entry.markup.patterns.identical && entry.markup.answers.releasedItemsIdentical);
writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
console.log('pass', report.pass);
