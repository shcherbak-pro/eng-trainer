import { BackupError, type DatabaseSchema, type StorePairs } from './format';

/**
 * Reads everything an IndexedDB database holds, without changing anything (ENG-V3-R1A).
 *
 * This is the only way the backup reads a database, its own or the stable product's. It
 * is also the only place of the folder that requests a database: both recoveries open
 * theirs through `openExistingDatabase`, so neither can create or upgrade one.
 *
 * - The database is opened without a version. An existing database then opens at the
 *   version it has, and is never upgraded.
 * - A database that does not exist is not created. Where the browser can list its
 *   databases, an absent one is not opened at all. Elsewhere the open request starts to
 *   create it, and that creation is cancelled before it is kept.
 * - Only the expected version with exactly the expected stores is read. Anything else is
 *   reported as unsupported, and no data is taken from it.
 * - All stores are read in one read-only transaction, so the result is one moment of the
 *   database. This module never starts a read-write transaction.
 * - The connection is closed as soon as the read has finished, and at once when the
 *   product that owns the database wants to upgrade it.
 */

/** How long an open request may stay unanswered. Another tab that upgrades the database can hold it up. */
export const OPEN_TIMEOUT_MS = 8000;

export type DatabaseSnapshot =
  | { state: 'absent' }
  | { state: 'unsupported'; version: number; storeNames: string[] }
  | { state: 'ok'; version: number; stores: Record<string, StorePairs> };

function storageError(error: unknown): BackupError {
  if (error instanceof BackupError) return error;
  const detail = error instanceof Error ? error.message : String(error ?? 'unknown error');
  return new BackupError('unavailable', `The browser storage could not be read: ${detail}`, { cause: error });
}

/**
 * Opens a database that already exists, at the version it has. Resolves with `null`
 * when it does not exist; nothing is created then.
 */
export function openExistingDatabase(name: string, timeoutMs = OPEN_TIMEOUT_MS): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let creating = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (run: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run();
    };

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name);
    } catch (error) {
      reject(storageError(error));
      return;
    }
    timer = setTimeout(() => settle(() => reject(new BackupError('unavailable', 'The browser storage did not answer. Close other tabs of this application and try again.'))), timeoutMs);

    request.onupgradeneeded = () => {
      // Without a version, only a database that does not exist yet is upgraded: the browser
      // has started to create it. Cancelling this transaction cancels the creation.
      creating = true;
      request.transaction?.abort();
    };
    request.onerror = (event) => {
      // The cancelled creation ends here, as an expected error of this request.
      event.preventDefault();
      settle(() => (creating ? resolve(null) : reject(storageError(request.error))));
    };
    request.onsuccess = () => {
      const database = request.result;
      // An answer after the time limit is never used.
      if (settled) {
        database.close();
        return;
      }
      // Never stand in the way of an upgrade that the owner of the database starts.
      database.onversionchange = () => database.close();
      settle(() => resolve(database));
    };
  });
}

/** Every record of the named stores, read in one read-only transaction. */
export function readStores(database: IDBDatabase, names: readonly string[]): Promise<Record<string, StorePairs>> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction([...names], 'readonly');
    } catch (error) {
      reject(storageError(error));
      return;
    }
    // Keys and values are both returned in key order, so they line up.
    const requests = names.map((name) => {
      const store = transaction.objectStore(name);
      return { name, keys: store.getAllKeys(), values: store.getAll() };
    });
    transaction.oncomplete = () => {
      try {
        const stores: Record<string, StorePairs> = {};
        for (const { name, keys, values } of requests) {
          stores[name] = keys.result.map((key, index): [string, unknown] => {
            if (typeof key !== 'string') throw new BackupError('unsupported-version', `The store "${name}" has a key that is not text. This version of the application cannot back it up.`);
            return [key, values.result[index]];
          });
        }
        resolve(stores);
      } catch (error) {
        reject(storageError(error));
      }
    };
    transaction.onabort = () => reject(storageError(transaction.error ?? new Error('the read was interrupted')));
  });
}

/**
 * Reads the database of a product, if it exists and has exactly the given schema.
 * A failed read rejects with a `BackupError`; it never looks like an empty database.
 */
export async function readDatabaseSnapshot(schema: DatabaseSchema): Promise<DatabaseSnapshot> {
  if (typeof indexedDB === 'undefined') throw new BackupError('unavailable', 'IndexedDB is not available in this browser.');

  if (typeof indexedDB.databases === 'function') {
    let known: IDBDatabaseInfo[];
    try {
      known = await indexedDB.databases();
    } catch (error) {
      throw storageError(error);
    }
    if (!known.some((entry) => entry.name === schema.database)) return { state: 'absent' };
  }

  const database = await openExistingDatabase(schema.database);
  if (!database) return { state: 'absent' };
  try {
    const storeNames = Array.from(database.objectStoreNames).sort();
    if (database.version !== schema.schemaVersion || storeNames.join('\n') !== [...schema.stores].sort().join('\n')) {
      return { state: 'unsupported', version: database.version, storeNames };
    }
    return { state: 'ok', version: database.version, stores: await readStores(database, schema.stores) };
  } finally {
    database.close();
  }
}
