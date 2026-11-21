import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';

/**
 * IndexedDB access for the v2 application.
 *
 * This is the only module that touches IndexedDB. It knows the database name,
 * the object stores and how to run transactions. It does not know what the
 * stored values mean: the state services own and validate them.
 */

export const DATABASE_NAME = 'eng-trainer-v2';
export const DATABASE_VERSION = 1;

/** Every store uses explicit string keys (`put(value, key)`). */
export const STORE_NAMES = ['progress', 'learnPasses', 'flashcardSessions', 'settings'] as const;
export type StoreName = (typeof STORE_NAMES)[number];

export type WriteOp =
  | { type: 'put'; store: StoreName; key: string; value: unknown }
  | { type: 'delete'; store: StoreName; key: string };

/** Everything saved in the database: one key → value map per store. */
export type StoredRecords = Record<StoreName, Map<string, unknown>>;

export type StorageOperation = 'open' | 'read' | 'write';

export class StorageError extends Error {
  readonly operation: StorageOperation;

  constructor(operation: StorageOperation, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause ?? 'unknown error');
    super(`IndexedDB ${operation} failed: ${detail}`);
    this.name = 'StorageError';
    this.operation = operation;
  }
}

export interface AppStorage {
  /**
   * Reads every saved record in one read-only transaction.
   * A record that was never saved is simply absent from the result.
   * A failed read rejects with a `StorageError`; it never looks like "empty".
   */
  readAll(): Promise<StoredRecords>;
  /**
   * Applies the operations in one read-write transaction.
   * Resolves only after the transaction has completed. If anything fails, the
   * transaction is aborted, nothing is saved and the promise rejects.
   */
  write(ops: WriteOp[]): Promise<void>;
  close(): void;
}

function createStorage(db: IDBPDatabase): AppStorage {
  return {
    async readAll() {
      try {
        const tx = db.transaction(STORE_NAMES, 'readonly');
        const stores = await Promise.all(
          STORE_NAMES.map(async (name) => {
            const store = tx.objectStore(name);
            // Both lists are ordered by key, so keys and values line up.
            const [keys, values] = await Promise.all([store.getAllKeys(), store.getAll()]);
            return [name, new Map(keys.map((key, index) => [String(key), values[index] as unknown]))] as const;
          })
        );
        await tx.done;
        return Object.fromEntries(stores) as StoredRecords;
      } catch (error) {
        throw new StorageError('read', error);
      }
    },

    async write(ops) {
      if (!ops.length) return;

      let tx: IDBPTransaction<unknown, StoreName[], 'readwrite'> | undefined;
      const pending: Promise<unknown>[] = [];

      try {
        tx = db.transaction([...new Set(ops.map((op) => op.store))], 'readwrite');
        // All requests are issued before the first await, so they belong to
        // this transaction and are committed or rolled back together.
        for (const op of ops) {
          const store = tx.objectStore(op.store);
          pending.push(op.type === 'put' ? store.put(op.value, op.key) : store.delete(op.key));
        }
        pending.push(tx.done);
        await Promise.all(pending);
      } catch (error) {
        // A request that could not even be issued does not abort the
        // transaction by itself, so the requests before it are rolled back here.
        try {
          tx?.abort();
        } catch {
          // The transaction has already finished or was aborted by the browser.
        }
        // The first failure is the one reported; the rest are consequences of it.
        for (const promise of [...pending, tx?.done]) promise?.catch(() => undefined);
        throw new StorageError('write', error);
      }
    },

    close() {
      db.close();
    }
  };
}

/** Opens the v2 database, creating it on the first run. */
export async function openStorage(): Promise<AppStorage> {
  try {
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB is not available in this browser.');
    }

    const db = await openDB(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          for (const name of STORE_NAMES) database.createObjectStore(name);
        }
      },
      blocking() {
        // A newer version of the app in another tab wants to upgrade the
        // database. Let it: later writes from this tab fail visibly.
        db.close();
      }
    });

    return createStorage(db);
  } catch (error) {
    throw new StorageError('open', error);
  }
}
