import type { PinnedFile } from './pinned';

/**
 * What the browser says about this site's storage, and whether a model fits (ENG-V3-R1B).
 *
 * Every version of the trainer keeps its data in the storage that the browser gives to
 * this site: the first version, the stable version, this version and its speech model,
 * and anything else that is published at the same address. That storage has one limit,
 * and a browser that removes it removes all of it. A model is 47 MB in a storage that
 * otherwise holds a few hundred kilobytes of learning data, so it is installed only when
 * this module says that there is room for it, with headroom for the learning data, by the
 * browser's own estimate.
 *
 * What the browser's answers are worth:
 *
 * - **An estimate is not a reservation.** `estimate()` gives two rough numbers for the
 *   whole site. A write can still fail a moment later. The installer handles that.
 * - **A download that succeeds proves nothing about what is left.** A browser can enforce a
 *   limit that its estimate does not show. Then a model is stored and far less room is left
 *   than the headroom that was asked for. Nothing here can reserve storage, so a later save
 *   of learning data, or a recovery from a backup, can still fail for lack of room.
 * - **Unknown counts as insufficient.** A browser that gives no estimate, an answer that
 *   makes no sense and an answer that does not come all mean: no download.
 * - **Persistence is not durability.** A browser that agrees to keep the data only says
 *   that it will not remove it by itself when storage runs low. The data is still lost
 *   when the site's data is cleared, with the browser profile, and with the device. It is
 *   never a backup, and nothing here treats it as one.
 *
 * This is the only module of the feature that asks the browser's storage manager.
 */
export type StorageManagerLike = {
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
};

/** The storage manager of this browser, or null where it has none (an insecure page, an old browser). */
export function browserStorageManager(): StorageManagerLike | null {
  const manager = (globalThis as { navigator?: { storage?: StorageManagerLike } }).navigator?.storage;
  return manager ?? null;
}

/** Usage and limit of the whole site, in bytes, as the browser estimates them. */
export type Estimate = { known: true; usage: number; quota: number } | { known: false; reason: string };

/** What the browser says about keeping this site's data. Never a statement about a backup. */
export type Persistence =
  /** The browser says that it will not remove this site's data by itself. */
  | 'persistent'
  /** The browser may remove this site's data by itself, for example when the device runs low on storage. */
  | 'best-effort'
  /** The browser cannot say. It is treated like best-effort. */
  | 'unknown';

/** The browser's answer to an explicit request to keep this site's data. */
export type PersistenceAnswer = 'granted' | 'declined' | 'unsupported' | 'failed';

/** How long a question that needs no decision of the learner may stay unanswered. */
export const ANSWER_TIMEOUT_MS = 5000;

const detailOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Ends a wait for the browser: an answer that does not come is no answer. */
function within<T>(answer: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the browser did not answer')), timeoutMs);
    answer.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export async function readEstimate(manager: StorageManagerLike | null = browserStorageManager(), timeoutMs = ANSWER_TIMEOUT_MS): Promise<Estimate> {
  if (!manager || typeof manager.estimate !== 'function') return { known: false, reason: 'This browser does not say how much storage this site uses or may use.' };
  let answer: { usage?: number; quota?: number };
  try {
    answer = await within(manager.estimate(), timeoutMs);
  } catch (error) {
    return { known: false, reason: `The browser gave no estimate of this site's storage (${detailOf(error)}).` };
  }
  // A limit of zero, a missing number or a negative one is not an estimate to decide on.
  if (!answer || !isCount(answer.usage) || !isCount(answer.quota) || answer.quota === 0) {
    return { known: false, reason: 'The browser gave an estimate of this site\'s storage that cannot be used.' };
  }
  return { known: true, usage: answer.usage, quota: answer.quota };
}

export async function readPersistence(manager: StorageManagerLike | null = browserStorageManager(), timeoutMs = ANSWER_TIMEOUT_MS): Promise<Persistence> {
  if (!manager || typeof manager.persisted !== 'function') return 'unknown';
  try {
    return (await within(manager.persisted(), timeoutMs)) === true ? 'persistent' : 'best-effort';
  } catch {
    return 'unknown';
  }
}

export function canAskForPersistence(manager: StorageManagerLike | null = browserStorageManager()): boolean {
  return Boolean(manager && typeof manager.persist === 'function');
}

/**
 * Asks the browser to keep this site's data. Call it only from the handler of a control
 * that says so: some browsers answer with a question to the learner, and that question can
 * stay open for as long as the learner likes. So this wait has no time limit.
 */
export async function askForPersistence(manager: StorageManagerLike | null = browserStorageManager()): Promise<PersistenceAnswer> {
  if (!manager || typeof manager.persist !== 'function') return 'unsupported';
  try {
    return (await manager.persist()) === true ? 'granted' : 'declined';
  } catch {
    return 'failed';
  }
}

/**
 * Headroom that is asked for learning data, on top of what a model needs. The application
 * can back up 32 MiB of saved data at most, so this is about twice the largest profile it
 * can handle. It is a condition on the browser's estimate before a download. It is not a
 * reservation: nothing keeps these bytes free afterwards.
 */
export const LEARNING_RESERVE_BYTES = 64_000_000;

/** The room that an installation asks for, in bytes. */
export type Need = {
  /** The files that still have to be stored. */
  files: number;
  /** One more copy of the largest of them: a browser may hold a file twice while it stores it. */
  verifying: number;
  /** Headroom for learning data: asked for by the estimate, not reserved. */
  reserve: number;
  total: number;
};

export function needFor(files: readonly Pick<PinnedFile, 'bytes'>[], reserve: number = LEARNING_RESERVE_BYTES): Need {
  const sum = files.reduce((total, file) => total + file.bytes, 0);
  const largest = files.reduce((most, file) => Math.max(most, file.bytes), 0);
  return { files: sum, verifying: largest, reserve, total: sum + largest + reserve };
}

export type Capacity =
  | { state: 'sufficient'; usage: number; quota: number; free: number; need: Need }
  | { state: 'insufficient'; usage: number; quota: number; free: number; need: Need; shortBy: number }
  /** No usable estimate. It is handled like "insufficient". */
  | { state: 'unknown'; reason: string; need: Need };

/**
 * Whether `need` fits into what the estimate leaves. What the site uses already is never
 * counted as room: not the learning data, and not an older model that is kept until a new
 * one is complete.
 */
export function judgeCapacity(estimate: Estimate, need: Need): Capacity {
  if (!estimate.known) return { state: 'unknown', reason: estimate.reason, need };
  const free = Math.max(0, estimate.quota - estimate.usage);
  if (free >= need.total) return { state: 'sufficient', usage: estimate.usage, quota: estimate.quota, free, need };
  return { state: 'insufficient', usage: estimate.usage, quota: estimate.quota, free, need, shortBy: need.total - free };
}

const megabytes = (bytes: number): string => (bytes / 1_000_000).toFixed(1);

/** The verdict in one or two sentences, for a message. The screen shows the numbers itself. */
export function describeCapacity(capacity: Capacity): string {
  if (capacity.state === 'unknown') return `${capacity.reason} Without an estimate the model is not downloaded.`;
  const room = `The browser estimates ${megabytes(capacity.free)} MB of free storage for this site, and the installation asks for ${megabytes(capacity.need.total)} MB, ${megabytes(capacity.need.reserve)} MB of them as headroom for learning data.`;
  return capacity.state === 'sufficient' ? room : `${room} ${megabytes(capacity.shortBy)} MB are missing, so the model is not downloaded.`;
}
