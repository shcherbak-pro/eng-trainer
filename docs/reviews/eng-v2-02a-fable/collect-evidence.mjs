// Copies review logs/results from the disposable review folder into this
// evidence directory, replacing absolute local paths with placeholders
// (same convention as docs/reviews/SANITIZATION.md).
// Usage: node collect-evidence.mjs <review-copy-root> <review-tools-root> <file>...
//   Each <file> is relative to <review-copy-root>; it lands in ./logs/ or ./results/.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const [copyRoot, toolsRoot, ...files] = process.argv.slice(2);
const home = process.env.USERPROFILE ?? process.env.HOME;

function variants(path) {
  const win = resolve(path);
  const forward = win.replace(/\\/g, '/');
  const out = new Set([win, win.replace(/\\/g, '\\\\'), forward]);
  if (/^[A-Za-z]:/.test(win)) {
    for (const value of [...out]) {
      out.add(value[0].toLowerCase() + value.slice(1));
      out.add(value[0].toUpperCase() + value.slice(1));
    }
    out.add(`/${win[0].toLowerCase()}${forward.slice(2)}`);
    out.add(`file:///${forward}`);
  }
  // 8.3 short form of the account folder, e.g. C:\Users\ABCDEF~1\...
  const account = basename(home);
  for (const value of [...out]) out.add(value.replace(`\\${account}\\`, `\\${account.slice(0, 6).toUpperCase()}~1\\`).replace(`/${account}/`, `/${account.slice(0, 6).toUpperCase()}~1/`));
  return [...out].sort((a, b) => b.length - a.length);
}

const rules = [
  ['<repo>', variants(repo)],
  ['<review-copy>', variants(copyRoot)],
  ['<review-tools>', variants(toolsRoot)],
  ['<home>', variants(home)]
];
const counts = Object.fromEntries(rules.map(([name]) => [name, 0]));
for (const file of files) {
  let text = readFileSync(join(copyRoot, file), 'utf8');
  for (const [placeholder, forms] of rules) {
    for (const form of forms) {
      const parts = text.split(form);
      counts[placeholder] += parts.length - 1;
      text = parts.join(placeholder);
    }
  }
  const target = join(here, /\.log$/.test(file) ? 'logs' : 'results', basename(file));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}
console.log(JSON.stringify({ files: files.length, replacements: counts }));
