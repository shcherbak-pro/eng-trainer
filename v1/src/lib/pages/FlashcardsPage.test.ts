import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Materials } from '../types/materials';
import type { ProgressState } from '../stores/progress';

const STORAGE_KEY = 'englishAssessmentTrainer.svelteState.v1';
const EXIT_ANIMATION_MS = 250;

const materials = {
  meta: { title: 'Test', subtitle: '', version: '', language: '', updated: '', goal: '' },
  blocks: [],
  patterns: [],
  answers: [],
  drills: [],
  irregularVerbs: [],
  phrases: [
    { id: 'p1', category: 'Greetings', phrase: 'Good morning', translation: 'Доброго ранку', transcription: '/ɡʊd ˈmɔːrnɪŋ/', example: 'Good morning, team.' },
    { id: 'p2', category: 'Greetings', phrase: 'See you later', translation: 'Побачимось пізніше' },
    { id: 'p3', category: 'Work', phrase: 'dig into', translation: 'заглибитися' },
    { id: 'p4', category: 'Work', phrase: 'Good morning', translation: 'Доброго ранку' }
  ],
  wordIndex: [
    { id: 'w1', sourcePhraseId: 'p1', term: 'Good morning', category: 'Greetings', meaning: 'Доброго ранку', pronunciation: '', examples: [{ en: 'Good morning, team.', ua: 'Доброго ранку, командо.' }] },
    { id: 'w2', sourcePhraseId: 'p2', term: 'See you later', category: 'Greetings', meaning: 'Побачимось пізніше', pronunciation: '', examples: [] },
    { id: 'w3', sourcePhraseId: 'p3', term: 'dig into', category: 'Work', meaning: 'заглибитися', pronunciation: '', examples: [] },
    { id: 'w4', sourcePhraseId: 'p4', term: 'Good morning', category: 'Work', meaning: 'Доброго ранку', pronunciation: '', examples: [] }
  ]
} as Materials;

type Page = {
  root: HTMLElement;
  state: () => ProgressState;
  flush: () => void;
  close: () => void;
};

let openPages: Page[] = [];

/**
 * Mounts the page with freshly loaded modules, so the progress store is read
 * from localStorage again exactly like after a browser reload.
 */
async function openPage(): Promise<Page> {
  vi.resetModules();
  const svelte = await import('svelte');
  const { progress } = await import('../stores/progress');
  const { default: FlashcardsPage } = await import('./FlashcardsPage.svelte');

  const root = document.createElement('div');
  document.body.appendChild(root);
  const component = svelte.mount(FlashcardsPage, { target: root, props: { materials } });
  svelte.flushSync();

  const page: Page = {
    root,
    state: () => get(progress),
    flush: () => svelte.flushSync(),
    close: () => {
      svelte.unmount(component);
      root.remove();
    }
  };
  openPages.push(page);
  return page;
}

/** Lets the card finish leaving the screen so the next card is shown. */
function finishAnswer(page: Page): void {
  page.flush();
  vi.advanceTimersByTime(EXIT_ANIMATION_MS);
  page.flush();
}

function text(page: Page, selector: string): string {
  return (page.root.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function frontText(page: Page): string {
  return text(page, '.flashcard__term');
}

function stats(page: Page): string {
  return text(page, '.flashcards-progress__stats');
}

function button(page: Page, label: string): HTMLButtonElement {
  const match = [...page.root.querySelectorAll('button')].find(
    (item) => item.textContent?.replace(/\s+/g, ' ').includes(label) || item.getAttribute('aria-label')?.includes(label)
  );
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

function click(page: Page, label: string): void {
  button(page, label).click();
  page.flush();
}

function press(page: Page, key: string, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  page.flush();
  return event;
}

/** jsdom has no PointerEvent, so a mouse event carries the pointer fields the page reads. */
function pointer(target: Element, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    isPrimary: { value: true },
    pointerType: { value: 'touch' }
  });
  target.dispatchEvent(event);
}

function swipe(page: Page, deltaX: number, deltaY = 0): void {
  const card = page.root.querySelector('.flashcard-swipe')!;
  pointer(card, 'pointerdown', 200, 200);
  pointer(card, 'pointermove', 200 + deltaX / 2, 200 + deltaY / 2);
  pointer(card, 'pointermove', 200 + deltaX, 200 + deltaY);
  pointer(card, 'pointerup', 200 + deltaX, 200 + deltaY);
  page.flush();
}

function isFlipped(page: Page): boolean {
  return page.root.querySelector('.flashcard')!.classList.contains('flipped');
}

function selectTopic(page: Page, topic: string): void {
  click(page, 'By Topic');
  const select = page.root.querySelector('select')!;
  select.value = topic;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  page.flush();
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  openPages.forEach((page) => page.close());
  openPages = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Flashcards page', () => {
  it('shows one card with the English side first and the deck progress', async () => {
    const page = await openPage();

    expect(page.root.querySelectorAll('.flashcard')).toHaveLength(1);
    expect(frontText(page)).toBe('Good morning');
    expect(text(page, '.flashcard__transcription')).toBe('/ɡʊd ˈmɔːrnɪŋ/');
    // 4 phrases + 4 word-index entries are 3 different vocabulary items.
    expect(stats(page)).toBe('3 remaining 0 learned Card 1 of 3');
    expect(isFlipped(page)).toBe(false);
  });

  it('flips the card on tap and shows the translation and example', async () => {
    const page = await openPage();

    page.root.querySelector<HTMLButtonElement>('.flashcard__surface')!.click();
    page.flush();

    expect(isFlipped(page)).toBe(true);
    expect(text(page, '.flashcard__translation')).toBe('Доброго ранку');
    expect(text(page, '.flashcard__example')).toContain('Good morning, team.');
    expect(text(page, '.flashcard__example')).toContain('Доброго ранку, командо.');

    click(page, 'Flip card');
    expect(isFlipped(page)).toBe(false);
  });

  describe('buttons', () => {
    it('"I know it" marks the card as learned and moves on', async () => {
      const page = await openPage();

      click(page, 'I know it');
      finishAnswer(page);

      expect(page.state().learnedPhrases).toEqual(['p1', 'p4']);
      expect(frontText(page)).toBe('See you later');
      expect(stats(page)).toBe('2 remaining 1 learned Card 1 of 2');
    });

    it('"Keep learning" keeps the card in the pool and brings it back later', async () => {
      const page = await openPage();

      click(page, 'Keep learning');
      finishAnswer(page);

      expect(page.state().learnedPhrases).toEqual([]);
      expect(frontText(page)).toBe('See you later');
      expect(stats(page)).toBe('3 remaining 0 learned Card 2 of 3');

      click(page, 'I know it');
      finishAnswer(page);
      click(page, 'Keep learning');
      finishAnswer(page);

      // End of the deck: the cards still being learned come round again.
      expect(frontText(page)).toBe('Good morning');
      expect(stats(page)).toBe('2 remaining 1 learned Card 1 of 2');
      expect(text(page, '[role="status"]')).toContain('Starting again with the 2 cards');
    });

    it('always starts the next card on the front side', async () => {
      const page = await openPage();

      click(page, 'Flip card');
      click(page, 'Keep learning');
      finishAnswer(page);

      expect(isFlipped(page)).toBe(false);
    });
  });

  describe('keyboard', () => {
    it('ArrowRight means "I know it"', async () => {
      const page = await openPage();

      press(page, 'ArrowRight');
      finishAnswer(page);

      expect(page.state().learnedPhrases).toEqual(['p1', 'p4']);
      expect(frontText(page)).toBe('See you later');
    });

    it('ArrowLeft means "Keep learning"', async () => {
      const page = await openPage();

      press(page, 'ArrowLeft');
      finishAnswer(page);

      expect(page.state().learnedPhrases).toEqual([]);
      expect(frontText(page)).toBe('See you later');
    });

    it('Enter and Space flip the card', async () => {
      const page = await openPage();

      const enter = press(page, 'Enter');
      expect(isFlipped(page)).toBe(true);
      expect(enter.defaultPrevented).toBe(true);

      const space = press(page, ' ');
      expect(isFlipped(page)).toBe(false);
      expect(space.defaultPrevented).toBe(true);
    });

    it('leaves Enter and Space to a focused button', async () => {
      const page = await openPage();

      const event = press(page, 'Enter', button(page, 'Shuffle'));

      expect(isFlipped(page)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    });

    it('does not answer while the topic selector is being used', async () => {
      const page = await openPage();
      click(page, 'By Topic');

      press(page, 'ArrowRight', page.root.querySelector('select')!);
      finishAnswer(page);

      expect(page.state().learnedPhrases).toEqual([]);
    });

    it('ignores shortcuts combined with modifier keys', async () => {
      const page = await openPage();

      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
      finishAnswer(page);

      expect(page.state().learnedPhrases).toEqual([]);
      expect(frontText(page)).toBe('Good morning');
    });
  });

  describe('swipe', () => {
    it('right marks the card as learned and moves on', async () => {
      const page = await openPage();

      swipe(page, 160);
      finishAnswer(page);

      expect(page.state().learnedPhrases).toEqual(['p1', 'p4']);
      expect(frontText(page)).toBe('See you later');
    });

    it('left keeps the card in the learning pool and moves on', async () => {
      const page = await openPage();

      swipe(page, -160);
      finishAnswer(page);

      expect(page.state().learnedPhrases).toEqual([]);
      expect(frontText(page)).toBe('See you later');
      expect(stats(page)).toBe('3 remaining 0 learned Card 2 of 3');
    });

    it('does nothing when the swipe is too short', async () => {
      const page = await openPage();

      swipe(page, 40);
      finishAnswer(page);

      expect(page.state().learnedPhrases).toEqual([]);
      expect(frontText(page)).toBe('Good morning');
      expect(stats(page)).toBe('3 remaining 0 learned Card 1 of 3');
    });

    it('does nothing on a vertical move, so the page can scroll', async () => {
      const page = await openPage();

      swipe(page, 60, 300);
      finishAnswer(page);

      expect(page.state().learnedPhrases).toEqual([]);
      expect(frontText(page)).toBe('Good morning');
    });

    it('does not flip the card when a drag ends on it', async () => {
      const page = await openPage();

      swipe(page, 40);
      page.root.querySelector<HTMLButtonElement>('.flashcard__surface')!.click();
      page.flush();

      expect(isFlipped(page)).toBe(false);
    });
  });

  describe('decks', () => {
    it('shows only the cards of the selected topic', async () => {
      const page = await openPage();

      selectTopic(page, 'Work');

      expect(stats(page)).toBe('2 remaining 0 learned Card 1 of 2');
      expect(frontText(page)).toBe('Good morning');

      click(page, 'Keep learning');
      finishAnswer(page);
      expect(frontText(page)).toBe('dig into');
    });

    it('shares the learned status between topic decks and All Vocabulary', async () => {
      const page = await openPage();

      // "Good morning" is in both topics. Learn it in "Work".
      selectTopic(page, 'Work');
      click(page, 'I know it');
      finishAnswer(page);
      expect(stats(page)).toBe('1 remaining 1 learned Card 1 of 1');

      selectTopic(page, 'Greetings');
      expect(stats(page)).toBe('1 remaining 1 learned Card 1 of 1');
      expect(frontText(page)).toBe('See you later');

      click(page, 'All Vocabulary');
      expect(stats(page)).toBe('2 remaining 1 learned Card 1 of 2');
      expect(frontText(page)).toBe('See you later');
    });

    it('shows a completed state when every card of the deck is learned', async () => {
      const page = await openPage();
      selectTopic(page, 'Greetings');

      click(page, 'I know it');
      finishAnswer(page);
      click(page, 'I know it');
      finishAnswer(page);

      expect(page.root.querySelector('.flashcard')).toBeNull();
      expect(text(page, '.flashcards-complete')).toContain('Deck complete');
      expect(text(page, '.flashcards-complete')).toContain('You know all 2 cards in Greetings.');
      expect(stats(page)).toBe('0 remaining 2 learned');
    });

    it('shows an empty state when a topic has no cards to study', async () => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ hiddenPhrases: ['p3', 'p4'], flashcardMode: 'topic', flashcardTopic: 'Work' }));

      const page = await openPage();

      expect(page.root.querySelector('.flashcard')).toBeNull();
      expect(text(page, '.empty-state')).toContain('No cards in this deck');
      expect(stats(page)).toBe('0 remaining 0 learned');
    });

    it('falls back to the first topic when the saved topic no longer exists', async () => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ flashcardMode: 'topic', flashcardTopic: 'Deleted topic' }));

      const page = await openPage();

      expect(page.root.querySelector('select')!.value).toBe('Greetings');
      expect(stats(page)).toBe('2 remaining 0 learned Card 1 of 2');
    });
  });

  describe('saved progress', () => {
    it('continues with the same deck, card and counts after a reload', async () => {
      const first = await openPage();
      selectTopic(first, 'Work');
      click(first, 'Keep learning');
      finishAnswer(first);
      click(first, 'I know it');
      finishAnswer(first);
      expect(stats(first)).toBe('1 remaining 1 learned Card 1 of 1');
      first.close();
      openPages = [];

      const reloaded = await openPage();

      expect(reloaded.root.querySelector('select')!.value).toBe('Work');
      expect(reloaded.state().learnedPhrases).toEqual(['p3']);
      expect(frontText(reloaded)).toBe('Good morning');
      expect(stats(reloaded)).toBe('1 remaining 1 learned Card 1 of 1');
    });

    it('resumes in the middle of a round after a reload', async () => {
      const first = await openPage();
      click(first, 'Keep learning');
      finishAnswer(first);
      expect(frontText(first)).toBe('See you later');
      first.close();
      openPages = [];

      const reloaded = await openPage();

      expect(frontText(reloaded)).toBe('See you later');
      expect(stats(reloaded)).toBe('3 remaining 0 learned Card 2 of 3');
    });

    it('respects items already marked as learned on the Phrases page', async () => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ learnedPhrases: ['p2'], favoritePhrases: ['p2'] }));

      const page = await openPage();

      expect(stats(page)).toBe('2 remaining 1 learned Card 1 of 2');
      click(page, 'I know it');
      finishAnswer(page);
      expect(page.state().learnedPhrases).toEqual(['p2', 'p1', 'p4']);
      expect(page.state().favoritePhrases).toEqual(['p2']);
    });
  });

  describe('learned vocabulary', () => {
    it('lists learned cards and returns one to the deck with "Learn again"', async () => {
      const page = await openPage();
      click(page, 'I know it');
      finishAnswer(page);

      click(page, 'Review learned vocabulary');
      expect(text(page, '.flashcards-review__list')).toContain('Good morning');
      expect(page.root.querySelectorAll('.flashcards-review__list li')).toHaveLength(1);

      click(page, 'Learn again');

      expect(page.state().learnedPhrases).toEqual([]);
      expect(page.root.querySelectorAll('.flashcards-review__list li')).toHaveLength(0);
      expect(stats(page)).toBe('3 remaining 0 learned');

      click(page, 'Back to flashcards');
      // The restored card is reintroduced at the end of the review sequence.
      expect(frontText(page)).toBe('See you later');
      expect(stats(page)).toBe('3 remaining 0 learned Card 1 of 3');
    });

    it('resets the progress of the selected topic only after confirmation', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const page = await openPage();

      // Learn "dig into" (Work) and "See you later" (Greetings).
      selectTopic(page, 'Work');
      click(page, 'Keep learning');
      finishAnswer(page);
      click(page, 'I know it');
      finishAnswer(page);
      selectTopic(page, 'Greetings');
      click(page, 'Keep learning');
      finishAnswer(page);
      click(page, 'I know it');
      finishAnswer(page);
      expect(page.state().learnedPhrases).toEqual(['p3', 'p2']);

      click(page, 'Reset progress for Greetings');
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm.mock.calls[0][0]).toContain('Greetings');
      expect(page.state().learnedPhrases).toEqual(['p3', 'p2']);

      confirm.mockReturnValue(true);
      click(page, 'Reset progress for Greetings');

      expect(page.state().learnedPhrases).toEqual(['p3']);
      expect(stats(page)).toBe('2 remaining 0 learned Card 1 of 2');
      expect(frontText(page)).toBe('Good morning');
    });
  });
});
