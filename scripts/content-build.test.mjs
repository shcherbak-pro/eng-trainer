import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildContent, jsonText, readGeneratedContent, sha256 } from './content-build.mjs';
import { assembleMaterials, parseManifest, parsePack } from '../src/content/packFormat.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const built = await buildContent(join(root, 'content'));
const packs = built.assets.map((asset) => asset.pack);
const baseline = JSON.parse(await readFile(join(root, 'src/test/fixtures/content-baseline.json'), 'utf8'));
const hashJson = (value) => sha256(JSON.stringify(value));

test('preserves all baseline record values, array order, identities, metadata and explicit links', () => {
  assert.equal(hashJson(built.materials.meta), baseline.metaSha256);
  for (const [key, expected] of Object.entries(baseline.collections)) {
    const items = built.materials[key];
    assert.equal(items.length, expected.count, key);
    assert.equal(hashJson(items), expected.sha256, `${key}: complete records and order`);
    if (expected.idsSha256) assert.equal(hashJson(items.map((item) => item.id)), expected.idsSha256, `${key}: IDs`);
  }
  assert.equal(built.materials.wordIndex.filter((word) => word.sourcePhraseId).length, baseline.sourcePhraseLinks.count);
  assert.equal(hashJson(built.materials.wordIndex.map((word) => [word.id, word.sourcePhraseId ?? null])), baseline.sourcePhraseLinks.sha256);
});

test('generation is deterministic and generated files equal the validated source catalog', async () => {
  assert.deepEqual(await buildContent(join(root, 'content')), built);
  const published = await readGeneratedContent(join(root, 'public/data'));
  assert.deepEqual(published.materials, built.materials);
  assert.deepEqual(published.manifest, built.manifest);
});

test('explicit order preserves each collection even when pack discovery order changes', () => {
  assert.deepEqual(assembleMaterials(built.manifest, [...packs].reverse()), built.materials);
});

test('cross-pack sourcePhraseId references work without inferring links from text', () => {
  const split = structuredClone(packs);
  const word = split[0].content.wordIndex.shift();
  word.term = 'Different display text is still the same explicit relationship';
  split[1].content.wordIndex.push(word);
  const assembled = assembleMaterials(built.manifest, split);
  assert.equal(assembled.wordIndex.find((item) => item.id === word.id).sourcePhraseId, word.sourcePhraseId);
});

test('duplicate IDs anywhere in progress identity space and dangling references fail validation', () => {
  const duplicate = structuredClone(packs);
  duplicate[1].content.wordIndex[0].id = duplicate[0].content.phrases[0].id;
  assert.throws(() => assembleMaterials(built.manifest, duplicate), /duplicate entry id/);
  const dangling = structuredClone(packs);
  dangling[0].content.wordIndex[0].sourcePhraseId = 'missing-phrase';
  assert.throws(() => assembleMaterials(built.manifest, dangling), /sourcePhraseId points to missing/);
});

test('bad schemas, missing required fields and misspelled collections fail before generation', () => {
  for (const [mutate, expected] of [
    [(pack) => { pack.schemaVersion = 2; }, /schemaVersion/],
    [(pack) => { pack.content.phrases[0].translation = 42; }, /translation/],
    [(pack) => { delete pack.content.wordIndex[0].examples; }, /examples/],
    [(pack) => { pack.content.phrase = pack.content.phrases; }, /unknown/],
    [(pack) => { pack.content = {}; }, /empty/],
    [(pack) => { pack.order = -1; }, /order/]
  ]) {
    const pack = structuredClone(packs[0]);
    mutate(pack);
    assert.throws(() => parsePack(pack), expected);
  }
});

test('the legacy null word transcriptions are retained; other malformed values are rejected', () => {
  assert.equal(built.materials.wordIndex.filter((word) => word.transcription === null).length, 17);
  const pack = structuredClone(packs[0]);
  pack.content.wordIndex[0].transcription = false;
  assert.throws(() => parsePack(pack), /transcription/);
});

test('duplicate packs/orders and blocks targeting absent categories or verb sets fail', () => {
  assert.throws(() => assembleMaterials(built.manifest, [...packs, packs[0]]), /duplicate pack id/);
  const sameOrder = structuredClone(packs);
  sameOrder[1].order = sameOrder[0].order;
  assert.throws(() => assembleMaterials(built.manifest, sameOrder), /duplicate pack order/);
  for (const type of ['phraseCategory', 'irregularVerbs']) {
    const descriptor = structuredClone(built.manifest);
    const block = descriptor.blocks.find((item) => item.type === type);
    if (type === 'phraseCategory') block.category = 'Absent category';
    else block.verbSet = 'absent-verbs';
    assert.throws(() => assembleMaterials(descriptor, packs), /has no/);
  }
  assert.throws(() => assembleMaterials(built.manifest, packs.filter((pack) => pack.id !== 'speaking-practice')), /has no patterns/);
});

test('manifest paths stay in v2 packs and inventory/version/order errors are rejected', () => {
  for (const url of ['../v1/data/materials.json', '/data/pack.json', 'https://example.com/pack.json', 'packs/../pack.json']) {
    const manifest = structuredClone(built.manifest);
    manifest.packs[0].url = url;
    assert.throws(() => parseManifest(manifest), /relative pack path/);
  }
  for (const [mutate, expected] of [
    [(manifest) => { manifest.schemaVersion = 2; }, /schemaVersion/],
    [(manifest) => { manifest.packs = []; }, /empty/],
    [(manifest) => { manifest.packs.reverse(); }, /ascending/],
    [(manifest) => { manifest.packs[1].id = manifest.packs[0].id; }, /duplicate pack id/],
    [(manifest) => { manifest.counts.phrases++; }, /count mismatch/],
    [(manifest) => { delete manifest.packs[0].counts.phrases; }, /nonnegative integer/]
  ]) {
    const manifest = structuredClone(built.manifest);
    mutate(manifest);
    assert.throws(() => parseManifest(manifest), expected);
  }
});

test('published asset validation rejects a corrupt or missing pack even when counts match', async () => {
  const fixture = await mkdtemp(join(root, 'node_modules', '.content-test-'));
  try {
    await mkdir(join(fixture, 'packs'));
    await writeFile(join(fixture, 'manifest.json'), jsonText(built.manifest));
    for (const asset of built.assets) await writeFile(join(fixture, asset.url), asset.text);
    const first = built.assets[0];
    await writeFile(join(fixture, first.url), first.text.replace('Speaking foundations', 'Changed title'));
    await assert.rejects(readGeneratedContent(fixture), /Hash mismatch/);
    await rm(join(fixture, first.url));
    await assert.rejects(readGeneratedContent(fixture), /ENOENT/);
  } finally {
    assert.ok(resolve(fixture).startsWith(`${join(root, 'node_modules')}${sep}.content-test-`));
    await rm(fixture, { recursive: true, force: true });
  }
});
