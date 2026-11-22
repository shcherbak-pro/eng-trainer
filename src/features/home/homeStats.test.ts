import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptImport, connectCollections, disableCollections, exportCollection, prepareImport, readCollections, removeCollection, userVocabulary } from '../../collections/service';
import { parseImport } from '../../collections/format';
import { createCatalog, type ContentCatalog } from '../../content/catalog';
import type { Materials, Phrase, WordIndexItem } from '../../content/types';
import { combineCatalog } from '../../content/userCatalog';
import { openStorage, type AppStorage } from '../../storage/database';
import { collection, entry, id, native } from '../../test/collections';
import { realMaterials } from '../../test/content';
import { readDatabase, resetDatabase } from '../../test/database';
import { buildFlashcards, filterDeck, getTopics, summarizeDeck } from '../flashcards/flashcards';
import { focusCount, homeProgress, libraryOverview, percentLabel, topicCompletion } from './homeStats';

/**
 * Home statistics (ENG-V2-03). Numbered cases follow the task's metric tests; the
 * application-level ones (reactivity on screen, reload, no writes) are in App.home.test.ts.
 */
const meta = { title: 'Test', subtitle: '', version: '', language: '', updated: '', goal: '' };
function synthetic(phrases: Phrase[], wordIndex: WordIndexItem[] = []): ContentCatalog {
  return createCatalog({ meta, blocks: [], patterns: [], answers: [], drills: [], irregularVerbs: [], phrases, wordIndex } as Materials);
}
const phrase = (id: string, category: string, text = id): Phrase => ({ id, category, phrase: text, translation: `${text} (uk)` });
const word = (id: string, category: string, term: string, sourcePhraseId?: string): WordIndexItem => ({ id, category, term, meaning: `${term} (uk)`, pronunciation: '', examples: [], ...(sourcePhraseId ? { sourcePhraseId } : {}) });
const progress = (learnedPhrases: string[] = []) => ({ learnedPhrases, favoriteBlocks: [], favoritePhrases: [], favoriteWords: [], favoriteIrregular: [] });

describe('Home statistics selectors', () => {
  it('1: counts a phrase and its explicitly linked word once; a same-text word with its own ID stays independent', () => {
    const catalog = synthetic(
      [phrase('p1', 'Greetings', 'Good morning'), phrase('p2', 'Greetings', 'See you')],
      [word('w1', 'Greetings', 'Good morning', 'p1'), word('w2', 'Greetings', 'Good morning')]
    );
    expect(homeProgress(catalog, progress()).vocabulary).toEqual({ learned: 0, available: 3, remaining: 3 });
    const learnedPhrase = homeProgress(catalog, progress(['p1']));
    expect(learnedPhrase.vocabulary).toEqual({ learned: 1, available: 3, remaining: 2 });
    // The views overlap: the linked word is learned through its phrase; the same-text word is not.
    expect(learnedPhrase.words).toEqual({ learned: 1, available: 2 });
    expect(learnedPhrase.phrases).toEqual({ learned: 1, available: 2 });
    const both = homeProgress(catalog, progress(['p1', 'w2']));
    expect(both.vocabulary.learned).toBe(2);
    expect(both.words.learned).toBe(2);
    // A learned ID for the linked word itself is not a card ID and changes nothing.
    expect(homeProgress(catalog, progress(['w1'])).vocabulary.learned).toBe(0);
  });

  it('2: advances both topics of a card in two topics, counting the card once globally', () => {
    const catalog = synthetic([phrase('p1', 'Travel'), phrase('p2', 'Work')], [word('w1', 'Work', 'p1 term', 'p1')]);
    const cards = buildFlashcards(catalog);
    expect(cards.find((card) => card.id === 'p1')!.topics).toEqual(['Travel', 'Work']);
    const stats = homeProgress(catalog, progress(['p1']));
    expect(stats.vocabulary).toEqual({ learned: 1, available: 2, remaining: 1 });
    expect(stats.topics.list).toEqual([
      { name: 'Travel', available: 1, learned: 1, complete: true },
      { name: 'Work', available: 2, learned: 1, complete: false }
    ]);
    expect(stats.topics).toMatchObject({ completed: 1, eligible: 2 });
    // The same membership the flashcard topic decks use.
    for (const item of stats.topics.list) expect(filterDeck(cards, 'topic', item.name)).toHaveLength(item.available);
  });

  it('3: keeps a hidden, unlearned item in the denominator, so its topic is not complete', () => {
    const catalog = synthetic([phrase('p1', 'Small'), phrase('p2', 'Small')]);
    const state = { ...progress(['p1']), hiddenPhrases: ['p2'], hiddenWords: [] };
    const stats = homeProgress(catalog, state);
    expect(stats.vocabulary).toEqual({ learned: 1, available: 2, remaining: 1 });
    expect(stats.topics).toMatchObject({ completed: 0, eligible: 1 });
    // The flashcard deck leaves the hidden card out of its session; Home does not.
    expect(summarizeDeck(buildFlashcards(catalog), state).learning).toHaveLength(0);
  });

  it('8: handles empty sets and learned IDs that no longer exist without false completion', () => {
    const empty = synthetic([]);
    const stats = homeProgress(empty, progress(['gone-1', 'gone-2']));
    expect(stats.vocabulary).toEqual({ learned: 0, available: 0, remaining: 0 });
    expect(stats.topics).toEqual({ completed: 0, eligible: 0, list: [] });
    expect(percentLabel(0, 0)).toBeNull();
    expect(libraryOverview(empty)).toEqual({ words: 0, phrases: 0, verbs: 0, topics: 0, collections: 0 });
    const one = synthetic([phrase('p1', 'Only')]);
    expect(homeProgress(one, progress(['gone'])).topics).toMatchObject({ completed: 0, eligible: 1 });
    // A topic without cards is never complete.
    expect(topicCompletion([], new Set(['p1']))).toEqual([]);
    expect(topicCompletion([{ ...buildFlashcards(one)[0], topics: [] }], new Set(['p1']))).toEqual([]);
  });

  it('shows whole percentages rounded down: never 100% until everything is learned, "<1%" for a start', () => {
    expect(percentLabel(0, 638)).toBe('0%');
    expect(percentLabel(1, 638)).toBe('<1%');
    expect(percentLabel(637, 638)).toBe('99%');
    expect(percentLabel(638, 638)).toBe('100%');
  });

  it('10: derives totals from the whole catalog, so search, filters and pages cannot change them', () => {
    const catalog = createCatalog(realMaterials as Materials);
    const full = homeProgress(catalog, progress(['phrase-001']));
    // Filtered views are subsets; the selectors never receive them.
    const filtered = createCatalog({ ...(realMaterials as Materials), phrases: catalog.searchPhrases('meeting') });
    expect(homeProgress(filtered, progress(['phrase-001'])).vocabulary.available).toBeLessThan(full.vocabulary.available);
    expect(full.vocabulary.available).toBe(buildFlashcards(catalog).length);
    expect(full.topics.eligible).toBe(getTopics(buildFlashcards(catalog)).length);
  });

  it('describes the real library: one card per phrase, the three new topics included, nothing summed', () => {
    const catalog = createCatalog(realMaterials as Materials);
    const stats = homeProgress(catalog, progress());
    expect(stats.vocabulary).toEqual({ learned: 0, available: realMaterials.phrases.length, remaining: realMaterials.phrases.length });
    expect(libraryOverview(catalog)).toEqual({
      words: realMaterials.wordIndex.length,
      phrases: realMaterials.phrases.length,
      verbs: realMaterials.irregularVerbs.length,
      topics: stats.topics.eligible,
      collections: 0
    });
    expect(stats.topics.list.map((item) => item.name)).toEqual(expect.arrayContaining(['Conditionals', 'Small Talk', 'Interview English']));
    // The Words-screen rule agrees with the card identity for every built-in word.
    const cardOf = new Map(buildFlashcards(catalog).flatMap((card) => card.wordIds.map((wordId) => [wordId, card.id] as const)));
    for (const item of catalog.wordIndex) expect(cardOf.get(item.id)).toBe(item.sourcePhraseId ?? item.id);
  });

  it('counts Focus entries that are in the catalog, as the navigation does', () => {
    const catalog = createCatalog(realMaterials as Materials);
    const state = { favoriteBlocks: ['topic-small-talk', 'gone-block'], favoritePhrases: ['small-talk-meet-01', 'gone'], favoriteWords: [realMaterials.wordIndex[0].id], favoriteIrregular: [] };
    expect(focusCount(catalog, state)).toBe(3);
  });
});

describe('Home statistics with imported collections', () => {
  let storage: AppStorage;
  const builtIn = createCatalog(realMaterials as Materials);
  const current = () => combineCatalog(builtIn, get(userVocabulary));
  const plan = (value = native()) => prepareImport(parseImport(JSON.stringify(value), 'synthetic.json'), current());

  async function connect(): Promise<void> {
    storage = await openStorage();
    connectCollections(storage, readCollections(await storage.readAll()));
  }

  beforeEach(async () => { resetDatabase(); await connect(); });
  afterEach(() => { storage.close(); disableCollections(); vi.restoreAllMocks(); });

  it('4: retained learned IDs of a removed collection stop counting, and count again after a native reimport', async () => {
    await acceptImport(plan());
    const learned = progress(['phrase-001', id(1), id(2)]);
    const before = homeProgress(current(), learned);
    expect(before.vocabulary).toMatchObject({ learned: 3, available: builtIn.phrases.length + 2 });
    expect(before.topics.list.find((item) => item.name === 'Synthetic topic')).toMatchObject({ learned: 2, available: 2, complete: true });
    const exported = exportCollection(collection.id);

    await removeCollection(collection.id);
    const removed = homeProgress(current(), learned);
    expect(removed.vocabulary).toEqual({ learned: 1, available: builtIn.phrases.length, remaining: builtIn.phrases.length - 1 });
    expect(removed.topics.list.some((item) => item.name === 'Synthetic topic')).toBe(false);
    expect(libraryOverview(current()).collections).toBe(0);

    await acceptImport(prepareImport(parseImport(exported, 'export.json'), current()));
    expect(homeProgress(current(), learned)).toEqual(before);
  });

  it('5: importing a new unlearned item lowers coverage without clearing any learned state', async () => {
    const learned = progress(['phrase-001']);
    const before = homeProgress(current(), learned);
    await acceptImport(plan(native([entry(1), entry(2, { kind: 'phrase' }), entry(3, { topic: 'Conditionals' })])));
    const after = homeProgress(current(), learned);
    expect(after.vocabulary).toEqual({ learned: 1, available: before.vocabulary.available + 3, remaining: before.vocabulary.remaining + 3 });
    // An imported entry with an existing topic name joins that topic, as in the flashcard selector.
    expect(after.topics.list.find((item) => item.name === 'Conditionals')!.available).toBe(19);
    expect(after.topics.eligible).toBe(before.topics.eligible + 1);
    expect(libraryOverview(current())).toMatchObject({ collections: 1, words: builtIn.wordIndex.length + 2, phrases: builtIn.phrases.length + 1 });
  });

  it('7: a failed import or a failed removal leaves every count unchanged', async () => {
    const learned = progress(['phrase-001']);
    const empty = homeProgress(current(), learned);
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'userEntries') throw new DOMException('Synthetic quota exceeded', 'QuotaExceededError');
      return put.apply(this, args);
    });
    await expect(acceptImport(plan())).rejects.toThrow(/quota exceeded/);
    expect(homeProgress(current(), learned)).toEqual(empty);
    expect(libraryOverview(current()).collections).toBe(0);
    vi.restoreAllMocks();

    await acceptImport(plan());
    const imported = homeProgress(current(), learned);
    const overview = libraryOverview(current());
    const remove = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['delete']>) {
      if (this.name === 'userEntries') throw new Error('Synthetic deletion failure');
      return remove.apply(this, args);
    });
    await expect(removeCollection(collection.id)).rejects.toThrow(/not saved/);
    expect(homeProgress(current(), learned)).toEqual(imported);
    expect(libraryOverview(current())).toEqual(overview);
  });

  it('9: computing statistics writes nothing', async () => {
    await acceptImport(plan());
    const before = await readDatabase();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    for (let i = 0; i < 3; i += 1) {
      homeProgress(current(), progress(['phrase-001', id(1)]));
      libraryOverview(current());
    }
    expect(put).not.toHaveBeenCalled();
    expect(await readDatabase()).toEqual(before);
  });
});
