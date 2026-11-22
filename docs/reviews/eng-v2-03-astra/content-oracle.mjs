import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildContent } from '../../../scripts/content-build.mjs';
import { assembleMaterials } from '../../../src/content/packFormat.js';
import { legacyProjection } from '../../../src/test/legacyProjection.js';

const root = process.cwd(), out = 'docs/reviews/eng-v2-03-astra';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const baseline = '03f1267f1ef4287580227ce5db67615988c98177';
const old = JSON.parse(git('show', 'c84ef30:public/data/materials.json'));
const descriptor = JSON.parse(git('show', `${baseline}:content/catalog.json`));
const oldPaths = git('ls-tree', '-r', '--name-only', baseline, 'content/packs').trim().split('\n');
const oldPacks = oldPaths.map((file) => JSON.parse(git('show', `${baseline}:${file}`))).sort((a, b) => a.order - b.order);
const released = { meta: descriptor.meta, blocks: descriptor.blocks };
const keys = Object.keys(old).filter((key) => Array.isArray(old[key]) && key !== 'blocks');
for (const key of keys) released[key] = oldPacks.flatMap((pack) => pack.content[key] ?? []);
assert.deepEqual(released, old, '03f1267 packs independently reconstruct c84ef30 monolith');
fs.writeFileSync(path.join(out, 'released-materials.json'), json(released));

const built = await buildContent(path.join(root, 'content'));
const actual = built.materials;
function preserveRecords(current) {
  assert.deepEqual(current.meta, old.meta);
  for (const key of ['blocks', ...keys]) {
    const legacy = old[key];
    if (legacy.every((entry) => typeof entry === 'object' && entry.id)) {
      const ids = new Set(legacy.map((entry) => entry.id));
      assert.deepEqual(current[key].filter((entry) => ids.has(entry.id)), legacy, `${key}: legacy IDs, fields and relative order`);
    } else {
      // ID-less answers/patterns/drills are compared structurally, in their original order.
      const values = new Set(legacy.map((entry) => JSON.stringify(entry)));
      assert.deepEqual(current[key].filter((entry) => values.has(JSON.stringify(entry))), legacy, `${key}: legacy values and order`);
    }
  }
}
preserveRecords(actual);
const packChecks = oldPaths.map((file) => {
  const source = git('show', `${baseline}:${file}`);
  assert.equal(fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n'), source.replaceAll('\r\n', '\n'));
  const pack = JSON.parse(source);
  const expectedUrl = `packs/${pack.id}.${hash(json(pack)).slice(0, 16)}.json`;
  const entry = built.manifest.packs.find((p) => p.id === pack.id);
  assert.equal(entry.url, expectedUrl);
  assert.equal(fs.readFileSync(path.join('public/data', expectedUrl), 'utf8'), json(pack));
  return { id: pack.id, url: expectedUrl, unchanged: true };
});
assert.equal(actual.wordIndex.filter((word) => word.sourcePhraseId).length, 566);
assert.equal(['blocks', ...keys, 'topics'].reduce((total, key) => total + actual[key].length, 0), 1622);
assert.equal(built.manifest.packs.length, 14);

const source = fs.readFileSync(process.argv[2], 'utf8');
const corpus = source.slice(source.indexOf('### 8.1'), source.indexOf('## 9. Reference'));
const groups = [...corpus.matchAll(/^### 8\.\d (.+)\r?\n([\s\S]*?)(?=^### 8\.|$(?![\s\S]))/gm)];
assert.equal(groups.length, 3);
const mappings = [], editorial = [];
for (const [, title, body] of groups) {
  const topic = actual.topics.find((entry) => entry.title === title);
  assert.ok(topic, title);
  const field = (text, label) => text.match(new RegExp(`^${label}: (.+)$`, 'm'))?.[1].trim();
  assert.equal(topic.description, field(body, 'Description'));
  if (field(body, 'Shared usage note')) assert.equal(topic.usageNote, field(body, 'Shared usage note'));
  if (field(body, 'Shared note')) assert.equal(topic.note, field(body, 'Shared note'));
  const sections = [...body.matchAll(/^#### (.+)\r?\n([\s\S]*?)(?=^#### |$(?![\s\S]))/gm)];
  assert.equal(sections.length, 6, title);
  assert.equal(topic.sections.length, 6, title);
  for (let index = 0; index < sections.length; index++) {
    const [, heading, text] = sections[index];
    const section = topic.sections[index];
    assert.equal([section.group, section.title].filter(Boolean).join(' — '), heading);
    const rows = [...text.matchAll(/^\| ((?:cond|small|interview)-[a-z-]+-\d+) \| (.+?) \| (.+?) \|\r?$/gm)];
    assert.equal(rows.length, title === 'Small Talk' ? 6 : 3, heading);
    const ids = [];
    for (const [, sourceId, english, ukrainian] of rows) {
      const matches = actual.phrases.filter((p) => p.phrase === english && p.translation === ukrainian);
      assert.equal(matches.length, 1, sourceId);
      const phrase = matches[0];
      assert.equal(phrase.category, title);
      assert.equal(phrase.section, heading);
      assert.equal(phrase.tag, section.id);
      ids.push(phrase.id);
      mappings.push({ sourceId, catalogId: phrase.id, english, ukrainian, topic: title, section: heading });
    }
    assert.deepEqual(section.items, ids);
    for (const [label, key] of [['Use', 'use'], ['Pattern', 'pattern'], ['Answer structure', 'structure']]) {
      if (field(text, label)) assert.equal(section[key], field(text, label), `${heading} ${key}`);
    }
    if (field(text, 'Category key')) assert.equal(section.id, field(text, 'Category key').replace(/\.$/, ''));
    if (field(text, 'Situation note')) assert.equal(section.note.replaceAll(/[“”]/g, ''), field(text, 'Situation note'));
    if (title === 'Interview English') {
      const questionsText = text.slice(text.indexOf('| Typical question'), text.indexOf('| Source ID'));
      const questions = [...questionsText.matchAll(/^\| (?!Typical question)([^|]+?) \| ([^|]+?) \|\r?$/gm)].map((m) => ({ en: m[1], ua: m[2] }));
      assert.equal(questions.length, 2);
      assert.deepEqual(section.questions, questions);
      const model = text.match(/^Model answer to the first question[^:\r\n]*: (.+)$/m)[1].trim();
      const translation = field(text, 'Translation');
      const answer = actual.answers.find((a) => a.id === section.answerId);
      assert.ok(answer);
      assert.equal(answer.question, questions[0].en);
      assert.equal(answer.answer, model);
      assert.equal(answer.translation, translation);
      if (text.includes('— hypothetical server-backed application:')) assert.equal(answer.label, 'Hypothetical server-backed application');
      if (text.includes('— fictional practice example:')) assert.equal(answer.label, 'Fictional practice example');
    }
    editorial.push({ topic: title, heading, practiceItems: rows.length, exactRequiredText: true });
  }
}
assert.equal(mappings.length, 72);
assert.equal(new Set(mappings.map((entry) => entry.catalogId)).size, 72);
assert.equal(actual.phrases.length - old.phrases.length, 72);
assert.equal(actual.wordIndex.length, old.wordIndex.length);
const legacyTexts = new Set([...old.phrases.map((p) => p.phrase), ...old.wordIndex.map((w) => w.term)]);
assert.equal(mappings.filter((entry) => legacyTexts.has(entry.english)).length, 0);
const suppliedMap = JSON.parse(fs.readFileSync('docs/evidence/eng-v2-03/id-mapping.json', 'utf8'));
assert.deepEqual(suppliedMap.items.map(({sourceId,catalogId})=>({sourceId,catalogId})),mappings.map(({sourceId,catalogId})=>({sourceId,catalogId})));

const mutations = [];
const packs = built.assets.map((asset) => asset.pack);
for (const [name, mutate] of [
  ['changed original field', (p) => { p[0].content.phrases[0].translation += ' altered'; }],
  ['deleted original record', (p) => { p[0].content.phrases.shift(); p[0].content.wordIndex.shift(); }],
  ['changed explicit link', (p) => { p[0].content.wordIndex[0].sourcePhraseId = p[0].content.phrases[1].id; }],
  ['reordered originals', (p) => { [p[0].content.phrases[0], p[0].content.phrases[1]] = [p[0].content.phrases[1], p[0].content.phrases[0]]; }],
  ['moved original into a new pack', (p) => { p.find((p) => p.id === 'small-talk').content.phrases.push(p[0].content.phrases.shift()); }],
  ['changed ID-less released answer', (p) => { p.find((p) => p.content.answers?.length).content.answers[0].answer += ' altered'; }]
]) {
  const variant = structuredClone(packs);
  mutate(variant);
  const materials = assembleMaterials(built.manifest, variant);
  assert.notDeepEqual(legacyProjection(materials, variant), old, name);
  let independentRejected = false;
  try {
    preserveRecords(materials);
    for (const original of oldPacks) assert.deepEqual(variant.find((p) => p.id === original.id), original);
  } catch { independentRejected = true; }
  assert.ok(independentRejected, name);
  mutations.push({ name, candidatePreservationRejected: true, independentPreservationRejected: true });
}
fs.writeFileSync(path.join(out, 'editorial-mapping.json'), json(mappings));
fs.writeFileSync(path.join(out, 'content-oracle.json'), json({ sourceSha256: hash(source), baseline, c84ef30EqualsReleased: true, editorial, practiceItems: 72, translatedQuestions: 12, structures: 6, translatedModelAnswers: 6, links: 566, records: 1622, packs: 14, packChecks, mutations, documentationMappingInspected: !!suppliedMap }));
console.log('PASS: independent owner-corpus comparison, 72 IDs, supporting content, released packs and monolith, six preservation mutations.');
