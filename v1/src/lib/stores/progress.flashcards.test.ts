import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'englishAssessmentTrainer.svelteState.v1';

/** Loads a fresh copy of the store, the same way a page reload does. */
async function loadStore() {
  vi.resetModules();
  const { progress } = await import('./progress');
  return progress;
}

function savedState(): Record<string, unknown> {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('flashcard progress in localStorage', () => {
  it('starts with defaults when nothing is saved', async () => {
    const state = get(await loadStore());

    expect(state.flashcardMode).toBe('all');
    expect(state.flashcardTopic).toBe('');
    expect(state.flashcardSessions).toEqual({});
    expect(state.learnedPhrases).toEqual([]);
  });

  it('keeps learned items, the review sequence and the selected deck after a reload', async () => {
    const progress = await loadStore();
    progress.setFlashcardMode('topic');
    progress.setFlashcardTopic('Teamwork');
    progress.saveFlashcardSession('topic:Teamwork', { order: ['b', 'c'], index: 1 }, ['a']);

    const reloaded = get(await loadStore());

    expect(reloaded.flashcardMode).toBe('topic');
    expect(reloaded.flashcardTopic).toBe('Teamwork');
    expect(reloaded.learnedPhrases).toEqual(['a']);
    expect(reloaded.flashcardSessions).toEqual({ 'topic:Teamwork': { order: ['b', 'c'], index: 1 } });
  });

  it('does not mark anything as learned when a card is kept in the learning pool', async () => {
    const progress = await loadStore();
    progress.saveFlashcardSession('all', { order: ['a', 'b'], index: 1 });

    const reloaded = get(await loadStore());

    expect(reloaded.learnedPhrases).toEqual([]);
    expect(reloaded.flashcardSessions.all).toEqual({ order: ['a', 'b'], index: 1 });
  });

  it('does not store the same learned id twice', async () => {
    const progress = await loadStore();
    progress.saveFlashcardSession('all', { order: [], index: 0 }, ['a', 'b']);
    progress.saveFlashcardSession('topic:X', { order: [], index: 0 }, ['a']);

    expect(get(progress).learnedPhrases).toEqual(['a', 'b']);
  });

  it('returns items to the learning pool with "Learn again"', async () => {
    const progress = await loadStore();
    progress.saveFlashcardSession('all', { order: [], index: 0 }, ['a', 'b', 'c']);
    progress.relearnFlashcards(['b']);

    expect(get(await loadStore()).learnedPhrases).toEqual(['a', 'c']);
  });

  it('resets one deck without touching the others', async () => {
    const progress = await loadStore();
    progress.saveFlashcardSession('topic:One', { order: ['x'], index: 0 }, ['a', 'b']);
    progress.saveFlashcardSession('topic:Two', { order: ['y'], index: 0 }, ['c']);
    progress.resetFlashcardDeck('topic:One', ['a', 'b']);

    const reloaded = get(await loadStore());

    expect(reloaded.learnedPhrases).toEqual(['c']);
    expect(reloaded.flashcardSessions).toEqual({ 'topic:Two': { order: ['y'], index: 0 } });
  });

  it('keeps data saved by earlier versions of the app', async () => {
    // State written before the Flashcards page existed: no flashcard fields at all.
    const existing = {
      activePage: 'phrases',
      learnedPhrases: ['phrase-001'],
      hiddenPhrases: ['phrase-002'],
      hiddenWords: ['word-phrase-003'],
      favoritePhrases: ['phrase-004'],
      favoriteWords: ['word-phrase-005'],
      favoriteBlocks: ['start-answer'],
      learnPasses: [{ id: 'pass-1', name: 'My pass', blockIds: ['start-answer'], createdAt: 'x', updatedAt: 'y' }],
      selectedLearnPassId: 'pass-1'
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));

    const progress = await loadStore();
    expect(get(progress).flashcardSessions).toEqual({});

    progress.saveFlashcardSession('all', { order: ['phrase-006'], index: 0 }, ['phrase-005']);
    progress.relearnFlashcards(['phrase-005']);
    progress.resetFlashcardDeck('all', []);

    const saved = savedState();
    expect(saved.learnedPhrases).toEqual(['phrase-001']);
    expect(saved.hiddenPhrases).toEqual(['phrase-002']);
    expect(saved.hiddenWords).toEqual(['word-phrase-003']);
    expect(saved.favoritePhrases).toEqual(['phrase-004']);
    expect(saved.favoriteWords).toEqual(['word-phrase-005']);
    expect(saved.favoriteBlocks).toEqual(['start-answer']);
    expect(saved.selectedLearnPassId).toBe('pass-1');
    expect(saved.learnPasses).toHaveLength(1);
    expect(saved.activePage).toBe('phrases');
  });

  it('repairs malformed flashcard entries and keeps the rest of the saved data', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        hiddenPhrases: ['phrase-002'],
        learnedPhrases: ['phrase-001', 42, null],
        flashcardMode: 'sideways',
        flashcardTopic: 123,
        flashcardSessions: {
          all: { order: ['a', 'a', 7, 'b'], index: 50 },
          'topic:Broken': 'not an object',
          'topic:NoOrder': { index: 2 },
          'topic:Negative': { order: ['x', 'y'], index: -3 }
        }
      })
    );

    const state = get(await loadStore());

    expect(state.flashcardMode).toBe('all');
    expect(state.flashcardTopic).toBe('');
    expect(state.flashcardSessions).toEqual({
      all: { order: ['a', 'b'], index: 0 },
      'topic:NoOrder': { order: [], index: 0 },
      'topic:Negative': { order: ['x', 'y'], index: 0 }
    });
    expect(state.learnedPhrases).toEqual(['phrase-001']);
    expect(state.hiddenPhrases).toEqual(['phrase-002']);
  });

  it.each([
    ['an array', '[]'],
    ['a string', '"sessions"'],
    ['null', 'null']
  ])('falls back to no saved sequences when flashcardSessions is %s', async (_label, value) => {
    window.localStorage.setItem(STORAGE_KEY, `{"flashcardSessions":${value}}`);

    expect(get(await loadStore()).flashcardSessions).toEqual({});
  });

  it('starts with defaults when the saved state is not valid JSON', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');

    const progress = await loadStore();

    expect(get(progress).flashcardSessions).toEqual({});
    expect(() => progress.saveFlashcardSession('all', { order: ['a'], index: 0 }, ['b'])).not.toThrow();
    expect(get(await loadStore()).learnedPhrases).toEqual(['b']);
  });
});
