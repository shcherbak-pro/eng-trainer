import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';

/**
 * IndexedDB access for the v2 application.
 *
 * This is the only module that touches IndexedDB. It knows the database name,
 * the object stores and how to run transactions. It does not know what the
 * stored values mean: the state services own and validate them.
 */

export const DATABASE_NAME = 'eng-trainer-v2';
export const DATABASE_VERSION = 2;

/** Every store uses explicit string keys (`put(value, key)`). */
export const STATE_STORE_NAMES = ['progress', 'learnPasses', 'flashcardSessions', 'settings'] as const;
export const STORE_NAMES = [...STATE_STORE_NAMES, 'userCollections', 'userEntries'] as const;
export type StoreName = (typeof STORE_NAMES)[number];

/** Optimistic concurrency checks, read inside the same transaction as the writes. */
export type WriteCondition = { store: StoreName; key: string; expected: unknown };

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
  write(ops: WriteOp[], conditions?: WriteCondition[]): Promise<void>;
  close(): void;
}

/**
 * Cleans up a transaction after its first failure has been caught.
 *
 * The caught error is the one that is reported to the caller, wrapped in a
 * `StorageError`. What is released here are only the consequences of that same
 * failure: the transaction is aborted if it is still open (a request that could
 * not even be issued does not abort it by itself), and the other requests and
 * the completion promise of this transaction, which now reject too, get a
 * handler so they do not surface as unhandled rejections. Promises of other
 * transactions are never touched.
 */
function releaseAfterFailure(
  tx: IDBPTransaction<unknown, StoreName[], IDBTransactionMode> | undefined,
  pending: Promise<unknown>[]
): void {
  if (!tx) return;

  try {
    tx.abort();
  } catch {
    // The transaction has already finished or was aborted by the browser.
  }

  for (const promise of [...pending, tx.done]) promise.catch(() => undefined);
}

function createStorage(db: IDBPDatabase): AppStorage {
  return {
    async readAll() {
      let tx: IDBPTransaction<unknown, StoreName[], 'readonly'> | undefined;
      const pending: Promise<unknown>[] = [];

      try {
        tx = db.transaction([...STORE_NAMES], 'readonly');
        // The completion promise is tracked from the moment the transaction
        // exists. It rejects when the transaction aborts, also when every
        // request before the abort has succeeded.
        pending.push(tx.done);

        // Every request is tracked as soon as it is issued, and all of them are
        // issued before the first await.
        const track = <T>(request: Promise<T>): Promise<T> => {
          pending.push(request);
          return request;
        };
        const requests = STORE_NAMES.map((name) => {
          const store = tx!.objectStore(name);
          return { name, keys: track(store.getAllKeys()), values: track(store.getAll()) };
        });

        // One await for every request and for the completion of the
        // transaction: whichever fails first is reported, and none of the
        // promises is left without a handler.
        await Promise.all(pending);

        const records = {} as StoredRecords;
        for (const { name, keys, values } of requests) {
          // Both lists are ordered by key, so keys and values line up.
          const [storeKeys, storeValues] = [await keys, await values];
          records[name] = new Map(storeKeys.map((key, index) => [String(key), storeValues[index] as unknown]));
        }
        return records;
      } catch (error) {
        releaseAfterFailure(tx, pending);
        throw new StorageError('read', error);
      }
    },

    async write(ops, conditions = []) {
      if (!ops.length && !conditions.length) return;

      let tx: IDBPTransaction<unknown, StoreName[], 'readwrite'> | undefined;
      const pending: Promise<unknown>[] = [];

      try {
        tx = db.transaction([...new Set([...ops, ...conditions].map((op) => op.store))], 'readwrite');
        pending.push(tx.done);
        if (conditions.length) {
          const checks = conditions.map((condition) => {
            const request = tx!.objectStore(condition.store).get(condition.key);
            pending.push(request);
            return request;
          });
          const values = await Promise.all(checks);
          conditions.forEach((condition, index) => {
            if (JSON.stringify(values[index]) !== JSON.stringify(condition.expected)) {
              throw new Error('Saved data changed in another session. Reload and review the import again.');
            }
          });
        }
        // Issue all writes together after any condition reads, while this
        // transaction is active. They commit or roll back together.
        for (const op of ops) {
          const store = tx.objectStore(op.store);
          pending.push(op.type === 'put' ? store.put(op.value, op.key) : store.delete(op.key));
        }
        await Promise.all(pending);
      } catch (error) {
        releaseAfterFailure(tx, pending);
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

    let abandoned = false;
    let upgradeFailure: unknown;
    let rejectBlocked: (error: Error) => void;
    const blocked = new Promise<never>((_resolve, reject) => { rejectBlocked = reject; });
    const opening = openDB(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(database, oldVersion, _newVersion, transaction) {
        // The open request reports a failed migration; also observe idb's
        // wrapped upgrade-transaction promise so its abort is not detached.
        void transaction.done.catch(() => undefined);
        try {
          if (oldVersion < 1) {
            for (const name of STATE_STORE_NAMES) database.createObjectStore(name);
          }
          if (oldVersion < 2) {
            database.createObjectStore('userCollections');
            database.createObjectStore('userEntries');
          }
        } catch (error) {
          upgradeFailure = error;
          transaction.abort();
        }
      },
      blocked() {
        abandoned = true;
        rejectBlocked(new Error('Close other eng-trainer tabs so browser storage can be upgraded, then try again.'));
      },
      blocking() {
        // A newer version of the app in another tab wants to upgrade the
        // database. Let it: later writes from this tab fail visibly.
        void opening.then((database) => database.close());
      }
    });

    // An IndexedDB open request cannot be canceled. Close it if an abandoned
    // blocked attempt eventually completes after the other tab is closed.
    void opening.then((database) => { if (abandoned) database.close(); }, () => undefined);
    const db = await Promise.race([opening, blocked]).catch((error) => { throw upgradeFailure ?? error; });

    return createStorage(db);
  } catch (error) {
    throw new StorageError('open', error);
  }
}
