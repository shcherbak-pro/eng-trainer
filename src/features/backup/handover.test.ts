import { get } from 'svelte/store';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetDatabase, watchUnhandledRejections } from '../../test/database';
import { describeExperimental } from '../../test/product';
import type { BackupFile } from './format';
import { SYNTHETIC_META, V3_NAME, asPairs, snapshot, syntheticStores, type Stores } from './testing';

/**
 * The handover from the running application to a recovery (ENG-V3-R1A-RC3, finding 3 of the
 * review). All data is made up.
 *
 * The finding: a recovery checked for unsaved changes, then waited for its database, and
 * then switched saving off. A change that this tab accepted during that wait was dropped,
 * and so was one that could not be saved. A refused or rolled-back recovery then loaded the
 * state from the database again, and the change was gone from the screen too.
 *
 * What these tests hold the recovery to:
 *
 * - until the hold, every change is accepted and saved as always, and the recovery waits
 *   for all of it: the write that is running and what is queued behind it;
 * - a change that could not be saved stops the recovery, and stays with its way to try again;
 * - from the hold on, no change is accepted, so there is nothing to lose;
 * - a refusal or a rollback leaves the tab exactly as it was: nothing is loaded again.
 */
const V3 = 'experimental-v3';
const RECOVERY_STORES = 7;

async function load() {
  const [restore, exporter, reader, state, persistence, collections] = await Promise.all([
    import('./restore'),
    import('./exportBackup'),
    import('./snapshot'),
    import('../../state'),
    import('../../state/persistence'),
    import('../../collections/service')
  ]);
  return { ...restore, ...exporter, reader, state, persistence, collections };
}
type Modules = Awaited<ReturnType<typeof load>>;

/** The application as it is after start-up: the database exists and the state services are connected. */
async function startApp(): Promise<Modules> {
  const modules = await load();
  await modules.state.initState();
  return modules;
}

async function fileOf(modules: Modules, stores: Stores = syntheticStores(3)): Promise<BackupFile> {
  const section = { database: 'eng-trainer-v3', schemaVersion: 1, stores: asPairs({ ...stores, meta: SYNTHETIC_META }) };
  return (await modules.composeBackup({ [V3]: section })).backup;
}

const recoveredStores = (): Stores => ({ ...syntheticStores(3), meta: SYNTHETIC_META });
const refusal = (run: Promise<unknown>): Promise<{ code: string; message: string } | null> => run.then(() => null, (error: { code: string; message: string }) => error);

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/**
 * Stops the recovery where the review stopped it: its database is open, and it has not yet
 * taken over from the running application. `reached` resolves there; `release` lets it go on.
 * Everything else is real: the database, the saves, the recovery.
 */
function holdPreparation(app: Modules): { reached: Promise<void>; release: () => void } {
  const reached = deferred();
  const go = deferred();
  const open = app.reader.openExistingDatabase;
  vi.spyOn(app.reader, 'openExistingDatabase').mockImplementationOnce(async (...args) => {
    const database = await open(...args);
    reached.resolve();
    await go.promise;
    return database;
  });
  return { reached: reached.promise, release: go.resolve };
}

/**
 * Keeps the recovery's own transaction open, as a slow disk does: from its first write on, reads
 * are added to it until `release` is called. `reached` resolves when every write of the recovery
 * was issued and the transaction is still open. No record is made up.
 */
function holdTransaction(): { reached: Promise<void>; release: () => void } {
  const reached = deferred();
  let started = false;
  let released = false;
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
    const request = put.apply(this, args);
    if (!started && this.transaction.objectStoreNames.length === RECOVERY_STORES) {
      started = true;
      const store = this;
      const keep = (): void => {
        if (!released) store.get('kept-open-by-the-test').onsuccess = keep;
      };
      keep();
      reached.resolve();
    }
    return request;
  });
  return { reached: reached.promise, release: () => { released = true; } };
}

/** The read-write transactions that were started, as the lists of their stores, in order. */
function writingTransactions(spy: { mock: { results: { value: unknown }[] } }): string[][] {
  return spy.mock.results.map((result) => result.value as IDBTransaction).filter((transaction) => transaction?.mode === 'readwrite').map((transaction) => [...transaction.objectStoreNames]);
}
const isRecovery = (stores: string[]): boolean => stores.length === RECOVERY_STORES;

/** An import of one made-up phrase into a new collection, as the Collections screen hands it over. */
function importPlan(app: Modules): Parameters<Modules['collections']['acceptImport']>[0] {
  const collection = { id: 'user:99999999-0000-4000-8000-000000000000', name: 'Made up for the handover', description: '' };
  const entry = { id: `${collection.id}:entry:00000001-0000-4000-8000-000000000009`, kind: 'phrase', english: 'a phrase of the handover test', translation: 'made up', topic: '', examples: [] };
  return { parsed: { collection, entries: [entry], issues: [], fileName: 'made-up.json', source: 'json' }, target: collection, additions: [entry], skipped: 0, issues: [], duplicates: [] } as unknown as Parameters<typeof app.collections.acceptImport>[0];
}

/** Everything a learner, a timer or the Back button can do in a tab that would change saved state. */
async function tryEveryChange(app: Modules): Promise<{ kind: string; message: string } | null> {
  app.state.progress.toggleLearnedPhrase('phrase-of-the-old-state');
  app.state.progress.toggleFavorite('phrase', 'phrase-of-the-old-state');
  app.state.progress.hideItem('word', 'word-of-the-old-state');
  app.state.progress.saveLearnPass({ name: 'A pass of the old state', blockIds: ['block-a'] });
  app.state.progress.saveFlashcardSession('all', { order: ['phrase-of-the-old-state'], index: 0 }, ['phrase-of-the-old-state']);
  app.state.settings.setTheme('light');
  app.state.settings.setActivePage('phrases');
  app.state.settings.toggleIndexPanel('daily');
  app.state.resetAllState();
  void app.persistence.retrySave();
  return app.collections.acceptImport(importPlan(app)).then(() => null, (failure: { kind: string; message: string }) => failure);
}

beforeEach(() => {
  resetDatabase();
  window.localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describeExperimental('handover: what this tab accepted before the recovery took over', () => {
  it('saves a change that is being written and the changes queued behind it, and then refuses the destination that they filled', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    const observed = watchUnhandledRejections();
    const reload = vi.spyOn(app.state, 'initState');
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const preparation = holdPreparation(app);
    const attempt = refusal(app.restoreOwnSection(file));
    await preparation.reached;

    // The learner is back on another screen. The first change starts its save...
    app.state.progress.toggleLearnedPhrase('phrase-being-written');
    await Promise.resolve();
    await Promise.resolve();
    expect(writingTransactions(transactions)).toEqual([['progress']]);
    // ...and two more wait behind it, in the queue.
    app.state.progress.toggleLearnedPhrase('phrase-waiting-behind-it');
    app.state.settings.setActivePage('phrases');
    expect(app.persistence.holdChanges()).toBe('unsaved');
    preparation.release();

    const error = await attempt;

    // Both saves ran, in their order, and no recovery transaction was needed to find that out wrongly:
    // the recovery opened its transaction after them, found their data, and wrote nothing.
    expect(error).toMatchObject({ code: 'not-empty', message: expect.stringContaining('A recovery never overwrites data, so nothing was changed.') });
    const writing = writingTransactions(transactions);
    expect(writing).toEqual([['progress'], ['progress', 'settings'], [...Object.keys(recoveredStores())].sort()]);
    expect(reload).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    // Nothing is lost: not on screen, not in the database.
    expect(get(app.state.progress).learnedPhrases).toEqual(['phrase-being-written', 'phrase-waiting-behind-it']);
    expect(get(app.state.settings).activePage).toBe('phrases');
    const saved = (await snapshot(V3_NAME)).stores;
    expect(saved.progress.learnedPhrases).toEqual(['phrase-being-written', 'phrase-waiting-behind-it']);
    expect(saved.settings.activePage).toBe('phrases');
    expect(get(app.persistence.saveStatus).state).toBe('saved');
    expect(app.state.stateHeld()).toBe(false);
    // The tab goes on as before.
    app.state.progress.toggleLearnedPhrase('phrase-after-the-refusal');
    await app.persistence.persistenceSettled();
    expect((await snapshot(V3_NAME)).stores.progress.learnedPhrases).toHaveLength(3);
    expect(await observed.stop()).toEqual([]);
  });

  it.each([
    ['would then have been written', false],
    ['would then have been rolled back', true]
  ])('refuses when a change could not be saved while the recovery was being prepared, and keeps it with its way to try again (the recovery %s)', async (_name, failing) => {
    const app = await startApp();
    app.state.settings.setWordPageSize(20);
    await app.persistence.persistenceSettled();
    const file = await fileOf(app);
    const before = await snapshot(V3_NAME);
    const reload = vi.spyOn(app.state, 'initState');
    const preparation = holdPreparation(app);
    const attempt = refusal(app.restoreOwnSection(file));
    await preparation.reached;

    // The save of this change fails: the browser refuses the write.
    const put = IDBObjectStore.prototype.put;
    const failingSave = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.transaction.objectStoreNames.length === 1) throw new DOMException('synthetic: the save was refused', 'QuotaExceededError');
      return put.apply(this, args);
    });
    app.state.progress.toggleLearnedPhrase('phrase-that-could-not-be-saved');
    await app.persistence.persistenceSettled();
    expect(get(app.persistence.saveStatus).state).toBe('error');
    failingSave.mockRestore();
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
    if (failing) vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(() => { throw new DOMException('synthetic: the recovery failed before its commit', 'UnknownError'); });
    preparation.release();

    const error = await attempt;

    expect(error).toMatchObject({ code: 'unavailable' });
    expect(error?.message).toBe('The latest changes in this tab could not be saved, so nothing was recovered: a recovery must not replace changes that exist only here. They are still on screen. Choose “Try saving again” at the top of the page, then start the recovery again.');
    // The recovery never opened a transaction: there was nothing to write and nothing to roll back.
    expect(writingTransactions(transactions)).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(await snapshot(V3_NAME)).toEqual(before);
    // The change is still on screen, still reported as not saved, and still queued.
    expect(get(app.state.progress).learnedPhrases).toEqual(['phrase-that-could-not-be-saved']);
    expect(get(app.state.settings).wordPageSize).toBe(20);
    expect(get(app.persistence.saveStatus)).toMatchObject({ state: 'error', message: expect.stringContaining('synthetic: the save was refused') });
    expect(app.state.stateHeld()).toBe(false);
    await app.persistence.retrySave();
    expect(get(app.persistence.saveStatus).state).toBe('saved');
    expect((await snapshot(V3_NAME)).stores.progress.learnedPhrases).toEqual(['phrase-that-could-not-be-saved']);
  });

  it('does not take a finished write for an empty queue: a change that nothing is writing is started, and waited for', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    // A change that is made at the very moment a save is reported as done is queued, and nothing
    // writes it until the next change: waiting for "the running write" finds nothing to wait for.
    let made = false;
    const stop = app.persistence.saveStatus.subscribe((status) => {
      if (status.state !== 'saved' || made) return;
      made = true;
      app.state.progress.toggleFavorite('block', 'block-queued-and-not-written');
    });
    app.state.settings.setWordPageSize(20);
    await app.persistence.persistenceSettled();
    stop();
    await app.persistence.persistenceSettled();
    expect(made).toBe(true);
    expect(get(app.persistence.saveStatus).state).toBe('saving');
    expect((await snapshot(V3_NAME)).stores.progress).toEqual({});
    expect(app.persistence.holdChanges()).toBe('unsaved');
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');

    const error = await refusal(app.restoreOwnSection(file));

    // The waiting change was written first, and it is learning data: the recovery saw it and refused.
    expect(error).toMatchObject({ code: 'not-empty' });
    expect(writingTransactions(transactions)).toEqual([['progress'], [...Object.keys(recoveredStores())].sort()]);
    vi.restoreAllMocks();
    expect((await snapshot(V3_NAME)).stores.progress.favoriteBlocks).toEqual(['block-queued-and-not-written']);
    expect(get(app.state.progress).favoriteBlocks).toEqual(['block-queued-and-not-written']);
    expect(get(app.persistence.saveStatus).state).toBe('saved');
  });

  it('lets a collection change that is already being saved finish first, and then judges the destination with it', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const preparation = holdPreparation(app);
    const attempt = refusal(app.restoreOwnSection(file));
    await preparation.reached;
    let imported = false;
    const importing = app.collections.acceptImport(importPlan(app)).then((result) => { imported = true; return result; });
    preparation.release();
    await Promise.resolve();
    // The import has its transaction and has not finished. The recovery does not have to wait for it
    // by itself: the browser runs the two transactions in the order in which they were started.
    expect(imported).toBe(false);

    const error = await attempt;

    expect(await importing).toEqual({ added: 1, skipped: 0 });
    expect(error).toMatchObject({ code: 'not-empty' });
    const writing = writingTransactions(transactions);
    expect(writing.map(isRecovery)).toEqual([false, true]);
    expect(writing[0]).toEqual(['userCollections', 'userEntries']);
    vi.restoreAllMocks();
    expect(get(app.collections.userVocabulary).collections.map((collection) => collection.name)).toEqual(['Made up for the handover']);
    expect(Object.keys((await snapshot(V3_NAME)).stores.userCollections)).toEqual(['user:99999999-0000-4000-8000-000000000000']);
  });

  it('does not start when the Backup screen was closed while it was being prepared', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    const before = await snapshot(V3_NAME);
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
    let open = true;
    const preparation = holdPreparation(app);
    const attempt = refusal(app.restoreOwnSection(file, { screenOpen: () => open }));
    await preparation.reached;
    open = false;
    preparation.release();

    const error = await attempt;

    expect(error).toMatchObject({ code: 'unavailable', message: 'The Backup screen was closed before the recovery began, so nothing was recovered and nothing was changed.' });
    expect(writingTransactions(transactions)).toEqual([]);
    vi.restoreAllMocks();
    expect(await snapshot(V3_NAME)).toEqual(before);
    expect(app.state.stateHeld()).toBe(false);
    expect(get(app.persistence.saveStatus).state).toBe('idle');
  });

  it('refuses in a tab that is not connected to its saved data, and holds nothing', async () => {
    await (await load()).state.initState();
    vi.resetModules();
    const app = await load();
    const before = await snapshot(V3_NAME);

    const error = await refusal(app.restoreOwnSection(await fileOf(app)));

    expect(error).toMatchObject({ code: 'unavailable', message: expect.stringContaining('This tab is not connected to its saved data') });
    expect(app.state.stateHeld()).toBe(false);
    expect(await snapshot(V3_NAME)).toEqual(before);
  });
});

describeExperimental('handover: while the recovery writes', () => {
  it('accepts no change of any kind until the recovered state is loaded, so none can be lost and none can be written', async () => {
    const app = await startApp();
    app.state.settings.setWordPageSize(20);
    await app.persistence.persistenceSettled();
    const file = await fileOf(app);
    const transaction = holdTransaction();
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const attempt = app.restoreOwnSection(file);
    await transaction.reached;

    // Every write of the recovery is issued, and its transaction has not completed.
    expect(app.state.stateHeld()).toBe(true);
    const [progressBefore, settingsBefore, vocabularyBefore] = [get(app.state.progress), get(app.state.settings), get(app.collections.userVocabulary)];
    const collections = await tryEveryChange(app);

    // Nothing was accepted: every store holds the very value it held, and nothing waits to be saved.
    expect(get(app.state.progress)).toBe(progressBefore);
    expect(get(app.state.settings)).toBe(settingsBefore);
    expect(get(app.collections.userVocabulary)).toBe(vocabularyBefore);
    expect(collections).toMatchObject({ kind: 'busy', message: 'A recovery from a backup file is running in this tab, so nothing was changed. Try again when it has finished.' });
    expect(get(app.persistence.saveStatus).state).toBe('saved');
    expect(writingTransactions(transactions).map(isRecovery)).toEqual([true]);
    transaction.release();
    await attempt;

    vi.restoreAllMocks();
    expect((await snapshot(V3_NAME)).stores).toEqual(recoveredStores());
    expect(get(app.state.progress).learnedPhrases).toEqual(syntheticStores(3).progress.learnedPhrases);
    expect(get(app.state.settings).theme).toBe('dark');
    // Saving resumed, with the state that was loaded from the database.
    expect(app.state.stateHeld()).toBe(false);
    expect(get(app.persistence.saveStatus).state).toBe('idle');
    app.state.progress.toggleLearnedPhrase('phrase-learned-after-the-recovery');
    await app.persistence.persistenceSettled();
    expect((await snapshot(V3_NAME)).stores.progress.learnedPhrases).toEqual([...(syntheticStores(3).progress.learnedPhrases as string[]), 'phrase-learned-after-the-recovery']);
  });

  it('accepts no change while a recovery writes that is then rolled back, and the tab goes on with what it had', async () => {
    const app = await startApp();
    app.state.settings.setTheme('light');
    await app.persistence.persistenceSettled();
    const file = await fileOf(app);
    const before = await snapshot(V3_NAME);
    const reload = vi.spyOn(app.state, 'initState');
    const [progressBefore, settingsBefore, vocabularyBefore] = [get(app.state.progress), get(app.state.settings), get(app.collections.userVocabulary)];
    const clear = IDBObjectStore.prototype.clear;
    let calls = 0;
    let collections: Promise<{ kind: string; message: string } | null> | undefined;
    vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (this: IDBObjectStore) {
      calls += 1;
      if (calls === 3) {
        collections = tryEveryChange(app);
        throw new DOMException('synthetic failure', 'UnknownError');
      }
      return clear.call(this);
    });

    const error = await refusal(app.restoreOwnSection(file));

    expect(error).toMatchObject({ code: 'write-failed', message: expect.stringContaining('nothing was changed') });
    expect(await collections).toMatchObject({ kind: 'busy' });
    expect(reload).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(await snapshot(V3_NAME)).toEqual(before);
    expect(get(app.state.progress)).toBe(progressBefore);
    expect(get(app.state.settings)).toBe(settingsBefore);
    expect(get(app.collections.userVocabulary)).toBe(vocabularyBefore);
    expect(get(app.persistence.saveStatus).state).toBe('saved');
    // The hold has ended: the next change is accepted, and saved.
    expect(app.state.stateHeld()).toBe(false);
    app.state.progress.toggleLearnedPhrase('phrase-learned-after-the-rollback');
    expect(await app.collections.acceptImport(importPlan(app))).toEqual({ added: 1, skipped: 0 });
    await app.persistence.persistenceSettled();
    const after = (await snapshot(V3_NAME)).stores;
    expect(after.progress.learnedPhrases).toEqual(['phrase-learned-after-the-rollback']);
    expect(Object.keys(after.userCollections)).toHaveLength(1);
    expect(after.settings.theme).toBe('light');
  });

  it('writes nothing for a caller that queued a change without asking, and writes it once a rollback has ended the hold', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    const clear = IDBObjectStore.prototype.clear;
    let calls = 0;
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
    vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (this: IDBObjectStore) {
      calls += 1;
      if (calls === 2) {
        app.persistence.persist([{ type: 'put', store: 'settings', key: 'theme', value: 'light' }]);
        void app.persistence.retrySave();
      }
      if (calls === 5) throw new DOMException('synthetic failure', 'UnknownError');
      return clear.call(this);
    });

    expect(await refusal(app.restoreOwnSection(file))).toMatchObject({ code: 'write-failed' });
    await app.persistence.persistenceSettled();

    // One transaction of this tab while the hold lasted, the recovery's own. The other one came after it.
    expect(writingTransactions(transactions)).toEqual([[...Object.keys(recoveredStores())].sort(), ['settings']]);
    vi.restoreAllMocks();
    expect((await snapshot(V3_NAME)).stores.settings).toEqual({ theme: 'light' });
    expect(get(app.persistence.saveStatus).state).toBe('saved');
  });

  it('writes nothing for such a caller after a recovery either: the recovered data stays exactly the backup', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    const transaction = holdTransaction();
    const attempt = app.restoreOwnSection(file);
    await transaction.reached;
    app.persistence.persist([{ type: 'put', store: 'settings', key: 'theme', value: 'light' }]);
    await app.persistence.retrySave();
    transaction.release();

    await attempt;
    await app.persistence.persistenceSettled();
    await app.persistence.retrySave();

    vi.restoreAllMocks();
    expect((await snapshot(V3_NAME)).stores).toEqual(recoveredStores());
    expect(get(app.persistence.saveStatus).state).toBe('idle');
  });

  it('refuses a second recovery while one is writing, and leaves the hold to the first', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    const transaction = holdTransaction();
    const first = app.restoreOwnSection(file);
    await transaction.reached;

    const second = await refusal(app.restoreOwnSection(file));

    expect(second).toMatchObject({ code: 'unavailable', message: 'Another recovery is still running in this tab, so this one did not start. Nothing was changed.' });
    // The refused one did not end a hold that is not its own.
    expect(app.state.stateHeld()).toBe(true);
    transaction.release();
    await first;
    vi.restoreAllMocks();
    expect(app.state.stateHeld()).toBe(false);
    expect((await snapshot(V3_NAME)).stores).toEqual(recoveredStores());
  });

  it('is not interrupted by a screen that closes after the transaction was started', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    let open = true;
    const asked = vi.fn(() => open);
    const transaction = holdTransaction();
    const attempt = app.restoreOwnSection(file, { screenOpen: asked });
    await transaction.reached;
    // It was asked in the step that took the hold. What the screen does later is not asked, and changes nothing.
    expect(asked).toHaveBeenCalledTimes(1);
    open = false;
    transaction.release();
    await attempt;
    expect(asked).toHaveBeenCalledTimes(1);

    await attempt;

    vi.restoreAllMocks();
    expect((await snapshot(V3_NAME)).stores).toEqual(recoveredStores());
    expect(get(app.state.progress).learnedPhrases).toEqual(syntheticStores(3).progress.learnedPhrases);
  });
});

describeExperimental('handover: the hold ends on every way out', () => {
  const outcomes: [string, (app: Modules) => void | Promise<void>, string | null, string][] = [
    ['a recovery', () => undefined, null, 'idle'],
    ['a refusal: the destination holds learning data', async (app) => {
      app.state.progress.toggleLearnedPhrase('phrase-kept');
      await app.persistence.persistenceSettled();
    }, 'not-empty', 'saved'],
    ['a rollback', () => {
      vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(() => { throw new DOMException('synthetic failure', 'UnknownError'); });
    }, 'write-failed', 'idle'],
    ['a check that failed after the commit', () => {
      vi.spyOn(indexedDB, 'databases').mockRejectedValueOnce(new DOMException('synthetic read-back failure', 'UnknownError'));
    }, 'verification', 'disabled'],
    ['a recovered state that could not be loaded', (app) => {
      vi.spyOn(app.state, 'initState').mockRejectedValueOnce(new Error('synthetic load failure'));
    }, 'verification', 'disabled']
  ];

  it.each(outcomes)('after %s', async (_name, arrange, code, status) => {
    const app = await startApp();
    const file = await fileOf(app);
    await arrange(app);

    const error = await refusal(app.restoreOwnSection(file));

    expect(error?.code ?? null).toBe(code);
    vi.restoreAllMocks();
    expect(app.state.stateHeld()).toBe(false);
    expect(app.persistence.changesHeld()).toBe(false);
    expect(get(app.persistence.saveStatus).state).toBe(status);
    // The tab accepts changes again. Whether they are saved is what the status says.
    const database = await snapshot(V3_NAME);
    app.state.progress.toggleFavorite('word', 'word-after-the-hold');
    await app.persistence.persistenceSettled();
    expect(get(app.state.progress).favoriteWords).toContain('word-after-the-hold');
    const saved = ((await snapshot(V3_NAME)).stores.progress.favoriteWords as string[] | undefined) ?? [];
    expect(saved.includes('word-after-the-hold')).toBe(status !== 'disabled');
    if (status === 'disabled') expect(await snapshot(V3_NAME)).toEqual(database);
  });
});
