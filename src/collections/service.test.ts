import { get } from 'svelte/store';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCatalog } from '../content/catalog';
import { combineCatalog, inCollection, resolvedCollection } from '../content/userCatalog';
import { buildFlashcards, summarizeDeck } from '../features/flashcards/flashcards';
import { DATABASE_NAME, openStorage, STATE_STORE_NAMES, STORE_NAMES, type AppStorage } from '../storage/database';
import { collection, entry, id, native } from '../test/collections';
import { realMaterials } from '../test/content';
import { readDatabase, resetDatabase, watchUnhandledRejections } from '../test/database';
import { parseImport } from './format';
import { acceptImport, connectCollections, disableCollections, exportCollection, prepareImport, readCollections, removeCollection, renameCollection, userVocabulary } from './service';

const builtIn = createCatalog(realMaterials);
let storage: AppStorage;
async function connect(): Promise<void> {
  storage = await openStorage();
  connectCollections(storage, readCollections(await storage.readAll()));
}
const plan = (value = native()) => prepareImport(parseImport(JSON.stringify(value), 'synthetic.json'), combineCatalog(builtIn, get(userVocabulary)));

beforeEach(async () => { resetDatabase(); await connect(); });
afterEach(() => { storage.close(); disableCollections(); vi.restoreAllMocks(); });

describe('collection persistence and catalog', () => {
  it('imports atomically, joins shared search and reloads with stable identities and order', async () => {
    const proposal = plan();
    expect(get(userVocabulary).entries).toHaveLength(0);
    expect(await acceptImport(proposal)).toEqual({ added: 2, skipped: 0 });
    const saved = await readDatabase();
    expect(Object.keys(saved.userEntries)).toHaveLength(2);
    expect(saved.progress).toEqual({});
    const catalog = combineCatalog(builtIn, get(userVocabulary));
    expect(catalog.searchWords('ПЕРЕКЛАД 1').map((item) => item.id)).toEqual([id(1)]);
    expect(catalog.searchPhrases('EXAMPLE 2').map((item) => item.id)).toEqual([id(2)]);
    expect(catalog.searchWords('Synthetic vocabulary').map((item) => item.id)).toEqual([id(1)]);
    expect(catalog.wordCategories).toContain('Synthetic topic');
    expect(catalog.collections).toEqual([collection].map(({ id, name }) => ({ id, name })));
    const original = get(userVocabulary);
    storage.close(); await connect();
    expect(get(userVocabulary)).toEqual(original);
    expect(combineCatalog(builtIn, get(userVocabulary)).phrases.slice(0, builtIn.phrases.length)).toEqual(builtIn.phrases);
  });
  it('round-trips native export and treats repeated import as an exact no-op', async () => {
    await acceptImport(plan());
    const before = await readDatabase();
    const exported = exportCollection(collection.id);
    const again = prepareImport(parseImport(exported, 'export.json'), combineCatalog(builtIn, get(userVocabulary)));
    expect(again).toMatchObject({ additions: [], skipped: 2, issues: [], duplicates: [] });
    expect(await acceptImport(again)).toEqual({ added: 0, skipped: 2 });
    expect(await readDatabase()).toEqual(before);
    expect(parseImport(exported, 'export.json').entries).toEqual(native().entries);
  });
  it('blocks conflicting IDs without changing any data', async () => {
    await acceptImport(plan());
    const before = await readDatabase();
    const conflict = plan(native([entry(1, { translation: 'different meaning' }), entry(3)]));
    expect(conflict.issues[0].message).toMatch(/ID conflict/);
    await expect(acceptImport(conflict)).rejects.toThrow(/Fix all invalid/);
    expect(await readDatabase()).toEqual(before);
  });
  it('requires acknowledgment of possible duplicates and keeps separate meanings and IDs', async () => {
    const csv = parseImport('english,translation\nbank,банк\nbank,берег', 'bank.csv');
    const proposal = prepareImport(csv, builtIn);
    expect(proposal.duplicates.length).toBeGreaterThanOrEqual(1);
    await expect(acceptImport(proposal)).rejects.toThrow(/acknowledge/);
    expect(get(userVocabulary).entries).toHaveLength(0);
    await acceptImport(proposal, true);
    const cards = buildFlashcards(combineCatalog(builtIn, get(userVocabulary))).filter((card) => card.collectionId);
    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((card) => card.id)).size).toBe(2);
    const summary = summarizeDeck(cards, { learnedPhrases: [cards[0].id], hiddenPhrases: [], hiddenWords: [] });
    expect(summary.learned.map((card) => card.translation)).toEqual(['банк']);
    expect(summary.learning.map((card) => card.translation)).toEqual(['берег']);
  });
  it('only joins phrase and word identities through an explicit valid link', async () => {
    const value = native([entry(1, { kind: 'phrase', english: 'same' }), entry(2, { english: 'same', sourcePhraseId: id(1) }), entry(3, { english: 'same' })]);
    await acceptImport(plan(value), true);
    const catalog = combineCatalog(builtIn, get(userVocabulary));
    const cards = buildFlashcards(catalog).filter((card) => inCollection(card, collection.id));
    expect(cards.map((card) => card.id)).toEqual([id(1), id(3)]);
    expect(cards[0].wordIds).toEqual([id(2)]);
    expect(summarizeDeck(cards, { learnedPhrases: [], hiddenPhrases: [], hiddenWords: [id(2)] }).learning.map((card) => card.id)).toEqual([id(3)]);
    expect(resolvedCollection(catalog, collection.id)).toBe(collection.id);
    expect(resolvedCollection(catalog, 'missing')).toBe('');
    expect(buildFlashcards(catalog).filter((card) => inCollection(card, 'built-in'))).toEqual(buildFlashcards(builtIn));
  });
  it('renames without changing IDs, and preserves progress on deletion and reimport', async () => {
    await acceptImport(plan());
    const records = [
      { type: 'put' as const, store: 'progress' as const, key: 'learnedPhrases', value: ['phrase-001', id(1)] },
      { type: 'put' as const, store: 'progress' as const, key: 'favoriteWords', value: [id(1)] },
      { type: 'put' as const, store: 'flashcardSessions' as const, key: 'all', value: { order: [id(2), 'phrase-002'], index: 1 } }
    ];
    await storage.write(records);
    await renameCollection(collection.id, '  Renamed  ');
    const exported = exportCollection(collection.id);
    expect(parseImport(exported, 'export.json').collection.name).toBe('Renamed');
    const before = await readDatabase();
    await removeCollection(collection.id);
    const deleted = await readDatabase();
    expect(deleted.userCollections).toEqual({}); expect(deleted.userEntries).toEqual({});
    for (const store of STATE_STORE_NAMES) expect(deleted[store]).toEqual(before[store]);
    expect(combineCatalog(builtIn, get(userVocabulary))).toBe(builtIn);
    await acceptImport(prepareImport(parseImport(exported, 'export.json'), builtIn));
    const cards = buildFlashcards(combineCatalog(builtIn, get(userVocabulary)));
    expect(summarizeDeck(cards, { learnedPhrases: deleted.progress.learnedPhrases as string[], hiddenPhrases: [], hiddenWords: [] }).learned.map((card) => card.id)).toContain(id(1));
    expect((await readDatabase()).flashcardSessions).toEqual(before.flashcardSessions);
  });
  it('rejects stale previews after a rename, including imports with nothing new', async () => {
    await acceptImport(plan());
    const stale = plan();
    await renameCollection(collection.id, 'Changed elsewhere');
    await expect(acceptImport(stale)).rejects.toThrow(/changed/);
    expect(get(userVocabulary).collections[0].name).toBe('Changed elsewhere');
  });
  it('rejects a concurrent collection update in the storage transaction', async () => {
    await acceptImport(plan());
    const proposal = plan(native([entry(3)]));
    const another = { ...get(userVocabulary).collections[0], revision: 2, name: 'Another tab' };
    await storage.write([{ type: 'put', store: 'userCollections', key: collection.id, value: another }]);
    await expect(acceptImport(proposal)).rejects.toThrow(/another session/);
    expect(Object.keys((await readDatabase()).userEntries)).toHaveLength(2);
  });
  it('rejects invalid records instead of importing the valid subset', async () => {
    const proposal = prepareImport(parseImport('english,translation\nyes,так\nmissing,', 'bad.csv'), builtIn);
    expect(proposal.additions).toHaveLength(1);
    await expect(acceptImport(proposal)).rejects.toThrow(/Fix all invalid/);
    expect((await readDatabase()).userEntries).toEqual({});
  });
  it('cannot import in the continue-without-saving mode', async () => {
    disableCollections();
    await expect(acceptImport(plan())).rejects.toThrow(/Saving is unavailable/);
  });
  it('preserves catalog ordering after appending to an older collection and reloading', async () => {
    await acceptImport(plan());
    const second = prepareImport(parseImport('english,translation\nsecond collection,друга', 'second.csv'), combineCatalog(builtIn, get(userVocabulary)));
    await acceptImport(second);
    await acceptImport(plan(native([entry(3)])));
    const before = get(userVocabulary);
    storage.close(); await connect();
    expect(get(userVocabulary)).toEqual(before);
  });
});

describe('transaction and migration guarantees', () => {
  it('reports a blocked upgrade and safely retries after the old connection closes', async () => {
    storage.close(); resetDatabase();
    const legacy = await openDB(DATABASE_NAME, 1, { upgrade(db) { STATE_STORE_NAMES.forEach((name) => db.createObjectStore(name)); } });
    await expect(openStorage()).rejects.toThrow(/Close other eng-trainer tabs/);
    legacy.close();
    await connect();
    expect(get(userVocabulary).available).toBe(true);
  });
  it('rolls back a failed schema upgrade without losing version-1 records', async () => {
    storage.close(); resetDatabase();
    const legacy = await openDB(DATABASE_NAME, 1, { upgrade(db) { STATE_STORE_NAMES.forEach((name) => db.createObjectStore(name)); } });
    await legacy.put('progress', ['phrase-001'], 'learnedPhrases'); legacy.close();
    const create = IDBDatabase.prototype.createObjectStore;
    vi.spyOn(IDBDatabase.prototype, 'createObjectStore').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['createObjectStore']>) {
      const result = create.apply(this, args);
      if (args[0] === 'userEntries') result.transaction.abort();
      return result;
    });
    await expect(openStorage()).rejects.toThrow(/IndexedDB open failed/);
    vi.restoreAllMocks();
    const unchanged = await openDB(DATABASE_NAME);
    expect(unchanged.version).toBe(1);
    expect([...unchanged.objectStoreNames].sort()).toEqual([...STATE_STORE_NAMES].sort());
    expect(await unchanged.get('progress', 'learnedPhrases')).toEqual(['phrase-001']);
    unchanged.close(); await connect();
  });
  it('upgrades a real version-1 schema, preserving every existing record without startup writes', async () => {
    storage.close(); resetDatabase();
    const legacy = await openDB(DATABASE_NAME, 1, { upgrade(db) { STATE_STORE_NAMES.forEach((name) => db.createObjectStore(name)); } });
    const expected = { progress: { learnedPhrases: ['phrase-005'], unknownFutureRecord: { exact: true } }, settings: { theme: 'dark' }, learnPasses: { pass: { raw: ['unchanged'] } }, flashcardSessions: { all: { order: ['phrase-001'], index: 0 } } };
    for (const name of STATE_STORE_NAMES) for (const [key, value] of Object.entries(expected[name])) await legacy.put(name, value, key);
    legacy.close();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    await connect();
    expect(put).not.toHaveBeenCalled();
    const db = await openDB(DATABASE_NAME);
    expect(db.version).toBe(2); expect([...db.objectStoreNames].sort()).toEqual([...STORE_NAMES].sort()); db.close();
    expect(await readDatabase()).toEqual({ ...expected, userCollections: {}, userEntries: {} });
  });
  it('rolls back after requests succeed but the native transaction aborts', async () => {
    const observed = watchUnhandledRejections();
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      const request = put.apply(this, args);
      if (this.name === 'userEntries') request.addEventListener('success', () => { try { this.transaction.abort(); } catch { /* already aborted */ } });
      return request;
    });
    await expect(acceptImport(plan())).rejects.toThrow(/not saved.*No partial/);
    expect((await readDatabase()).userCollections).toEqual({});
    expect((await readDatabase()).userEntries).toEqual({});
    expect(get(userVocabulary).entries).toEqual([]);
    expect(await observed.stop()).toEqual([]);
    vi.restoreAllMocks();
    await expect(acceptImport(plan())).resolves.toEqual({ added: 2, skipped: 0 });
  });
  it('reports quota failure and rolls back metadata written before the failing entry', async () => {
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'userEntries') throw new DOMException('Synthetic quota exceeded', 'QuotaExceededError');
      return put.apply(this, args);
    });
    await expect(acceptImport(plan())).rejects.toThrow(/quota exceeded/);
    expect((await readDatabase()).userCollections).toEqual({});
    expect(get(userVocabulary).entries).toEqual([]);
  });
  it('rolls back a failed deletion without changing progress or the live catalog', async () => {
    await acceptImport(plan());
    const before = await readDatabase();
    const remove = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['delete']>) {
      if (this.name === 'userEntries') throw new Error('Synthetic deletion failure');
      return remove.apply(this, args);
    });
    await expect(removeCollection(collection.id)).rejects.toThrow(/not saved/);
    expect(await readDatabase()).toEqual(before);
    expect(get(userVocabulary).entries).toHaveLength(2);
  });
  it('refuses corrupt saved entries rather than silently dropping data', async () => {
    await acceptImport(plan());
    await storage.write([{ type: 'put', store: 'userEntries', key: id(1), value: { ...get(userVocabulary).entries[0], sourcePhraseId: id(99) } }]);
    await expect(storage.readAll().then(readCollections)).rejects.toThrow(/missing phrase/);
    expect(Object.keys((await readDatabase()).userEntries)).toHaveLength(2);
  });
});
