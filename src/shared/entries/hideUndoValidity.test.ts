import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDatabase, resetDatabase, seedDatabase } from '../../test/database';

/**
 * Hide and its Undo with the production card, Settings and message region
 * (ENG-V2-UX-01B-RC1, finding F1). The old callbacks are the ones the card issued.
 */
const phrase = { id: 'target', category: 'Synthetic', phrase: 'take ownership', translation: 'брати відповідальність' };
const cleanups: (() => void)[] = [];

async function mountCard() {
  vi.resetModules();
  const svelte = await import('svelte');
  const state = await import('../../state');
  const persistence = await import('../../state/persistence');
  const toast = await import('../ui/toast');
  const PhraseCard = (await import('./PhraseCard.svelte')).default;
  const SettingsPage = (await import('../../features/settings/SettingsPage.svelte')).default;
  await state.initState();

  const main = document.createElement('main');
  document.body.appendChild(main);
  const card = svelte.mount(PhraseCard, { target: main, props: { phrase } });
  const settingsHost = document.createElement('div');
  document.body.appendChild(settingsHost);
  const settings = svelte.mount(SettingsPage, { target: settingsHost });
  svelte.flushSync();
  cleanups.push(() => {
    svelte.unmount(card);
    svelte.unmount(settings);
    toast.dismissToast();
    main.remove();
    settingsHost.remove();
  });

  const settle = async () => {
    for (let round = 0; round < 30; round += 1) await Promise.resolve();
    svelte.flushSync();
  };
  const press = async (root: ParentNode, label: string) => {
    const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.getAttribute('aria-label') === label || (item.textContent ?? '').replace(/\s+/g, ' ').trim() === label
    );
    if (!button) throw new Error(`No button "${label}"`);
    button.click();
    svelte.flushSync();
    await settle();
  };
  return {
    state,
    persistence,
    progress: () => get(state.progress),
    /** Hides the entry with its own button and keeps the Undo callback it issued. */
    async hide() {
      await press(main, 'Hide item');
      return get(toast.toast)!.onAction!;
    },
    pressCard: (label: string) => press(main, label),
    async resetInSettings() {
      await press(settingsHost, 'Reset learning progress…');
      await press(settingsHost, 'Reset progress');
      await persistence.persistenceSettled();
    },
    settle,
    async saved() {
      await persistence.persistenceSettled();
      return readDatabase();
    }
  };
}

beforeEach(() => resetDatabase());
afterEach(() => {
  cleanups.splice(0).forEach((close) => close());
  vi.restoreAllMocks();
});

describe('Hide Undo validity (F1)', () => {
  it('a retained Hide Undo stays invalid after Reset, also when the same entry is hidden again', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['target'], favoritePhrases: ['target'] } });
    const card = await mountCard();
    const old = await card.hide();
    await card.resetInSettings();

    await old();
    await card.settle();
    expect(card.progress()).toMatchObject({ hiddenPhrases: [], learnedPhrases: [], favoritePhrases: [] });

    // A new Hide of the same id: the old callback must not unhide it or restore pre-Reset flags.
    await card.hide();
    await old();
    await card.settle();
    expect(card.progress()).toMatchObject({ hiddenPhrases: ['target'], learnedPhrases: [], favoritePhrases: [] });
    expect((await card.saved()).progress).toMatchObject({ hiddenPhrases: ['target'], learnedPhrases: [], favoritePhrases: [] });
  });

  it('Show and newer choices on the same entry make an older Hide Undo stale', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['target'], favoritePhrases: ['target'] } });
    const card = await mountCard();
    const old = await card.hide();
    await card.pressCard('Show item');
    await card.pressCard('Add to Focus List');
    await card.hide();

    await old();
    await card.settle();
    // The latest Hide stands: hidden, and hiding removed the Focus flag again.
    expect(card.progress()).toMatchObject({ hiddenPhrases: ['target'], learnedPhrases: [], favoritePhrases: [] });
    expect((await card.saved()).progress).toMatchObject({ hiddenPhrases: ['target'], learnedPhrases: [], favoritePhrases: [] });
  });

  it('applies a Hide Undo at most once', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['target'], favoritePhrases: ['target'] } });
    const card = await mountCard();
    const first = await card.hide();
    await first();
    await card.settle();
    expect(card.progress()).toMatchObject({ hiddenPhrases: [], learnedPhrases: ['target'], favoritePhrases: ['target'] });

    await card.hide();
    await first();
    await card.settle();
    expect(card.progress()).toMatchObject({ hiddenPhrases: ['target'], learnedPhrases: [], favoritePhrases: [] });
  });

  it('a valid Undo still restores exactly what this Hide removed', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['other', 'target'], favoritePhrases: ['target'], hiddenWords: ['word-x'] } });
    const card = await mountCard();
    const undo = await card.hide();
    await undo();
    await card.settle();
    const saved = (await card.saved()).progress;
    expect(saved.hiddenPhrases).toEqual([]);
    expect([...(saved.learnedPhrases as string[])].sort()).toEqual(['other', 'target']);
    expect(saved.favoritePhrases).toEqual(['target']);
    expect(saved.hiddenWords).toEqual(['word-x']);
  });

  it('after a storage failure, retrying saves the newest choice and never the stale Undo', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['target'], favoritePhrases: ['target'] } });
    const card = await mountCard();
    const { openStorage } = await import('../../storage/database');
    const storage = await openStorage();
    let failing = true;
    card.persistence.connectStorage({
      ...storage,
      write: async (ops, conditions) => {
        if (failing) throw new Error('Synthetic disk failure');
        await storage.write(ops, conditions);
      }
    });

    const old = await card.hide();
    await card.pressCard('Show item');
    await card.hide();
    await old();
    await card.settle();
    await card.persistence.persistenceSettled();
    expect(get(card.persistence.saveStatus).state).toBe('error');

    failing = false;
    await card.persistence.retrySave();
    await card.persistence.persistenceSettled();
    expect((await readDatabase()).progress).toMatchObject({ hiddenPhrases: ['target'], learnedPhrases: [], favoritePhrases: [] });
    storage.close();
  });
});
