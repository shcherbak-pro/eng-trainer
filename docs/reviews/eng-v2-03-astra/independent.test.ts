import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { buildContent } from '../../../scripts/content-build.mjs';
import { parsePack, assembleMaterials, countContent } from '../../../src/content/packFormat.js';
import { loadBuiltInCatalog } from '../../../src/content/builtIn';
import { createCatalog } from '../../../src/content/catalog';
import { combineCatalog } from '../../../src/content/userCatalog';
import { homeProgress, libraryOverview } from '../../../src/features/home/homeStats';
import { buildFlashcards, getTopics } from '../../../src/features/flashcards/flashcards';
import { resetDatabase, readDatabase } from '../../../src/test/database';
import { realMaterials } from '../../../src/test/content';
import { openStorage } from '../../../src/storage/database';
import { parseImport } from '../../../src/collections/format';
import { acceptImport, prepareImport, removeCollection, exportCollection, connectCollections, readCollections, userVocabulary, disableCollections } from '../../../src/collections/service';
import released from './released-materials.json';

const root = resolve('.');
const evidence = resolve('docs/reviews/eng-v2-03-astra');
const meta = { title: 'Review fixture', subtitle: '', version: '', language: '', updated: '', goal: '' };
const learned = (ids: string[] = []) => ({ learnedPhrases: ids, favoriteBlocks: [], favoritePhrases: [], favoriteWords: [], favoriteIrregular: [], hiddenPhrases: [], hiddenWords: [] });
const p = (id: string, category: string) => ({ id, category, phrase: 'The same English text', translation: 'Однаковий текст' });
const w = (id: string, category: string, sourcePhraseId?: string) => ({ id, category, term: 'The same English text', meaning: 'Однаковий текст', pronunciation: '', examples: [], ...(sourcePhraseId ? { sourcePhraseId } : {}) });
const material = (patch = {}) => ({ meta, blocks: [], phrases: [], wordIndex: [], patterns: [], answers: [], drills: [], irregularVerbs: [], ...patch });
function freeze(value: any): any { if (value && typeof value === 'object') { Object.freeze(value); for (const v of Object.values(value)) freeze(v); } return value; }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); disableCollections(); });

describe('Independent identity and set oracle', () => {
  it('exhausts the 16 learned subsets of four explicit canonical identities, including linked topics and same text', () => {
    const fixture = material({ phrases: [p('p', 'A'), p('twin', 'A'), p('hidden', 'B')], wordIndex: [w('linked', 'B', 'p'), w('independent', 'A')] });
    const catalog = createCatalog(freeze(fixture) as any);
    const ids = ['p', 'twin', 'hidden', 'independent'];
    const memberships = { A: ['p', 'twin', 'independent'], B: ['p', 'hidden'] };
    for (let mask = 0; mask < 16; mask++) {
      const present = ids.filter((_, index) => mask & (1 << index));
      const state = freeze({ ...learned([...present, 'removed-collection', 'linked']), hiddenPhrases: ['hidden'] });
      const before = JSON.stringify([fixture, state]);
      const stats = homeProgress(catalog, state);
      expect(stats.vocabulary).toEqual({ learned: present.length, available: 4, remaining: 4 - present.length });
      expect(stats.words).toEqual({ learned: Number(present.includes('p')) + Number(present.includes('independent')), available: 2 });
      expect(stats.phrases).toEqual({ learned: present.filter((id) => id !== 'independent').length, available: 3 });
      const expected = Object.entries(memberships).map(([name, members]) => ({ name, available: members.length, learned: members.filter((id) => present.includes(id)).length, complete: members.every((id) => present.includes(id)) }));
      expect(stats.topics).toEqual({ list: expected, eligible: 2, completed: expected.filter((t) => t.complete).length });
      expect(libraryOverview(catalog)).toEqual({ words: 2, phrases: 3, verbs: 0, topics: 2, collections: 0 });
      expect(JSON.stringify([fixture, state])).toEqual(before);
    }
  });
  it('counts existing non-phrase Focus entries and excludes unavailable favorites', () => {
    const catalog = createCatalog(realMaterials as any);
    const state = { ...learned(), favoriteBlocks: [catalog.blocks[0].id, 'gone-b'], favoritePhrases: ['conditionals-zero-01', 'gone-p'], favoriteWords: [catalog.wordIndex[0].id, 'gone-w'], favoriteIrregular: [catalog.irregularVerbs[0].id, 'gone-v'] };
    expect(homeProgress(catalog, state).focus).toBe(4);
  });
  it('handles empty catalogs, ghosts and cards without topics', () => {
    expect(homeProgress(createCatalog(material() as any), learned(['ghost'])).vocabulary).toEqual({ learned: 0, available: 0, remaining: 0 });
    expect(homeProgress(createCatalog(material() as any), learned(['ghost'])).topics).toEqual({ eligible: 0, completed: 0, list: [] });
    const catalog = createCatalog(material({ phrases: [p('unnamed', '')] }) as any);
    expect(homeProgress(catalog, learned()).topics.eligible).toBe(0);
  });
  it('derives actual card counts independently from IDs; supporting content creates no cards', () => {
    const catalog = createCatalog(realMaterials as any);
    const phraseIds = new Set(catalog.phrases.map((item) => item.id));
    const independentIds = catalog.wordIndex.filter((item) => !item.sourcePhraseId || !phraseIds.has(item.sourcePhraseId)).map((item) => item.id);
    expect(new Set([...phraseIds, ...independentIds]).size).toBe(638);
    expect(buildFlashcards(catalog).map((c) => c.id)).toEqual([...phraseIds, ...independentIds]);
    expect(getTopics(buildFlashcards(catalog))).toHaveLength(34);
  });
});

describe('Independent legacy search oracle', () => {
  it('preserves original matches and order in all four shared search domains', () => {
    const catalog = createCatalog(realMaterials as any);
    const alternatives = (v: any) => Array.isArray(v) ? v.join(' ') : v;
    const examples = (item: any) => (item.examples ?? []).flatMap((e: any) => [e.en, e.ua]);
    const domains: any[] = [
      [released.phrases, catalog.searchPhrases, (v: any) => [v.phrase, v.example, ...examples(v), v.translation, v.transcription, alternatives(v.commonAlternatives), v.category, v.section, v.tag]],
      [released.wordIndex, catalog.searchWords, (v: any) => [v.term, v.meaning, v.pronunciation, v.transcription, alternatives(v.commonAlternatives), ...examples(v), v.category, v.section, v.tag]],
      [released.irregularVerbs, catalog.searchVerbs, (v: any) => [v.base, v.pastSimple, v.pastParticiple, v.translation, v.transcription, alternatives(v.commonAlternatives), v.group]],
      [[...released.blocks].sort((a,b) => (a.priority ?? 0) - (b.priority ?? 0)), catalog.searchBlocks, (v: any) => [v.title, v.description, v.type, v.category, v.tag]]
    ];
    const queries = ['', 'work', 'meeting', 'the', 'про', 'conditionals', 'traveling', ...realMaterials.phrases.map((p) => p.phrase), ...realMaterials.phrases.slice(0, 100).map((p) => p.translation)];
    for (const [items, search, fields] of domains) {
      const ids = new Set(items.map((v: any) => v.id));
      for (const query of queries) {
        const expected = items.filter((v: any) => fields(v).some((f: any) => String(f ?? '').toLowerCase().trim().includes(query.toLowerCase().trim()))).map((v: any) => v.id);
        expect(search(query).filter((v: any) => ids.has(v.id)).map((v: any) => v.id), query).toEqual(expected);
      }
    }
  });
});

function smallFixture() {
  const descriptor = { schemaVersion: 1, meta, blocks: [{ id: 'topic-a', title: 'A', description: 'English', type: 'phraseCategory', category: 'A' }, { id: 'topic-b', title: 'B', description: 'English', type: 'phraseCategory', category: 'B' }] };
  const pack: any = { schemaVersion: 1, id: 'a', title: 'Review', order: 10, content: {
    phrases: [p('p-a', 'A'), p('p-b', 'B')], answers: [{ id: 'answer-a', topic: 'A', question: 'Question?', answer: 'Answer.', translation: 'Відповідь.' }],
    topics: [{ id: 'a', title: 'A', blockId: 'topic-a', description: 'English', sections: [{ id: 'one', title: 'One', items: ['p-a'], answerId: 'answer-a' }] }]
  } };
  return { descriptor, pack };
}
const invalids: [string, (pack: any) => void][] = [
  ['unknown topic key', p => p.content.topics[0].unknown = true],
  ['unknown subsection key', p => p.content.topics[0].sections[0].unknown = true],
  ['malformed question translation', p => p.content.topics[0].sections[0].questions = [{ en: 'Question?', ua: 3 }]],
  ['malformed filter', p => p.content.topics[0].filter = { label: 'Situations', all: false }],
  ['malformed answer label', p => p.content.answers[0].label = {}],
  ['malformed optional answer ID', p => p.content.answers[0].id = 123],
  ['duplicate topic ID', p => p.content.topics.push(structuredClone(p.content.topics[0]))],
  ['duplicate topic title', p => p.content.topics.push({ ...structuredClone(p.content.topics[0]), id: 'another' })],
  ['duplicate answer ID', p => p.content.answers.push(structuredClone(p.content.answers[0]))],
  ['answer ID collides with phrase', p => p.content.answers[0].id = 'p-a'],
  ['non-category block', p => p.content.topics[0].blockId = 'p-a'],
  ['wrong category block', p => p.content.topics[0].blockId = 'topic-b'],
  ['missing phrase', p => p.content.topics[0].sections[0].items = ['missing']],
  ['wrong category phrase', p => p.content.topics[0].sections[0].items = ['p-b']],
  ['duplicate coverage', p => p.content.topics[0].sections[0].items.push('p-a')],
  ['unlisted phrase in category', p => p.content.phrases.push({ ...p.content.phrases[0], id: 'extra' })],
  ['answerId is an existing phrase', p => p.content.topics[0].sections[0].answerId = 'p-a']
];
describe('Independent malformed fixtures at generation and runtime boundaries', () => {
  for (const [name, change] of invalids) it(name, async () => {
    const { descriptor, pack } = smallFixture();
    change(pack);
    mkdirSync(join(evidence, 'runtime'), { recursive: true });
    const dir = mkdtempSync(join(evidence, 'runtime', 'malformed-'));
    mkdirSync(join(dir, 'packs'));
    writeFileSync(join(dir, 'catalog.json'), JSON.stringify(descriptor));
    writeFileSync(join(dir, 'packs/a.json'), JSON.stringify(pack));
    await expect(buildContent(dir)).rejects.toThrow();
    const counts = countContent(pack.content);
    const manifest = { ...descriptor, counts, packs: [{ id: 'a', title: pack.title, order: 10, url: 'packs/a.0000000000000000.json', counts }] };
    vi.stubGlobal('fetch', vi.fn(async (url) => new Response(JSON.stringify(String(url).endsWith('manifest.json') ? manifest : pack), { status: 200 })));
    await expect(loadBuiltInCatalog()).rejects.toThrow();
  });
  it('supports absent topic/answer optional fields and separate pack/topic/record namespaces', () => {
    const { descriptor, pack } = smallFixture();
    pack.content.topics[0].id = 'p-a'; // Topic ID can equal a learning ID; it is an address.
    expect(assembleMaterials(descriptor, [pack]).topics).toHaveLength(1);
    delete pack.content.topics;
    delete pack.content.answers[0].id;
    expect(parsePack(pack).content.answers[0]).not.toHaveProperty('label');
    expect(assembleMaterials(descriptor, [pack]).topics).toEqual([]);
  });
});

describe('Actual collection service with exact same-name topic', () => {
  it('joins Conditionals, survives hidden/removal/reimport, and publishes no failed transaction', async () => {
    resetDatabase();
    const storage = await openStorage();
    connectCollections(storage, readCollections(await storage.readAll()));
    try {
      const built = createCatalog(realMaterials as any);
      const cid = 'user:11111111-1111-4111-8111-111111111111';
      const id = `${cid}:entry:11111111-1111-4111-8111-111111111112`;
      const native = { format: 'eng-trainer-vocabulary', version: 1, collection: { id: cid, name: 'Independent', description: 'Synthetic' }, entries: [{ id, kind: 'word', english: 'A new Conditionals word', translation: 'Нове слово', topic: 'Conditionals', examples: [] }] };
      const now = () => combineCatalog(built, get(userVocabulary));
      const state = learned(built.phrases.filter(p => p.category === 'Conditionals').map(p => p.id));
      const snap = () => homeProgress(now(), state);
      const plan = () => prepareImport(parseImport(JSON.stringify(native), 'independent.json'), now());
      const before = snap();
      const dbBefore = await readDatabase();
      plan(); // Canceling/abandoning preview cannot publish.
      expect(snap()).toEqual(before);
      const originalPut = IDBObjectStore.prototype.put;
      const fail = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (...args) { if (this.name === 'userEntries') throw new DOMException('Review quota', 'QuotaExceededError'); return originalPut.apply(this, args as any); });
      await expect(acceptImport(plan())).rejects.toThrow();
      expect(snap()).toEqual(before);
      expect(await readDatabase()).toEqual(dbBefore);
      fail.mockRestore();
      await acceptImport(plan());
      const imported = snap();
      expect(imported.vocabulary).toEqual({ learned: 18, available: 639, remaining: 621 });
      expect(imported.topics).toMatchObject({ eligible: 34, completed: 0 });
      expect(imported.topics.list.find(t => t.name === 'Conditionals')).toEqual({ name: 'Conditionals', learned: 18, available: 19, complete: false });
      state.hiddenWords.push(id);
      expect(snap()).toEqual(imported);
      state.learnedPhrases.push(id);
      const savedProgress = structuredClone(state);
      const exported = exportCollection(cid);
      const originalDelete = IDBObjectStore.prototype.delete;
      const failDelete = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (...args) { if (this.name === 'userEntries') throw new Error('Review delete'); return originalDelete.apply(this, args as any); });
      await expect(removeCollection(cid)).rejects.toThrow();
      expect(snap().vocabulary.available).toBe(639);
      failDelete.mockRestore();
      await removeCollection(cid);
      expect(snap().vocabulary).toEqual({ learned: 18, available: 638, remaining: 620 });
      expect(state).toEqual(savedProgress);
      await acceptImport(prepareImport(parseImport(exported, 'restore.json'), now()));
      expect(snap().vocabulary).toEqual({ learned: 19, available: 639, remaining: 620 });
      expect(snap().topics.completed).toBe(1);
      expect(state).toEqual(savedProgress);
    } finally { storage.close(); }
  });
});
