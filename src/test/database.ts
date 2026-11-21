import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { DATABASE_NAME, DATABASE_VERSION, STORE_NAMES, type StoreName } from '../storage/database';

export type SavedRecords = Partial<Record<StoreName, Record<string, unknown>>>;

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
