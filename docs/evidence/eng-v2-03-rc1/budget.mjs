// Established cold-load response BODY method, applied to the reviewed snapshot and RC1.
// No rebuild of earlier milestones. node docs/evidence/eng-v2-03-rc1/budget.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
const out = path.resolve('docs/evidence/eng-v2-03-rc1');
const common = path.resolve(execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim());
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(common, 'eng-v2-02b-release/browsers');
const pw = createRequire(import.meta.url)(path.join(common, 'eng-v2-02b-release/tools/node_modules/playwright'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const budget = { code: 102400, fonts: 204800, total: 563200 };
const servers = [], bases = {};
const report = { method: 'Cold load, fresh context, 390 x 844; networkidle, intended fonts ready, networkidle plus 500ms. Local gzip level 9 except WOFF2 stored. Browser response-body bytes excluding headers.', budget, engines: {} };
try {
  for (const [build, directory] of Object.entries({ reviewed: path.join(out, 'local/reviewed-site'), rc1: path.resolve('site-dist') })) {
    const server = createServer((request, response) => {
      const url = new URL(request.url, 'http://localhost');
      if (!url.pathname.startsWith('/eng-trainer/')) { response.writeHead(404).end(); return; }
      let file = path.resolve(directory, '.' + decodeURIComponent(url.pathname.slice('/eng-trainer'.length)));
      if (!file.startsWith(directory + path.sep) && file !== directory) { response.writeHead(403).end(); return; }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) { response.writeHead(404).end(); return; }
      const gzip = path.extname(file) !== '.woff2';
      const body = gzip ? gzipSync(fs.readFileSync(file), { level: 9 }) : fs.readFileSync(file);
      response.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store',
        ...(gzip ? { 'content-encoding': 'gzip' } : {}), 'content-length': body.length });
      response.end(body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    bases[build] = `http://127.0.0.1:${server.address().port}/eng-trainer/`;
  }
  for (const engine of ['chromium', 'firefox']) {
    const browser = await pw[engine].launch({ headless: true });
    const result = { version: browser.version(), routes: {} };
    report.engines[engine] = result;
    for (const route of ['index', 'phrases', 'wordIndex', 'topic/small-talk', 'topic/interview-english']) {
      const entry = result.routes[route] = {};
      for (const [build, base] of Object.entries(bases)) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await context.route((url) => !url.href.startsWith(base), (request) => request.abort());
        const page = await context.newPage(), requests = [], pending = [], errors = [];
        page.on('pageerror', (error) => errors.push(String(error).replaceAll(base, '/eng-trainer/')));
        page.on('requestfinished', (request) => pending.push((async () => {
          const sizes = await request.sizes();
          requests.push({ url: request.url().replace(base, '/eng-trainer/'), type: request.resourceType(), bodyBytes: sizes.responseBodySize });
        })()));
        await page.goto(base + '#' + route, { waitUntil: 'networkidle' });
        await page.locator('.app-shell').waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForLoadState('networkidle');
        await new Promise((resolve) => setTimeout(resolve, 500));
        await Promise.all(pending);
        const sum = (test) => requests.filter(test).reduce((total, request) => total + request.bodyBytes, 0);
        const code = sum((request) => ['document', 'script', 'stylesheet'].includes(request.type));
        const fonts = sum((request) => request.type === 'font');
        const content = sum((request) => /\/data\/(manifest\.json|packs\/)/.test(request.url));
        const total = sum(() => true);
        entry[build] = { code, fonts, content, other: total - code - fonts - content, total, errors,
          withinBudget: code <= budget.code && fonts <= budget.fonts && total <= budget.total,
          requests: requests.sort((a, b) => a.url.localeCompare(b.url)) };
        await context.close();
      }
      entry.delta = Object.fromEntries(['code', 'fonts', 'content', 'other', 'total'].map((key) => [key, entry.rc1[key] - entry.reviewed[key]]));
      console.log(engine, route, JSON.stringify({ reviewed: entry.reviewed.total, rc1: entry.rc1.total, code: entry.rc1.code, withinBudget: entry.rc1.withinBudget }));
    }
    await browser.close();
  }
} finally { for (const server of servers) server.close(); }
report.passed = Object.values(report.engines).every((engine) => Object.values(engine.routes).every((route) => route.rc1.withinBudget && route.rc1.errors.length === 0));
fs.writeFileSync(path.join(out, 'budget.json'), JSON.stringify(report, null, 2) + '\n');
if (!report.passed) process.exitCode = 1;
