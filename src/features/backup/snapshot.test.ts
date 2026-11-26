import { openDB } from 'idb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { abortReadTransactions, resetDatabase, watchUnhandledRejections } from '../../test/database';
import { describeExperimental } from '../../test/product';
import { STORE_NAMES } from '../../storage/database';
import { DATABASE_SCHEMAS } from './format';
import { legacyTheme } from './summary';
import { readLegacyRecords } from './legacyStorage';
import { openExistingDatabase, readDatabaseSnapshot } from './snapshot';
import { SYNTHETIC_META, V1_STATE, V1_STATE_KEY, V1_THEME, V1_THEME_KEY, V2_NAME, V3_NAME, asPairs, databaseNames, seedExperimental, seedLegacy, seedStable, snapshot, syntheticStores } from './testing';

/**
 * The two read-only readers of the backup (ENG-V3-R1A): a database snapshot, and the two
 * records of the first version. Each test proves what was read and that nothing changed.
 */
const STABLE = DATABASE_SCHEMAS['stable-v2'];
const EXPERIMENTAL = DATABASE_SCHEMAS['experimental-v3'];

/** Every transaction mode that was asked of any database connection. */
function transactionModes(): { modes: () => string[] } {
  const spy = vi.spyOn(IDBDatabase.prototype, 'transaction');
  return { modes: () => spy.mock.calls.map(([, mode]) => mode ?? 'readonly') };
}

beforeEach(() => {
  resetDatabase();
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describeExperimental('database snapshot: a database that does not exist', () => {
  it('reports it as absent without opening it, where the browser lists its databases', async () => {
    const open = vi.spyOn(indexedDB, 'open');
    expect(await readDatabaseSnapshot(STABLE)).toEqual({ state: 'absent' });
    expect(open).not.toHaveBeenCalled();
    expect(await databaseNames()).toEqual([]);
  });

  it('reports it as absent and leaves nothing behind where the browser cannot list its databases', async () => {
    const list = indexedDB.databases.bind(indexedDB);
    Object.defineProperty(indexedDB, 'databases', { value: undefined, configurable: true });
    const observed = watchUnhandledRejections();

    expect(await readDatabaseSnapshot(STABLE)).toEqual({ state: 'absent' });
    expect(await openExistingDatabase(V2_NAME)).toBeNull();

    expect(await observed.stop()).toEqual([]);
    // The creation that the open request started was cancelled: there is no database, also not an empty one.
    expect((await list()).map((entry) => entry.name)).toEqual([]);
  });

  it('does not create the stable database next to an existing experimental one', async () => {
    await seedExperimental();
    expect(await readDatabaseSnapshot(STABLE)).toEqual({ state: 'absent' });
    expect(await databaseNames()).toEqual([V3_NAME]);
  });
});

describeExperimental('database snapshot: reading', () => {
  it('reads all six stores of the stable database as sorted pairs, deeply equal to what was saved', async () => {
    const stores = syntheticStores(2);
    await seedStable(stores);
    const read = await readDatabaseSnapshot(STABLE);
    expect(read).toEqual({ state: 'ok', version: 2, stores: asPairs(stores) });
    if (read.state !== 'ok') return;
    expect(Object.keys(read.stores)).toEqual([...STORE_NAMES]);
    for (const pairs of Object.values(read.stores)) expect(pairs.map(([key]) => key)).toEqual(pairs.map(([key]) => key).sort());
  });

  it('reads the six stores and meta of the experimental database', async () => {
    const stores = syntheticStores(3);
    await seedExperimental(stores);
    expect(await readDatabaseSnapshot(EXPERIMENTAL)).toEqual({ state: 'ok', version: 1, stores: asPairs({ ...stores, meta: SYNTHETIC_META }) });
  });

  it('opens the database without a version, uses read-only transactions only, and changes nothing', async () => {
    await seedStable();
    const before = await snapshot(V2_NAME);
    const open = vi.spyOn(indexedDB, 'open');
    const { modes } = transactionModes();
    const writes = [vi.spyOn(IDBObjectStore.prototype, 'put'), vi.spyOn(IDBObjectStore.prototype, 'add'), vi.spyOn(IDBObjectStore.prototype, 'delete'), vi.spyOn(IDBObjectStore.prototype, 'clear')];
    const structure = [vi.spyOn(IDBDatabase.prototype, 'createObjectStore'), vi.spyOn(IDBDatabase.prototype, 'deleteObjectStore'), vi.spyOn(indexedDB, 'deleteDatabase')];

    await readDatabaseSnapshot(STABLE);

    expect(open.mock.calls).toEqual([[V2_NAME]]);
    expect(modes()).toEqual(['readonly']);
    for (const spy of [...writes, ...structure]) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(await snapshot(V2_NAME)).toEqual(before);
  });

  it('reads one moment of the database: all stores in one transaction', async () => {
    await seedExperimental();
    const { modes } = transactionModes();
    await readDatabaseSnapshot(EXPERIMENTAL);
    expect(modes()).toHaveLength(1);
  });

  it('closes its connection, so the owner of the database can upgrade it afterwards', async () => {
    await seedStable();
    await readDatabaseSnapshot(STABLE);
    let blocked = false;
    const upgraded = await openDB(V2_NAME, 3, { upgrade: (db) => void db.createObjectStore('later'), blocked: () => { blocked = true; } });
    expect(blocked).toBe(false);
    expect(upgraded.version).toBe(3);
    upgraded.close();
  });

  it('closes an open connection at once when the owner starts an upgrade', async () => {
    await seedStable();
    const held = await openExistingDatabase(V2_NAME);
    expect(held?.version).toBe(2);
    let blocked = false;
    const upgraded = await openDB(V2_NAME, 3, { upgrade: (db) => void db.createObjectStore('later'), blocked: () => { blocked = true; } });
    expect(blocked).toBe(false);
    upgraded.close();
    expect(() => held!.transaction(['progress'], 'readonly')).toThrow();
  });

  it('rejects when the read is interrupted: an interrupted read never looks like an empty database', async () => {
    await seedStable();
    const observed = watchUnhandledRejections();
    const restore = abortReadTransactions();
    const failure = await readDatabaseSnapshot(STABLE).then(() => null, (error: unknown) => error);
    restore();
    expect(failure).toMatchObject({ name: 'BackupError', code: 'unavailable' });
    expect(await observed.stop()).toEqual([]);
  });

  it('gives up when the browser does not answer, and never uses an answer that comes later', async () => {
    await seedStable();
    vi.useFakeTimers();
    const request = { onsuccess: null as null | (() => void), onerror: null, onupgradeneeded: null, result: { close: vi.fn(), version: 2 } };
    vi.spyOn(indexedDB, 'open').mockReturnValue(request as unknown as IDBOpenDBRequest);

    const pending = openExistingDatabase(V2_NAME, 500).then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(501);
    expect(await pending).toMatchObject({ code: 'unavailable', message: expect.stringContaining('did not answer') });

    request.onsuccess!();
    expect(request.result.close).toHaveBeenCalledTimes(1);
  });
});

describeExperimental('database snapshot: a schema this version does not know', () => {
  it('takes no data from an older stable database: version 1 with four stores', async () => {
    await seedStable(syntheticStores(2), 1, ['progress', 'learnPasses', 'flashcardSessions', 'settings']);
    const { modes } = transactionModes();
    expect(await readDatabaseSnapshot(STABLE)).toEqual({ state: 'unsupported', version: 1, storeNames: ['flashcardSessions', 'learnPasses', 'progress', 'settings'] });
    expect(modes()).toEqual([]);
    // Reading did not upgrade it either.
    expect((await snapshot(V2_NAME)).version).toBe(1);
  });

  it('takes no data from a newer stable database, or from one with another set of stores', async () => {
    await seedStable(syntheticStores(2), 3);
    expect((await readDatabaseSnapshot(STABLE)).state).toBe('unsupported');

    resetDatabase();
    await seedStable(syntheticStores(2), 2, [...STORE_NAMES, 'extra']);
    expect(await readDatabaseSnapshot(STABLE)).toMatchObject({ state: 'unsupported', version: 2 });

    resetDatabase();
    await seedExperimental(syntheticStores(3), SYNTHETIC_META, ['pronunciationAttempts']);
    expect(await readDatabaseSnapshot(EXPERIMENTAL)).toMatchObject({ state: 'unsupported', version: 1, storeNames: expect.arrayContaining(['pronunciationAttempts']) });
  });

  it('refuses a key that is not text, instead of turning it into text', async () => {
    await seedStable();
    const database = await openDB(V2_NAME);
    await database.put('settings', 'dark', 7);
    database.close();
    await expect(readDatabaseSnapshot(STABLE)).rejects.toMatchObject({ code: 'unsupported-version', message: expect.stringContaining('a key that is not text') });
  });
});

describeExperimental('records of the first version', () => {
  it('reads exactly the two known records, as text, and nothing else', () => {
    seedLegacy();
    window.localStorage.setItem('another.application', 'not ours');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const read = readLegacyRecords();

    expect(read).toEqual({ state: 'ok', section: { storage: 'localStorage', records: { [V1_STATE_KEY]: V1_STATE, [V1_THEME_KEY]: V1_THEME } } });
    expect(getItem.mock.calls.map(([key]) => key)).toEqual([V1_STATE_KEY, V1_THEME_KEY]);
    if (read.state === 'ok') expect(legacyTheme(read.section)).toBe('dark');
  });

  it('never writes, removes, clears or lists the storage', () => {
    seedLegacy();
    const forbidden = [vi.spyOn(Storage.prototype, 'setItem'), vi.spyOn(Storage.prototype, 'removeItem'), vi.spyOn(Storage.prototype, 'clear'), vi.spyOn(Storage.prototype, 'key')];
    readLegacyRecords();
    for (const spy of forbidden) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(window.localStorage.length).toBe(2);
    expect(window.localStorage.getItem(V1_STATE_KEY)).toBe(V1_STATE);
  });

  it('reports one record when only one exists, and absent when none does', () => {
    window.localStorage.setItem(V1_THEME_KEY, 'light');
    expect(readLegacyRecords()).toEqual({ state: 'ok', section: { storage: 'localStorage', records: { [V1_THEME_KEY]: 'light' } } });
    window.localStorage.clear();
    window.localStorage.setItem('another.application', 'not ours');
    expect(readLegacyRecords()).toEqual({ state: 'absent' });
  });

  it('rejects when the browser refuses access to the storage: a refusal never looks like "nothing saved"', () => {
    const refusing = { getItem: (): string | null => { throw new DOMException('The operation is insecure.', 'SecurityError'); } };
    expect(() => readLegacyRecords(refusing)).toThrow(expect.objectContaining({ code: 'unavailable' }));
  });
});
