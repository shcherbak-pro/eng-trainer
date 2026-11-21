// ENG-V2-02A Fable review — adversarial probes of the content generator CLI.
//
// Every case runs in its own throwaway tree that contains only the candidate's
// generator (scripts/generate-content.mjs, scripts/content-build.mjs,
// src/content/packFormat.js) and a copy of content/. The real generator is run
// once to produce outputs, the source is mutated, and the generator is run
// again. A case records the exit code, the first error line and whether the
// previously generated outputs were touched.
//
// Usage: node generator-probes.mjs <candidate-root> <work-dir> [--out file.json]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outFile = outIndex >= 0 ? resolve(args.splice(outIndex, 2)[1]) : null;
const candidate = resolve(args[0]);
const work = resolve(args[1]);
if (existsSync(work)) rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const sha = (value) => createHash('sha256').update(value).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

function tree(name) {
  const dir = join(work, name);
  for (const file of ['scripts/generate-content.mjs', 'scripts/content-build.mjs', 'src/content/packFormat.js']) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    cpSync(join(candidate, file), join(dir, file));
  }
  cpSync(join(candidate, 'content'), join(dir, 'content'), { recursive: true });
  return dir;
}

function generate(dir) {
  const result = spawnSync(process.execPath, [join(dir, 'scripts/generate-content.mjs')], { encoding: 'utf8' });
  const stderr = result.stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    exit: result.status,
    message: stderr.find((line) => /^[A-Za-z]*Error\b/.test(line)) ?? stderr[0] ?? result.stdout.trim()
  };
}

function outputs(dir) {
  const data = join(dir, 'public/data');
  if (!existsSync(join(data, 'manifest.json'))) return null;
  const files = { 'manifest.json': sha(readFileSync(join(data, 'manifest.json'))) };
  for (const name of readdirSync(join(data, 'packs')).sort()) files[`packs/${name}`] = sha(readFileSync(join(data, 'packs', name)));
  return files;
}

const pack = (dir, id) => join(dir, 'content/packs', `${id}.json`);
const results = [];

function probe(name, expectation, mutate) {
  const dir = tree(name.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
  const first = generate(dir);
  if (first.exit !== 0) throw new Error(`clean generation failed for ${name}: ${first.message}`);
  const before = outputs(dir);
  mutate(dir);
  const second = generate(dir);
  const after = outputs(dir);
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  // 'observe' records behaviour without a pass/fail expectation; a rejection must still leave outputs untouched.
  const passed = expectation === 'reject' ? second.exit !== 0 && !changed
    : expectation === 'accept' ? second.exit === 0
      : second.exit === 0 || !changed;
  results.push({ name, expectation, exit: second.exit, message: second.message, outputsChanged: changed, passed, after: expectation === 'accept' ? after : undefined });
  return { dir, before, after, second };
}

// ---------------------------------------------------------------- determinism
{
  const a = tree('determinism-a');
  const b = tree('determinism-b');
  generate(a); generate(b);
  const once = outputs(a);
  generate(a);
  results.push({ name: 'two independent trees and a rerun produce byte-identical outputs', passed: JSON.stringify(once) === JSON.stringify(outputs(a)) && JSON.stringify(once) === JSON.stringify(outputs(b)), files: Object.keys(once).length });
  const crlf = tree('determinism-crlf-minified');
  for (const name of readdirSync(join(crlf, 'content/packs'))) {
    const path = join(crlf, 'content/packs', name);
    const value = readJson(path);
    writeFileSync(path, name.startsWith('a') ? JSON.stringify(value) : JSON.stringify(value, null, 4).replace(/\n/g, '\r\n'));
  }
  generate(crlf);
  results.push({ name: 'CRLF, 4-space and minified source formatting do not change generated names or bytes', passed: JSON.stringify(outputs(crlf)) === JSON.stringify(once) });
}

// --------------------------------------------------------- rejected sources
const rejects = [
  ['duplicate phrase id across packs', (d) => { const p = readJson(pack(d, 'presentations')); p.content.phrases[0].id = readJson(pack(d, 'speaking-foundations')).content.phrases[0].id; writeJson(pack(d, 'presentations'), p); }],
  ['duplicate verb id across packs', (d) => { const p = readJson(pack(d, 'logical-200')); p.content.irregularVerbs[5].id = readJson(pack(d, 'essential-100')).content.irregularVerbs[5].id; writeJson(pack(d, 'logical-200'), p); }],
  ['duplicate word id within a pack', (d) => { const p = readJson(pack(d, 'personal-topics')); p.content.wordIndex[1].id = p.content.wordIndex[0].id; writeJson(pack(d, 'personal-topics'), p); }],
  ['word id equal to a block id', (d) => { const p = readJson(pack(d, 'personal-topics')); p.content.wordIndex[1].id = readJson(join(d, 'content/catalog.json')).blocks[0].id; writeJson(pack(d, 'personal-topics'), p); }],
  ['duplicate pack order', (d) => { const p = readJson(pack(d, 'presentations')); p.order = 10; writeJson(pack(d, 'presentations'), p); }],
  ['duplicate pack id under another filename', (d) => { writeFileSync(join(d, 'content/packs/presentations-copy.json'), readFileSync(pack(d, 'presentations'))); }],
  ['filename differs from id', (d) => { renameSync(pack(d, 'presentations'), join(d, 'content/packs/talks.json')); }],
  ['pack schemaVersion 2', (d) => { const p = readJson(pack(d, 'presentations')); p.schemaVersion = 2; writeJson(pack(d, 'presentations'), p); }],
  ['catalog schemaVersion 2', (d) => { const c = readJson(join(d, 'content/catalog.json')); c.schemaVersion = 2; writeJson(join(d, 'content/catalog.json'), c); }],
  ['missing schemaVersion', (d) => { const p = readJson(pack(d, 'presentations')); delete p.schemaVersion; writeJson(pack(d, 'presentations'), p); }],
  ['unknown envelope key', (d) => { const p = readJson(pack(d, 'presentations')); p.description = 'x'; writeJson(pack(d, 'presentations'), p); }],
  ['misspelled collection key', (d) => { const p = readJson(pack(d, 'presentations')); p.content.phrase = p.content.phrases; delete p.content.phrases; delete p.content.wordIndex; writeJson(pack(d, 'presentations'), p); }],
  ['uppercase / path-like pack id', (d) => { const p = readJson(pack(d, 'presentations')); p.id = '../Presentations'; writeJson(pack(d, 'presentations'), p); }],
  ['negative order', (d) => { const p = readJson(pack(d, 'presentations')); p.order = -5; writeJson(pack(d, 'presentations'), p); }],
  ['fractional order', (d) => { const p = readJson(pack(d, 'presentations')); p.order = 20.5; writeJson(pack(d, 'presentations'), p); }],
  ['empty content object', (d) => { const p = readJson(pack(d, 'presentations')); p.content = {}; writeJson(pack(d, 'presentations'), p); }],
  ['empty collections only', (d) => { const p = readJson(pack(d, 'speaking-practice')); p.content = { patterns: [], answers: [], drills: [] }; writeJson(pack(d, 'speaking-practice'), p); }],
  ['missing required phrase field', (d) => { const p = readJson(pack(d, 'presentations')); delete p.content.phrases[3].translation; writeJson(pack(d, 'presentations'), p); }],
  ['wrong field type (examples not an array)', (d) => { const p = readJson(pack(d, 'presentations')); p.content.wordIndex[3].examples = 'none'; writeJson(pack(d, 'presentations'), p); }],
  ['empty drill string', (d) => { const p = readJson(pack(d, 'speaking-practice')); p.content.drills[0] = '  '; writeJson(pack(d, 'speaking-practice'), p); }],
  ['dangling sourcePhraseId', (d) => { const p = readJson(pack(d, 'presentations')); p.content.wordIndex[3].sourcePhraseId = 'no-such-phrase'; writeJson(pack(d, 'presentations'), p); }],
  ['block → absent phrase category', (d) => { const c = readJson(join(d, 'content/catalog.json')); c.blocks.find((b) => b.type === 'phraseCategory').category = 'No such category'; writeJson(join(d, 'content/catalog.json'), c); }],
  ['block → absent verb set', (d) => { const c = readJson(join(d, 'content/catalog.json')); c.blocks.find((b) => b.type === 'irregularVerbs' && b.verbSet).verbSet = 'no-such-set'; writeJson(join(d, 'content/catalog.json'), c); }],
  ['unsupported block type', (d) => { const c = readJson(join(d, 'content/catalog.json')); c.blocks[0].type = 'quiz'; writeJson(join(d, 'content/catalog.json'), c); }],
  ['duplicate block id', (d) => { const c = readJson(join(d, 'content/catalog.json')); c.blocks[1].id = c.blocks[0].id; writeJson(join(d, 'content/catalog.json'), c); }],
  ['pack providing every verb of a referenced set removed', (d) => { unlinkSync(pack(d, 'essential-100')); }],
  ['syntactically invalid JSON (trailing comma)', (d) => { writeFileSync(pack(d, 'presentations'), readFileSync(pack(d, 'presentations'), 'utf8').replace(/\n}\s*$/, ',\n}\n')); }],
  ['UTF-8 byte-order mark', (d) => { writeFileSync(pack(d, 'presentations'), `﻿${readFileSync(pack(d, 'presentations'), 'utf8')}`); }],
  ['missing catalog.json', (d) => { unlinkSync(join(d, 'content/catalog.json')); }]
];
for (const [name, mutate] of rejects) probe(name, 'reject', mutate);

// ------------------------------------------- accepted sources (documented behaviour)
{
  const { before, after } = probe('changed translation regenerates a new content-addressed pack and removes the stale one', 'accept', (d) => {
    const p = readJson(pack(d, 'presentations'));
    p.content.phrases[0].translation += ' (edited)';
    writeJson(pack(d, 'presentations'), p);
  });
  const last = results[results.length - 1];
  const oldNames = Object.keys(before).filter((k) => k.startsWith('packs/presentations.'));
  const newNames = Object.keys(after).filter((k) => k.startsWith('packs/presentations.'));
  last.stalePackRemoved = oldNames.length === 1 && newNames.length === 1 && oldNames[0] !== newNames[0];
  last.otherPacksUntouched = Object.keys(before).filter((k) => k.startsWith('packs/') && !k.startsWith('packs/presentations.')).every((k) => before[k] === after[k]);
  last.passed = last.passed && last.stalePackRemoved && last.otherPacksUntouched;
  delete last.after;
}
const observations = [
  ['an unrelated non-JSON file in content/packs is ignored', (d) => writeFileSync(join(d, 'content/packs/NOTES.md'), '# notes')],
  ['observe: a pack renamed to an upper-case .JSON extension (skipped by discovery)', (d) => renameSync(pack(d, 'agent-framework'), join(d, 'content/packs/agent-framework.JSON'))],
  ['a JSON object with a duplicated key keeps the last value without an error', (d) => writeFileSync(pack(d, 'presentations'), readFileSync(pack(d, 'presentations'), 'utf8').replace('"title": "Presentations",', '"title": "Ignored",\n  "title": "Presentations",'))]
];
for (const id of readdirSync(join(candidate, 'content/packs')).map((name) => name.replace(/\.json$/, ''))) {
  observations.push([`observe: authored pack ${id} deleted`, (d) => unlinkSync(pack(d, id))]);
}
for (const [name, mutate] of observations) {
  probe(name, name.startsWith('observe:') ? 'observe' : 'accept', mutate);
  const last = results[results.length - 1];
  const totals = last.after ? readJson(join(work, name.replace(/[^a-z0-9]+/gi, '-').toLowerCase(), 'public/data/manifest.json')).counts : null;
  last.generatedCounts = totals;
  delete last.after;
}

// A stray file in the generated packs directory: what does cleanup remove?
{
  const dir = tree('stray-generated-files');
  generate(dir);
  writeFileSync(join(dir, 'public/data/packs/old-pack.0123456789abcdef.json'), '{}');
  writeFileSync(join(dir, 'public/data/packs/notes.json'), '{}');
  generate(dir);
  results.push({
    name: 'cleanup removes stale hash-named packs but leaves unrelated files',
    passed: !existsSync(join(dir, 'public/data/packs/old-pack.0123456789abcdef.json')),
    unrelatedFileKept: existsSync(join(dir, 'public/data/packs/notes.json'))
  });
}

const summary = {
  candidate: '<candidate>',
  generatorSha256: Object.fromEntries(['scripts/generate-content.mjs', 'scripts/content-build.mjs', 'src/content/packFormat.js'].map((f) => [f, sha(readFileSync(join(candidate, f)))])),
  total: results.length,
  passed: results.filter((r) => r.passed).length,
  results
};
const text = `${JSON.stringify(summary, null, 2)}\n`;
if (outFile) writeFileSync(outFile, text);
for (const r of results) console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.name}${r.exit !== undefined ? `  [exit ${r.exit}] ${r.message ?? ''}` : ''}${r.generatedCounts ? `  counts=${JSON.stringify(r.generatedCounts)}` : ''}${r.unrelatedFileKept !== undefined ? `  unrelatedFileKept=${r.unrelatedFileKept}` : ''}`);
console.log(`${summary.passed}/${summary.total} probes behaved as expected`);
process.exit(summary.passed === summary.total ? 0 : 1);
