import { get } from 'svelte/store';
import { holdState, initState, initStateWithoutStorage, releaseState, stateHeld } from '../../state';
import { persistenceSettled, retrySave, saveStatus } from '../../state/persistence';
import { DATABASE_NAME, DATABASE_VERSION, STORE_NAMES } from '../../storage/database';
import { BackupError, DATABASE_SCHEMAS, EXPERIMENTAL_PRODUCT, GUARD_KEY, GUARD_STORE, hasDigest, sectionDigest, type BackupFile, type DatabaseSection, type StorePairs } from './format';
import { openExistingDatabase, readDatabaseSnapshot } from './snapshot';
import { learningDataIn } from './summary';
import { checkSection } from './validate';

/**
 * Recovers this product's section of a backup into this product's own database (ENG-V3-R1A).
 *
 * The destination is fixed: the database this build was made for. No argument, file
 * content or address can name another one, so this module cannot write the stable
 * product's database or the records of the first version. Those two sections are
 * recovered by recoveryWriter.ts, a file of its own.
 *
 * Rules:
 *
 * - Only into a destination without learning data. Recovery never overwrites and never
 *   merges. Saved preferences are not learning data: they are replaced by those of the
 *   backup, and the learner is told so before confirming.
 * - One read-write transaction. The destination is judged again inside it, so data that
 *   appeared since the preview stops the recovery. Every record is written in it, or
 *   none: a failure rolls everything back. That also holds when the script itself stops
 *   in the middle of the writes, see the guard in `writeSection`.
 * - After the write the database is read again, and its digest must be the digest in the
 *   file. Only then is the result reported as recovered.
 * - The running application hands over to the recovery in one synchronous step
 *   (ENG-V3-R1A-RC3). Until that step, the tab works as always: a change is accepted and
 *   saved. The step itself is `holdState`: it succeeds only when nothing waits to be saved
 *   and nothing is being written, and from then on the state services accept no change
 *   and nothing of this tab is written. A change is therefore either accepted and in the
 *   database before the recovery looks at it, or not accepted at all. A change that could
 *   not be saved stops the recovery, and stays where it was, with its way to try again.
 * - What follows depends on the transaction, never on this tab:
 *   - rolled back or refused: the hold ends, and the application goes on with the state
 *     and the storage it had. Nothing of it was replaced, dropped or switched off;
 *   - committed: the state in memory is now the state from before the recovery. The tab is
 *     detached from its storage, and saving comes back in one way only: the application
 *     loads its state from the database again. If the check or that loading fails, the tab
 *     stays detached and the learner is asked to reload: old state is never saved over
 *     recovered data.
 */
const OWN_SCHEMA = DATABASE_SCHEMAS[EXPERIMENTAL_PRODUCT];

export type Destination =
  /** No learning data: a recovery is possible. */
  | { state: 'empty' }
  /** The database holds exactly the section it was compared with: there is nothing to recover. */
  | { state: 'identical' }
  /** Learning data exists, and it is not that of the section. `holds` describes it. */
  | { state: 'occupied'; holds: string[] }
  /** The database cannot be used for a recovery. */
  | { state: 'unavailable'; reason: string };

const NOT_EMPTY = 'This version already holds learning data in this browser. A recovery never overwrites data, so nothing was changed.';
/** Said whenever a recovery leaves this tab detached from its storage. */
const DETACHED = 'This tab saves nothing until the page is reloaded, so that nothing can be written over the recovered data. Reload the page.';
/** The refusals of the handover. Each of them leaves the tab exactly as it was. */
const UNSAVED = 'The latest changes in this tab could not be saved, so nothing was recovered: a recovery must not replace changes that exist only here. They are still on screen. Choose “Try saving again” at the top of the page, then start the recovery again.';
const LEFT = 'The Backup screen was closed before the recovery began, so nothing was recovered and nothing was changed.';
const ALREADY_RUNNING = 'Another recovery is still running in this tab, so this one did not start. Nothing was changed.';
const NOT_CONNECTED = 'This tab is not connected to its saved data, so nothing can be recovered now. Reload the page and try again. Nothing was changed.';

const detailOf = (error: unknown): string => (error instanceof Error ? error.message : String(error ?? 'unknown error'));
const ownSection = (stores: Record<string, StorePairs>): DatabaseSection => ({ database: OWN_SCHEMA.database, schemaVersion: OWN_SCHEMA.schemaVersion, stores });

function assertOwnProduct(): void {
  // The backup feature exists in one product. A build for another one must never get here.
  if (DATABASE_NAME !== OWN_SCHEMA.database || DATABASE_VERSION !== OWN_SCHEMA.schemaVersion) {
    throw new BackupError('unavailable', 'This build of the application has no recovery.');
  }
  // "Continue without saving": the session deliberately uses no storage. A recovery would
  // switch saving back on behind the learner's back, so it waits for a reload.
  if (get(saveStatus).state === 'disabled') {
    throw new BackupError('unavailable', 'Saving is switched off in this session, so nothing can be recovered now. Reload the page and try again.');
  }
}

/**
 * What the destination holds now. The answer is for the preview; the recovery itself checks again.
 *
 * With `expectedDigest`, the digest of the section that would be recovered, a database
 * that holds exactly that section is reported as `identical`. That is how a recovery
 * that was written but could not be checked is checked later, from the file alone.
 */
export async function inspectDestination(expectedDigest?: string): Promise<Destination> {
  try {
    assertOwnProduct();
    await persistenceSettled();
    const snapshot = await readDatabaseSnapshot(OWN_SCHEMA);
    if (snapshot.state === 'absent') return { state: 'unavailable', reason: 'This version has no saved data storage in this browser. Saving may be switched off in this session. Reload the page and try again.' };
    if (snapshot.state === 'unsupported') return { state: 'unavailable', reason: 'The saved data of this version has a storage schema that this version of the application does not know.' };
    const holds = learningDataIn(snapshot.stores);
    if (!holds.length) return { state: 'empty' };
    if (expectedDigest !== undefined && (await hasDigest(ownSection(snapshot.stores), expectedDigest))) return { state: 'identical' };
    return { state: 'occupied', holds };
  } catch (error) {
    return { state: 'unavailable', reason: detailOf(error) };
  }
}

const settle = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/** Writes the section in one transaction, after judging the destination inside that transaction. */
async function writeSection(database: IDBDatabase, section: DatabaseSection): Promise<void> {
  const transaction = database.transaction([...OWN_SCHEMA.stores], 'readwrite');
  const finished = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new DOMException('The transaction was aborted.', 'AbortError'));
  });
  // The failure is reported by the code below. This keeps it from also being an unhandled rejection.
  finished.catch(() => undefined);

  try {
    const current: Record<string, StorePairs> = {};
    await Promise.all(STORE_NAMES.map(async (name) => {
      const store = transaction.objectStore(name);
      const [keys, values] = await Promise.all([settle(store.getAllKeys()), settle(store.getAll())]);
      current[name] = keys.map((key, index): [string, unknown] => [String(key), values[index]]);
    }));
    if (learningDataIn(current).length) throw new BackupError('not-empty', NOT_EMPTY);

    // A browser commits a transaction as soon as its requests are done and no script adds more.
    // It does not know that this script meant to add more. If the script stops between two
    // writes (the tab is closed and the browser cancels the script, or it runs out of memory),
    // no `catch` block runs, and the writes issued so far would be committed: half a recovery.
    //
    // The guard closes that. Its second request must fail, because the key was just written.
    // A failed request aborts its transaction, unless a handler stops that. This handler stops
    // it only when every write below was issued. So the transaction can commit in one case
    // only: the script got to the end of the list, and was still there to say so.
    //
    // The guard's record is an empty list of learned phrases (see format.ts): a record that the
    // application writes itself, and no learning data. The destination has no learned phrase, or
    // it would have been refused above. So if the script stops between the guard's two requests,
    // what is committed is that empty list and nothing else.
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

    // Every request is issued now, while the transaction is active. They commit or roll back
    // together. Clearing the guard's store replaces its record by the records of the backup.
    for (const name of OWN_SCHEMA.stores) {
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
    if (error instanceof BackupError) throw error;
    const quota = (error as { name?: unknown } | null)?.name === 'QuotaExceededError';
    const detail = error instanceof Error ? error.message : String(error ?? 'unknown error');
    throw new BackupError('write-failed', quota
      ? 'The browser refused to store the data: its storage for this site is full. Nothing was changed.'
      : `The data could not be written, and nothing was changed. ${detail}`, { cause: error });
  }
}

/**
 * What is checked after the transaction has completed: the database must read back as the
 * file, and the running application must load it. Loading is also what attaches the tab to
 * its storage again. Every failure here is `verification`: written, but not checked.
 */
async function checkAndLoad(digest: string): Promise<void> {
  let matches: boolean;
  try {
    const written = await readDatabaseSnapshot(OWN_SCHEMA);
    matches = written.state === 'ok' && (await sectionDigest(ownSection(written.stores))) === digest;
  } catch (error) {
    throw new BackupError('verification', `The data was written, but it could not be read back to check it. ${detailOf(error)} ${DETACHED} Then choose the backup file again: the screen says whether this version holds exactly its data.`, { cause: error });
  }
  // Proof, not assumption: what the database holds now must be what the file holds.
  if (!matches) {
    throw new BackupError('verification', `The data was written, but reading it back gave another result. Another tab of this application may have changed it. ${DETACHED} Then check your data.`);
  }
  try {
    await initState();
  } catch (error) {
    // A start that failed half-way leaves nothing connected.
    initStateWithoutStorage();
    throw new BackupError('verification', `The data was written and checked, but the application could not load it. ${detailOf(error)} ${DETACHED}`, { cause: error });
  }
}

/**
 * Recovers the experimental section of a validated backup file.
 *
 * Resolves after the data was written, read back and loaded into the running
 * application. Rejects with a `BackupError`:
 *
 * - `verification`: the writing transaction completed, so the data is in the database.
 *   It could not be read back, or it read back differently, or the application could not
 *   load it. This is never "nothing was recovered". The tab is left detached from its
 *   storage and saves nothing until the page is reloaded;
 * - any other code: the database is exactly as it was, and so is the running application.
 *   It keeps its state, its storage and every change that still waits to be saved.
 *
 * `options.screenOpen` says whether the screen that asked for the recovery is still open.
 * It is asked in the step that takes the hold, and not after it: where the screen was
 * closed before, the transaction is not started. Once it is started, it is not interrupted.
 */
export async function restoreOwnSection(file: BackupFile, options: { screenOpen?: () => boolean } = {}): Promise<void> {
  assertOwnProduct();
  const section = file.sections[EXPERIMENTAL_PRODUCT];
  const digest = file.integrity.sections[EXPERIMENTAL_PRODUCT];
  if (!section || !digest) throw new BackupError('malformed', 'The backup holds no data of this version.');
  // Judged again here, so this function is safe for any caller, not only after a preview.
  checkSection(EXPERIMENTAL_PRODUCT, section);
  if ((await sectionDigest(section)) !== digest) throw new BackupError('integrity', 'The data of this version does not match its digest.', { product: EXPERIMENTAL_PRODUCT });

  // Preparation. The tab works as always while this waits: a change is accepted and saved.
  const database = await openExistingDatabase(DATABASE_NAME);
  if (!database) throw new BackupError('unavailable', 'This version has no saved data storage in this browser. Reload the page and try again.');
  /** Whether this call holds the changes. Only then does it end the hold. */
  let held = false;
  try {
    try {
      const storeNames = Array.from(database.objectStoreNames).sort();
      if (database.version !== OWN_SCHEMA.schemaVersion || storeNames.join('\n') !== [...OWN_SCHEMA.stores].sort().join('\n')) {
        throw new BackupError('unsupported-version', 'The saved data of this version has a storage schema that this version of the application does not know. Nothing was changed.');
      }
      // The handover.
      while (!held) {
        // Everything this tab has accepted goes to the database first: the write that is running, and
        // what waits behind it. The recovery then judges the destination with all of it in place.
        await persistenceSettled();
        // From here to the hold nothing is awaited, so nothing can change between a question and the hold.
        if (options.screenOpen && !options.screenOpen()) throw new BackupError('unavailable', LEFT);
        // A change that could not be saved exists in this tab only. It stays there, with its way to try again.
        if (get(saveStatus).state === 'error') throw new BackupError('unavailable', UNSAVED);
        const hold = holdState();
        if (hold === 'unavailable') throw new BackupError('unavailable', stateHeld() ? ALREADY_RUNNING : NOT_CONNECTED);
        held = hold === 'held';
        // Otherwise something still waits that nothing is writing. It is started, and the questions are asked again.
        if (!held) await retrySave();
      }
      // Held: no change is accepted, and nothing of this tab is written. The transaction is created
      // in the same step as the hold, so it stands behind every write that this tab started before.
      await writeSection(database, section);
    } finally {
      database.close();
    }
    // The transaction has completed: the data is in the database, whatever happens below, and the
    // state in memory is the one from before. The tab is detached at once. From here on a failure
    // is "written, but not checked", and the tab stays detached.
    initStateWithoutStorage();
    await checkAndLoad(digest);
  } finally {
    // After a refusal or a rollback the tab goes on as it was. After a recovery it saves again, with
    // the state it has just loaded. After a failed check it is detached, and stays so.
    if (held) releaseState();
  }
}
