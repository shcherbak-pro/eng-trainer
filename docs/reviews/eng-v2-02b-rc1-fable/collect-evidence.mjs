// ENG-V2-02B-RC1 Fable re-review — copies logs from the disposable review folder into
// this evidence directory and sanitizes files already here. Absolute local
// paths become placeholders (convention: docs/reviews/SANITIZATION.md); ANSI
// colour codes are stripped for readability. Nothing else is changed.
// Usage: node collect-evidence.mjs <review-root> <review-tools-root> <file-or-glob-free-path>...
//   Paths under <review-root> are copied into ./logs (.log/.txt) or ./results;
//   paths inside this directory are sanitized in place.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const [reviewRoot, toolsRoot, ...files] = process.argv.slice(2);
const home = process.env.USERPROFILE ?? process.env.HOME;
const account = basename(home);

function variants(path) {
  const win = resolve(path);
  const forward = win.replace(/\\/g, '/');
  const out = new Set([win, win.replace(/\\/g, '\\\\'), forward]);
  for (const value of [...out]) { out.add(value[0].toLowerCase() + value.slice(1)); out.add(value[0].toUpperCase() + value.slice(1)); }
  out.add(`/${win[0].toLowerCase()}${forward.slice(2)}`);
  out.add(`file:///${forward}`);
  const short = `${account.slice(0, 6).toUpperCase()}~1`;
  for (const value of [...out]) out.add(value.replace(`\\${account}\\`, `\\${short}\\`).replace(`/${account}/`, `/${short}/`).replace(`\\\\${account}\\\\`, `\\\\${short}\\\\`));
  return [...out].sort((a, b) => b.length - a.length);
}
const rules = [
  ['<repo>', variants(repo)],
  ['<review-copy>', variants(join(reviewRoot, 'copy'))],
  ['<review-baseline>', variants(join(reviewRoot, 'baseline'))],
  ['<review-root>', variants(reviewRoot)],
  ['<review-tools>', variants(toolsRoot)],
  ['<home>', variants(home)]
];
const counts = Object.fromEntries(rules.map(([name]) => [name, 0]));
for (const file of files) {
  const source = resolve(file);
  let text = readFileSync(source, 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
  for (const [placeholder, forms] of rules) for (const form of forms) { const parts = text.split(form); counts[placeholder] += parts.length - 1; text = parts.join(placeholder); }
  const inside = source.startsWith(here + sep);
  const target = inside ? source : join(here, /\.(log|txt)$/.test(source) ? 'logs' : 'results', basename(source));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}
console.log(JSON.stringify({ files: files.length, replacements: counts }));
