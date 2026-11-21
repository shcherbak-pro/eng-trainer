import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { abortReadTransactions, readDatabase, resetDatabase, seedDatabase, watchUnhandledRejections } from '../test/database';

/** Starts the state services from the database, the same way a page load does. */
async function loadState() {
  vi.resetModules();
  const state = await import('./index');
  const persistence = await import('./persistence');
  await state.initState();

  return {
    ...state,
    ...persistence,
    /** Waits for pending writes and returns what is really in the database. */
    async saved() {
      await persistence.persistenceSettled();
      return readDatabase();
    },
    /** Waits for pending writes and loads the state again, like a page reload. */
    async reload() {
      await persistence.persistenceSettled();
      return loadState();
    }
  };
}

beforeEach(() => {
  resetDatabase();
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('learning state in IndexedDB', () => {
  it('starts with defaults when nothing is saved, and saves nothing on its own', async () => {
    const app = await loadState();
    const state = get(app.progress);

    expect(get(app.settings).flashcardMode).toBe('all');
    expect(get(app.settings).flashcardTopic).toBe('');
    expect(state.flashcardSessions).toEqual({});
    expect(state.learnedPhrases).toEqual([]);
    expect(get(app.saveStatus)).toEqual({ state: 'idle' });
    expect(await app.saved()).toEqual({ progress: {}, learnPasses: {}, flashcardSessions: {}, settings: {} });
  });

  it('keeps learned items, the review sequence and the selected deck after a reload', async () => {
    const app = await loadState();
    app.settings.setFlashcardMode('topic');
    app.settings.setFlashcardTopic('Teamwork');
    app.progress.saveFlashcardSession('topic:Teamwork', { order: ['b', 'c'], index: 1 }, ['a']);

    const reloaded = await app.reload();

    expect(get(reloaded.settings).flashcardMode).toBe('topic');
    expect(get(reloaded.settings).flashcardTopic).toBe('Teamwork');
    expect(get(reloaded.progress).learnedPhrases).toEqual(['a']);
    expect(get(reloaded.progress).flashcardSessions).toEqual({ 'topic:Teamwork': { order: ['b', 'c'], index: 1 } });
  });

  it('does not mark anything as learned when a card is kept in the learning pool', async () => {
    const app = await loadState();
    app.progress.saveFlashcardSession('all', { order: ['a', 'b'], index: 1 });

    const reloaded = get((await app.reload()).progress);

    expect(reloaded.learnedPhrases).toEqual([]);
    expect(reloaded.flashcardSessions.all).toEqual({ order: ['a', 'b'], index: 1 });
  });

  it('does not store the same learned id twice', async () => {
    const app = await loadState();
    app.progress.saveFlashcardSession('all', { order: [], index: 0 }, ['a', 'b']);
    app.progress.saveFlashcardSession('topic:X', { order: [], index: 0 }, ['a']);

    expect(get(app.progress).learnedPhrases).toEqual(['a', 'b']);
    expect((await app.saved()).progress.learnedPhrases).toEqual(['a', 'b']);
  });

  it('returns items to the learning pool with "Learn again"', async () => {
    const app = await loadState();
    app.progress.saveFlashcardSession('all', { order: [], index: 0 }, ['a', 'b', 'c']);
    app.progress.relearnFlashcards(['b']);

    expect(get((await app.reload()).progress).learnedPhrases).toEqual(['a', 'c']);
  });

  it('resets one deck without touching the others', async () => {
    const app = await loadState();
    app.progress.saveFlashcardSession('topic:One', { order: ['x'], index: 0 }, ['a', 'b']);
    app.progress.saveFlashcardSession('topic:Two', { order: ['y'], index: 0 }, ['c']);
    app.progress.resetFlashcardDeck('topic:One', ['a', 'b']);

    expect((await app.saved()).flashcardSessions).toEqual({ 'topic:Two': { order: ['y'], index: 0 } });

    const reloaded = get((await app.reload()).progress);

    expect(reloaded.learnedPhrases).toEqual(['c']);
    expect(reloaded.flashcardSessions).toEqual({ 'topic:Two': { order: ['y'], index: 0 } });
  });

  it('keeps hidden items, the Focus List, Learn Passes and preferences after a reload', async () => {
    const app = await loadState();
    app.progress.toggleLearnedPhrase('phrase-001');
    app.progress.toggleFavorite('phrase', 'phrase-002');
    app.progress.toggleFavorite('word', 'word-phrase-003');
    app.progress.toggleFavorite('block', 'start-answer');
    app.progress.toggleFavorite('irregular', 'iv-001-be');
    app.progress.hideItem('word', 'word-phrase-004');
    app.progress.hideItem('irregular', 'iv-002-have');
    app.progress.saveLearnPass({ name: ' My pass ', blockIds: ['start-answer', 'start-answer', 'patterns'] });
    app.settings.setTheme('dark');
    app.settings.setSpeechRepeatCount(50);
    app.settings.setPhrasePageSize(20);
    app.settings.setPhraseCategory('Teamwork');
    app.settings.toggleIndexPanel('daily');
    app.settings.toggleShowHidden('word');

    const reloaded = await app.reload();
    const progress = get(reloaded.progress);
    const settings = get(reloaded.settings);

    expect(progress.learnedPhrases).toEqual(['phrase-001']);
    expect(progress.favoritePhrases).toEqual(['phrase-002']);
    expect(progress.favoriteWords).toEqual(['word-phrase-003']);
    expect(progress.favoriteBlocks).toEqual(['start-answer']);
    expect(progress.favoriteIrregular).toEqual(['iv-001-be']);
    expect(progress.hiddenWords).toEqual(['word-phrase-004']);
    expect(progress.hiddenIrregular).toEqual(['iv-002-have']);
    expect(progress.learnPasses).toHaveLength(1);
    expect(progress.learnPasses[0]).toMatchObject({ name: 'My pass', blockIds: ['start-answer', 'patterns'] });
    expect(progress.selectedLearnPassId).toBe(progress.learnPasses[0].id);
    expect(settings).toMatchObject({
      theme: 'dark',
      speechRepeatCount: 50,
      phrasePageSize: 20,
      phraseCategory: 'Teamwork',
      indexDailyExpanded: false,
      showHiddenWords: true
    });
  });

  it('hiding a phrase also removes it from the Focus List and from learned items', async () => {
    const app = await loadState();
    app.progress.toggleLearnedPhrase('phrase-001');
    app.progress.toggleFavorite('phrase', 'phrase-001');
    app.progress.hideItem('phrase', 'phrase-001');

    const reloaded = get((await app.reload()).progress);

    expect(reloaded.hiddenPhrases).toEqual(['phrase-001']);
    expect(reloaded.favoritePhrases).toEqual([]);
    expect(reloaded.learnedPhrases).toEqual([]);
  });

  it('deletes a Learn Pass from the database and falls back to the default pass', async () => {
    const app = await loadState();
    app.progress.saveLearnPass({ name: 'One', blockIds: ['a'] });
    const id = get(app.progress).selectedLearnPassId;
    app.progress.deleteLearnPass(id);

    expect((await app.saved()).learnPasses).toEqual({});

    const reloaded = get((await app.reload()).progress);
    expect(reloaded.learnPasses).toEqual([]);
    expect(reloaded.selectedLearnPassId).toBe('default');
  });

  it('keeps search text, page numbers and the practice prompt in memory only', async () => {
    const app = await loadState();
    app.viewState.setPhraseQuery('meeting');
    app.viewState.setPhrasePage(3);
    app.viewState.setCurrentPrompt('Describe your team.');

    expect(get(app.saveStatus)).toEqual({ state: 'idle' });
    expect(await app.saved()).toEqual({ progress: {}, learnPasses: {}, flashcardSessions: {}, settings: {} });
    expect(get((await app.reload()).viewState)).toMatchObject({ phraseQuery: '', phrasePage: 1, currentPrompt: '' });
  });

  it('repairs malformed saved records and keeps the rest of the saved data', async () => {
    await seedDatabase({
      progress: {
        hiddenPhrases: ['phrase-002'],
        learnedPhrases: ['phrase-001', 42, null],
        favoriteWords: 'not a list',
        selectedLearnPassId: 'deleted-pass'
      },
      learnPasses: {
        broken: 'not an object',
        'pass-1': { id: 'pass-1', name: 'My pass', blockIds: ['start-answer', 7], createdAt: 'x', updatedAt: 'y' }
      },
      settings: { flashcardMode: 'sideways', flashcardTopic: 123, theme: 'dark', phrasePageSize: 7 },
      flashcardSessions: {
        all: { order: ['a', 'a', 7, 'b'], index: 50 },
        'topic:Broken': 'not an object',
        'topic:NoOrder': { index: 2 },
        'topic:Negative': { order: ['x', 'y'], index: -3 }
      }
    });

    const app = await loadState();
    const state = get(app.progress);
    const settings = get(app.settings);

    expect(settings.flashcardMode).toBe('all');
    expect(settings.flashcardTopic).toBe('');
    expect(settings.phrasePageSize).toBe(5);
    expect(settings.theme).toBe('dark');
    expect(state.flashcardSessions).toEqual({
      all: { order: ['a', 'b'], index: 0 },
      'topic:NoOrder': { order: [], index: 0 },
      'topic:Negative': { order: ['x', 'y'], index: 0 }
    });
    expect(state.learnedPhrases).toEqual(['phrase-001']);
    expect(state.hiddenPhrases).toEqual(['phrase-002']);
    expect(state.favoriteWords).toEqual([]);
    expect(state.learnPasses).toEqual([
      { id: 'pass-1', name: 'My pass', description: '', blockIds: ['start-answer'], createdAt: 'x', updatedAt: 'y' }
    ]);
    expect(state.selectedLearnPassId).toBe('default');
  });

  it.each([
    ['an array', []],
    ['a string', 'sessions'],
    ['null', null]
  ])('skips a saved review sequence that is %s', async (_label, value) => {
    await seedDatabase({ flashcardSessions: { all: value } });

    expect(get((await loadState()).progress).flashcardSessions).toEqual({});
  });
});

describe('storage boundaries', () => {
  it('uses the dedicated v2 database', async () => {
    const { DATABASE_NAME } = await import('../storage/database');
    const app = await loadState();
    app.progress.toggleLearnedPhrase('phrase-001');
    await app.saved();

    expect(DATABASE_NAME).toBe('eng-trainer-v2');
    expect((await indexedDB.databases()).map((db) => db.name)).toEqual(['eng-trainer-v2']);
  });

  it('never reads or writes localStorage, so v1 data is neither used nor changed', async () => {
    const v1State = JSON.stringify({ learnedPhrases: ['phrase-001'], hiddenPhrases: ['phrase-002'], flashcardMode: 'topic' });
    window.localStorage.setItem('englishAssessmentTrainer.svelteState.v1', v1State);
    window.localStorage.setItem('englishAssessmentTrainer.theme.v1', 'dark');

    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    const clear = vi.spyOn(Storage.prototype, 'clear');

    const app = await loadState();
    expect(get(app.progress).learnedPhrases).toEqual([]);
    expect(get(app.progress).hiddenPhrases).toEqual([]);
    expect(get(app.settings).theme).toBe('system');

    app.progress.toggleLearnedPhrase('phrase-009');
    app.settings.setTheme('light');
    app.resetAllState();
    await app.saved();

    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(window.localStorage.getItem('englishAssessmentTrainer.svelteState.v1')).toBe(v1State);
    expect(window.localStorage.getItem('englishAssessmentTrainer.theme.v1')).toBe('dark');
  });

  it('"Reset progress" clears the v2 learning state and keeps the theme', async () => {
    const app = await loadState();
    app.progress.toggleLearnedPhrase('phrase-001');
    app.progress.hideItem('word', 'word-phrase-002');
    app.progress.saveLearnPass({ name: 'One', blockIds: ['a'] });
    app.progress.saveFlashcardSession('all', { order: ['x'], index: 0 });
    app.settings.setTheme('dark');
    app.settings.setPhrasePageSize(20);
    app.viewState.setPhraseQuery('meeting');

    app.resetAllState();

    const saved = await app.saved();
    expect(saved.learnPasses).toEqual({});
    expect(saved.flashcardSessions).toEqual({});
    expect(saved.progress).toMatchObject({ learnedPhrases: [], hiddenWords: [], selectedLearnPassId: 'default' });
    expect(saved.settings).toMatchObject({ theme: 'dark', phrasePageSize: 5 });

    const reloaded = await app.reload();
    expect(get(reloaded.progress)).toMatchObject({ learnedPhrases: [], hiddenWords: [], learnPasses: [], flashcardSessions: {} });
    expect(get(reloaded.settings)).toMatchObject({ theme: 'dark', phrasePageSize: 5 });
    expect(get(reloaded.viewState).phraseQuery).toBe('');
  });
});

describe('storage failures', () => {
  it('reports "saved" only after the transaction has completed', async () => {
    const app = await loadState();

    app.progress.toggleLearnedPhrase('phrase-001');
    expect(get(app.saveStatus)).toEqual({ state: 'saving' });

    await app.persistenceSettled();
    expect(get(app.saveStatus)).toEqual({ state: 'saved' });
    expect((await readDatabase()).progress.learnedPhrases).toEqual(['phrase-001']);
  });

  it('saves one user action that touches several records in one transaction', async () => {
    const app = await loadState();
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction');

    app.progress.saveFlashcardSession('all', { order: ['b'], index: 0 }, ['a']);
    await app.persistenceSettled();

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][1]).toBe('readwrite');
    expect([...(transaction.mock.calls[0][0] as string[])].sort()).toEqual(['flashcardSessions', 'progress']);
  });

  it('does not start with defaults when the saved state cannot be read', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['phrase-001'] }, settings: { theme: 'dark' } });
    vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(() => {
      throw new DOMException('Simulated read failure', 'UnknownError');
    });

    vi.resetModules();
    const state = await import('./index');
    const persistence = await import('./persistence');

    await expect(state.initState()).rejects.toMatchObject({ name: 'StorageError', operation: 'read' });

    // The services are not connected to storage, so a change cannot overwrite saved data.
    state.progress.toggleLearnedPhrase('phrase-777');
    state.settings.setTheme('light');
    await persistence.persistenceSettled();
    expect(get(persistence.saveStatus).state).not.toBe('saved');

    vi.restoreAllMocks();
    expect(await readDatabase()).toMatchObject({ progress: { learnedPhrases: ['phrase-001'] }, settings: { theme: 'dark' } });
  });

  it('handles a read transaction that aborts by itself: no unhandled rejection, no overwrite, and a retry loads the saved state', async () => {
    const seeded = { progress: { learnedPhrases: ['phrase-001'] }, settings: { theme: 'dark', activePage: 'phrases' } };
    await seedDatabase(seeded);
    const rejections = watchUnhandledRejections();
    const removeFailure = abortReadTransactions();

    vi.resetModules();
    const state = await import('./index');
    const persistence = await import('./persistence');

    let failure: unknown;
    try {
      await state.initState();
    } catch (error) {
      failure = error;
    } finally {
      removeFailure();
    }

    expect(failure).toMatchObject({ name: 'StorageError', operation: 'read' });
    expect(String((failure as Error).message)).toMatch(/abort/i);
    expect(await rejections.stop()).toEqual([]);

    // Nothing was loaded and nothing is connected, so nothing can be overwritten.
    expect(get(state.progress).learnedPhrases).toEqual([]);
    state.progress.toggleLearnedPhrase('phrase-777');
    await persistence.persistenceSettled();
    expect(get(persistence.saveStatus).state).not.toBe('saved');
    expect(await readDatabase()).toEqual({ ...seeded, learnPasses: {}, flashcardSessions: {} });

    // "Try again" after the failure is gone: the saved state replaces what is in memory.
    await state.initState();

    expect(get(state.progress).learnedPhrases).toEqual(['phrase-001']);
    expect(get(state.settings)).toMatchObject({ theme: 'dark', activePage: 'phrases' });
    expect(await readDatabase()).toEqual({ ...seeded, learnPasses: {}, flashcardSessions: {} });
  });

  it('reports an initialization failure when the database cannot be opened', async () => {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('Simulated open failure', 'SecurityError');
    });

    vi.resetModules();
    const state = await import('./index');

    await expect(state.initState()).rejects.toMatchObject({ name: 'StorageError', operation: 'open' });
  });

  it('reports a failed write, keeps the change unsaved and saves it on retry', async () => {
    const app = await loadState();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Simulated write failure', 'QuotaExceededError');
    });

    app.progress.toggleLearnedPhrase('phrase-001');
    await app.persistenceSettled();

    expect(get(app.saveStatus)).toMatchObject({ state: 'error' });
    expect(get(app.progress).learnedPhrases).toEqual(['phrase-001']);

    put.mockRestore();
    expect((await readDatabase()).progress).toEqual({});

    await app.retrySave();

    expect(get(app.saveStatus)).toEqual({ state: 'saved' });
    expect((await readDatabase()).progress.learnedPhrases).toEqual(['phrase-001']);
  });

  it('saves none of the records of a transaction that fails halfway', async () => {
    const app = await loadState();
    const originalPut = IDBObjectStore.prototype.put;
    let calls = 0;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      calls += 1;
      if (calls === 2) throw new DOMException('Simulated write failure', 'QuotaExceededError');
      return originalPut.apply(this, args);
    });

    // One action, two records: the learned list and the deck sequence.
    app.progress.saveFlashcardSession('all', { order: ['b'], index: 0 }, ['a']);
    await app.persistenceSettled();
    put.mockRestore();

    expect(calls).toBe(2);
    expect(get(app.saveStatus)).toMatchObject({ state: 'error' });
    expect(await readDatabase()).toEqual({ progress: {}, learnPasses: {}, flashcardSessions: {}, settings: {} });
  });

  it('saves earlier failed changes together with the next change', async () => {
    const app = await loadState();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Simulated write failure', 'QuotaExceededError');
    });

    app.progress.toggleLearnedPhrase('phrase-001');
    await app.persistenceSettled();
    put.mockRestore();

    app.progress.toggleFavorite('word', 'word-phrase-002');

    const saved = await app.saved();
    expect(get(app.saveStatus)).toEqual({ state: 'saved' });
    expect(saved.progress).toEqual({ learnedPhrases: ['phrase-001'], favoriteWords: ['word-phrase-002'] });
  });

  it('says that nothing is saved when the app runs without storage', async () => {
    vi.resetModules();
    const state = await import('./index');
    const persistence = await import('./persistence');

    state.initStateWithoutStorage();
    state.progress.toggleLearnedPhrase('phrase-001');
    await persistence.persistenceSettled();

    expect(get(state.progress).learnedPhrases).toEqual(['phrase-001']);
    expect(get(persistence.saveStatus)).toEqual({ state: 'disabled' });
    expect(await readDatabase()).toEqual({ progress: {}, learnPasses: {}, flashcardSessions: {}, settings: {} });
  });
});
