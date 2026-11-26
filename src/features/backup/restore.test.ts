import { openDB } from 'idb';
import { get } from 'svelte/store';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetDatabase, watchUnhandledRejections } from '../../test/database';
import { describeExperimental } from '../../test/product';
import type { BackupFile } from './format';
import { SYNTHETIC_META, V1_STATE, V1_STATE_KEY, V1_THEME_KEY, V2_NAME, V3_NAME, asPairs, bytesOf, databaseNames, seedExperimental, seedLegacy, seedStable, snapshot, syntheticStores, type Snapshot, type Stores } from './testing';

/**
 * Recovery into this product's own database (ENG-V3-R1A). All data is made up.
 *
 * "Losing the browser storage" is a new, empty IndexedDB, an empty key-value storage and
 * fresh modules: nothing of the earlier session survives except the text of the file.
 */
const V3 = 'experimental-v3';
const V2 = 'stable-v2';
const V1 = 'legacy-v1';
/** Records that the made-up experimental section writes: 23 learning records and 2 of meta. */
const WRITES = 25;
/** Calls of `put` in one recovery: the guard's record first, then every record of the section. */
const PUTS = WRITES + 1;

async function load() {
  const [restore, exporter, validate, format, state, persistence, collections] = await Promise.all([
    import('./restore'),
    import('./exportBackup'),
    import('./validate'),
    import('./format'),
    import('../../state'),
    import('../../state/persistence'),
    import('../../collections/service')
  ]);
  return { ...restore, ...exporter, ...validate, ...format, state, persistence, collections };
}
type Modules = Awaited<ReturnType<typeof load>>;

function loseBrowserStorage(): void {
  resetDatabase();
  window.localStorage.clear();
  vi.resetModules();
}

/** A backup of a profile with all three products, then the loss of everything but its text. */
async function backupThenLoss(): Promise<{ text: string; original: Snapshot }> {
  await seedExperimental();
  await seedStable();
  seedLegacy();
  const source = await load();
  const { text } = await source.composeBackup((await source.collectSections()).sections);
  const original = await snapshot(V3_NAME);
  loseBrowserStorage();
  return { text, original };
}

/** The application as it is after start-up: the database exists and the state services are connected. */
async function startApp(): Promise<Modules> {
  const modules = await load();
  await modules.state.initState();
  return modules;
}

const refusal = (run: Promise<unknown>): Promise<{ code: string; message: string } | null> => run.then(() => null, (error: { code: string; message: string }) => error);

/** A file for the experimental product alone, with matching digests, built without a database. */
async function fileOf(modules: Modules, stores: Stores = syntheticStores(3)): Promise<BackupFile> {
  const section = { database: 'eng-trainer-v3', schemaVersion: 1, stores: asPairs({ ...stores, meta: SYNTHETIC_META }) };
  return (await modules.composeBackup({ [V3]: section })).backup;
}

beforeEach(() => {
  loseBrowserStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describeExperimental('recovery: the complete round trip', () => {
  it('brings back every store exactly, from the file alone, after the browser lost everything', async () => {
    const { text, original } = await backupThenLoss();
    expect(await databaseNames()).toEqual([]);
    const app = await startApp();
    const fresh = await snapshot(V3_NAME);
    expect(fresh.stores.meta.createdAt).not.toBe(SYNTHETIC_META.createdAt);

    await app.restoreOwnSection(await app.readBackup(bytesOf(text)));

    const recovered = await snapshot(V3_NAME);
    expect(recovered).toEqual(original);
    expect(recovered.stores.meta).toEqual(SYNTHETIC_META);
    expect(Object.keys(recovered.stores)).toHaveLength(7);
  });

  it('keeps every identity: entries, the collection, the Learn pass, deck keys and positions', async () => {
    const { text } = await backupThenLoss();
    const app = await startApp();
    await app.restoreOwnSection(await app.readBackup(bytesOf(text)));

    const expected = syntheticStores(3);
    const { stores } = await snapshot(V3_NAME);
    for (const name of ['progress', 'learnPasses', 'flashcardSessions', 'settings', 'userCollections', 'userEntries']) {
      expect(Object.keys(stores[name]), name).toEqual(Object.keys(expected[name]).sort());
      expect(stores[name], name).toEqual(expected[name]);
    }
    expect(stores.flashcardSessions.all).toEqual({ order: ['phrase-307', 'user:33333333-0000-4000-8000-000000000000:entry:00000001-0000-4000-8000-000000000003', 'phrase-308'], index: 1 });
    expect(stores.progress.selectedLearnPassId).toBe('pass-synthetic-3');
  });

  it('loads the recovered state into the running application, which keeps saving into the same database', async () => {
    const { text } = await backupThenLoss();
    const app = await startApp();
    expect(get(app.state.progress).learnedPhrases).toEqual([]);

    await app.restoreOwnSection(await app.readBackup(bytesOf(text)));

    const expected = syntheticStores(3);
    expect(get(app.state.progress).learnedPhrases).toEqual(expected.progress.learnedPhrases);
    expect(get(app.state.progress).selectedLearnPassId).toBe('pass-synthetic-3');
    expect(get(app.state.progress).learnPasses.map((pass) => pass.name)).toEqual(['Synthetic pass 3']);
    expect(get(app.state.settings)).toMatchObject({ theme: 'dark', speechRepeatCount: 20, indexPageSize: 'all', flashcardMode: 'topic' });
    expect(get(app.collections.userVocabulary)).toMatchObject({ available: true, collections: [{ name: 'Synthetic collection 3' }] });
    expect(get(app.collections.userVocabulary).entries).toHaveLength(2);
    expect(get(app.persistence.saveStatus).state).toBe('idle');

    app.state.progress.toggleLearnedPhrase('phrase-learned-after-recovery');
    await app.persistence.persistenceSettled();
    expect(get(app.persistence.saveStatus).state).toBe('saved');
    expect((await snapshot(V3_NAME)).stores.progress.learnedPhrases).toEqual([...(expected.progress.learnedPhrases as string[]), 'phrase-learned-after-recovery']);
  });

  it('writes only this product: the stable database and the records of the first version are not created from the file', async () => {
    const { text } = await backupThenLoss();
    const app = await startApp();
    const file = await app.readBackup(bytesOf(text));
    expect(Object.keys(file.sections)).toEqual([V3, V2, V1]);
    const open = vi.spyOn(indexedDB, 'open');
    const storage = [vi.spyOn(Storage.prototype, 'getItem'), vi.spyOn(Storage.prototype, 'setItem'), vi.spyOn(Storage.prototype, 'removeItem'), vi.spyOn(Storage.prototype, 'clear')];

    await app.restoreOwnSection(file);

    expect([...new Set(open.mock.calls.map(([name]) => name))]).toEqual([V3_NAME]);
    for (const spy of storage) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(await databaseNames()).toEqual([V3_NAME]);
    expect(window.localStorage.length).toBe(0);
  });

  it('leaves existing data of the other two products exactly as it is', async () => {
    const { text } = await backupThenLoss();
    // On this device the other two products still have their own, different data.
    const other = syntheticStores(2);
    other.progress.learnedPhrases = ['phrase-only-on-this-device'];
    await seedStable(other);
    seedLegacy('{"learnedPhrases":["phrase-v1-on-this-device"]}', 'light');
    const before = await snapshot(V2_NAME);
    const app = await startApp();

    await app.restoreOwnSection(await app.readBackup(bytesOf(text)));

    expect(await snapshot(V2_NAME)).toEqual(before);
    expect(window.localStorage.length).toBe(2);
    expect(window.localStorage.getItem(V1_STATE_KEY)).toBe('{"learnedPhrases":["phrase-v1-on-this-device"]}');
    expect(window.localStorage.getItem(V1_THEME_KEY)).toBe('light');
    expect(V1_STATE).not.toContain('phrase-v1-on-this-device');
  });
});

describeExperimental('recovery: only into a destination without learning data', () => {
  const occupied: [string, (stores: Stores) => void, string][] = [
    ['a learned item', (stores) => { stores.progress = { learnedPhrases: ['phrase-kept'] }; }, '1 learned, hidden or Focus item'],
    ['a hidden word and a Focus item', (stores) => { stores.progress = { hiddenWords: ['word-kept'], favoriteBlocks: ['block-kept'], learnedPhrases: [] }; }, '2 learned, hidden or Focus items'],
    ['a Learn pass', (stores) => { stores.learnPasses = syntheticStores(2).learnPasses; }, '1 Learn pass'],
    ['a selected Learn pass', (stores) => { stores.progress = { selectedLearnPassId: 'pass-kept' }; }, '1 other progress record'],
    ['a progress record of an unknown form', (stores) => { stores.progress = { learnedPhrases: 'phrase-kept' }; }, '1 other progress record'],
    ['a flashcard deck with a saved place', (stores) => { stores.flashcardSessions = { all: { order: ['phrase-kept'], index: 0 } }; }, '1 flashcard deck with a saved place'],
    ['an imported collection', (stores) => { stores.userCollections = syntheticStores(2).userCollections; stores.userEntries = syntheticStores(2).userEntries; }, '1 imported collection'],
    ['imported entries without their collection', (stores) => { stores.userEntries = syntheticStores(2).userEntries; }, '2 imported entries']
  ];

  it.each(occupied)('refuses a destination that holds %s, and changes nothing', async (_name, fill, holds) => {
    const stores: Stores = { settings: { theme: 'light' } };
    fill(stores);
    // The running application started on an empty profile. The data is in the database all the same,
    // as another tab leaves it: only the database decides, never what this tab remembers.
    const app = await startApp();
    await seedExperimental(stores, { createdAt: '2026-06-06T06:06:06.000Z', schema: 1 });
    const before = await snapshot(V3_NAME);
    const file = await fileOf(app);

    expect(await app.inspectDestination()).toEqual({ state: 'occupied', holds: [holds] });
    const error = await refusal(app.restoreOwnSection(file));

    expect(error).toMatchObject({ code: 'not-empty', message: expect.stringContaining('never overwrites data, so nothing was changed') });
    expect(await snapshot(V3_NAME)).toEqual(before);
  });

  it('accepts a destination after "Reset learning progress": empty lists are not learning data, and preferences are replaced', async () => {
    const app = await startApp();
    app.state.progress.toggleLearnedPhrase('phrase-learned-then-reset');
    app.state.progress.saveLearnPass({ name: 'A pass that is reset', blockIds: ['block-a'] });
    app.state.settings.setWordPageSize(20);
    app.state.settings.setTheme('light');
    app.state.resetAllState();
    await app.persistence.persistenceSettled();
    const before = await snapshot(V3_NAME);
    expect(before.stores.progress.learnedPhrases).toEqual([]);
    expect(before.stores.settings.theme).toBe('light');
    expect(await app.inspectDestination()).toEqual({ state: 'empty' });

    await app.restoreOwnSection(await fileOf(app));

    const after = await snapshot(V3_NAME);
    expect(after.stores).toEqual({ ...syntheticStores(3), meta: SYNTHETIC_META });
    // A preference that only the destination had is gone: the stores are those of the backup, exactly.
    expect(Object.keys(after.stores.settings)).toEqual(Object.keys(syntheticStores(3).settings));
    expect(get(app.state.settings).theme).toBe('dark');
  });

  it('refuses a second recovery: the first one filled the destination', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    await app.restoreOwnSection(file);
    const before = await snapshot(V3_NAME);

    expect(await refusal(app.restoreOwnSection(file))).toMatchObject({ code: 'not-empty' });
    expect(await snapshot(V3_NAME)).toEqual(before);
  });

  it('judges the destination inside the one transaction that writes, before the first write', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const reads = [vi.spyOn(IDBObjectStore.prototype, 'getAll'), vi.spyOn(IDBObjectStore.prototype, 'getAllKeys')];
    const writes = [vi.spyOn(IDBObjectStore.prototype, 'clear'), vi.spyOn(IDBObjectStore.prototype, 'put'), vi.spyOn(IDBObjectStore.prototype, 'add')];

    await app.restoreOwnSection(file);

    const writing = transactions.mock.results.map((result) => result.value as IDBTransaction).filter((transaction) => transaction.mode === 'readwrite');
    expect(writing).toHaveLength(1);
    const order = (spies: { mock: { invocationCallOrder: number[]; contexts: unknown[] } }[]): number[] => spies.flatMap((spy) => spy.mock.invocationCallOrder.filter((_, index) => (spy.mock.contexts[index] as IDBObjectStore).transaction === writing[0]));
    // Six stores are read (keys and values) in the writing transaction, and all of that precedes every write.
    expect(order(reads)).toHaveLength(12);
    // Seven stores are cleared, the guard is written and then added once more, and every record is written.
    expect(order(writes)).toHaveLength(7 + PUTS + 1);
    expect(Math.max(...order(reads))).toBeLessThan(Math.min(...order(writes)));
    // Every write of the recovery belongs to that one transaction.
    for (const spy of writes) for (const context of spy.mock.contexts) expect((context as IDBObjectStore).transaction).toBe(writing[0]);
  });

  it('refuses when learning data appeared after the preview, as from another tab', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    expect(await app.inspectDestination()).toEqual({ state: 'empty' });

    const otherTab = await openDB(V3_NAME);
    await otherTab.put('progress', ['phrase-learned-in-another-tab'], 'learnedPhrases');
    otherTab.close();
    const before = await snapshot(V3_NAME);

    expect(await refusal(app.restoreOwnSection(file))).toMatchObject({ code: 'not-empty' });
    expect(await snapshot(V3_NAME)).toEqual(before);
    expect(before.stores.progress.learnedPhrases).toEqual(['phrase-learned-in-another-tab']);
  });
});

describeExperimental('recovery: all or nothing', () => {
  /** The application with a few saved preferences and reset lists: a destination that has records to lose. */
  async function appWithPreferences(): Promise<{ app: Modules; before: Snapshot }> {
    const app = await startApp();
    app.state.progress.toggleLearnedPhrase('phrase-toggled');
    app.state.progress.toggleLearnedPhrase('phrase-toggled');
    app.state.settings.setTheme('light');
    app.state.settings.setWordPageSize(20);
    await app.persistence.persistenceSettled();
    return { app, before: await snapshot(V3_NAME) };
  }

  it.each([1, 2, 14, PUTS])('rolls everything back when write number %i fails, and leaves the running application as it was', async (failing) => {
    const { app, before } = await appWithPreferences();
    const file = await fileOf(app);
    const observed = watchUnhandledRejections();
    const put = IDBObjectStore.prototype.put;
    let calls = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      calls += 1;
      if (calls === failing) throw new DOMException('synthetic failure', 'UnknownError');
      return put.apply(this, args);
    });

    const error = await refusal(app.restoreOwnSection(file));
    vi.restoreAllMocks();

    expect(error).toMatchObject({ code: 'write-failed', message: expect.stringContaining('nothing was changed') });
    expect(error?.message).toContain('synthetic failure');
    expect(calls).toBe(failing);
    expect(await snapshot(V3_NAME)).toEqual(before);
    expect(get(app.state.settings).theme).toBe('light');
    expect(get(app.state.progress).learnedPhrases).toEqual([]);
    expect(await observed.stop()).toEqual([]);
  });

  it('rolls everything back when the transaction is aborted after every write was accepted', async () => {
    const { app, before } = await appWithPreferences();
    const file = await fileOf(app);
    const observed = watchUnhandledRejections();
    const put = IDBObjectStore.prototype.put;
    let calls = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      const request = put.apply(this, args);
      calls += 1;
      if (calls === PUTS) {
        // An interruption by the browser: the last request succeeds, then the transaction is aborted.
        const transaction = this.transaction;
        request.addEventListener('success', () => transaction.abort());
      }
      return request;
    });

    const error = await refusal(app.restoreOwnSection(file));
    vi.restoreAllMocks();

    expect(error).toMatchObject({ code: 'write-failed' });
    expect(calls).toBe(PUTS);
    expect(await snapshot(V3_NAME)).toEqual(before);
    expect(await observed.stop()).toEqual([]);
  });

  // Found by the browser acceptance test in Firefox: the tab was closed while the recovery issued its
  // writes, the browser cancelled the script, no `catch` block ran, and the writes issued so far were
  // committed. A cancelled script cannot be made in a test, so the same state is built here: the
  // script stops at one write, and its own rollback does not happen.
  it.each([2, 3, 11, 20, PUTS])('commits nothing when the script stops at write number %i and never gets to roll back', async (stopping) => {
    const { app, before } = await appWithPreferences();
    const file = await fileOf(app);
    const observed = watchUnhandledRejections();
    const put = IDBObjectStore.prototype.put;
    let calls = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      calls += 1;
      if (calls === stopping) throw new Error('the script stopped here');
      return put.apply(this, args);
    });
    const rollback = vi.spyOn(IDBTransaction.prototype, 'abort').mockImplementation(() => { throw new Error('the rollback of the script never ran'); });

    const error = await refusal(app.restoreOwnSection(file));
    expect(rollback).toHaveBeenCalled();
    vi.restoreAllMocks();

    expect(error).toMatchObject({ code: 'write-failed' });
    // Earlier writes of the same transaction were accepted. None of them is in the database.
    expect(calls).toBe(stopping);
    expect(await snapshot(V3_NAME)).toEqual(before);
    expect(Object.keys((await snapshot(V3_NAME)).stores.meta).sort()).toEqual(['createdAt', 'schema']);
    expect(await app.inspectDestination()).toEqual({ state: 'empty' });
    expect(await observed.stop()).toEqual([]);
  });

  it('writes nothing in a browser that would accept the guard\'s key twice: without a guard there is no recovery', async () => {
    const { app, before } = await appWithPreferences();
    const file = await fileOf(app);
    // A storage that treats `add` like `put` gives the guard nothing to fail on.
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      return IDBObjectStore.prototype.put.call(this, value, key);
    });

    const error = await refusal(app.restoreOwnSection(file));
    vi.restoreAllMocks();

    expect(error).toMatchObject({ code: 'write-failed' });
    expect(await snapshot(V3_NAME)).toEqual(before);
  });

  it('uses a guard whose record is an empty list of learned phrases, and leaves no other trace of it', async () => {
    const app = await startApp();
    expect([app.GUARD_STORE, app.GUARD_KEY]).toEqual(['progress', 'learnedPhrases']);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    const add = vi.spyOn(IDBObjectStore.prototype, 'add');

    await app.restoreOwnSection(await fileOf(app));

    expect([(put.mock.contexts[0] as IDBObjectStore).name, ...put.mock.calls[0]]).toEqual(['progress', [], 'learnedPhrases']);
    expect(add.mock.calls).toEqual([[[], 'learnedPhrases']]);
    expect((add.mock.contexts[0] as IDBObjectStore).name).toBe('progress');
    vi.restoreAllMocks();
    expect((await snapshot(V3_NAME)).stores).toEqual({ ...syntheticStores(3), meta: SYNTHETIC_META });
  });

  // The one moment that the guard cannot cover is the one between its own two requests. What is
  // committed then is the guard's record alone, and that record is valid and empty.
  it('leaves a valid, empty profile when the script stops between the two requests of the guard', async () => {
    const app = await startApp();
    const before = await snapshot(V3_NAME);
    expect(before.stores.progress).toEqual({});
    const file = await fileOf(app);
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(() => { throw new Error('the script stopped here'); });
    vi.spyOn(IDBTransaction.prototype, 'abort').mockImplementation(() => { throw new Error('the rollback of the script never ran'); });

    expect(await refusal(app.restoreOwnSection(file))).toMatchObject({ code: 'write-failed' });
    vi.restoreAllMocks();

    const after = await snapshot(V3_NAME);
    expect(after.stores).toEqual({ ...before.stores, progress: { learnedPhrases: [] } });
    expect(Object.keys(after.stores.meta).sort()).toEqual(['createdAt', 'schema']);
    // A backup of this profile can still be made: every record is one that the application writes itself.
    expect((await app.collectSections()).reports.find((report) => report.product === V3)).toMatchObject({ state: 'included' });
    expect(await app.inspectDestination()).toEqual({ state: 'empty' });
    await app.restoreOwnSection(file);
    expect((await snapshot(V3_NAME)).stores).toEqual({ ...syntheticStores(3), meta: SYNTHETIC_META });
  });

  it('says that the storage is full when the browser refuses the data for that reason', async () => {
    const { app, before } = await appWithPreferences();
    const file = await fileOf(app);
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('synthetic quota', 'QuotaExceededError'); });

    const error = await refusal(app.restoreOwnSection(file));
    vi.restoreAllMocks();

    expect(error).toMatchObject({ code: 'write-failed', message: expect.stringContaining('its storage for this site is full. Nothing was changed.') });
    expect(await snapshot(V3_NAME)).toEqual(before);
  });

  it('succeeds on the next attempt after an interrupted one: the destination is still eligible', async () => {
    const { app } = await appWithPreferences();
    const file = await fileOf(app);
    const put = IDBObjectStore.prototype.put;
    let calls = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      calls += 1;
      if (calls === 5) throw new DOMException('synthetic failure', 'UnknownError');
      return put.apply(this, args);
    });
    expect(await refusal(app.restoreOwnSection(file))).toMatchObject({ code: 'write-failed' });
    vi.restoreAllMocks();
    expect(await app.inspectDestination()).toEqual({ state: 'empty' });

    await app.restoreOwnSection(file);

    expect((await snapshot(V3_NAME)).stores).toEqual({ ...syntheticStores(3), meta: SYNTHETIC_META });
  });

  it('does not report a recovery when the database does not hold what the file holds', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    const put = IDBObjectStore.prototype.put;
    // The storage keeps another value than it was given: a fault that only a read-back can see.
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      return put.call(this, key === 'learnedPhrases' ? ['phrase-kept-wrongly'] : value, key);
    });

    const error = await refusal(app.restoreOwnSection(file));
    vi.restoreAllMocks();

    expect(error).toMatchObject({ code: 'verification', message: expect.stringContaining('reading it back gave another result') });
    expect((await snapshot(V3_NAME)).stores.progress.learnedPhrases).toEqual(['phrase-kept-wrongly']);
  });
});

describeExperimental('recovery: what it refuses before it opens a transaction', () => {
  it('refuses a file without data of this product, a section that fails its digest, and a record that is not acceptable', async () => {
    const app = await startApp();
    const before = await snapshot(V3_NAME);
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const good = await fileOf(app);

    const withoutOwn = { ...good, sections: { [V2]: { database: 'eng-trainer-v2', schemaVersion: 2, stores: asPairs(syntheticStores(2)) } }, integrity: { ...good.integrity, sections: {} } } as BackupFile;
    expect(await refusal(app.restoreOwnSection(withoutOwn))).toMatchObject({ code: 'malformed', message: expect.stringContaining('holds no data of this version') });

    const changed = structuredClone(good);
    changed.sections[V3]!.stores.progress[0][1] = ['phrase-changed-after-the-digest'];
    expect(await refusal(app.restoreOwnSection(changed))).toMatchObject({ code: 'integrity' });

    const odd = syntheticStores(3);
    odd.settings.theme = 'purple';
    const invalid = structuredClone(good);
    invalid.sections[V3]!.stores = asPairs({ ...odd, meta: SYNTHETIC_META });
    invalid.integrity.sections[V3] = await app.sectionDigest(invalid.sections[V3]!);
    expect(await refusal(app.restoreOwnSection(invalid))).toMatchObject({ code: 'invalid-record' });

    // The stable product's section under this product's name is not this product's data.
    const disguised = structuredClone(good);
    disguised.sections[V3] = { database: 'eng-trainer-v2', schemaVersion: 2, stores: asPairs(syntheticStores(2)) };
    disguised.integrity.sections[V3] = await app.sectionDigest(disguised.sections[V3]!);
    expect(await refusal(app.restoreOwnSection(disguised))).toMatchObject({ code: 'malformed', message: expect.stringContaining('names the storage "eng-trainer-v2", not "eng-trainer-v3"') });

    expect(transactions.mock.calls.filter(([, mode]) => mode === 'readwrite')).toEqual([]);
    vi.restoreAllMocks();
    expect(await snapshot(V3_NAME)).toEqual(before);
  });

  it('refuses while saving is switched off, and does not switch it on', async () => {
    (await (await load()).state.initState());
    loseModulesOnly();
    const app = await load();
    app.state.initStateWithoutStorage();
    const before = await snapshot(V3_NAME);

    expect(await app.inspectDestination()).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('Saving is switched off') });
    expect(await refusal(app.restoreOwnSection(await fileOf(app)))).toMatchObject({ code: 'unavailable' });

    expect(get(app.persistence.saveStatus).state).toBe('disabled');
    expect(await snapshot(V3_NAME)).toEqual(before);
  });

  it('refuses when this product has no database yet, and does not create one from the file', async () => {
    const app = await load();
    expect(await app.inspectDestination()).toMatchObject({ state: 'unavailable' });
    expect(await refusal(app.restoreOwnSection(await fileOf(app)))).toMatchObject({ code: 'unavailable' });
    expect(await databaseNames()).toEqual([]);
  });

  it('refuses a destination with a storage schema it does not know', async () => {
    await seedExperimental({}, SYNTHETIC_META, ['pronunciationAttempts']);
    const before = await snapshot(V3_NAME);
    const app = await load();

    expect(await app.inspectDestination()).toMatchObject({ state: 'unavailable' });
    expect(await refusal(app.restoreOwnSection(await fileOf(app)))).toMatchObject({ code: 'unsupported-version', message: expect.stringContaining('Nothing was changed') });
    expect(await snapshot(V3_NAME)).toEqual(before);
  });
});

/**
 * ENG-V3-R1A-RC2, finding 1 of the review: what happens after the writing transaction has
 * completed, and what the state of the running tab may still do to the database.
 */
describeExperimental('recovery: after the transaction has completed', () => {
  const recoveredStores = (): Stores => ({ ...syntheticStores(3), meta: SYNTHETIC_META });

  /** Everything a learner can do in the same tab that would save something. */
  async function useTheSameTab(app: Modules): Promise<void> {
    app.state.progress.toggleLearnedPhrase('phrase-001');
    app.state.progress.toggleFavorite('phrase', 'phrase-002');
    app.state.progress.saveLearnPass({ name: 'A pass of the old state', blockIds: ['block-a'] });
    app.state.settings.setTheme('light');
    app.state.settings.setActivePage('phrases');
    app.state.resetAllState();
    app.state.progress.toggleLearnedPhrase('phrase-003');
    await app.persistence.persistenceSettled();
    await app.persistence.retrySave();
    await app.persistence.persistenceSettled();
  }

  it('reports a rejected read-back as written but not checked: the data is in the database, and this tab saves nothing more', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    // The fault of the review: the first listing of the databases after the commit is refused, once.
    const listing = vi.spyOn(indexedDB, 'databases').mockRejectedValueOnce(new DOMException('Injected post-commit read failure', 'UnknownError'));

    const error = await refusal(app.restoreOwnSection(file));

    expect(listing).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ code: 'verification' });
    expect(error?.message).toContain('The data was written, but it could not be read back to check it.');
    expect(error?.message).toContain('Injected post-commit read failure');
    expect(error?.message).toContain('This tab saves nothing until the page is reloaded, so that nothing can be written over the recovered data. Reload the page.');
    expect(error?.message).not.toMatch(/nothing was (?:changed|recovered)/i);
    // The transaction did complete: every store is the backup's.
    expect((await snapshot(V3_NAME)).stores).toEqual(recoveredStores());
    // The tab still holds the state from before the recovery, and it is detached from its storage.
    expect(get(app.state.progress).learnedPhrases).toEqual([]);
    expect(get(app.persistence.saveStatus).state).toBe('disabled');
    expect(get(app.collections.userVocabulary).available).toBe(false);

    await useTheSameTab(app);

    expect(get(app.state.progress).learnedPhrases).toEqual(['phrase-003']);
    expect((await snapshot(V3_NAME)).stores).toEqual(recoveredStores());
  });

  it('refuses a change of the collections in the detached tab too', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    vi.spyOn(indexedDB, 'databases').mockRejectedValueOnce(new DOMException('Injected post-commit read failure', 'UnknownError'));
    expect(await refusal(app.restoreOwnSection(file))).toMatchObject({ code: 'verification' });

    const collection = { id: 'user:99999999-0000-4000-8000-000000000000', name: 'Of the old state', description: '' };
    const entry = { id: `${collection.id}:entry:00000001-0000-4000-8000-000000000009`, kind: 'phrase', english: 'a stale phrase', translation: 'made up', topic: '', examples: [] };
    const plan = { parsed: { collection, entries: [entry], issues: [], fileName: 'stale.json', source: 'json' }, target: collection, additions: [entry], skipped: 0, issues: [], duplicates: [] } as unknown as Parameters<typeof app.collections.acceptImport>[0];
    const attempt = await app.collections.acceptImport(plan).then(() => null, (failure: { kind: string }) => failure);

    expect(attempt).toMatchObject({ kind: 'unavailable' });
    expect((await snapshot(V3_NAME)).stores).toEqual(recoveredStores());
  });

  it('after a reload the application starts on the recovered data, and the file says that this version holds exactly it', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    vi.spyOn(indexedDB, 'databases').mockRejectedValueOnce(new DOMException('Injected post-commit read failure', 'UnknownError'));
    expect(await refusal(app.restoreOwnSection(file))).toMatchObject({ code: 'verification' });
    await useTheSameTab(app);
    vi.restoreAllMocks();

    loseModulesOnly();
    const reloaded = await startApp();

    expect(get(reloaded.state.progress).learnedPhrases).toEqual(syntheticStores(3).progress.learnedPhrases);
    expect(get(reloaded.persistence.saveStatus).state).toBe('idle');
    expect(await reloaded.inspectDestination(file.integrity.sections[V3])).toEqual({ state: 'identical' });
    // Without the file's digest the same database is simply one that holds learning data.
    expect(await reloaded.inspectDestination()).toMatchObject({ state: 'occupied' });
    // Another file does not find its own data there.
    const other = syntheticStores(3);
    other.progress.learnedPhrases = ['phrase-of-another-backup'];
    const otherFile = await fileOf(reloaded, other);
    expect(await reloaded.inspectDestination(otherFile.integrity.sections[V3])).toMatchObject({ state: 'occupied' });
  });

  it('reports a digest that does not match after the commit as written but not checked, and detaches the tab', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    const put = IDBObjectStore.prototype.put;
    // The storage keeps another value than it was given: a fault that only a read-back can see.
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      return put.call(this, key === 'hiddenWords' ? ['word-kept-wrongly'] : value, key);
    });

    const error = await refusal(app.restoreOwnSection(file));
    vi.restoreAllMocks();

    expect(error).toMatchObject({ code: 'verification' });
    expect(error?.message).toContain('The data was written, but reading it back gave another result.');
    expect(error?.message).toContain('This tab saves nothing until the page is reloaded');
    expect(error?.message).not.toMatch(/nothing was (?:changed|recovered)/i);
    const written = await snapshot(V3_NAME);
    expect(written.stores.progress.learnedPhrases).toEqual(syntheticStores(3).progress.learnedPhrases);
    expect(get(app.persistence.saveStatus).state).toBe('disabled');

    await useTheSameTab(app);

    expect(await snapshot(V3_NAME)).toEqual(written);
  });

  it('stays detached when the recovered state cannot be loaded, and saves again only after it was loaded from the database', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    const load = vi.spyOn(app.state, 'initState').mockRejectedValueOnce(new Error('synthetic load failure'));

    const error = await refusal(app.restoreOwnSection(file));

    expect(load).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ code: 'verification' });
    expect(error?.message).toContain('The data was written and checked, but the application could not load it. synthetic load failure');
    expect(error?.message).toContain('This tab saves nothing until the page is reloaded');
    expect(get(app.persistence.saveStatus).state).toBe('disabled');
    // Nothing resumed by itself: the tab holds the old state, and nothing of it reaches the database.
    expect(get(app.state.progress).learnedPhrases).toEqual([]);
    await useTheSameTab(app);
    expect((await snapshot(V3_NAME)).stores).toEqual(recoveredStores());

    // The one way back: the state is loaded from the database again.
    vi.restoreAllMocks();
    await app.state.initState();

    expect(get(app.persistence.saveStatus).state).toBe('idle');
    expect(get(app.state.progress).learnedPhrases).toEqual(syntheticStores(3).progress.learnedPhrases);
    app.state.progress.toggleLearnedPhrase('phrase-learned-after-the-reload');
    await app.persistence.persistenceSettled();
    expect((await snapshot(V3_NAME)).stores.progress.learnedPhrases).toEqual([...(syntheticStores(3).progress.learnedPhrases as string[]), 'phrase-learned-after-the-reload']);
  });

  it('keeps a change that is made while the recovery writes out of the database', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    const clear = IDBObjectStore.prototype.clear;
    let made = false;
    // In the middle of the recovery's own transaction something in the tab changes the old state:
    // a key that was still held down, a timer, the Back button.
    vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (this: IDBObjectStore) {
      if (!made) {
        made = true;
        app.state.progress.toggleLearnedPhrase('phrase-changed-during-the-write');
        app.state.settings.setTheme('light');
        app.state.settings.setActivePage('words');
      }
      return clear.call(this);
    });

    await app.restoreOwnSection(file);
    vi.restoreAllMocks();
    await app.persistence.persistenceSettled();

    expect(made).toBe(true);
    expect((await snapshot(V3_NAME)).stores).toEqual(recoveredStores());
    expect(get(app.state.progress).learnedPhrases).toEqual(syntheticStores(3).progress.learnedPhrases);
    expect(get(app.state.settings).theme).toBe('dark');
    expect(get(app.persistence.saveStatus).state).toBe('idle');
  });

  it('saves a change that was on its way when the recovery started before it writes, and then replaces it', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    const writes = vi.spyOn(IDBDatabase.prototype, 'transaction');

    // Not awaited: the save is queued and has not started when the recovery is called.
    app.state.settings.setTheme('light');
    app.state.settings.setWordPageSize(20);
    await app.restoreOwnSection(file);

    // Two read-write transactions, in this order: the queued save, then the recovery.
    const writing = writes.mock.results.map((result) => result.value as IDBTransaction).filter((transaction) => transaction.mode === 'readwrite');
    expect(writing.map((transaction) => [...transaction.objectStoreNames])).toEqual([['settings'], [...Object.keys(recoveredStores())].sort()]);
    vi.restoreAllMocks();
    expect((await snapshot(V3_NAME)).stores).toEqual(recoveredStores());
    expect(get(app.state.settings).theme).toBe('dark');
  });

  it('refuses while changes of this session could not be saved, and drops none of them', async () => {
    const app = await startApp();
    const file = await fileOf(app);
    const before = await snapshot(V3_NAME);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('synthetic failure', 'UnknownError'); });
    app.state.settings.setTheme('light');
    await app.persistence.persistenceSettled();
    expect(get(app.persistence.saveStatus).state).toBe('error');
    put.mockRestore();
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');

    const error = await refusal(app.restoreOwnSection(file));

    expect(error).toMatchObject({ code: 'unavailable', message: expect.stringContaining('The latest changes in this tab could not be saved, so nothing was recovered') });
    expect(error?.message).toContain('Choose “Try saving again” at the top of the page');
    expect(error?.message).not.toMatch(/reload/i);
    expect(transactions.mock.calls.filter(([, mode]) => mode === 'readwrite')).toEqual([]);
    vi.restoreAllMocks();
    expect(await snapshot(V3_NAME)).toEqual(before);
    // The unsaved change is still on screen and still queued, and saving it works.
    expect(get(app.state.settings).theme).toBe('light');
    expect(get(app.persistence.saveStatus).state).toBe('error');
    await app.persistence.retrySave();
    expect(get(app.persistence.saveStatus).state).toBe('saved');
    expect((await snapshot(V3_NAME)).stores.settings.theme).toBe('light');
  });

  it('after a write that was rolled back the application goes on with the state and the storage it had', async () => {
    const app = await startApp();
    app.state.settings.setTheme('light');
    await app.persistence.persistenceSettled();
    const file = await fileOf(app);
    const reload = vi.spyOn(app.state, 'initState');
    const [progressBefore, settingsBefore, vocabularyBefore] = [get(app.state.progress), get(app.state.settings), get(app.collections.userVocabulary)];
    const put = IDBObjectStore.prototype.put;
    let calls = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      calls += 1;
      if (calls === 9) throw new DOMException('synthetic failure', 'UnknownError');
      return put.apply(this, args);
    });

    const error = await refusal(app.restoreOwnSection(file));

    expect(error).toMatchObject({ code: 'write-failed', message: expect.stringContaining('nothing was changed') });
    expect(error?.message).not.toContain('Reload the page');
    // Nothing was loaded again, switched off or put back: every store still holds the very same value.
    expect(reload).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(get(app.state.progress)).toBe(progressBefore);
    expect(get(app.state.settings)).toBe(settingsBefore);
    expect(get(app.collections.userVocabulary)).toBe(vocabularyBefore);
    expect(get(app.persistence.saveStatus).state).toBe('saved');
    expect(app.state.stateHeld()).toBe(false);
    app.state.progress.toggleLearnedPhrase('phrase-learned-after-the-failed-attempt');
    await app.persistence.persistenceSettled();
    expect(get(app.persistence.saveStatus).state).toBe('saved');
    expect((await snapshot(V3_NAME)).stores.progress.learnedPhrases).toEqual(['phrase-learned-after-the-failed-attempt']);
  });

  it('after a refusal nothing of the running application is loaded again either: an Undo offer stays valid', async () => {
    const app = await startApp();
    app.state.progress.toggleLearnedPhrase('phrase-kept');
    const undo = app.state.progress.issueUndo({ type: 'learned', id: 'phrase-kept' });
    await app.persistence.persistenceSettled();
    const before = await snapshot(V3_NAME);
    const file = await fileOf(app);
    const reload = vi.spyOn(app.state, 'initState');
    const progressBefore = get(app.state.progress);

    const error = await refusal(app.restoreOwnSection(file));

    expect(error).toMatchObject({ code: 'not-empty' });
    expect(error?.message).toBe('This version already holds learning data in this browser. A recovery never overwrites data, so nothing was changed.');
    expect(reload).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(await snapshot(V3_NAME)).toEqual(before);
    expect(get(app.state.progress)).toBe(progressBefore);
    expect(get(app.persistence.saveStatus).state).toBe('saved');
    // Loading the state again would have ended every Undo offer. This one can still be used.
    expect(app.state.progress.redeemUndo(undo)).toBe(true);
  });
});

/** Fresh modules over the same browser storage: the page was reloaded. */
function loseModulesOnly(): void {
  vi.resetModules();
}
