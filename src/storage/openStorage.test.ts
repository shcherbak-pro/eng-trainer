import { openDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase } from '../test/database';
import { describeStableLineage } from '../test/product';
import { DATABASE_NAME, openStorage, STATE_STORE_NAMES, StorageAbortError } from './database';

/** Another tab that still runs a build with database version 1 and does not close for upgrades. */
function holdLegacyConnection() {
  return openDB(DATABASE_NAME, 1, { upgrade(db) { STATE_STORE_NAMES.forEach((name) => db.createObjectStore(name)); } });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

beforeEach(() => {
  resetDatabase();
  vi.restoreAllMocks();
});

describeStableLineage('blocked database upgrade (F4)', () => {
  it('keeps waiting with guidance and continues by itself when the other tab closes', async () => {
    const legacy = await holdLegacyConnection();
    const onBlocked = vi.fn();
    let opened = false;
    const pending = openStorage({ onBlocked }).then((storage) => {
      opened = true;
      return storage;
    });
    await settle();
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(opened).toBe(false);

    legacy.close();
    const storage = await pending;
    expect(opened).toBe(true);
    expect([...(await storage.readAll()).userCollections.keys()]).toEqual([]);
    storage.close();
  });

  it('lets a retry join the waiting request: one IndexedDB request, and only the latest caller gets the connection', async () => {
    const legacy = await holdLegacyConnection();
    const open = vi.spyOn(indexedDB, 'open');
    const firstBlocked = vi.fn();
    const secondBlocked = vi.fn();

    const first = openStorage({ onBlocked: firstBlocked });
    await settle();
    expect(firstBlocked).toHaveBeenCalledTimes(1);

    const second = openStorage({ onBlocked: secondBlocked });
    // The retry learns at once that the upgrade is still blocked, instead of waiting silently.
    expect(secondBlocked).toHaveBeenCalledTimes(1);
    await expect(first).rejects.toBeInstanceOf(StorageAbortError);
    expect(open).toHaveBeenCalledTimes(1);

    legacy.close();
    const storage = await second;
    storage.close();
  });

  it('closes a connection that opens after the caller gave up, so a late result cannot take over', async () => {
    const legacy = await holdLegacyConnection();
    const controller = new AbortController();
    const request = openStorage({ onBlocked: () => undefined, signal: controller.signal });
    await settle();

    controller.abort();
    await expect(request).rejects.toBeInstanceOf(StorageAbortError);
    legacy.close();
    await settle();

    // If the late version-2 connection were still open, this upgrade would be blocked by it.
    const blocked = vi.fn();
    const next = await openDB(DATABASE_NAME, 3, { blocked });
    expect(blocked).not.toHaveBeenCalled();
    next.close();
  });

  it('keeps the released behaviour for callers without a waiting handler: the blocked upgrade fails visibly', async () => {
    const legacy = await holdLegacyConnection();
    await expect(openStorage()).rejects.toThrow(/Close other eng-trainer tabs/);
    legacy.close();
    const storage = await openStorage();
    storage.close();
  });
});
