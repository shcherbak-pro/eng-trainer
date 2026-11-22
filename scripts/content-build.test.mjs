import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildContent, jsonText, readGeneratedContent, sha256 } from './content-build.mjs';
import { assembleMaterials, parseManifest, parsePack } from '../src/content/packFormat.js';
import { ENG_V2_03_ADDITIONS, LEGACY_KEYS, legacyProjection, topicsOutsideAdditions } from '../src/test/legacyProjection.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const built = await buildContent(join(root, 'content'));
const packs = built.assets.map((asset) => asset.pack);
const baseline = JSON.parse(await readFile(join(root, 'src/test/fixtures/content-baseline.json'), 'utf8'));
const legacyPackUrls = JSON.parse(await readFile(join(root, 'src/test/fixtures/legacy-pack-urls.json'), 'utf8'));
const hashJson = (value) => sha256(JSON.stringify(value));

// ENG-V2-03 intentionally enlarges the catalog. The frozen baseline is unchanged and now
// applies to the legacy projection: the full catalog without the three topic packs and
// their three blocks, in catalog order.
test('legacy projection preserves all baseline record values, array order, identities, metadata and explicit links', () => {
  const legacy = legacyProjection(built.materials, packs);
  assert.equal(hashJson(legacy.meta), baseline.metaSha256);
  assert.deepEqual(Object.keys(baseline.collections).sort(), ['blocks', ...LEGACY_KEYS].sort());
  for (const [key, expected] of Object.entries(baseline.collections)) {
    const items = legacy[key];
    assert.equal(items.length, expected.count, key);
    assert.equal(hashJson(items), expected.sha256, `${key}: complete records and order`);
    if (expected.idsSha256) assert.equal(hashJson(items.map((item) => item.id)), expected.idsSha256, `${key}: IDs`);
  }
  assert.equal(legacy.wordIndex.filter((word) => word.sourcePhraseId).length, baseline.sourcePhraseLinks.count);
  assert.equal(hashJson(legacy.wordIndex.map((word) => [word.id, word.sourcePhraseId ?? null])), baseline.sourcePhraseLinks.sha256);
  assert.deepEqual(topicsOutsideAdditions(packs), []);
});

test('the projection detects a changed or added legacy record and validation rejects a moved one', () => {
  const fingerprint = (sourcePacks) => {
    const materials = assembleMaterials(built.manifest, sourcePacks);
    return hashJson(legacyProjection(materials, sourcePacks).phrases);
  };
  assert.equal(fingerprint(packs), baseline.collections.phrases.sha256);
  const changed = structuredClone(packs);
  changed[0].content.phrases[0].translation += ' ';
  const added = structuredClone(packs);
  added[0].content.phrases.push({ ...added[0].content.phrases[0], id: 'phrase-extra' });
  for (const variant of [changed, added]) assert.notEqual(fingerprint(variant), baseline.collections.phrases.sha256);
  // Moving a released phrase into a topic pack removes it from the projection.
  const moved = structuredClone(packs);
  const phrase = moved[0].content.phrases.pop();
  packOf(moved, 'small-talk').content.phrases.push(phrase);
  const projected = legacyProjection(assembleMaterials(built.manifest, moved), moved).phrases;
  assert.equal(projected.length, baseline.collections.phrases.count - 1);
});

test('the eleven released packs are byte-identical: their content-addressed URLs are unchanged', () => {
  const legacy = built.manifest.packs.filter((entry) => !ENG_V2_03_ADDITIONS.packs.includes(entry.id));
  assert.deepEqual(legacy.map(({ id, order, url }) => ({ id, order, url })), legacyPackUrls.packs.map(({ id, order, url }) => ({ id, order, url })));
  for (const entry of legacyPackUrls.packs) {
    const counts = built.manifest.packs.find((item) => item.id === entry.id).counts;
    assert.deepEqual(counts, { ...entry.counts, topics: 0 }, entry.id);
  }
});

test('ENG-V2-03 adds exactly three topic packs after the released ones, with derived totals', () => {
  const added = built.manifest.packs.filter((entry) => ENG_V2_03_ADDITIONS.packs.includes(entry.id));
  assert.deepEqual(added.map(({ id, order }) => [id, order]), [['conditionals', 120], ['small-talk', 130], ['interview-english', 140]]);
  for (const entry of added) {
    const asset = built.assets.find((item) => item.pack.id === entry.id);
    assert.equal(entry.url, `packs/${entry.id}.${sha256(asset.text).slice(0, 16)}.json`);
  }
  assert.deepEqual(added.map((entry) => entry.counts), [
    { phrases: 18, wordIndex: 0, irregularVerbs: 0, patterns: 0, answers: 0, drills: 0, topics: 1 },
    { phrases: 36, wordIndex: 0, irregularVerbs: 0, patterns: 0, answers: 0, drills: 0, topics: 1 },
    { phrases: 18, wordIndex: 0, irregularVerbs: 0, patterns: 0, answers: 6, drills: 0, topics: 1 }
  ]);
  // Full totals are the frozen baseline plus these additions; nothing else changed.
  const expected = Object.fromEntries(LEGACY_KEYS.map((key) => [key, baseline.collections[key].count + added.reduce((sum, entry) => sum + entry.counts[key], 0)]));
  assert.deepEqual(built.manifest.counts, { ...expected, topics: 3 });
  assert.equal(built.manifest.blocks.length, baseline.collections.blocks.count + ENG_V2_03_ADDITIONS.blocks.length);
  assert.deepEqual(built.manifest.blocks.slice(-3).map((block) => block.id), [...ENG_V2_03_ADDITIONS.blocks]);
});

test('learning topics: every reference is explicit and checked', () => {
  const variants = [
    [(p) => { topicOf(p, 'conditionals').sections[0].items.push('missing-phrase'); }, /lists missing phrase/],
    [(p) => { topicOf(p, 'conditionals').sections[0].items.push(topicOf(p, 'small-talk').sections[0].items[0]); }, /belongs to Small Talk/],
    [(p) => { topicOf(p, 'conditionals').sections[1].items.push(topicOf(p, 'conditionals').sections[0].items[0]); }, /listed twice/],
    [(p) => { topicOf(p, 'conditionals').sections[0].items.pop(); }, /does not list its phrase/],
    [(p) => { topicOf(p, 'interview-english').sections[0].answerId = 'missing-answer'; }, /missing answer/],
    [(p) => { topicOf(p, 'small-talk').blockId = 'missing-block'; }, /missing block/],
    [(p) => { topicOf(p, 'small-talk').blockId = 'topic-conditionals'; }, /already opens another topic|must be the phrase category/],
    [(p) => { topicOf(p, 'small-talk').blockId = 'start-answer'; }, /must be the phrase category/],
    [(p) => { topicOf(p, 'small-talk').sections[1].id = topicOf(p, 'small-talk').sections[0].id; }, /duplicate section id/],
    [(p) => { packOf(p, 'small-talk').content.topics.push({ ...topicOf(p, 'conditionals') }); }, /duplicate topic id/]
  ];
  for (const [mutate, expected] of variants) {
    const copy = structuredClone(packs);
    mutate(copy);
    assert.throws(() => assembleMaterials(built.manifest, copy), expected);
  }
  // Model answers have IDs in the shared identity space; a repeated ID is rejected.
  const duplicate = structuredClone(packs);
  packOf(duplicate, 'interview-english').content.answers[1].id = 'phrase-001';
  assert.throws(() => assembleMaterials(built.manifest, duplicate), /duplicate entry id/);
});

test('learning topic records have a strict shape; packs without topics stay valid', () => {
  for (const [mutate, expected] of [
    [(topic) => { topic.color = 'blue'; }, /color is unknown/],
    [(topic) => { topic.id = 'Small Talk'; }, /lowercase slug/],
    [(topic) => { topic.sections = []; }, /sections is empty/],
    [(topic) => { topic.sections[0].items = []; }, /items is empty/],
    [(topic) => { topic.sections[0].questions = [{ en: 'Question?' }]; }, /\.ua must be/],
    [(topic) => { topic.description = ' '; }, /description must be a nonempty string/],
    [(topic) => { topic.filter = { label: 'Situations' }; }, /filter\.all must be/]
  ]) {
    const pack = structuredClone(packOf(packs, 'small-talk'));
    mutate(pack.content.topics[0]);
    assert.throws(() => parsePack(pack), expected);
  }
  assert.equal(packOf(packs, 'speaking-foundations').content.topics, undefined);
});

function packOf(list, id) {
  return list.find((pack) => pack.id === id);
}

function topicOf(list, id) {
  return packOf(list, id).content.topics[0];
}

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
