import { askForPersistence, canAskForPersistence, judgeCapacity, needFor, readEstimate, readPersistence, type Capacity, type Estimate, type Persistence, type PersistenceAnswer, type StorageManagerLike } from './capacity';
import { browserLocks, canCoordinate, type LockManagerLike } from './exclusive';
import type { Installation, ModelStore } from './store';

/**
 * What the screen shows about the model's place in this browser, and what it can ask the
 * browser about it (ENG-V3-R1B).
 *
 * Everything here concerns the model cache and the browser's own answers about the site's
 * storage. Nothing here reads or changes learning data, and nothing here changes the
 * cache: removing is the recognizer's `remove`, installing is the installer.
 */
export type StorageFacts = {
  estimate: Estimate;
  /** Whether the whole model fits now, with its headroom, by the browser's estimate. Judged for a complete download. */
  capacity: Capacity;
  persistence: Persistence;
  canAskForPersistence: boolean;
  /** Whether this browser can make sure that only one tab changes the model cache. Without that, nothing is installed or removed. */
  canCoordinate: boolean;
};

export type ModelStorage = {
  /** The size of a complete download, in bytes. */
  readonly totalBytes: number;
  /** The browser's estimate, the verdict for a download of this model, and what the browser says about keeping data. */
  facts(): Promise<StorageFacts>;
  /** What the model cache holds: nothing, an installation, leftovers, or a damaged one. */
  inspect(): Promise<Installation>;
  /** Reads and hashes every installed file. Returns what is wrong, one line per file. */
  verify(): Promise<string[]>;
  /** Asks the browser to keep this site's data. Only after an explicit action of the learner. */
  askForPersistence(): Promise<PersistenceAnswer>;
};

export function createModelStorage(deps: { store: ModelStore; manager: () => StorageManagerLike | null; locks?: () => LockManagerLike | null }): ModelStorage {
  const locks = deps.locks ?? browserLocks;
  return {
    totalBytes: deps.store.pinned.files.reduce((sum, file) => sum + file.bytes, 0),
    async facts(): Promise<StorageFacts> {
      const manager = deps.manager();
      const [estimate, persistence] = await Promise.all([readEstimate(manager), readPersistence(manager)]);
      return {
        estimate,
        capacity: judgeCapacity(estimate, needFor(deps.store.pinned.files)),
        persistence,
        canAskForPersistence: canAskForPersistence(manager),
        canCoordinate: canCoordinate(locks())
      };
    },
    inspect: () => deps.store.inspect(),
    verify: () => deps.store.verify(),
    askForPersistence: () => askForPersistence(deps.manager())
  };
}
