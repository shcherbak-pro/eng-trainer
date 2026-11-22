import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readDatabase, resetDatabase, seedDatabase } from '../test/database';

/**
 * Operation validity of Undo at the state boundary (ENG-V2-UX-01B-RC1, finding F1).
 * The rules are checked on the real progress store, independently of any button.
 */
async function loadState() {
  vi.resetModules();
  const state = await import('./index');
  const persistence = await import('./persistence');
  await state.initState();
  return { ...state, ...persistence };
}

beforeEach(() => resetDatabase());

describe('Undo validity', () => {
  it('is valid once: a second use is refused', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['p1'] } });
    const app = await loadState();
    app.progress.relearnFlashcards(['p1']);
    const token = app.progress.issueUndo({ type: 'learned', id: 'p1' });
    expect(app.progress.redeemUndo(token)).toBe(true);
    expect(app.progress.redeemUndo(token)).toBe(false);
  });

  it('expires on newer intent for the same entry, even when the stored value does not change', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['p1'] } });
    const app = await loadState();
    app.progress.relearnFlashcards(['p1']);
    const token = app.progress.issueUndo({ type: 'learned', id: 'p1' });
    const before = get(app.progress);
    // "Keep learning" on a card that is not learned changes nothing that is stored.
    app.progress.noteIntent({ type: 'learned', id: 'p1' });
    expect(get(app.progress)).toBe(before);
    expect(app.progress.redeemUndo(token)).toBe(false);
  });

  it('stays valid when a different entry changes', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['p1'], favoritePhrases: ['p2'] } });
    const app = await loadState();
    app.progress.relearnFlashcards(['p1']);
    const learned = app.progress.issueUndo({ type: 'learned', id: 'p1' });
    app.progress.hideItem('phrase', 'p3');
    const hidden = app.progress.issueUndo({ type: 'hide', kind: 'phrase', id: 'p3' });
    app.progress.toggleLearnedPhrase('p2');
    app.progress.toggleFavorite('phrase', 'p2');
    app.progress.saveFlashcardSession('all', { order: ['p4'], index: 0 }, ['p2']);
    app.progress.hideItem('word', 'p3');
    expect(app.progress.redeemUndo(learned)).toBe(true);
    expect(app.progress.redeemUndo(hidden)).toBe(true);
  });

  it('expires a Hide Undo on any newer change of that entry: Show, Focus, learned, or another Hide', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['p1'], favoritePhrases: ['p1'] } });
    const app = await loadState();
    const issue = () => {
      app.progress.hideItem('phrase', 'p1');
      return app.progress.issueUndo({ type: 'hide', kind: 'phrase', id: 'p1' });
    };
    let token = issue();
    app.progress.unhideItem('phrase', 'p1');
    expect(app.progress.redeemUndo(token)).toBe(false);
    token = issue();
    app.progress.toggleFavorite('phrase', 'p1');
    expect(app.progress.redeemUndo(token)).toBe(false);
    token = issue();
    app.progress.toggleLearnedPhrase('p1');
    expect(app.progress.redeemUndo(token)).toBe(false);
    token = issue();
    app.progress.hideItem('phrase', 'p1');
    expect(app.progress.redeemUndo(token)).toBe(false);
  });

  it('keys hidden and Focus state by kind: hiding a word does not expire the Undo of a phrase with the same id', async () => {
    const app = await loadState();
    app.progress.hideItem('phrase', 'shared');
    const phrase = app.progress.issueUndo({ type: 'hide', kind: 'phrase', id: 'shared' });
    app.progress.hideItem('word', 'shared');
    app.progress.toggleFavorite('word', 'shared');
    expect(app.progress.redeemUndo(phrase)).toBe(true);
  });

  it('expires every earlier Undo on Reset, even when the entry later returns to the same values', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['p1'] } });
    const app = await loadState();
    app.progress.relearnFlashcards(['p1']);
    const token = app.progress.issueUndo({ type: 'learned', id: 'p1' });
    app.resetAllState();
    await app.persistenceSettled();
    // Same visible values as when the Undo was issued: p1 is not learned.
    expect(get(app.progress).learnedPhrases).toEqual([]);
    expect(app.progress.redeemUndo(token)).toBe(false);
  });

  it('expires every earlier Undo when the saved state is loaded again', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['p1'] } });
    const app = await loadState();
    app.progress.relearnFlashcards(['p1']);
    const token = app.progress.issueUndo({ type: 'learned', id: 'p1' });
    await app.persistenceSettled();
    app.progress.hydrate({
      progress: new Map(Object.entries((await readDatabase()).progress ?? {})),
      settings: new Map(),
      learnPasses: new Map(),
      flashcardSessions: new Map(),
      userCollections: new Map(),
      userEntries: new Map()
    });
    expect(app.progress.redeemUndo(token)).toBe(false);
  });

  it('treats a deck reset as newer intent for every card of the deck, learned or not', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['p1', 'p2'] } });
    const app = await loadState();
    app.progress.relearnFlashcards(['p1']);
    const token = app.progress.issueUndo({ type: 'learned', id: 'p1' });
    app.progress.resetFlashcardDeck('all', ['p2'], undefined, ['p1', 'p2', 'p3']);
    expect(app.progress.redeemUndo(token)).toBe(false);
  });
});
