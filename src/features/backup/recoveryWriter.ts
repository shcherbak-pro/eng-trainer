import { STABLE_SCHEMA, planLegacyRecovery, type LegacyRecords } from './destinations';
import { BackupError, GUARD_KEY, GUARD_STORE, LEGACY_KEYS, LEGACY_PRODUCT, LEGACY_STATE_KEY, LEGACY_THEME_KEY, STABLE_PRODUCT, sectionDigest, type BackupFile, type DatabaseSection, type LegacyKey, type LegacySection, type ProductId, type StorePairs } from './format';
import { openExistingDatabase, readDatabaseSnapshot } from './snapshot';
import { learningDataIn } from './summary';
import { checkSection } from './validate';

/**
 * The recovery writer for the other two products (ENG-V3-R1A-RC1, approved by the owner
 * as option A).
 *
 * This is the only module of the experimental product that writes storage of another
 * product. It is a file of its own, loaded by the Backup screen after the learner
 * confirmed a recovery, and by nothing else. It has two destinations, both fixed here:
 *
 * - the stable product's database `eng-trainer-v2`, version 2, exactly six stores;
 * - the two `localStorage` records of the first version.
 *
 * No argument, file content or address can name another database or another record.
 *
 * The contract:
 *
 * 1. Explicit: one section, after validation, a preview and a confirmation.
 * 2. Only into a destination without learning data, judged by value at the moment of
 *    writing. Nothing is overwritten and nothing is merged. Preferences are replaced.
 * 3. The released schema and nothing else. This module creates no database, upgrades
 *    none and deletes none: it opens the stable database as it is, without a version. A
 *    database that does not exist is created by the stable product itself, when it is
 *    opened. A database of another version or with other stores is never written.
 * 4. The stable database is written in one transaction, guarded against a script that
 *    stops in the middle.
 * 5. The two records of the first version cannot be one transaction. The state is
 *    written first and read back, then the theme. A stop between them is reported as
 *    incomplete, never as a success, and can be completed later: see `planLegacyRecovery`.
 * 6. The result is read back and compared with the backup before it is called recovered.
 * 7. Never at start-up, never without a file, never while a backup is made.
 */
const NOT_EMPTY: Record<typeof STABLE_PRODUCT | typeof LEGACY_PRODUCT, string> = {
  [STABLE_PRODUCT]: 'The stable version already holds learning data in this browser. A recovery never overwrites data, so nothing was changed.',
  [LEGACY_PRODUCT]: 'The previous version (v1) already holds learning data in this browser. A recovery never overwrites data, so nothing was changed.'
};

const detailOf = (error: unknown): string => (error instanceof Error ? error.message : String(error ?? 'unknown error'));
const isQuota = (error: unknown): boolean => (error as { name?: unknown } | null)?.name === 'QuotaExceededError';

/** A write that left the destination exactly as it was. */
function unchanged(error: unknown, product: ProductId): BackupError {
  if (error instanceof BackupError) return error;
  return new BackupError('write-failed', isQuota(error)
    ? 'The browser refused to store the data: its storage for this site is full. Nothing was changed.'
    : `The data could not be written, and nothing was changed. ${detailOf(error)}`, { cause: error, product });
}

/** The section of a product, judged again here: this module is safe for any caller, not only after a preview. */
async function checkedSection<T extends DatabaseSection | LegacySection>(file: BackupFile, product: typeof STABLE_PRODUCT | typeof LEGACY_PRODUCT, name: string): Promise<{ section: T; digest: string }> {
  const section = file.sections[product];
  const digest = file.integrity.sections[product];
  if (!section || !digest) throw new BackupError('malformed', `The backup holds no data of ${name}.`, { product });
  checkSection(product, section);
  if ((await sectionDigest(section)) !== digest) throw new BackupError('integrity', `The data of ${name} does not match its digest.`, { product });
  return { section: section as T, digest };
}

// ---- The stable product: one database, one transaction ----------------------------------------

const settle = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/** Writes the section in one transaction, after judging the destination inside that transaction. */
async function writeSection(database: IDBDatabase, section: DatabaseSection): Promise<void> {
  const transaction = database.transaction([...STABLE_SCHEMA.stores], 'readwrite');
  const finished = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new DOMException('The transaction was aborted.', 'AbortError'));
  });
  // The failure is reported by the code below. This keeps it from also being an unhandled rejection.
  finished.catch(() => undefined);

  try {
    const current: Record<string, StorePairs> = {};
    await Promise.all(STABLE_SCHEMA.stores.map(async (name) => {
      const store = transaction.objectStore(name);
      const [keys, values] = await Promise.all([settle(store.getAllKeys()), settle(store.getAll())]);
      current[name] = keys.map((key, index): [string, unknown] => [String(key), values[index]]);
    }));
    if (learningDataIn(current).length) throw new BackupError('not-empty', NOT_EMPTY[STABLE_PRODUCT], { product: STABLE_PRODUCT });

    // The guard, as in restore.ts. A browser commits a transaction as soon as its requests are
    // done and no script adds more. If this script stops between two writes (the tab is closed
    // and the browser cancels the script), no `catch` block runs, and the writes issued so far
    // would be committed. The guard's second request must fail, because its key was just
    // written. A failed request aborts its transaction unless a handler stops that, and this
    // handler stops it only when every write was issued.
    //
    // The guard's record is an empty list of learned phrases: a record that the stable product
    // writes itself, and no learning data. The destination has no learned phrase, or it would
    // have been refused above. So if the script stops between the guard's two requests, what
    // is committed is that empty list and nothing else.
    let everyWriteIssued = false;
    const guardStore = transaction.objectStore(GUARD_STORE);
    guardStore.put([], GUARD_KEY);
    const guard = guardStore.add([], GUARD_KEY);
    guard.onerror = (event) => {
      if (everyWriteIssued) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // A browser that accepted the same key twice would have no guard. Then nothing is written.
    guard.onsuccess = () => transaction.abort();

    // Every request is issued now, while the transaction is active. They commit or roll back together.
    for (const name of STABLE_SCHEMA.stores) {
      const store = transaction.objectStore(name);
      store.clear();
      for (const [key, value] of section.stores[name]) store.put(value, key);
    }
    everyWriteIssued = true;
    await finished;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The transaction has already finished or was aborted by the browser.
    }
    // Wait for the rollback, so "nothing was changed" is true when it is said.
    await finished.catch(() => undefined);
    throw unchanged(error, STABLE_PRODUCT);
  }
}

/**
 * Recovers the stable product's section of a validated backup file into the stable
 * product's database.
 *
 * Resolves after the data was written and read back. Rejects with a `BackupError`:
 *
 * - `verification`: the writing transaction completed, so the data is in the stable
 *   database. It could not be read back, or it read back differently. This is never
 *   "nothing was recovered";
 * - any other code: the stable product's storage is exactly as it was.
 */
export async function restoreStableSection(file: BackupFile): Promise<void> {
  const { section, digest } = await checkedSection<DatabaseSection>(file, STABLE_PRODUCT, 'the stable version');

  // Opened as it is, without a version: nothing is created and nothing is upgraded here.
  const database = await openExistingDatabase(STABLE_SCHEMA.database);
  if (!database) {
    throw new BackupError('unavailable', 'The stable version has no storage for its data in this browser yet. It creates that storage when it is opened. Open the stable version once, then try again. Nothing was changed.', { product: STABLE_PRODUCT });
  }
  try {
    const storeNames = Array.from(database.objectStoreNames).sort();
    if (database.version !== STABLE_SCHEMA.schemaVersion || storeNames.join('\n') !== [...STABLE_SCHEMA.stores].sort().join('\n')) {
      throw new BackupError('unsupported-version', 'The saved data of the stable version has a storage schema that this version of the application does not know. It is never changed or upgraded from here. Nothing was changed.', { product: STABLE_PRODUCT });
    }
    await writeSection(database, section);
  } finally {
    database.close();
  }

  // The transaction has completed: the data is in the stable database, whatever happens below.
  // From here on a failure is "written, but not checked", never "nothing was recovered".
  let matches: boolean;
  try {
    const written = await readDatabaseSnapshot(STABLE_SCHEMA);
    matches = written.state === 'ok' && (await sectionDigest({ database: STABLE_SCHEMA.database, schemaVersion: STABLE_SCHEMA.schemaVersion, stores: written.stores })) === digest;
  } catch (error) {
    throw new BackupError('verification', `The data of the stable version was written, but it could not be read back to check it. ${detailOf(error)} Do not reset anything because of this message. Check again here, or open the stable version and look at your data.`, { product: STABLE_PRODUCT, cause: error });
  }
  // Proof, not assumption: what the database holds now must be what the file holds.
  if (!matches) {
    throw new BackupError('verification', 'The data of the stable version was written, but reading it back gave another result. Another tab of the stable version may have changed it. Open the stable version and check your data.', { product: STABLE_PRODUCT });
  }
}

// ---- The first version: two key-value records, no transaction ---------------------------------

/** The two things this module does with the browser's key-value storage, on the two records of the first version only. */
type LegacyStorage = { read(key: LegacyKey): string | null; write(key: LegacyKey, value: string): void };

function legacyStorage(): LegacyStorage {
  const storage = globalThis.localStorage;
  // Two methods, so removing or clearing a record is out of reach here. This is the only call that writes a record.
  return { read: (key) => storage.getItem(key), write: (key, value) => storage.setItem(key, value) };
}

const RECORD_NAMES: Record<LegacyKey, string> = { [LEGACY_STATE_KEY]: 'learning data', [LEGACY_THEME_KEY]: 'theme' };

/**
 * Judges the destination and writes the records, in one run without a pause: no other
 * code of this page runs between the reading that the plan is made from and the writes.
 */
function writeLegacyRecords(section: LegacySection): void {
  const fail = (code: BackupError['code'], message: string, cause?: unknown): never => {
    throw new BackupError(code, message, { product: LEGACY_PRODUCT, cause });
  };

  let storage: LegacyStorage;
  const current: LegacyRecords = {};
  try {
    storage = legacyStorage();
    for (const key of LEGACY_KEYS) {
      const value = storage.read(key);
      if (value !== null) current[key] = value;
    }
  } catch (error) {
    return fail('unavailable', `The storage of the previous version (v1) could not be read, so nothing was changed. ${detailOf(error)}`, error);
  }

  const plan = planLegacyRecovery(current, section);
  if (plan.state === 'identical') return;
  if (plan.state === 'occupied') return fail('not-empty', NOT_EMPTY[LEGACY_PRODUCT]);
  if (plan.state === 'unavailable') return fail('unavailable', `${plan.reason} Nothing was changed.`);

  /** What the storage holds now. A record that cannot be read back is not a record that was kept. */
  const kept = (key: LegacyKey): string | null => {
    try {
      return storage.read(key);
    } catch {
      return null;
    }
  };

  // After this run the state record is the backup's when it already was (`partial`) or when it is written now.
  let stateInPlace = plan.state === 'partial';
  for (const key of plan.writes) {
    const text = section.records[key] as string;
    try {
      storage.write(key, text);
    } catch (error) {
      const reason = isQuota(error) ? 'The browser refused to store it: its storage for this site is full.' : detailOf(error);
      if (stateInPlace) {
        return fail('partial', `The recovery of the previous version (v1) is not complete. Its learning data is in this browser and was checked. Its ${RECORD_NAMES[key]} could not be written. ${reason}`, error);
      }
      return fail('write-failed', `The ${RECORD_NAMES[key]} of the previous version (v1) could not be written, and nothing was changed. ${reason}`, error);
    }
    if (kept(key) !== text) {
      return fail('verification', `The ${RECORD_NAMES[key]} of the previous version (v1) was written, but reading it back gave another result. Another tab of the previous version may have changed it. Open the previous version and check your data.`);
    }
    if (key === LEGACY_STATE_KEY) stateInPlace = true;
  }

  // Proof, not assumption: both records, read once more after the last write.
  for (const key of LEGACY_KEYS) {
    if (section.records[key] !== undefined && kept(key) !== section.records[key]) {
      return fail('verification', 'The data of the previous version (v1) was written, but reading it back gave another result. Another tab of the previous version may have changed it. Open the previous version and check your data.');
    }
  }
}

/**
 * Recovers the first version's section of a validated backup file into its two records.
 *
 * Resolves after every record of the section is in the storage and was read back. That
 * includes the completion of an earlier, interrupted recovery: then only the missing
 * record is written. Rejects with a `BackupError`:
 *
 * - `partial`: the learning data is in place and checked, the theme is not. A later call
 *   completes it, as long as the learning data is still the text of the backup;
 * - `verification`: a record was written and then read back differently;
 * - any other code: the two records are exactly as they were.
 */
export async function restoreLegacySection(file: BackupFile): Promise<void> {
  const { section } = await checkedSection<LegacySection>(file, LEGACY_PRODUCT, 'the previous version (v1)');
  writeLegacyRecords(section);
}
