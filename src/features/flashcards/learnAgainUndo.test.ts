import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCatalog } from '../../content/catalog';
import type { Materials } from '../../content/types';
import { readDatabase, resetDatabase, seedDatabase } from '../../test/database';

/**
 * "Learn again" and its Undo with the production page, message region and Settings
 * (ENG-V2-UX-01B-RC1, findings F1 and F2). Every Undo here is the callback the page
 * really issued: clicked in the message, or retained and invoked later on purpose.
 */
const materials = {
  meta: { title: 'Test', subtitle: '', version: '', language: '', updated: '', goal: '' },
  blocks: [],
  patterns: [],
  answers: [],
  drills: [],
  irregularVerbs: [],
  phrases: [
    { id: 'p1', category: 'Greetings', phrase: 'Good morning', translation: 'Доброго ранку' },
    { id: 'p2', category: 'Greetings', phrase: 'See you later', translation: 'Побачимось пізніше' },
    { id: 'p3', category: 'Work', phrase: 'dig into', translation: 'заглибитися' },
    { id: 'p4', category: 'Work', phrase: 'Good morning!', translation: 'Доброго ранку!' }
  ],
  wordIndex: [
    { id: 'w1', sourcePhraseId: 'p1', term: 'Good morning', category: 'Greetings', meaning: 'Доброго ранку', pronunciation: '', examples: [] },
    { id: 'w2', sourcePhraseId: 'p2', term: 'See you later', category: 'Greetings', meaning: 'Побачимось пізніше', pronunciation: '', examples: [] },
    { id: 'w3', sourcePhraseId: 'p3', term: 'dig into', category: 'Work', meaning: 'заглибитися', pronunciation: '', examples: [] },
    { id: 'w4', sourcePhraseId: 'p4', term: 'Good morning!', category: 'Work', meaning: 'Доброго ранку!', pronunciation: '', examples: [] }
  ]
} as Materials;

/** An id of a removed collection: its learning state must survive every step. */
const ABSENT = 'user:99999999-9999-4999-8999-999999999999:entry:99999999-9999-4999-8999-999999999999';
const EXIT_MS = 250;
const cleanups: (() => void)[] = [];

async function openPage(options: { withSettings?: boolean } = {}) {
  vi.resetModules();
  const svelte = await import('svelte');
  const state = await import('../../state');
  const persistence = await import('../../state/persistence');
  const toast = await import('../../shared/ui/toast');
  const FlashcardsPage = (await import('./FlashcardsPage.svelte')).default;
  const ToastRegion = (await import('../../shared/ui/ToastRegion.svelte')).default;
  await state.initState();

  const main = document.createElement('main');
  main.id = 'main';
  main.tabIndex = -1;
  document.body.appendChild(main);
  const page = svelte.mount(FlashcardsPage, { target: main, props: { catalog: createCatalog(materials) } });
  const toastHost = document.createElement('div');
  document.body.appendChild(toastHost);
  const region = svelte.mount(ToastRegion, { target: toastHost });
  const settingsHost = document.createElement('div');
  document.body.appendChild(settingsHost);
  const settingsPage = options.withSettings
    ? svelte.mount((await import('../settings/SettingsPage.svelte')).default, { target: settingsHost })
    : null;
  svelte.flushSync();

  const close = () => {
    svelte.unmount(page);
    svelte.unmount(region);
    if (settingsPage) svelte.unmount(settingsPage);
    toast.dismissToast();
    main.remove();
    toastHost.remove();
    settingsHost.remove();
  };
  cleanups.push(close);

  const flush = () => svelte.flushSync();
  /** Lets promises, Svelte updates and awaited renders run to the end. */
  const settle = async () => {
    for (let round = 0; round < 30; round += 1) await Promise.resolve();
    flush();
  };
  const buttonIn = (root: ParentNode, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.getAttribute('aria-label') === label || (item.textContent ?? '').replace(/\s+/g, ' ').trim() === label
    );
  const button = (label: string) => {
    const match = buttonIn(document.body, label);
    if (!match) throw new Error(`No button "${label}"`);
    return match;
  };
  const click = async (label: string) => {
    button(label).click();
    flush();
    await settle();
  };
  return {
    state,
    persistence,
    toast,
    main,
    settingsHost,
    flush,
    settle,
    button,
    click,
    close,
    progress: () => get(state.progress),
    frontText: () => (main.querySelector('.flashcard__term')?.textContent ?? '').trim(),
    learnAgainFor: (id: string) => main.querySelector<HTMLButtonElement>(`.learn-again[data-card-id="${id}"]`),
    undoButton: () => document.querySelector<HTMLButtonElement>('.toast__action'),
    /** The answer leaves the screen before the next card appears. */
    async answer(label: 'I know it' | 'Keep learning') {
      button(label).click();
      flush();
      vi.advanceTimersByTime(EXIT_MS);
      flush();
      await settle();
    },
    /** Presses the message's Undo the way a keyboard user does: focus it, then activate it. */
    async undoFromMessage() {
      const undo = document.querySelector<HTMLButtonElement>('.toast__action');
      if (!undo) throw new Error('No Undo in the message');
      undo.focus();
      undo.click();
      flush();
      await settle();
      await settle();
    },
    async saved() {
      await persistence.persistenceSettled();
      return readDatabase();
    }
  };
}

/** Saves what is pending, closes the page and opens it again from the database, like a reload. */
async function reload(page: Awaited<ReturnType<typeof openPage>>) {
  await page.persistence.persistenceSettled();
  page.close();
  return openPage();
}

beforeEach(() => {
  resetDatabase();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  cleanups.splice(0).forEach((close) => close());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Learn again Undo validity (F1)', () => {
  it('ordinary Learn again then Undo restores exactly the saved state, also after a reload', async () => {
    await seedDatabase({
      progress: { learnedPhrases: ['p1'], hiddenWords: [ABSENT], favoritePhrases: ['p2'] },
      flashcardSessions: { all: { order: ['p2', ABSENT, 'p3', 'p4'], index: 2 }, other: { order: ['p3', 'p2'], index: 1 } }
    });
    const page = await openPage();
    const before = await readDatabase();
    await page.click('Review learned vocabulary (1)');
    await page.click('Learn again');
    expect(page.progress().learnedPhrases).toEqual([]);
    await page.undoFromMessage();
    expect(await page.saved()).toEqual(before);
    const reloaded = await reload(page);
    expect(await reloaded.saved()).toEqual(before);
    expect(reloaded.progress().learnedPhrases).toEqual(['p1']);
  });

  it('Learn again, then answering another card, then Undo keeps the newer answer and both deck records', async () => {
    await seedDatabase({
      progress: { learnedPhrases: ['p1'], hiddenWords: [ABSENT] },
      flashcardSessions: { all: { order: ['p2', ABSENT, 'p3', 'p4'], index: 0 }, other: { order: ['p3', 'p2'], index: 1 } }
    });
    const page = await openPage();
    await page.click('Review learned vocabulary (1)');
    await page.click('Learn again');
    await page.click('Back to flashcards');
    expect(page.frontText()).toBe('See you later');
    await page.answer('I know it');
    const afterAnswer = await page.saved();
    expect(afterAnswer.progress.learnedPhrases).toEqual(['p2']);

    await page.undoFromMessage();
    const saved = await page.saved();
    expect([...(saved.progress.learnedPhrases as string[])].sort()).toEqual(['p1', 'p2']);
    expect(saved.flashcardSessions).toEqual(afterAnswer.flashcardSessions);
    expect(saved.flashcardSessions.other).toEqual({ order: ['p3', 'p2'], index: 1 });
    expect((saved.flashcardSessions.all as { order: string[] }).order).toContain(ABSENT);
    expect(saved.progress.hiddenWords).toEqual([ABSENT]);
    expect(await (await reload(page)).saved()).toEqual(saved);
  });

  it('an older Undo cannot override a newer "Keep learning" on the same card, also after a reload', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['p1'] }, flashcardSessions: { all: { order: ['p1', 'p2', 'p3'], index: 0 } } });
    const page = await openPage();
    await page.click('Review learned vocabulary (1)');
    await page.click('Learn again');
    await page.click('Back to flashcards');
    expect(page.frontText()).toBe('Good morning');
    await page.answer('Keep learning');
    // The message from Learn again is still on screen, and its Undo is pressed.
    expect(page.undoButton()).not.toBeNull();
    await page.undoFromMessage();
    expect(page.progress().learnedPhrases).not.toContain('p1');
    expect((await page.saved()).progress.learnedPhrases).toEqual([]);
    expect((await (await reload(page)).saved()).progress.learnedPhrases).toEqual([]);
  });

  it('a retained Learn again callback cannot bring back progress after Reset confirmed in Settings', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['p1'] } });
    const page = await openPage({ withSettings: true });
    await page.click('Review learned vocabulary (1)');
    await page.click('Learn again');
    const retained = get(page.toast.toast)!.onAction!;

    await page.click('Reset learning progress…');
    page.settingsHost.querySelector<HTMLButtonElement>('.dialog .btn--danger')!.click();
    page.flush();
    await page.settle();
    // Settings replaced the visible message: no Undo is offered any more.
    expect(get(page.toast.toast)?.message).toBe('Learning progress was reset.');
    expect(page.undoButton()).toBeNull();
    expect((await page.saved()).progress.learnedPhrases).toEqual([]);

    // The old callback is invoked on purpose (it is not reachable in the interface).
    await retained();
    await page.settle();
    expect(page.progress().learnedPhrases).toEqual([]);
    expect((await page.saved()).progress.learnedPhrases).toEqual([]);
    expect((await (await reload(page)).saved()).progress.learnedPhrases).toEqual([]);
  });

  it('applies an Undo at most once, even when its callback is invoked again after a newer Learn again', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['p1'] } });
    const page = await openPage();
    await page.click('Review learned vocabulary (1)');
    await page.click('Learn again');
    const first = get(page.toast.toast)!.onAction!;
    await first();
    await page.settle();
    expect(page.progress().learnedPhrases).toEqual(['p1']);

    await page.click('Learn again');
    expect(page.progress().learnedPhrases).toEqual([]);
    await first();
    await page.settle();
    expect(page.progress().learnedPhrases).toEqual([]);
    expect((await page.saved()).progress.learnedPhrases).toEqual([]);
  });

  it('after a storage failure, retrying saves the newer answer and never the stale Undo', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['p1'] }, flashcardSessions: { all: { order: ['p1', 'p2', 'p3'], index: 0 } } });
    const page = await openPage();
    const { openStorage } = await import('../../storage/database');
    const storage = await openStorage();
    let failing = true;
    page.persistence.connectStorage({
      ...storage,
      write: async (ops, conditions) => {
        if (failing) throw new Error('Synthetic disk failure');
        await storage.write(ops, conditions);
      }
    });

    await page.click('Review learned vocabulary (1)');
    await page.click('Learn again');
    await page.click('Back to flashcards');
    await page.answer('Keep learning');
    await page.undoFromMessage();
    await page.persistence.persistenceSettled();
    expect(get(page.persistence.saveStatus).state).toBe('error');
    expect(page.progress().learnedPhrases).toEqual([]);

    failing = false;
    await page.persistence.retrySave();
    await page.persistence.persistenceSettled();
    const saved = await readDatabase();
    expect(saved.progress.learnedPhrases).toEqual([]);
    expect((saved.flashcardSessions.all as { order: string[] }).order).toContain('p1');
    storage.close();
  });
});

describe('keyboard focus around Learn again and its Undo (F2)', () => {
  it('moves focus to the card that took the row’s place, then to the list heading', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['p1', 'p2'] } });
    const page = await openPage();
    await page.click('Review learned vocabulary (2)');
    page.learnAgainFor('p1')!.focus();
    page.learnAgainFor('p1')!.click();
    page.flush();
    await page.settle();
    expect(document.activeElement).toBe(page.learnAgainFor('p2'));

    page.learnAgainFor('p2')!.click();
    page.flush();
    await page.settle();
    expect(document.activeElement).toBe(page.main.querySelector('#review-title'));
  });

  it('Undo from the message returns focus to the restored card’s row', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['p1', 'p2'] } });
    const page = await openPage();
    await page.click('Review learned vocabulary (2)');
    page.learnAgainFor('p1')!.focus();
    page.learnAgainFor('p1')!.click();
    page.flush();
    await page.settle();

    await page.undoFromMessage();
    expect(page.learnAgainFor('p1')).not.toBeNull();
    expect(document.activeElement).toBe(page.learnAgainFor('p1'));
  });

  it('Undo while the learned list is closed focuses the button that opens it', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['p1'] } });
    const page = await openPage();
    await page.click('Review learned vocabulary (1)');
    await page.click('Learn again');
    await page.click('Back to flashcards');

    await page.undoFromMessage();
    expect(document.activeElement).toBe(page.button('Review learned vocabulary (1)'));
  });

  it('does not move focus when the message simply expires', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['p1', 'p2'] } });
    const page = await openPage();
    await page.click('Review learned vocabulary (2)');
    await page.click('Learn again');
    const elsewhere = page.button('Back to flashcards');
    elsewhere.focus();
    vi.advanceTimersByTime(10_000);
    page.flush();
    await page.settle();
    expect(get(page.toast.toast)).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('after a confirmed deck reset removes its opener, focus goes to the current card', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['p1'] } });
    const page = await openPage();
    await page.click('Review learned vocabulary (1)');
    page.button('Reset progress for All Vocabulary').focus();
    await page.click('Reset progress for All Vocabulary');
    await page.click('Reset this deck');
    await page.settle();
    expect(page.progress().learnedPhrases).toEqual([]);
    expect(document.activeElement).toBe(page.main.querySelector('.flashcard__surface'));
  });
});
