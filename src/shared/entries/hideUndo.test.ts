import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDatabase, resetDatabase, seedDatabase } from '../../test/database';

const cleanups: (() => void)[] = [];

beforeEach(() => resetDatabase());
afterEach(() => cleanups.splice(0).forEach((close) => close()));

async function mountPhraseCard() {
  vi.resetModules();
  const svelte = await import('svelte');
  const state = await import('../../state');
  const persistence = await import('../../state/persistence');
  const toast = await import('../ui/toast');
  const PhraseCard = (await import('./PhraseCard.svelte')).default;
  await state.initState();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const phrase = { id: 'target', category: 'Synthetic', phrase: 'take ownership', translation: 'брати відповідальність' };
  const component = svelte.mount(PhraseCard, { target: root, props: { phrase } });
  svelte.flushSync();
  cleanups.push(() => {
    svelte.unmount(component);
    root.remove();
  });
  const press = (label: string) => {
    root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
    svelte.flushSync();
  };
  return { root, state, persistence, toast, press, flush: () => svelte.flushSync() };
}

describe('Hide and Undo', () => {
  it('Undo reverses only what hiding changed for this entry, through entry-level operations', async () => {
    await seedDatabase({
      progress: {
        learnedPhrases: ['target', 'other'],
        favoritePhrases: ['other', 'target'],
        hiddenPhrases: ['already-hidden'],
        hiddenWords: ['word-x'],
        favoriteWords: ['word-y']
      }
    });
    const card = await mountPhraseCard();

    card.press('Hide item');
    expect(get(card.state.progress)).toMatchObject({
      hiddenPhrases: ['already-hidden', 'target'],
      favoritePhrases: ['other'],
      learnedPhrases: ['other']
    });
    const message = get(card.toast.toast)!;
    expect(message.message).toBe('Hidden: “take ownership”.');
    expect(message.actionLabel).toBe('Undo');

    message.onAction!();
    card.flush();
    await card.persistence.persistenceSettled();
    const progress = get(card.state.progress);
    expect(progress.hiddenPhrases).toEqual(['already-hidden']);
    expect([...progress.favoritePhrases].sort()).toEqual(['other', 'target']);
    expect([...progress.learnedPhrases].sort()).toEqual(['other', 'target']);
    // Nothing else was touched: other lists keep their exact contents.
    expect(progress.hiddenWords).toEqual(['word-x']);
    expect(progress.favoriteWords).toEqual(['word-y']);
    expect((await readDatabase()).progress.hiddenPhrases).toEqual(['already-hidden']);
  });

  it('does not add Focus or learned state that the entry did not have, and keeps a permanent "Show" action', async () => {
    const card = await mountPhraseCard();
    card.press('Hide item');
    expect(card.root.querySelector('button[aria-label="Show item"]')).not.toBeNull();
    get(card.toast.toast)!.onAction!();
    card.flush();
    expect(get(card.state.progress)).toMatchObject({ hiddenPhrases: [], favoritePhrases: [], learnedPhrases: [] });

    // After the message is gone, the entry can still be shown again with its own button.
    card.press('Hide item');
    card.toast.dismissToast();
    card.press('Show item');
    expect(get(card.state.progress).hiddenPhrases).toEqual([]);
  });
});
