import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCatalog } from '../../content/catalog';
import { combineCatalog } from '../../content/userCatalog';
import { parseImport } from '../../collections/format';
import { collection, entry, id, native } from '../../test/collections';
import { realMaterials } from '../../test/content';
import { readDatabase, resetDatabase } from '../../test/database';

const topic = 'Synthetic topic';
const builtIn = createCatalog({ ...realMaterials,
  phrases: ['a', 'b', 'c'].map((id) => ({ id, phrase: `Built-in ${id}`, translation: id, category: topic })),
  wordIndex: [{ id: 'word', term: 'Built-in word', meaning: 'слово', category: topic, pronunciation: '', examples: [] }]
});
const document = native([
  entry(1, { english: 'Same term' }), entry(2, { kind: 'phrase', english: 'Same term' }),
  entry(3, { kind: 'phrase' }), entry(4), entry(5, { kind: 'phrase' })
]);
const other = native([entry(6), entry(7, { kind: 'phrase' })]);
other.collection = { ...collection, id: collection.id.replace(/1$/, '2'), name: 'Other collection' };
other.entries = other.entries.map((item) => ({ ...item, id: item.id.replace(collection.id, other.collection.id) }));
const otherKey = `collection:${JSON.stringify([other.collection.id, 'all'])}`;
const collectionKey = `collection:${JSON.stringify([collection.id, 'all'])}`;
const cleanups: (() => Promise<void>)[] = [];

async function open() {
  vi.resetModules();
  const svelte = await import('svelte');
  const state = await import('../../state');
  const persistence = await import('../../state/persistence');
  const service = await import('../../collections/service');
  const pages = {
    cards: (await import('../flashcards/FlashcardsPage.svelte')).default,
    phrases: (await import('../vocabulary/PhrasesPage.svelte')).default,
    words: (await import('../vocabulary/WordIndexPage.svelte')).default
  };
  await state.initState();
  const catalog = () => combineCatalog(builtIn, get(service.userVocabulary));
  async function importFile(text: string) {
    await service.acceptImport(service.prepareImport(parseImport(text, 'synthetic.json'), catalog()), true);
  }
  function mount(view: keyof typeof pages) {
    const root = globalThis.document.createElement('div');
    globalThis.document.body.appendChild(root);
    const component = svelte.mount(pages[view], { target: root, props: { catalog: catalog() } });
    svelte.flushSync();
    const close = async () => { await svelte.unmount(component); root.remove(); };
    cleanups.push(close);
    const button = (label: string) => [...root.querySelectorAll('button')].find((item) =>
      item.getAttribute('aria-label') === label || item.textContent?.includes(label));
    return { root, button, async click(label: string) {
      const target = button(label);
      expect(target, label).toBeDefined();
      target!.click(); svelte.flushSync(); await persistence.persistenceSettled();
    }, async close() { cleanups.splice(cleanups.indexOf(close), 1); await close(); } };
  }
  return { ...state, ...service, catalog, importFile, mount, saved: persistence.persistenceSettled };
}

beforeEach(() => {
  resetDatabase();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
});
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('retained collection learning state', () => {
  it.each(['all', `topic:${topic}`])('restores %s order after deletion, answers and reload', async (key) => {
    let app = await open();
    await app.importFile(JSON.stringify(document));
    await app.importFile(JSON.stringify(other));
    const backup = app.exportCollection(collection.id);
    const order = ['a', id(1), 'b', id(2), 'c', other.entries[0].id, other.entries[1].id, 'word'];
    app.progress.toggleLearnedPhrase(id(3));
    app.progress.toggleFavorite('word', id(1));
    app.progress.hideItem('word', id(4));
    app.progress.hideItem('phrase', id(5));
    for (const deck of ['all', `topic:${topic}`]) app.progress.saveFlashcardSession(deck, { order, index: 1 });
    app.progress.saveFlashcardSession(collectionKey, { order: [id(2), id(1)], index: 1 });
    app.progress.saveFlashcardSession(otherKey, { order: other.entries.map((item) => item.id), index: 1 });
    app.settings.setFlashcardMode(key === 'all' ? 'all' : 'topic');
    app.settings.setFlashcardTopic(topic);
    await app.saved();
    const before = await readDatabase();
    await app.removeCollection(collection.id);
    let page = app.mount('cards');
    expect(page.root.querySelector('.flashcard__term')?.textContent).toBe('Built-in b');
    await page.click('Keep learning');
    expect(page.root.querySelector('.flashcard__term')?.textContent).toBe('Built-in c');
    await page.click('I know it');
    const expected = { order: order.filter((item) => item !== 'c'), index: 4 };
    expect((await readDatabase()).flashcardSessions?.[key]).toEqual(expected);
    await page.close();
    app = await open(); // hydrate from IndexedDB while the collection is absent
    page = app.mount('cards');
    expect(page.root.querySelector('.flashcard__term')?.textContent).toBe(other.entries[0].english);
    await page.close();
    await app.importFile(backup);
    const restored = await readDatabase();
    expect(restored.progress).toEqual({ ...before.progress, learnedPhrases: [id(3), 'c'] });
    expect(restored.flashcardSessions).toEqual({ ...before.flashcardSessions, [key]: expected });
    expect(restored.userEntries).toEqual(before.userEntries);
    expect(restored.userCollections?.[other.collection.id]).toEqual(before.userCollections?.[other.collection.id]);
    page = app.mount('cards');
    expect(page.root.querySelector('.flashcard__term')?.textContent).toBe(other.entries[0].english);
    // Same text, distinct word/phrase IDs, neither learned by another card's answer.
    expect(expected.order.indexOf(id(1))).toBe(1);
    expect(expected.order.indexOf(id(2))).toBe(3);
    await page.close();
    app.settings.setCollectionFilter(collection.id);
    page = app.mount('cards');
    expect(page.root.querySelector('.flashcard__term')?.textContent).toBe('Same term');
  });

  it('preserves absent slots during shuffle and explicit reset of an available deck', async () => {
    const app = await open();
    app.progress.saveFlashcardSession('all', { order: ['a', id(1), 'b', id(2), 'c', 'word'], index: 2 }, ['c']);
    const page = app.mount('cards');
    await page.click('Shuffle remaining cards');
    let session = get(app.progress).flashcardSessions.all;
    expect(session.order[1]).toBe(id(1)); expect(session.order[3]).toBe(id(2));
    expect(session.order.filter((value) => !value.startsWith('user:')).sort()).toEqual(['a', 'b', 'word']);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await page.click('Reset progress for All Vocabulary');
    session = get(app.progress).flashcardSessions.all;
    expect(session).toEqual({ order: ['a', id(1), 'b', id(2), 'c', 'word'], index: 0 });
    expect(get(app.progress).learnedPhrases).toEqual([]);
    expect((await readDatabase()).flashcardSessions?.all).toEqual(session);
  });

  it.each([
    ['words', 'word', 'hiddenWords', 'word', id(1), id(4), other.entries[0].id, 'Unhide all words'],
    ['phrases', 'phrase', 'hiddenPhrases', 'a', id(2), id(5), other.entries[1].id, 'Unhide all phrases']
  ] as const)('unhides only available %s and restores hidden IDs after reimport', async (view, kind, list, builtId, removedId, removedId2, otherId, label) => {
    let app = await open();
    await app.importFile(JSON.stringify(document));
    await app.importFile(JSON.stringify(other));
    const backup = app.exportCollection(collection.id);
    for (const value of [removedId, removedId2, builtId, otherId]) app.progress.hideItem(kind, value);
    await app.saved();
    const before = await readDatabase();
    await app.removeCollection(collection.id);
    let page = app.mount(view);
    await page.click(label);
    expect(page.button(label)).toBeUndefined();
    expect(get(app.progress)[list]).toEqual([removedId, removedId2]);
    await page.close();
    app = await open();
    page = app.mount(view);
    expect(page.button(label)).toBeUndefined();
    // Even an empty scoped request cannot erase unavailable flags.
    app.progress.unhideAll(kind, []); await app.saved();
    expect((await readDatabase()).progress?.[list]).toEqual([removedId, removedId2]);
    await page.close();
    await app.importFile(backup);
    page = app.mount(view);
    expect(page.button(label)).toBeDefined();
    expect(get(app.progress)[list]).toEqual([removedId, removedId2]);
    expect((await readDatabase()).userEntries).toEqual(before.userEntries);
    expect((await readDatabase()).userCollections?.[other.collection.id]).toEqual(before.userCollections?.[other.collection.id]);
    await page.click(label);
    expect((await readDatabase()).progress?.[list]).toEqual([]);
  });
});
