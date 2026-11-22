import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
export const out = path.resolve('docs/reviews/eng-v2-03-rc1-astra');
const common = path.resolve(execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim());
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(common, 'eng-v2-02b-release/browsers');
export const pw = createRequire(import.meta.url)(path.join(common, 'eng-v2-02b-release/tools/node_modules/playwright'));
export const pause = (ms = 220) => new Promise((resolve) => setTimeout(resolve, ms));
export async function serve(directory) {
  directory = path.resolve(directory);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith('/eng-trainer/')) return response.writeHead(404).end();
    let file = path.resolve(directory, pathname.slice('/eng-trainer/'.length));
    if (file !== directory && !file.startsWith(directory + path.sep)) return response.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return response.writeHead(404).end();
    response.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: 'http://127.0.0.1:' + server.address().port + '/eng-trainer/', close: () => server.close() };
}

// Pure observation: do not focus, scroll, click, or change layout in this oracle.
// Assess every non-space character as well as the whole line boxes, full focus footprint,
// and axis-specific intersection of all clipping ancestors with the viewport and fixed bar.
export function measureFocus() {
  const el = document.activeElement;
  if (!el?.matches('.chip-row > button')) return { missing: true, active: el?.tagName };
  const css = getComputedStyle(el);
  const rect = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
  const box = rect(el.getBoundingClientRect());
  const outlineWidth = parseFloat(css.outlineWidth) || 0, outlineOffset = parseFloat(css.outlineOffset) || 0;
  const extent = css.outlineStyle === 'none' ? 0 : Math.max(0, outlineWidth + outlineOffset);
  const footprint = { left: box.left - extent, right: box.right + extent, top: box.top - extent, bottom: box.bottom + extent };
  const effective = { left: 0, top: 0, right: document.documentElement.clientWidth, bottom: innerHeight };
  const ancestors = [];
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p), b = p.getBoundingClientRect();
    const bounds = { left: b.left + p.clientLeft, right: b.left + p.clientLeft + p.clientWidth,
      top: b.top + p.clientTop, bottom: b.top + p.clientTop + p.clientHeight };
    const x = s.overflowX !== 'visible', y = s.overflowY !== 'visible';
    // Root scrolling is represented by the viewport, not the root document's border box.
    if (p !== document.documentElement) {
      if (x) { effective.left = Math.max(effective.left, bounds.left); effective.right = Math.min(effective.right, bounds.right); }
      if (y) { effective.top = Math.max(effective.top, bounds.top); effective.bottom = Math.min(effective.bottom, bounds.bottom); }
    }
    if (x || y) ancestors.push({ tag: p.tagName, className: p.className, overflowX: s.overflowX, overflowY: s.overflowY, bounds });
  }
  const nav = document.querySelector('.tab-bar');
  const navRect = nav?.getBoundingClientRect();
  if (navRect?.height && getComputedStyle(nav).position === 'fixed') effective.bottom = Math.min(effective.bottom, navRect.top);
  const epsilon = 0.75;
  const exceeds = (r, area) => Math.max(0, area.left - r.left, r.right - area.right, area.top - r.top, r.bottom - area.bottom);
  const range = document.createRange();
  range.selectNodeContents(el);
  const lines = [...range.getClientRects()].filter((r) => r.width && r.height).map(rect);
  const characters = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    for (let i = 0; i < text.length; i++) {
      if (/\s/.test(text.data[i])) continue;
      range.setStart(text, i); range.setEnd(text, i + 1);
      const r = rect(range.getBoundingClientRect());
      characters.push({ character: text.data[i], box: r, clip: Math.max(exceeds(r, effective), exceeds(r, box)) });
    }
  }
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
  ctx.font = css.font;
  const unwrappedTextWidth = ctx.measureText(el.textContent.trim()).width;
  const strip = el.parentElement;
  return {
    label: el.textContent.trim(), connected: el.isConnected, focusVisible: el.matches(':focus-visible'),
    ariaPressed: el.getAttribute('aria-pressed'), box, outlineWidth, outlineOffset, footprint, effective, ancestors, lines,
    paintedOverflow: exceeds(footprint, effective), characterCount: characters.length,
    clippedCharacters: characters.filter((c) => c.clip > epsilon),
    complete: exceeds(footprint, effective) <= epsilon && characters.length > 0 && characters.every((c) => c.clip <= epsilon),
    fontSize: parseFloat(css.fontSize), fontFamily: css.fontFamily, lineCount: new Set(lines.map((l) => Math.round(l.top))).size,
    unwrappedTextWidth, whiteSpace: css.whiteSpace, textOverflow: css.textOverflow,
    stripClientWidth: strip.clientWidth, stripScrollWidth: strip.scrollWidth, stripLeft: strip.scrollLeft,
    scrollY, viewport: { width: innerWidth, height: innerHeight }, navTop: navRect?.height ? navRect.top : null,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}
