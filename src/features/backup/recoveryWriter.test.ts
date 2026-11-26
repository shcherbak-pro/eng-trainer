import { openDB } from 'idb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetDatabase, watchUnhandledRejections } from '../../test/database';
import { describeExperimental } from '../../test/product';
import type { BackupFile, BackupSections, DatabaseSection, LegacySection } from './format';
import { SYNTHETIC_META, V1_STATE, V1_STATE_KEY, V1_THEME, V1_THEME_KEY, V2_NAME, V3_NAME, asPairs, bytesOf, databaseNames, seedExperimental, seedLegacy, seedStable, snapshot, syntheticStores, type Snapshot, type Stores } from './testing';

/**
 * The recovery writer for the stable product and for the first version
 * (ENG-V3-R1A-RC1). All data is made up.
 *
 * "Losing the browser storage" is a new, empty IndexedDB, an empty key-value storage and
 * fresh modules: nothing of the earlier session survives except the text of the file.
 */
const V3 = 'experimental-v3';
const V2 = 'stable-v2';
const V1 = 'legacy-v1';
const STORE_NAMES = ['progress', 'learnPasses', 'flashcardSessions', 'settings', 'userCollections', 'userEntries'];
/** Records of the made-up stable section. */
const RECORDS = 23;
/** Calls of `put` in one recovery of it: the guard's record first, then every record. */
const PUTS = RECORDS + 1;

/** The state that the first version writes when it is opened for the first time. */
const V1_DEFAULT = JSON.stringify({
  activePage: 'index', selectedLearnPassId: 'default',
  learnedPhrases: [], hiddenPhrases: [], hiddenWords: [], hiddenIrregular: [],
  favoriteBlocks: [], favoritePhrases: [], favoriteWords: [], favoriteIrregular: [],
  learnPasses: [], flashcardSessions: {}
});

async function load() {
  const [writer, destinations, exporter, validate, format, reader] = await Promise.all([
    import('./recoveryWriter'),
    import('./destinations'),
    import('./exportBackup'),
    import('./validate'),
    import('./format'),
    import('./snapshot')
  ]);
  return { ...writer, ...destinations, ...exporter, ...validate, ...format, reader };
}
type Modules = Awaited<ReturnType<typeof load>>;

function loseBrowserStorage(): void {
  resetDatabase();
  window.localStorage.clear();
  vi.resetModules();
}

const stableSection = (stores: Stores = syntheticStores(2)): DatabaseSection => ({ database: V2_NAME, schemaVersion: 2, stores: asPairs(stores) });
const legacySection = (records: LegacySection['records'] = { [V1_STATE_KEY]: V1_STATE, [V1_THEME_KEY]: V1_THEME }): LegacySection => ({ storage: 'localStorage', records });

/** A file with the given sections and matching digests, built without any storage. */
async function fileOf(modules: Modules, sections: BackupSections): Promise<BackupFile> {
  return (await modules.composeBackup(sections)).backup;
}
const stableFile = async (modules: Modules, stores?: Stores): Promise<BackupFile> => fileOf(modules, { [V2]: stableSection(stores) });
const legacyFile = async (modules: Modules, records?: LegacySection['records']): Promise<BackupFile> => fileOf(modules, { [V1]: legacySection(records) });

const refusal = (run: Promise<unknown>): Promise<{ code: string; message: string; product?: string } | null> => run.then(() => null, (error: { code: string; message: string; product?: string }) => error);

/** What the first version has in the key-value storage, and nothing of anything else. */
const legacyRecords = (): Record<string, string | null> => ({ state: window.localStorage.getItem(V1_STATE_KEY), theme: window.localStorage.getItem(V1_THEME_KEY) });

/** Makes call number `failing` of `put` throw. Returns the number of calls so far. */
function failPut(failing: number, error: () => unknown = () => new DOMException('synthetic failure', 'UnknownError')): () => number {
  const put = IDBObjectStore.prototype.put;
  let calls = 0;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
    calls += 1;
    if (calls === failing) throw error();
    return put.apply(this, args);
  });
  return () => calls;
}

beforeEach(() => {
  loseBrowserStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describeExperimental('recovery of all three products from one file, after the browser lost everything', () => {
  it('brings back the stable database and the two records of the first version exactly, from the file alone', async () => {
    await seedExperimental();
    await seedStable();
    seedLegacy();
    const source = await load();
    const { text } = await source.composeBackup((await source.collectSections()).sections);
    const original = await snapshot(V2_NAME);
    loseBrowserStorage();
    expect(await databaseNames()).toEqual([]);
    expect(window.localStorage.length).toBe(0);
    // The learner opened the stable version once: it created its own, empty storage.
    await seedStable({});

    const app = await load();
    const file = await app.readBackup(bytesOf(text));
    await app.restoreStableSection(file);
    await app.restoreLegacySection(file);

    expect(await snapshot(V2_NAME)).toEqual(original);
    expect(await snapshot(V2_NAME)).toEqual({ version: 2, stores: syntheticStores(2) });
    expect(legacyRecords()).toEqual({ state: V1_STATE, theme: V1_THEME });
    // The experimental product's part is not this writer's business: its database was not created.
    expect(await databaseNames()).toEqual([V2_NAME]);
    expect(window.localStorage.length).toBe(2);
  });
});

describeExperimental('stable section: a browser without the stable database', () => {
  it('refuses, creates nothing, and says that the stable version has to be opened once', async () => {
    const app = await load();
    const file = await stableFile(app);
    expect(await app.inspectStableDestination()).toEqual({ state: 'absent' });
    const open = vi.spyOn(indexedDB, 'open');
    const create = vi.spyOn(IDBDatabase.prototype, 'createObjectStore');

    const error = await refusal(app.restoreStableSection(file));

    expect(error).toMatchObject({ code: 'unavailable', product: V2 });
    expect(error?.message).toContain('The stable version has no storage for its data in this browser yet. It creates that storage when it is opened. Open the stable version once, then try again. Nothing was changed.');
    // The only request names no version: it could not create a database, and the creation it started was cancelled.
    expect(open.mock.calls).toEqual([[V2_NAME]]);
    expect(create).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(await databaseNames()).toEqual([]);
  });

  it('recovers once the stable product has created its storage: six plain stores at version 2, as it left them', async () => {
    const app = await load();
    const file = await stableFile(app);
    expect(await refusal(app.restoreStableSection(file))).toMatchObject({ code: 'unavailable' });
    await seedStable({});

    await app.restoreStableSection(file);

    const database = await openDB(V2_NAME);
    expect(database.version).toBe(2);
    expect([...database.objectStoreNames].sort()).toEqual([...STORE_NAMES].sort());
    const transaction = database.transaction(STORE_NAMES, 'readonly');
    for (const name of STORE_NAMES) {
      const store = transaction.objectStore(name);
      expect([store.keyPath, store.autoIncrement, [...store.indexNames]], name).toEqual([null, false, []]);
    }
    await transaction.done;
    database.close();
    expect((await snapshot(V2_NAME)).stores).toEqual(syntheticStores(2));
  });
});

describeExperimental('stable section: into the database that the stable product left', () => {
  /** The stable database after a first start and a reset: lists that are empty, and preferences. */
  async function emptyProfile(): Promise<Snapshot> {
    await seedStable({ progress: { learnedPhrases: [], favoriteBlocks: [] }, settings: { theme: 'light', wordPageSize: 20, activePage: 'words' } });
    return snapshot(V2_NAME);
  }

  it('writes every record in one transaction and replaces the preferences, without a versioned open', async () => {
    const before = await emptyProfile();
    const app = await load();
    const file = await stableFile(app);
    expect(await app.inspectStableDestination()).toEqual({ state: 'empty' });
    const open = vi.spyOn(indexedDB, 'open');
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');

    await app.restoreStableSection(file);

    expect(open.mock.calls.every(([name, version]) => name === V2_NAME && version === undefined)).toBe(true);
    expect(transactions.mock.calls.map(([, mode]) => mode).filter((mode) => mode === 'readwrite')).toHaveLength(1);
    const after = await snapshot(V2_NAME);
    expect(after).toEqual({ version: 2, stores: syntheticStores(2) });
    // A preference that only the destination had is gone: the stores are those of the backup, exactly.
    expect(before.stores.settings.wordPageSize).toBe(20);
    expect(Object.keys(after.stores.settings)).toEqual(Object.keys(syntheticStores(2).settings));
  });

  it('keeps every identity: entries, the collection, the Learn pass, deck keys and positions', async () => {
    await emptyProfile();
    const app = await load();
    await app.restoreStableSection(await stableFile(app));

    const { stores } = await snapshot(V2_NAME);
    const expected = syntheticStores(2);
    for (const name of STORE_NAMES) expect(Object.keys(stores[name]), name).toEqual(Object.keys(expected[name]).sort());
    expect(stores.flashcardSessions.all).toEqual({ order: ['phrase-207', 'user:22222222-0000-4000-8000-000000000000:entry:00000001-0000-4000-8000-000000000002', 'phrase-208'], index: 1 });
    expect(stores.progress.selectedLearnPassId).toBe('pass-synthetic-2');
  });

  it('opens the fixed database only, never with a version, creates no store and touches no key-value record', async () => {
    await emptyProfile();
    const app = await load();
    const file = await stableFile(app);
    const open = vi.spyOn(indexedDB, 'open');
    const create = vi.spyOn(IDBDatabase.prototype, 'createObjectStore');
    const removal = vi.spyOn(indexedDB, 'deleteDatabase');
    const storage = [vi.spyOn(Storage.prototype, 'getItem'), vi.spyOn(Storage.prototype, 'setItem'), vi.spyOn(Storage.prototype, 'removeItem'), vi.spyOn(Storage.prototype, 'clear')];

    await app.restoreStableSection(file);

    expect(open.mock.calls.length).toBeGreaterThan(0);
    expect(open.mock.calls.every((call) => call.length === 1 && call[0] === V2_NAME)).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(removal).not.toHaveBeenCalled();
    for (const spy of storage) expect(spy).not.toHaveBeenCalled();
  });

  it('uses a guard whose record is an empty list of learned phrases, and leaves no other trace of it', async () => {
    await seedStable({});
    const app = await load();
    expect([app.GUARD_STORE, app.GUARD_KEY]).toEqual(['progress', 'learnedPhrases']);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    const add = vi.spyOn(IDBObjectStore.prototype, 'add');

    await app.restoreStableSection(await stableFile(app));

    expect([(put.mock.contexts[0] as IDBObjectStore).name, ...put.mock.calls[0]]).toEqual(['progress', [], 'learnedPhrases']);
    expect(add.mock.calls).toEqual([[[], 'learnedPhrases']]);
    expect((add.mock.contexts[0] as IDBObjectStore).name).toBe('progress');
    vi.restoreAllMocks();
    expect((await snapshot(V2_NAME)).stores).toEqual(syntheticStores(2));
  });

  // The one moment that the guard cannot cover is the one between its own two requests. What is
  // committed then is the guard's record alone, and that record is valid and empty.
  it('leaves a valid, empty profile when the script stops between the two requests of the guard', async () => {
    await seedStable({});
    const app = await load();
    const file = await stableFile(app);
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(() => { throw new Error('the script stopped here'); });
    vi.spyOn(IDBTransaction.prototype, 'abort').mockImplementation(() => { throw new Error('the rollback of the script never ran'); });

    expect(await refusal(app.restoreStableSection(file))).toMatchObject({ code: 'write-failed' });
    vi.restoreAllMocks();

    const after = await snapshot(V2_NAME);
    expect(after.stores).toEqual({ progress: { learnedPhrases: [] }, learnPasses: {}, flashcardSessions: {}, settings: {}, userCollections: {}, userEntries: {} });
    // It is a profile that the stable product could have written itself: every check of a backup accepts it.
    expect(() => app.checkSection(V2, stableSection(after.stores))).not.toThrow();
    expect(await app.inspectStableDestination()).toEqual({ state: 'empty' });
    await app.restoreStableSection(file);
    expect((await snapshot(V2_NAME)).stores).toEqual(syntheticStores(2));
  });

  it('judges the destination inside the one transaction that writes, before the first write', async () => {
    await emptyProfile();
    const app = await load();
    const file = await stableFile(app);
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const reads = [vi.spyOn(IDBObjectStore.prototype, 'getAll'), vi.spyOn(IDBObjectStore.prototype, 'getAllKeys')];
    const writes = [vi.spyOn(IDBObjectStore.prototype, 'clear'), vi.spyOn(IDBObjectStore.prototype, 'put'), vi.spyOn(IDBObjectStore.prototype, 'add')];

    await app.restoreStableSection(file);

    const writing = transactions.mock.results.map((result) => result.value as IDBTransaction).filter((transaction) => transaction.mode === 'readwrite');
    expect(writing).toHaveLength(1);
    expect(writing[0].db.name).toBe(V2_NAME);
    const order = (spies: { mock: { invocationCallOrder: number[]; contexts: unknown[] } }[]): number[] => spies.flatMap((spy) => spy.mock.invocationCallOrder.filter((_, index) => (spy.mock.contexts[index] as IDBObjectStore).transaction === writing[0]));
    // Six stores are read (keys and values) in the writing transaction, and all of that precedes every write.
    expect(order(reads)).toHaveLength(12);
    // Six stores are cleared, the guard is written and then added once more, and every record is written.
    expect(order(writes)).toHaveLength(6 + PUTS + 1);
    expect(Math.max(...order(reads))).toBeLessThan(Math.min(...order(writes)));
    for (const spy of writes) for (const context of spy.mock.contexts) expect((context as IDBObjectStore).transaction).toBe(writing[0]);
  });

  const occupied: [string, Stores, string][] = [
    ['a learned item', { progress: { learnedPhrases: ['phrase-kept'] } }, '1 learned, hidden or Focus item'],
    ['a Learn pass', { learnPasses: syntheticStores(3).learnPasses }, '1 Learn pass'],
    ['a selected Learn pass', { progress: { selectedLearnPassId: 'pass-kept' } }, '1 other progress record'],
    ['a flashcard deck with a saved place', { flashcardSessions: { all: { order: ['phrase-kept'], index: 0 } } }, '1 flashcard deck with a saved place'],
    ['an imported collection', { userCollections: syntheticStores(3).userCollections, userEntries: syntheticStores(3).userEntries }, '1 imported collection'],
    ['imported entries without their collection', { userEntries: syntheticStores(3).userEntries }, '2 imported entries']
  ];

  it.each(occupied)('refuses a destination that holds %s, and changes nothing', async (_name, stores, holds) => {
    await seedStable({ settings: { theme: 'light' }, ...stores });
    const before = await snapshot(V2_NAME);
    const app = await load();

    expect(await app.inspectStableDestination()).toEqual({ state: 'occupied', holds: [holds] });
    const error = await refusal(app.restoreStableSection(await stableFile(app)));

    expect(error).toMatchObject({ code: 'not-empty', product: V2, message: expect.stringContaining('never overwrites data, so nothing was changed') });
    expect(await snapshot(V2_NAME)).toEqual(before);
  });

  it('refuses a second recovery: the first one filled the destination', async () => {
    await emptyProfile();
    const app = await load();
    const file = await stableFile(app);
    await app.restoreStableSection(file);
    const before = await snapshot(V2_NAME);

    expect(await refusal(app.restoreStableSection(file))).toMatchObject({ code: 'not-empty' });
    expect(await snapshot(V2_NAME)).toEqual(before);
  });

  it('refuses when learning data appeared after the preview, as from a tab of the stable product', async () => {
    await emptyProfile();
    const app = await load();
    const file = await stableFile(app);
    expect(await app.inspectStableDestination()).toEqual({ state: 'empty' });

    const otherTab = await openDB(V2_NAME);
    await otherTab.put('progress', ['phrase-learned-in-another-tab'], 'learnedPhrases');
    otherTab.close();
    const before = await snapshot(V2_NAME);

    expect(await refusal(app.restoreStableSection(file))).toMatchObject({ code: 'not-empty' });
    expect(await snapshot(V2_NAME)).toEqual(before);
  });

  it.each([1, 2, 13, PUTS])('rolls everything back when write number %i fails', async (failing) => {
    const before = await emptyProfile();
    const app = await load();
    const file = await stableFile(app);
    const observed = watchUnhandledRejections();
    const calls = failPut(failing);

    const error = await refusal(app.restoreStableSection(file));
    vi.restoreAllMocks();

    expect(error).toMatchObject({ code: 'write-failed', message: expect.stringContaining('nothing was changed') });
    expect(calls()).toBe(failing);
    expect(await snapshot(V2_NAME)).toEqual(before);
    expect(await observed.stop()).toEqual([]);
  });

  it.each([2, 3, 12, PUTS])('commits nothing when the script stops at write number %i and never gets to roll back', async (stopping) => {
    const before = await emptyProfile();
    const app = await load();
    const file = await stableFile(app);
    const observed = watchUnhandledRejections();
    const calls = failPut(stopping, () => new Error('the script stopped here'));
    const rollback = vi.spyOn(IDBTransaction.prototype, 'abort').mockImplementation(() => { throw new Error('the rollback of the script never ran'); });

    const error = await refusal(app.restoreStableSection(file));
    expect(rollback).toHaveBeenCalled();
    vi.restoreAllMocks();

    expect(error).toMatchObject({ code: 'write-failed' });
    expect(calls()).toBe(stopping);
    expect(await snapshot(V2_NAME)).toEqual(before);
    expect(await app.inspectStableDestination()).toEqual({ state: 'empty' });
    expect(await observed.stop()).toEqual([]);
  });

  it('rolls everything back when the transaction is aborted after every write was accepted', async () => {
    const before = await emptyProfile();
    const app = await load();
    const file = await stableFile(app);
    const put = IDBObjectStore.prototype.put;
    let calls = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      const request = put.apply(this, args);
      calls += 1;
      if (calls === PUTS) {
        const transaction = this.transaction;
        request.addEventListener('success', () => transaction.abort());
      }
      return request;
    });

    const error = await refusal(app.restoreStableSection(file));
    vi.restoreAllMocks();

    expect(error).toMatchObject({ code: 'write-failed' });
    expect(await snapshot(V2_NAME)).toEqual(before);
  });

  it('writes nothing in a browser that would accept the guard\'s key twice', async () => {
    const before = await emptyProfile();
    const app = await load();
    const file = await stableFile(app);
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      return IDBObjectStore.prototype.put.call(this, value, key);
    });

    expect(await refusal(app.restoreStableSection(file))).toMatchObject({ code: 'write-failed' });
    vi.restoreAllMocks();
    expect(await snapshot(V2_NAME)).toEqual(before);
  });

  it('completes on the next attempt after a failed one', async () => {
    await emptyProfile();
    const app = await load();
    const file = await stableFile(app);
    failPut(7);
    expect(await refusal(app.restoreStableSection(file))).toMatchObject({ code: 'write-failed' });
    vi.restoreAllMocks();

    await app.restoreStableSection(file);

    expect(await snapshot(V2_NAME)).toEqual({ version: 2, stores: syntheticStores(2) });
  });

  it('says that the storage is full when the browser refuses the data for that reason', async () => {
    const before = await emptyProfile();
    const app = await load();
    const file = await stableFile(app);
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('synthetic quota', 'QuotaExceededError'); });

    const error = await refusal(app.restoreStableSection(file));
    vi.restoreAllMocks();

    expect(error).toMatchObject({ code: 'write-failed', message: expect.stringContaining('its storage for this site is full. Nothing was changed.') });
    expect(await snapshot(V2_NAME)).toEqual(before);
  });

  it('does not report a recovery when the database does not hold what the file holds', async () => {
    await emptyProfile();
    const app = await load();
    const file = await stableFile(app);
    const put = IDBObjectStore.prototype.put;
    // The storage keeps another value than it was given: a fault that only a read-back can see.
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      return put.call(this, key === 'learnedPhrases' ? ['phrase-kept-wrongly'] : value, key);
    });

    const error = await refusal(app.restoreStableSection(file));
    vi.restoreAllMocks();

    expect(error).toMatchObject({ code: 'verification', product: V2, message: expect.stringContaining('reading it back gave another result') });
  });
});

describeExperimental('stable section: after the transaction has completed (ENG-V3-R1A-RC2)', () => {
  it('reports a rejected read-back as written but not checked, never as nothing recovered: the data is in the stable database', async () => {
    await seedStable({ settings: { theme: 'light' } });
    const app = await load();
    const file = await stableFile(app);
    // The fault of the review: the first listing of the databases after the commit is refused, once.
    const listing = vi.spyOn(indexedDB, 'databases').mockRejectedValueOnce(new DOMException('Injected post-commit read failure', 'UnknownError'));

    const error = await refusal(app.restoreStableSection(file));

    expect(listing).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ code: 'verification', product: V2 });
    expect(error?.message).toContain('The data of the stable version was written, but it could not be read back to check it.');
    expect(error?.message).toContain('Injected post-commit read failure');
    expect(error?.message).toContain('Do not reset anything because of this message. Check again here, or open the stable version and look at your data.');
    expect(error?.message).not.toMatch(/nothing was (?:changed|recovered)/i);
    vi.restoreAllMocks();
    expect(await snapshot(V2_NAME)).toEqual({ version: 2, stores: syntheticStores(2) });
    // Looked at again, from the file alone, the stable database is seen to hold exactly its data.
    expect(await app.inspectStableDestination(file.integrity.sections[V2])).toEqual({ state: 'identical' });
  });

  it('reports a digest that cannot be computed after the commit in the same way', async () => {
    await seedStable({});
    const app = await load();
    const file = await stableFile(app);
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let calls = 0;
    // The file's own digest is computed first. The second computation is the one of the read-back.
    vi.spyOn(crypto.subtle, 'digest').mockImplementation((...args: Parameters<SubtleCrypto['digest']>) => {
      calls += 1;
      return calls === 2 ? Promise.reject(new DOMException('synthetic digest failure', 'OperationError')) : digest(...args);
    });

    const error = await refusal(app.restoreStableSection(file));
    vi.restoreAllMocks();

    expect(calls).toBe(2);
    expect(error).toMatchObject({ code: 'verification', product: V2 });
    expect(error?.message).toContain('could not be read back to check it');
    expect(await snapshot(V2_NAME)).toEqual({ version: 2, stores: syntheticStores(2) });
  });

  it('keeps the name of a failure before the commit: a write that was rolled back is not "written"', async () => {
    await seedStable({});
    const app = await load();
    const file = await stableFile(app);
    failPut(5);

    const error = await refusal(app.restoreStableSection(file));
    vi.restoreAllMocks();

    expect(error).toMatchObject({ code: 'write-failed', message: expect.stringContaining('nothing was changed') });
    expect((await snapshot(V2_NAME)).stores.progress).toEqual({});
  });
});

describeExperimental('stable section: schemas that are left alone', () => {
  const schemas: [string, number, string[]][] = [
    ['a newer version', 3, STORE_NAMES],
    ['the older version 1 with four stores', 1, ['progress', 'learnPasses', 'flashcardSessions', 'settings']],
    ['version 2 with one more store', 2, [...STORE_NAMES, 'meta']],
    ['version 2 without a store', 2, STORE_NAMES.slice(0, 5)]
  ];

  it.each(schemas)('refuses %s: never written, never upgraded', async (_name, version, stores) => {
    await seedStable({ settings: { theme: 'light' } }, version, stores);
    const before = await snapshot(V2_NAME);
    const app = await load();
    const open = vi.spyOn(indexedDB, 'open');
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');

    const error = await refusal(app.restoreStableSection(await stableFile(app)));

    expect(error).toMatchObject({ code: 'unsupported-version', product: V2, message: expect.stringContaining('Nothing was changed.') });
    // The database is opened as it is. No request names a version, so no upgrade can start.
    expect(open.mock.calls.every(([, version]) => version === undefined)).toBe(true);
    expect(transactions.mock.calls.filter(([, mode]) => mode === 'readwrite')).toEqual([]);
    vi.restoreAllMocks();
    expect(await snapshot(V2_NAME)).toEqual(before);
  });

});

describeExperimental('stable section: what is refused before the storage is touched', () => {
  it('refuses a file without the section, a section that fails its digest, a record that is not acceptable and another product\'s data', async () => {
    const app = await load();
    const open = vi.spyOn(indexedDB, 'open');
    const good = await stableFile(app);

    const without = await fileOf(app, { [V1]: legacySection() });
    expect(await refusal(app.restoreStableSection(without))).toMatchObject({ code: 'malformed', message: expect.stringContaining('holds no data of the stable version') });

    const changed = structuredClone(good);
    changed.sections[V2]!.stores.progress[0][1] = ['phrase-changed-after-the-digest'];
    expect(await refusal(app.restoreStableSection(changed))).toMatchObject({ code: 'integrity' });

    const odd = syntheticStores(2);
    odd.settings.theme = 'purple';
    const invalid = structuredClone(good);
    invalid.sections[V2] = stableSection(odd);
    invalid.integrity.sections[V2] = await app.sectionDigest(invalid.sections[V2]!);
    expect(await refusal(app.restoreStableSection(invalid))).toMatchObject({ code: 'invalid-record' });

    // The experimental product's section under the stable product's name is not the stable product's data.
    const disguised = structuredClone(good);
    disguised.sections[V2] = { database: V3_NAME, schemaVersion: 1, stores: asPairs({ ...syntheticStores(3), meta: SYNTHETIC_META }) };
    disguised.integrity.sections[V2] = await app.sectionDigest(disguised.sections[V2]!);
    expect(await refusal(app.restoreStableSection(disguised))).toMatchObject({ code: 'malformed', message: expect.stringContaining('names the storage "eng-trainer-v3", not "eng-trainer-v2"') });

    expect(open).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(await databaseNames()).toEqual([]);
  });

  it('leaves the experimental product\'s database and the first version\'s records exactly as they are', async () => {
    await seedExperimental();
    await seedStable({});
    seedLegacy('{"learnedPhrases":["phrase-v1-on-this-device"]}', 'light');
    const own = await snapshot(V3_NAME);
    const app = await load();

    await app.restoreStableSection(await stableFile(app));

    expect(await snapshot(V3_NAME)).toEqual(own);
    expect(legacyRecords()).toEqual({ state: '{"learnedPhrases":["phrase-v1-on-this-device"]}', theme: 'light' });
    expect(window.localStorage.length).toBe(2);
  });
});

describeExperimental('section of the first version: the two records', () => {
  it('writes the state, reads it back, then the theme, reads it back, and proves both once more', async () => {
    const app = await load();
    const file = await legacyFile(app);
    const calls: string[] = [];
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) { calls.push(`get ${key}`); return getItem.call(this, key); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) { calls.push(`set ${key}`); setItem.call(this, key, value); });
    const others = [vi.spyOn(Storage.prototype, 'removeItem'), vi.spyOn(Storage.prototype, 'clear'), vi.spyOn(Storage.prototype, 'key')];
    const open = vi.spyOn(indexedDB, 'open');

    await app.restoreLegacySection(file);
    vi.restoreAllMocks();

    expect(calls).toEqual([
      `get ${V1_STATE_KEY}`, `get ${V1_THEME_KEY}`,
      `set ${V1_STATE_KEY}`, `get ${V1_STATE_KEY}`,
      `set ${V1_THEME_KEY}`, `get ${V1_THEME_KEY}`,
      `get ${V1_STATE_KEY}`, `get ${V1_THEME_KEY}`
    ]);
    for (const spy of others) expect(spy).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(legacyRecords()).toEqual({ state: V1_STATE, theme: V1_THEME });
    expect(window.localStorage.length).toBe(2);
  });

  it('keeps the text of the state exactly, with a member that this application does not know', async () => {
    const app = await load();
    expect(V1_STATE).toContain('unknownMemberOfAnOlderBuild');
    await app.restoreLegacySection(await legacyFile(app));
    expect(window.localStorage.getItem(V1_STATE_KEY)).toBe(V1_STATE);
  });

  it('writes over the records of a first start, and leaves every other record of the origin alone', async () => {
    seedLegacy(V1_DEFAULT, 'system');
    window.localStorage.setItem('another.application', 'kept');
    const app = await load();
    expect(app.inspectLegacyDestination(legacySection())).toEqual({ state: 'empty', writes: [V1_STATE_KEY, V1_THEME_KEY] });

    await app.restoreLegacySection(await legacyFile(app));

    expect(legacyRecords()).toEqual({ state: V1_STATE, theme: V1_THEME });
    expect(window.localStorage.getItem('another.application')).toBe('kept');
    expect(window.localStorage.length).toBe(3);
  });

  it('writes a section without a theme, and leaves the theme of this browser as it is', async () => {
    seedLegacy(V1_DEFAULT, 'light');
    const app = await load();
    await app.restoreLegacySection(await legacyFile(app, { [V1_STATE_KEY]: V1_STATE }));
    expect(legacyRecords()).toEqual({ state: V1_STATE, theme: 'light' });
  });

  const occupied: [string, string][] = [
    ['a learned phrase', '{"learnedPhrases":["phrase-kept"]}'],
    ['a Learn pass', '{"learnPasses":[{"id":"pass-kept","name":"Kept"}]}'],
    ['a flashcard deck with a saved place', '{"flashcardSessions":{"all":{"order":["phrase-kept"],"index":0}}}'],
    ['a selected Learn pass', '{"selectedLearnPassId":"pass-kept"}'],
    ['a list of an unknown form', '{"hiddenWords":"word-kept"}']
  ];

  it.each(occupied)('refuses a storage that holds %s, and changes nothing', async (_name, state) => {
    seedLegacy(state, 'light');
    const app = await load();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    const error = await refusal(app.restoreLegacySection(await legacyFile(app)));

    expect(error).toMatchObject({ code: 'not-empty', product: V1, message: expect.stringContaining('never overwrites data, so nothing was changed') });
    expect(setItem).not.toHaveBeenCalled();
    expect(legacyRecords()).toEqual({ state, theme: 'light' });
  });

  it.each(['not JSON', '[]', ''])('refuses a storage whose state is the unreadable text %j, and changes nothing', async (state) => {
    seedLegacy(state, 'light');
    const app = await load();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    const error = await refusal(app.restoreLegacySection(await legacyFile(app)));

    expect(error).toMatchObject({ code: 'unavailable', message: expect.stringContaining('Nothing was changed.') });
    expect(setItem).not.toHaveBeenCalled();
    expect(legacyRecords()).toEqual({ state, theme: 'light' });
  });

  it('refuses when the storage cannot be read, and writes nothing', async () => {
    const app = await load();
    const file = await legacyFile(app);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('synthetic refusal', 'SecurityError'); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    const error = await refusal(app.restoreLegacySection(file));

    expect(error).toMatchObject({ code: 'unavailable', product: V1, message: expect.stringContaining('could not be read, so nothing was changed.') });
    expect(error?.message).toContain('synthetic refusal');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('has nothing to write when both records are already those of the backup', async () => {
    seedLegacy();
    const app = await load();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await app.restoreLegacySection(await legacyFile(app));
    expect(setItem).not.toHaveBeenCalled();
    expect(legacyRecords()).toEqual({ state: V1_STATE, theme: V1_THEME });
  });

  it('refuses a file without the section, a section that fails its digest and a record that is not acceptable, before it reads the storage', async () => {
    const app = await load();
    const storage = [vi.spyOn(Storage.prototype, 'getItem'), vi.spyOn(Storage.prototype, 'setItem')];
    const good = await legacyFile(app);

    expect(await refusal(app.restoreLegacySection(await stableFile(app)))).toMatchObject({ code: 'malformed', message: expect.stringContaining('holds no data of the previous version (v1)') });

    const changed = structuredClone(good);
    changed.sections[V1]!.records[V1_THEME_KEY] = 'light';
    expect(await refusal(app.restoreLegacySection(changed))).toMatchObject({ code: 'integrity' });

    const invalid = structuredClone(good);
    invalid.sections[V1] = legacySection({ [V1_STATE_KEY]: '[]', [V1_THEME_KEY]: 'dark' });
    invalid.integrity.sections[V1] = await app.sectionDigest(invalid.sections[V1]!);
    expect(await refusal(app.restoreLegacySection(invalid))).toMatchObject({ code: 'invalid-record' });

    for (const spy of storage) expect(spy).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
  });
});

describeExperimental('section of the first version: a recovery that stops between the two records', () => {
  /** Makes the write of one record throw, as a full or refused storage does. Returns the keys that were written. */
  function failWriteOf(failingKey: string, error: () => unknown = () => new DOMException('synthetic failure', 'UnknownError')): string[] {
    const setItem = Storage.prototype.setItem;
    const written: string[] = [];
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === failingKey) throw error();
      setItem.call(this, key, value);
      written.push(key);
    });
    return written;
  }

  it('changes nothing when the state cannot be written: the theme is not attempted', async () => {
    seedLegacy(V1_DEFAULT, 'system');
    const app = await load();
    const file = await legacyFile(app);
    const written = failWriteOf(V1_STATE_KEY);

    const error = await refusal(app.restoreLegacySection(file));
    vi.restoreAllMocks();

    expect(error).toMatchObject({ code: 'write-failed', product: V1, message: expect.stringContaining('The learning data of the previous version (v1) could not be written, and nothing was changed.') });
    expect(error?.message).toContain('synthetic failure');
    expect(written).toEqual([]);
    expect(legacyRecords()).toEqual({ state: V1_DEFAULT, theme: 'system' });
  });

  it('reports an incomplete recovery, never a success, when the theme cannot be written after the state', async () => {
    seedLegacy(V1_DEFAULT, 'system');
    const app = await load();
    const file = await legacyFile(app);
    const written = failWriteOf(V1_THEME_KEY);

    const error = await refusal(app.restoreLegacySection(file));
    vi.restoreAllMocks();

    expect(error).toMatchObject({ code: 'partial', product: V1 });
    expect(error?.message).toContain('The recovery of the previous version (v1) is not complete. Its learning data is in this browser and was checked. Its theme could not be written.');
    expect(error?.message).toContain('synthetic failure');
    expect(written).toEqual([V1_STATE_KEY]);
    // The learning data is the backup's. The theme is the one that was here.
    expect(legacyRecords()).toEqual({ state: V1_STATE, theme: 'system' });
    expect(app.inspectLegacyDestination(legacySection())).toEqual({ state: 'partial', writes: [V1_THEME_KEY] });
  });

  it('says that the storage is full when that is why the theme was not written', async () => {
    const app = await load();
    const file = await legacyFile(app);
    failWriteOf(V1_THEME_KEY, () => new DOMException('synthetic quota', 'QuotaExceededError'));

    const error = await refusal(app.restoreLegacySection(file));
    vi.restoreAllMocks();

    expect(error).toMatchObject({ code: 'partial', message: expect.stringContaining('Its theme could not be written. The browser refused to store it: its storage for this site is full.') });
    expect(legacyRecords()).toEqual({ state: V1_STATE, theme: null });
  });

  it('completes the recovery later by writing the theme only: the state is proven unchanged and is not written again', async () => {
    const app = await load();
    const file = await legacyFile(app);
    failWriteOf(V1_THEME_KEY);
    expect(await refusal(app.restoreLegacySection(file))).toMatchObject({ code: 'partial' });
    vi.restoreAllMocks();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    await app.restoreLegacySection(file);

    expect(setItem.mock.calls).toEqual([[V1_THEME_KEY, V1_THEME]]);
    expect(legacyRecords()).toEqual({ state: V1_STATE, theme: V1_THEME });
  });

  it('completes it from the file alone after the page was closed between the two writes', async () => {
    // What a closed tab leaves: the state of the backup, and no theme. Nothing else survives.
    window.localStorage.setItem(V1_STATE_KEY, V1_STATE);
    vi.resetModules();
    const app = await load();
    const file = await app.readBackup(bytesOf((await app.composeBackup({ [V1]: legacySection() })).text));
    expect(app.inspectLegacyDestination(file.sections[V1]!)).toEqual({ state: 'partial', writes: [V1_THEME_KEY] });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    await app.restoreLegacySection(file);

    expect(setItem.mock.calls).toEqual([[V1_THEME_KEY, V1_THEME]]);
    expect(legacyRecords()).toEqual({ state: V1_STATE, theme: V1_THEME });
  });

  it('still reports an incomplete recovery when the completion fails too, and leaves the learning data alone', async () => {
    window.localStorage.setItem(V1_STATE_KEY, V1_STATE);
    const app = await load();
    const file = await legacyFile(app);
    const written = failWriteOf(V1_THEME_KEY);

    const error = await refusal(app.restoreLegacySection(file));
    vi.restoreAllMocks();

    expect(error).toMatchObject({ code: 'partial' });
    expect(written).toEqual([]);
    expect(legacyRecords()).toEqual({ state: V1_STATE, theme: null });
  });

  it('refuses to complete when the learning data was changed after it was recovered, and writes nothing', async () => {
    const app = await load();
    const file = await legacyFile(app);
    failWriteOf(V1_THEME_KEY);
    expect(await refusal(app.restoreLegacySection(file))).toMatchObject({ code: 'partial' });
    vi.restoreAllMocks();
    // The first version was opened and used: it saved its state again, with one more learned phrase.
    const used = JSON.stringify({ ...JSON.parse(V1_STATE), learnedPhrases: ['phrase-101', 'phrase-102', 'phrase-learned-since'] });
    window.localStorage.setItem(V1_STATE_KEY, used);
    window.localStorage.setItem(V1_THEME_KEY, 'system');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    const error = await refusal(app.restoreLegacySection(file));

    expect(error).toMatchObject({ code: 'not-empty' });
    expect(setItem).not.toHaveBeenCalled();
    expect(legacyRecords()).toEqual({ state: used, theme: 'system' });
  });

  it('does not report a recovery when a record does not read back as it was written', async () => {
    const app = await load();
    const file = await legacyFile(app);
    const setItem = Storage.prototype.setItem;
    // The storage keeps another text than it was given: a fault that only a read-back can see.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      setItem.call(this, key, key === V1_STATE_KEY ? `${value} ` : value);
    });

    const error = await refusal(app.restoreLegacySection(file));
    vi.restoreAllMocks();

    expect(error).toMatchObject({ code: 'verification', product: V1, message: expect.stringContaining('learning data of the previous version (v1) was written, but reading it back gave another result') });
    // The theme was not attempted after the state failed its check.
    expect(window.localStorage.getItem(V1_THEME_KEY)).toBeNull();
  });

  it('does not report a recovery when the state changed while the theme was written', async () => {
    const app = await load();
    const file = await legacyFile(app);
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      setItem.call(this, key, value);
      // A tab of the first version saves its own state at this moment.
      if (key === V1_THEME_KEY) setItem.call(this, V1_STATE_KEY, V1_DEFAULT);
    });

    const error = await refusal(app.restoreLegacySection(file));
    vi.restoreAllMocks();

    expect(error).toMatchObject({ code: 'verification' });
  });

  it('leaves the stable database and the experimental database exactly as they are', async () => {
    await seedExperimental();
    await seedStable();
    const before = [await snapshot(V3_NAME), await snapshot(V2_NAME)];
    const app = await load();
    const open = vi.spyOn(indexedDB, 'open');

    await app.restoreLegacySection(await legacyFile(app));

    expect(open).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect([await snapshot(V3_NAME), await snapshot(V2_NAME)]).toEqual(before);
  });
});
