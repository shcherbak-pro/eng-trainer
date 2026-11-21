// A review oracle independent of the new pack sources. Requires the released
// commit in local Git history; regular unit tests use its frozen fingerprints.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContent, readGeneratedContent, sha256 } from './content-build.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(await readFile(join(root, 'src/test/fixtures/content-baseline.json'), 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const original = JSON.parse(git('show', `${baseline.commit}:${baseline.source}`));
const { materials, manifest } = await buildContent(join(root, 'content'));
const generated = await readGeneratedContent(join(root, 'public/data'));
assert.deepEqual(materials, original, 'all content values and collection order must equal the release');
assert.deepEqual(generated.materials, original, 'published catalog must equal the release');
assert.equal(git('diff', baseline.commit, '--', 'v1'), '', 'tracked v1 files must remain unchanged');
assert.equal(git('ls-files', '--others', '--exclude-standard', '--', 'v1').trim(), '', 'no new v1 source files');

console.log(JSON.stringify({
  baseline: baseline.commit,
  branch: git('branch', '--show-current').trim(),
  head: git('rev-parse', 'HEAD').trim(),
  packs: manifest.packs.map(({ id, counts }) => ({ id, counts })),
  collections: Object.fromEntries(Object.entries(original).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, { count: value.length, sha256: sha256(JSON.stringify(value)) }])),
  exactContentAndOrderMatch: true,
  exactPublishedContentMatch: true,
  sourcePhraseLinks: materials.wordIndex.filter((word) => word.sourcePhraseId).length,
  v1Unchanged: true
}, null, 2));
