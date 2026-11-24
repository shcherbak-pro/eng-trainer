import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { DATABASE_NAME, DATABASE_VERSION, META_STORE_NAME, STORE_NAMES, type StoreName } from '../storage/database';

export type SavedRecords = Partial<Record<StoreName, Record<string, unknown>>>;

// The tests run in Node. Only this one event of `process` is used here, so the
// project does not need the Node type definitions for it.
declare const process: {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
};

/** Gives the next test a browser that has never opened the app. */
export function resetDatabase(): void {
  globalThis.indexedDB = new IDBFactory();
}

async function open() {
  return openDB(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(db) {
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
      // The experimental database has one more store (ENG-V3-01). A database seeded here must
      // have the product's complete schema, because the application will not upgrade it.
      if (__ENG_PRODUCT__ === 'experimental-v3' && !db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME);
      }
    }
  });
}

/** Writes records straight into the database, as an earlier session would have. */
export async function seedDatabase(records: SavedRecords): Promise<void> {
  const db = await open();
  const tx = db.transaction(STORE_NAMES, 'readwrite');
  for (const name of STORE_NAMES) {
    for (const [key, value] of Object.entries(records[name] ?? {})) {
      void tx.objectStore(name).put(value, key);
    }
  }
  await tx.done;
  db.close();
}

/**
 * Makes every read transaction abort by itself after its first `getAll` request
 * has succeeded. This is an asynchronous abort of a real transaction, as a
 * browser does it, not an exception thrown while the request is issued.
 * Call the returned function to remove the failure.
 */
export function abortReadTransactions(): () => void {
  const original = IDBObjectStore.prototype.getAll;

  IDBObjectStore.prototype.getAll = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['getAll']>) {
    const request = original.apply(this, args);
    const transaction = this.transaction;
    request.addEventListener('success', () => {
      try {
        transaction.abort();
      } catch {
        // The transaction has already been aborted by an earlier request.
      }
    });
    return request;
  } as IDBObjectStore['getAll'];

  return () => {
    IDBObjectStore.prototype.getAll = original;
  };
}

/**
 * Collects promise rejections that nothing handled. `stop()` waits long enough
 * for late ones to be reported and returns them.
 */
export function watchUnhandledRejections(): { stop: () => Promise<unknown[]> } {
  const seen: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    seen.push(reason);
  };
  process.on('unhandledRejection', onRejection);

  return {
    async stop() {
      await new Promise((resolve) => setTimeout(resolve, 50));
      process.off('unhandledRejection', onRejection);
      return seen;
    }
  };
}

/** Reads what is really saved in the database, bypassing the application. */
export async function readDatabase(): Promise<Record<StoreName, Record<string, unknown>>> {
  const db = await open();
  const result = {} as Record<StoreName, Record<string, unknown>>;
  for (const name of STORE_NAMES) {
    const keys = await db.getAllKeys(name);
    const values = await db.getAll(name);
    result[name] = Object.fromEntries(keys.map((key, index) => [String(key), values[index]]));
  }
  db.close();
  return result;
}
