import { openDB } from 'idb';
import { beforeEach, expect, it, vi } from 'vitest';
import { resetDatabase, watchUnhandledRejections } from '../test/database';
import { describeExperimental } from '../test/product';
import { META_CREATED_AT_KEY, META_SCHEMA_KEY, META_STORE_NAME, STORE_NAMES, StorageError, openStorage, type WriteOp } from './database';

/**
 * The database of the experimental product (ENG-V3-01): a new lineage, `eng-trainer-v3`
 * at version 1. All data here is synthetic. The stable database and v1's localStorage
 * are only created by the tests themselves, to prove that they stay untouched.
 */
const V2_NAME = 'eng-trainer-v2';
const V3_NAME = 'eng-trainer-v3';
const V1_KEYS = ['englishAssessmentTrainer.svelteState.v1', 'englishAssessmentTrainer.theme.v1'];

type Snapshot = { version: number; stores: Record<string, Record<string, unknown>> };

/** Everything a database holds, read without a version so that nothing is created or upgraded. */
async function snapshot(name: string): Promise<Snapshot> {
  const db = await openDB(name);
  const stores: Snapshot['stores'] = {};
  for (const store of [...db.objectStoreNames].sort()) {
    const keys = await db.getAllKeys(store);
    const values = await db.getAll(store);
    stores[store] = Object.fromEntries(keys.map((key, index) => [String(key), values[index]]));
  }
  const result = { version: db.version, stores };
  db.close();
  return result;
}

const databaseNames = async (): Promise<string[]> => (await indexedDB.databases()).map((db) => String(db.name)).sort();

/** A stable database as an earlier stable session would have left it. */
async function seedStableDatabase(): Promise<void> {
  const db = await openDB(V2_NAME, 2, {
    upgrade(database) {
      for (const name of STORE_NAMES) database.createObjectStore(name);
    }
  });
  await db.put('progress', ['phrase-001', 'phrase-007'], 'learnedPhrases');
  await db.put('settings', 'dark', 'theme');
  await db.put('learnPasses', { id: 'pass-synthetic', name: 'Synthetic pass', description: '', blockIds: ['a'], createdAt: 1, updatedAt: 1 }, 'pass-synthetic');
  await db.put('flashcardSessions', { order: ['phrase-001'], index: 0 }, 'all');
  await db.put('userCollections', { id: 'user:synthetic', name: 'Synthetic', revision: 1 }, 'user:synthetic');
  await db.put('userEntries', { id: 'user:synthetic:entry:1', collectionId: 'user:synthetic', position: 0, english: 'synthetic' }, 'user:synthetic:entry:1');
  db.close();
}

const SYNTHETIC: WriteOp[] = [
  { type: 'put', store: 'progress', key: 'learnedPhrases', value: ['phrase-100'] },
  { type: 'put', store: 'learnPasses', key: 'pass-v3', value: { id: 'pass-v3', name: 'v3 pass', description: '', blockIds: [], createdAt: 2, updatedAt: 2 } },
  { type: 'put', store: 'flashcardSessions', key: 'all', value: { order: ['phrase-100'], index: 0 } },
  { type: 'put', store: 'settings', key: 'theme', value: 'light' },
  { type: 'put', store: 'userCollections', key: 'user:v3', value: { id: 'user:v3', name: 'v3 only', revision: 1 } },
  { type: 'put', store: 'userEntries', key: 'user:v3:entry:1', value: { id: 'user:v3:entry:1', collectionId: 'user:v3', position: 0, english: 'v3 only' } }
];

beforeEach(() => {
  resetDatabase();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describeExperimental('experimental database: schema version 1', () => {
  it('creates only eng-trainer-v3 on a fresh origin: version 1, the six shared stores plus meta', async () => {
    const storage = await openStorage();
    storage.close();

    expect(await databaseNames()).toEqual([V3_NAME]);
    const created = await snapshot(V3_NAME);
    expect(created.version).toBe(1);
    expect(Object.keys(created.stores)).toEqual([...STORE_NAMES, META_STORE_NAME].sort());
    expect(Object.keys(created.stores)).toHaveLength(7);
    for (const name of STORE_NAMES) expect(created.stores[name]).toEqual({});
  });

  it('records the schema version and the creation time in meta, once', async () => {
    const before = Date.now();
    (await openStorage()).close();
    const meta = (await snapshot(V3_NAME)).stores[META_STORE_NAME];

    expect(Object.keys(meta).sort()).toEqual([META_CREATED_AT_KEY, META_SCHEMA_KEY].sort());
    expect(meta[META_SCHEMA_KEY]).toBe(1);
    const createdAt = meta[META_CREATED_AT_KEY] as string;
    expect(new Date(createdAt).toISOString()).toBe(createdAt);
    expect(Date.parse(createdAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(createdAt)).toBeLessThanOrEqual(Date.now());

    // Opening again neither upgrades the database nor rewrites its meta records.
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    (await openStorage()).close();
    expect(put).not.toHaveBeenCalled();
    const again = await snapshot(V3_NAME);
    expect(again.version).toBe(1);
    expect(again.stores[META_STORE_NAME]).toEqual(meta);
  });

  it('keeps meta out of the learning state: readAll returns exactly the six shared stores', async () => {
    const storage = await openStorage();
    const records = await storage.readAll();
    storage.close();

    expect(Object.keys(records).sort()).toEqual([...STORE_NAMES].sort());
    for (const name of STORE_NAMES) expect(records[name].size).toBe(0);
  });

  it('saves synthetic learning state in all six stores and reads it back after reopening', async () => {
    const first = await openStorage();
    await first.write(SYNTHETIC);
    first.close();

    const second = await openStorage();
    const records = await second.readAll();
    second.close();
    for (const op of SYNTHETIC) {
      if (op.type === 'put') expect(records[op.store].get(op.key)).toEqual(op.value);
    }
    // Learning writes never touch meta.
    expect(Object.keys((await snapshot(V3_NAME)).stores[META_STORE_NAME]).sort()).toEqual([META_CREATED_AT_KEY, META_SCHEMA_KEY].sort());
  });

  it('creates the database completely or not at all: a failure while creating meta leaves no database', async () => {
    const observed = watchUnhandledRejections();
    const create = IDBDatabase.prototype.createObjectStore;
    vi.spyOn(IDBDatabase.prototype, 'createObjectStore').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['createObjectStore']>) {
      if (args[0] === META_STORE_NAME) throw new DOMException('synthetic failure', 'UnknownError');
      return create.apply(this, args);
    });

    const failure = await openStorage().then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(StorageError);
    expect((failure as StorageError).operation).toBe('open');
    expect((failure as StorageError).message).toContain('synthetic failure');
    vi.restoreAllMocks();
    expect(await observed.stop()).toEqual([]);
    expect(await databaseNames()).toEqual([]);

    // The next start creates the complete schema.
    (await openStorage()).close();
    expect(Object.keys((await snapshot(V3_NAME)).stores)).toHaveLength(7);
  });

  it('rolls back when a meta record cannot be written, without an unhandled rejection of the record written before it', async () => {
    const observed = watchUnhandledRejections();
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (args[1] === META_CREATED_AT_KEY) throw new DOMException('synthetic quota', 'QuotaExceededError');
      return put.apply(this, args);
    });

    const failure = await openStorage().then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(StorageError);
    expect((failure as StorageError).kind).toBe('quota');
    vi.restoreAllMocks();
    // The schema record was already requested; the abort rejects it, and that is handled.
    expect(await observed.stop()).toEqual([]);
    expect(await databaseNames()).toEqual([]);

    (await openStorage()).close();
    const created = await snapshot(V3_NAME);
    expect(created.version).toBe(1);
    expect(Object.keys(created.stores[META_STORE_NAME]).sort()).toEqual([META_CREATED_AT_KEY, META_SCHEMA_KEY].sort());
  });
});

describeExperimental('experimental database: isolation from the stable database and from v1', () => {
  it('never opens, creates or upgrades eng-trainer-v2 during start-up and ordinary use', async () => {
    const open = vi.spyOn(indexedDB, 'open');
    const storage = await openStorage();
    await storage.write(SYNTHETIC);
    await storage.readAll();
    storage.close();

    expect(open.mock.calls.map(([name]) => name)).toEqual([V3_NAME]);
    expect(await databaseNames()).toEqual([V3_NAME]);
  });

  it('leaves a seeded stable database deeply equal: version, stores, keys and values', async () => {
    await seedStableDatabase();
    const before = await snapshot(V2_NAME);
    expect(before.version).toBe(2);

    const open = vi.spyOn(indexedDB, 'open');
    const storage = await openStorage();
    await storage.write(SYNTHETIC);
    await storage.write([{ type: 'delete', store: 'settings', key: 'theme' }]);
    storage.close();
    expect(open.mock.calls.map(([name]) => name)).toEqual([V3_NAME]);
    open.mockRestore();

    expect(await snapshot(V2_NAME)).toEqual(before);
    expect(await databaseNames()).toEqual([V2_NAME, V3_NAME]);
    // The two databases hold different data under the same keys.
    const experimental = await snapshot(V3_NAME);
    expect(experimental.stores.progress.learnedPhrases).toEqual(['phrase-100']);
    expect(before.stores.progress.learnedPhrases).toEqual(['phrase-001', 'phrase-007']);
    expect(Object.keys(before.stores)).not.toContain(META_STORE_NAME);
  });

  it('never reads or writes localStorage, so v1 data is neither used nor changed', async () => {
    const values = ['{"learnedPhrases":["phrase-001"],"flashcardMode":"topic"}', 'dark'];
    V1_KEYS.forEach((key, index) => window.localStorage.setItem(key, values[index]));
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');

    const storage = await openStorage();
    await storage.write(SYNTHETIC);
    storage.close();

    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(window.localStorage.length).toBe(2);
    V1_KEYS.forEach((key, index) => expect(window.localStorage.getItem(key)).toBe(values[index]));
  });
});
