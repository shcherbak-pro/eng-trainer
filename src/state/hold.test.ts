import { get } from 'svelte/store';
import { beforeEach, expect, it, vi } from 'vitest';
import { readDatabase, resetDatabase } from '../test/database';
import { describeExperimental, describeStable } from '../test/product';

/**
 * The hold on changes (ENG-V3-R1A-RC3): what `holdChanges` answers, and what the state
 * services and the write queue do while it lasts. The recovery that uses it is tested in
 * src/features/backup/handover.test.ts.
 */
async function start() {
  vi.resetModules();
  const state = await import('./index');
  const persistence = await import('./persistence');
  const collections = await import('../collections/service');
  await state.initState();
  return { state, persistence, collections };
}

beforeEach(() => resetDatabase());

describeExperimental('the hold on changes', () => {
  it('is refused where there is no storage to save to: before start-up, and while saving is off', async () => {
    vi.resetModules();
    const state = await import('./index');
    const persistence = await import('./persistence');
    expect(persistence.holdChanges()).toBe('unavailable');
    expect(state.holdState()).toBe('unavailable');

    await state.initState();
    state.initStateWithoutStorage();

    expect(state.holdState()).toBe('unavailable');
    expect(state.stateHeld()).toBe(false);
  });

  it('is not taken while a change is scheduled, being written, or queued after a failed save', async () => {
    const app = await start();

    // Scheduled: handed over in this very step, and no write has started.
    app.state.settings.setTheme('dark');
    expect(app.persistence.holdChanges()).toBe('unsaved');
    // Being written.
    await Promise.resolve();
    await Promise.resolve();
    expect(app.persistence.holdChanges()).toBe('unsaved');
    await app.persistence.persistenceSettled();
    expect(get(app.persistence.saveStatus).state).toBe('saved');

    // Queued after a failure: nothing is running, and the change exists in this tab only.
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('synthetic failure', 'UnknownError'); });
    app.state.progress.toggleLearnedPhrase('phrase-not-saved');
    await app.persistence.persistenceSettled();
    put.mockRestore();
    expect(get(app.persistence.saveStatus).state).toBe('error');
    expect(app.persistence.holdChanges()).toBe('unsaved');
    expect(app.state.holdState()).toBe('unsaved');
    expect(app.state.stateHeld()).toBe(false);

    // Nothing was held on the way: the failed change is saved by the ordinary retry.
    await app.persistence.retrySave();
    expect((await readDatabase()).progress.learnedPhrases).toEqual(['phrase-not-saved']);
    expect(app.state.holdState()).toBe('held');
    app.state.releaseState();
  });

  it('once taken, lets no state service accept a change, and is not taken twice', async () => {
    const app = await start();
    app.state.progress.toggleLearnedPhrase('phrase-before-the-hold');
    await app.persistence.persistenceSettled();
    const before = await readDatabase();
    const [progress, settings, vocabulary] = [get(app.state.progress), get(app.state.settings), get(app.collections.userVocabulary)];

    expect(app.state.holdState()).toBe('held');
    expect(app.state.holdState()).toBe('unavailable');
    expect(app.state.stateHeld()).toBe(true);

    app.state.progress.toggleLearnedPhrase('phrase-during-the-hold');
    app.state.progress.toggleFavorite('word', 'word-during-the-hold');
    app.state.progress.setSelectedLearnPass('pass-during-the-hold');
    app.state.progress.reset();
    app.state.settings.setTheme('dark');
    app.state.settings.setActivePage('phrases');
    app.state.settings.reset();
    app.state.resetAllState();
    const collection = { id: 'user:99999999-0000-4000-8000-000000000000', name: 'During the hold', description: '' };
    const entry = { id: `${collection.id}:entry:00000001-0000-4000-8000-000000000009`, kind: 'phrase', english: 'a phrase during the hold', translation: 'made up', topic: '', examples: [] };
    const plan = { parsed: { collection, entries: [entry], issues: [], fileName: 'made-up.json', source: 'json' }, target: collection, additions: [entry], skipped: 0, issues: [], duplicates: [] } as unknown as Parameters<typeof app.collections.acceptImport>[0];
    const refused = await app.collections.acceptImport(plan).then(() => null, (failure: { kind: string }) => failure);
    await app.persistence.persistenceSettled();

    expect(get(app.state.progress)).toBe(progress);
    expect(get(app.state.settings)).toBe(settings);
    expect(get(app.collections.userVocabulary)).toBe(vocabulary);
    expect(refused).toMatchObject({ kind: 'busy' });
    expect(get(app.persistence.saveStatus).state).toBe('saved');
    expect(await readDatabase()).toEqual(before);

    app.state.releaseState();

    expect(app.state.stateHeld()).toBe(false);
    app.state.progress.toggleLearnedPhrase('phrase-after-the-hold');
    expect(await app.collections.acceptImport(plan)).toEqual({ added: 1, skipped: 0 });
    await app.persistence.persistenceSettled();
    const after = await readDatabase();
    expect(after.progress.learnedPhrases).toEqual(['phrase-before-the-hold', 'phrase-after-the-hold']);
    expect(Object.keys(after.userCollections)).toEqual([collection.id]);
  });

  it('writes nothing while it lasts, also for a caller that did not ask, and writes that change when it ends', async () => {
    const app = await start();
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
    expect(app.persistence.holdChanges()).toBe('held');

    app.persistence.persist([{ type: 'put', store: 'settings', key: 'theme', value: 'dark' }]);
    await app.persistence.persistenceSettled();
    await app.persistence.retrySave();

    expect(transactions).not.toHaveBeenCalled();
    expect(get(app.persistence.saveStatus).state).toBe('saving');

    app.persistence.releaseChanges();
    await app.persistence.persistenceSettled();

    expect(transactions).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    expect(get(app.persistence.saveStatus).state).toBe('saved');
    expect((await readDatabase()).settings).toEqual({ theme: 'dark' });
  });
});

describeStable('the stable product has no hold on changes', () => {
  it('accepts and saves every change as always: the state services never ask for the hold', async () => {
    const app = await start();
    expect(app.state.holdState()).toBe('held');

    app.state.progress.toggleLearnedPhrase('phrase-saved-as-always');
    app.state.settings.setTheme('dark');
    await app.persistence.persistenceSettled();

    expect(get(app.state.progress).learnedPhrases).toEqual(['phrase-saved-as-always']);
    const saved = await readDatabase();
    expect(saved.progress.learnedPhrases).toEqual(['phrase-saved-as-always']);
    expect(saved.settings.theme).toBe('dark');
    app.state.releaseState();
  });
});
