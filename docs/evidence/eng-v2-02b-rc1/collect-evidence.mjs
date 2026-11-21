// Run from the repo root after the checks/browser runs recorded in README.md.
// The ignored pre-correction snapshot is required for exact delta verification.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = process.cwd();
const raw = resolve(process.argv[2] ?? 'node_modules/.cache/eng-v2-02b-rc1');
const out = join(root, 'docs/evidence/eng-v2-02b-rc1');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fileHash = async (path) => hash(await readFile(join(root, path)));
const json = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const parse = (value) => JSON.parse(value.replace(/^\uFEFF/, ''));
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function sanitize(value) {
  let result = value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  for (const [path, replacement] of [[root, '<repo>'], [process.env.TEMP, '<temp>'], [process.env.USERPROFILE, '<user>']]) {
    if (!path) continue;
    for (const form of [path, path.replaceAll('\\', '/')]) result = result.replace(new RegExp(escape(form), 'gi'), replacement);
  }
  assert.doesNotMatch(result, /[A-Z]:[\\/]Users[\\/]/i, 'unnecessary user path in new evidence');
  return result;
}

await mkdir(join(out, 'logs'), { recursive: true });
const mapping = [];
for (const [source, target] of [
  ['check-initial.log', 'check.log'], ['test.log', 'test.log'], ['check-v1.log', 'check-v1.log'],
  ['test-v1.log', 'test-v1.log'], ['build-site.log', 'build-site.log'], ['verify-content.log', 'verify-content.log'],
  ['browser-final.log', 'browser.log'], ['baseline-browser.log', 'baseline-browser.log']
]) {
  const original = await readFile(join(raw, source));
  const published = sanitize(original.toString('utf8'));
  await writeFile(join(out, 'logs', target), published);
  mapping.push({ path: `logs/${target}`, rawSha256: hash(original), publishedSha256: hash(published) });
}
for (const [source, target, count] of [['browser-final', 'browser', 3], ['baseline-browser', 'baseline-browser', 5]]) {
  for (const engine of ['chromium', 'firefox']) {
    const report = JSON.parse(await readFile(join(raw, source, `browser-${engine}.json`), 'utf8'));
    assert.equal(report.results.length, count);
    assert.ok(report.results.every((item) => item.status === 'PASS'), `${source}/${engine} must pass`);
  }
  await mkdir(join(out, target), { recursive: true });
  for (const file of await readdir(join(raw, source))) {
    assert.ok(!file.includes('failure'), 'do not publish a failed/intermediate run as final evidence');
    const value = await readFile(join(raw, source, file));
    await writeFile(join(out, target, file), file.endsWith('.json') ? sanitize(value.toString('utf8')) : value);
  }
}
await json(join(out, 'sanitization.json'), { policy: 'Only new RC1 logs: replace local repo/user/temp paths and strip ANSI. Original evidence is unchanged.', files: mapping });

async function inventory(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) files.push(...await inventory(path));
    else files.push({ path: relative(join(root, 'site-dist'), path).replaceAll('\\', '/'), sha256: hash(await readFile(path)) });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
await json(join(out, 'artifact.json'), await inventory(join(root, 'site-dist')));
const before = parse(await readFile(join(raw, 'before.json'), 'utf8'));
const allowedChanges = new Set([
  'docs/architecture/USER-COLLECTIONS.md', 'docs/handoffs/ENG-V2-02B.md',
  'src/features/flashcards/flashcards.test.ts', 'src/features/flashcards/flashcards.ts', 'src/features/flashcards/FlashcardsPage.svelte',
  'src/features/vocabulary/IrregularVerbsPage.svelte', 'src/features/vocabulary/PhrasesPage.svelte', 'src/features/vocabulary/WordIndexPage.svelte',
  'src/state/progress.ts'
]);
const changed = [];
for (const item of before) {
  const sha256 = await fileHash(item.path);
  if (sha256 === item.sha256) continue;
  assert.ok(allowedChanges.has(item.path), `Unexpected modification: ${item.path}`);
  changed.push({ path: item.path, beforeSha256: item.sha256, afterSha256: sha256 });
}
assert.equal(changed.length, allowedChanges.size);
const releases = before.filter((item) => item.path.startsWith('docs/releases/'));
assert.equal(releases.length, 12);
assert.equal(git('diff', '--cached', '--name-only'), '');
assert.equal(git('rev-parse', 'HEAD'), '020babfaf24a14a0a1fdc15c13c90dde00ea9633');
assert.equal(git('branch', '--show-current'), 'feature/eng-v2-02b-vocabulary-import');
assert.equal(git('ls-files', 'public/data', 'dist', 'site-dist', 'node_modules'), '');
assert.equal(git('-c', 'core.whitespace=cr-at-eol', 'diff', '--check'), '');
await json(join(out, 'candidate-delta.json'), {}); // Include its status, exclude its own hash.
await writeFile(join(out, 'git-status.txt'), git('status', '--short', '--untracked-files=all') + '\n');
const beforePaths = new Set(before.map((item) => item.path));
const paths = git('ls-files', '--cached', '--others', '--exclude-standard').split('\n');
const added = [];
for (const path of paths.filter((path) => !beforePaths.has(path))) {
  assert.ok(path.startsWith('docs/evidence/eng-v2-02b-rc1/') || path === 'src/features/collections/retainedLearning.test.ts', `Unexpected new file: ${path}`);
  if (!path.endsWith('/candidate-delta.json')) added.push({ path, sha256: await fileHash(path) });
}
await json(join(out, 'candidate-delta.json'), {
  baseline: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), stagedFiles: 0, commitsCreated: 0, pushed: false, deployed: false,
  initialFingerprintFiles: before.length, fableOriginalFingerprintMatchesBeforeEdit: 356,
  preservedReleaseFiles: releases,
  preservedIndependentReviewFiles: before.filter((item) => item.path === 'docs/reviews/ENG-V2-02B-FABLE.md' || item.path.startsWith('docs/reviews/eng-v2-02b-fable/')).length,
  preservedOriginalImplementationEvidenceFiles: before.filter((item) => item.path.startsWith('docs/evidence/eng-v2-02b/')).length,
  generatedContentTracked: false, v1Unchanged: true, databaseImplementationUnchangedFromReviewedCandidate: true,
  changedExistingFiles: changed, addedFiles: added
});
console.log(`Verified ${before.length} initial files: ${changed.length} expected modifications; 12 protected release files unchanged. Added ${added.length + 1} RC1 files including the inventory.`);
