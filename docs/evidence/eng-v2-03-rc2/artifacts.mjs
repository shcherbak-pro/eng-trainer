// Compares the RC2 build with the authenticated RC1 copy and with RC1's protected-artifact record.
// node docs/evidence/eng-v2-03-rc2/artifacts.mjs   (after npm run build:site)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const out = 'docs/evidence/eng-v2-03-rc2';
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk = (dir, prefix = '') => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  .flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name), prefix + entry.name + '/') : [prefix + entry.name]);
const rc1Dir = path.join(out, 'local/rc1-site');
const rc1 = new Map(walk(rc1Dir).map((file) => [file, sha(path.join(rc1Dir, file))]));
const rc2 = new Map(walk('site-dist').map((file) => [file, sha(path.join('site-dist', file))]));
const files = [...new Set([...rc1.keys(), ...rc2.keys()])].sort();
const changed = files.filter((file) => rc1.get(file) !== rc2.get(file)).map((file) => ({ file, rc1: rc1.get(file) ?? null, rc2: rc2.get(file) ?? null }));
// Only the page and its script may differ: a new script name, and the page that references it.
const expectedChange = (file) => file === 'index.html' || /^assets\/index-[\w-]+\.js$/.test(file);
assert.deepEqual(changed.filter((entry) => !expectedChange(entry.file)), [], 'Unexpected build differences');
const record = JSON.parse(fs.readFileSync('docs/evidence/eng-v2-03-rc1/artifacts.json', 'utf8'));
const groups = Object.fromEntries(Object.entries(record.groups).map(([group, value]) => {
  const entries = value.entries.map((entry) => ({ file: entry.file, unchanged: rc2.get(entry.file) === entry.sha256 }));
  assert(entries.every((entry) => entry.unchanged), `${group} differs from RC1's record`);
  return [group, { files: entries.length, unchanged: true }];
}));
const protectedSources = record.protectedFiles.map((entry) => ({ file: entry.file, unchanged: sha(entry.file) === entry.sha256 }));
assert(protectedSources.every((entry) => entry.unchanged), 'A protected source file changed');
const summary = {
  rc1Files: rc1.size, rc2Files: rc2.size, identicalFiles: files.length - changed.length, changed,
  css: [...rc2.keys()].filter((file) => file.endsWith('.css')).map((file) => ({ file, identicalToRc1: rc1.get(file) === rc2.get(file) })),
  rc1ProtectedArtifactGroups: groups,
  rc1ProtectedSourceFiles: protectedSources,
};
fs.writeFileSync(path.join(out, 'artifacts.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ ...summary, rc1ProtectedSourceFiles: protectedSources.length }, null, 2));
