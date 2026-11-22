import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCatalog } from '../content/catalog';
import { combineCatalog } from '../content/userCatalog';
import { openStorage, type AppStorage } from '../storage/database';
import { collection, entry, native } from '../test/collections';
import { realMaterials } from '../test/content';
import { readDatabase, resetDatabase } from '../test/database';
import { describeCollectionError } from '../features/collections/importFeedback';
import { parseImport } from './format';
import {
  acceptImport,
  CollectionError,
  connectCollections,
  disableCollections,
  prepareImport,
  readCollections,
  removeCollection,
  renameCollection,
  userVocabulary
} from './service';

const builtIn = createCatalog(realMaterials);
let storage: AppStorage;
const plan = (value = native()) => prepareImport(parseImport(JSON.stringify(value), 'synthetic.json'), combineCatalog(builtIn, get(userVocabulary)));

async function failure(run: () => Promise<unknown>): Promise<CollectionError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(CollectionError);
    return error as CollectionError;
  }
  throw new Error('Expected the operation to fail');
}

beforeEach(async () => {
  resetDatabase();
  storage = await openStorage();
  connectCollections(storage, readCollections(await storage.readAll()));
});
afterEach(() => {
  storage.close();
  disableCollections();
  vi.restoreAllMocks();
});

describe('collection errors are typed, and the advice fits the failure (F5)', () => {
  it('reports a change made in another tab as a conflict, without storage-space advice', async () => {
    await acceptImport(plan());
    const before = await readDatabase();
    // Another tab renames the collection first.
    const otherTab = { ...get(userVocabulary).collections[0], revision: 2, name: 'Renamed in another tab' };
    await storage.write([{ type: 'put', store: 'userCollections', key: collection.id, value: otherTab }]);

    for (const run of [() => renameCollection(collection.id, 'Mine'), () => removeCollection(collection.id), () => acceptImport(plan(native([entry(3)])))]) {
      const error = await failure(run);
      expect(error.kind).toBe('conflict');
      expect(error.message).toMatch(/another session/);
    }
    const advice = describeCollectionError(await failure(() => renameCollection(collection.id, 'Mine')), 'rename');
    expect(advice.text).toContain('changed in another tab');
    expect(advice.text).not.toMatch(/storage|space/i);
    expect(advice.reload).toBe(true);
    expect((await readDatabase()).userCollections).toEqual({ ...before.userCollections, [collection.id]: otherTab });
  });

  it('suggests freeing storage space only when the browser refused to store more data', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Synthetic quota exceeded', 'QuotaExceededError');
    });
    const error = await failure(() => acceptImport(plan()));
    expect(error.kind).toBe('quota');
    expect(describeCollectionError(error, 'import').text).toContain('no more storage space');
  });

  it('reports other failed transactions as "not saved" without blaming storage space', async () => {
    await acceptImport(plan());
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(() => {
      throw new Error('Synthetic deletion failure');
    });
    const error = await failure(() => removeCollection(collection.id));
    expect(error.kind).toBe('storage');
    const advice = describeCollectionError(error, 'remove');
    expect(advice.text).toContain('The removal was not saved');
    expect(advice.text).not.toMatch(/space/i);
  });

  it('separates unavailable storage, stale previews and validation', async () => {
    const stale = plan();
    await acceptImport(plan());
    expect((await failure(() => acceptImport(stale))).kind).toBe('stale');
    const invalid = await failure(() => renameCollection(collection.id, '   '));
    expect(invalid.kind).toBe('validation');
    expect(invalid.message).toBe('Collection name is required.');
    disableCollections();
    expect((await failure(() => acceptImport(plan()))).kind).toBe('unavailable');
  });
});
