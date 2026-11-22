// A review oracle independent of the new pack sources. Requires the released
// commit in local Git history; regular unit tests use its frozen fingerprints.
// Since ENG-V2-03 the catalog is intentionally larger: the released content is
// compared through the legacy projection (the catalog without the ENG-V2-03 packs
// and blocks), which must equal the release exactly, in the same relative order.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContent, readGeneratedContent, sha256 } from './content-build.mjs';
import { ENG_V2_03_ADDITIONS, legacyProjection, topicsOutsideAdditions } from '../src/test/legacyProjection.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(await readFile(join(root, 'src/test/fixtures/content-baseline.json'), 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const original = JSON.parse(git('show', `${baseline.commit}:${baseline.source}`));
const { materials, manifest, assets } = await buildContent(join(root, 'content'));
const generated = await readGeneratedContent(join(root, 'public/data'));
const sourcePacks = assets.map((asset) => asset.pack);
assert.deepEqual(legacyProjection(materials, sourcePacks), original, 'all released content values and collection order must equal the release');
assert.deepEqual(legacyProjection(generated.materials, generated.packs), original, 'published catalog must contain the release unchanged');
assert.deepEqual(topicsOutsideAdditions(sourcePacks), [], 'only the ENG-V2-03 packs define learning topics');
assert.equal(git('diff', baseline.commit, '--', 'v1'), '', 'tracked v1 files must remain unchanged');
assert.equal(git('ls-files', '--others', '--exclude-standard', '--', 'v1').trim(), '', 'no new v1 source files');

const collections = (value) => Object.fromEntries(Object.entries(value).filter(([, items]) => Array.isArray(items)).map(([key, items]) => [key, { count: items.length, sha256: sha256(JSON.stringify(items)) }]));
const added = manifest.packs.filter((entry) => ENG_V2_03_ADDITIONS.packs.includes(entry.id));

console.log(JSON.stringify({
  baseline: baseline.commit,
  branch: git('branch', '--show-current').trim(),
  head: git('rev-parse', 'HEAD').trim(),
  packs: manifest.packs.map(({ id, counts }) => ({ id, counts })),
  released: collections(original),
  fullCatalog: { ...Object.fromEntries(Object.entries(collections(materials)).map(([key, value]) => [key, value.count])), packs: manifest.packs.length },
  addedByEngV203: { packs: added.map((entry) => entry.id), blocks: [...ENG_V2_03_ADDITIONS.blocks], counts: Object.fromEntries(Object.keys(manifest.counts).map((key) => [key, added.reduce((sum, entry) => sum + entry.counts[key], 0)])) },
  exactContentAndOrderMatch: true,
  exactPublishedContentMatch: true,
  sourcePhraseLinks: materials.wordIndex.filter((word) => word.sourcePhraseId).length,
  v1Unchanged: true
}, null, 2));
