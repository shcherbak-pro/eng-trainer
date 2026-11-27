/**
 * One change of the model cache at a time, across the tabs of this browser (ENG-V3-R1B).
 *
 * An installation removes the leftovers of an earlier attempt before it starts and after
 * it fails, and "Remove" deletes the whole cache. Two tabs doing that at once could delete
 * each other's files: a failed attempt in one tab would remove the model that the other
 * tab had just completed. So a change of the cache holds a lock of the browser, and a
 * second change is refused at once, with a reason, instead of waiting or interleaving.
 *
 * **No lock, no change** (ENG-V3-R1B-RC1). A browser that has no such locks, or that does
 * not give one when it is asked, gets no installation, no cleanup and no removal. The
 * request is refused with a reason and changes nothing. There is no unprotected path.
 *
 * Reading needs no lock: a file is checked against the pinned list each time it is read.
 * A look at the cache is therefore not a snapshot. It can run while another tab changes
 * the cache (store.ts says what follows from that).
 *
 * Nothing of the learning data depends on this lock: it concerns the model cache only.
 */
export const MODEL_LOCK_NAME = 'eng-trainer-v3-models';

/** The speech model is being installed or removed right now, in this tab or in another one. */
export class ModelBusyError extends Error {
  constructor() {
    super('The speech model is being installed or removed at this moment, in this or another tab of this browser. This request changed nothing.');
    this.name = 'ModelBusyError';
  }
}

/** This browser cannot coordinate a change of the model cache between tabs, so the change was not started. */
export class NoCoordinationError extends Error {
  constructor(detail: string) {
    super(`This browser cannot make sure that only one tab changes the speech model at a time (${detail}). So the model is not downloaded, replaced or removed here. This request changed nothing.`);
    this.name = 'NoCoordinationError';
  }
}

export type LockManagerLike = {
  request<T>(name: string, options: { ifAvailable: true }, run: (lock: unknown) => Promise<T>): Promise<T>;
};

export function browserLocks(): LockManagerLike | null {
  const locks = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator?.locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

/** Whether a change of the model cache can be coordinated here at all. The screen offers no change where it cannot. */
export function canCoordinate(locks: LockManagerLike | null = browserLocks()): boolean {
  return locks !== null;
}

/** What the lock callback answers when the lock is held elsewhere. */
const HELD_ELSEWHERE = Symbol('the lock of the model cache is held elsewhere');

/**
 * Runs `change` while no other tab changes the model cache. Otherwise it refuses, and
 * `change` does not run: with `ModelBusyError` when the lock is held, and with
 * `NoCoordinationError` when the browser has no locks or does not give one.
 */
export async function exclusively<T>(change: () => Promise<T>, locks: LockManagerLike | null = browserLocks()): Promise<T> {
  if (!locks) throw new NoCoordinationError('it has no Web Locks');
  let started = false;
  let outcome: T | typeof HELD_ELSEWHERE;
  try {
    // A held lock is answered with a value, and the refusal is raised below, after the browser's
    // callback has returned. Firefox reports a failure inside a callback that got no lock as an
    // uncaught error of the page, also when the caller handles it.
    outcome = await locks.request<T | typeof HELD_ELSEWHERE>(MODEL_LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock) return HELD_ELSEWHERE;
      started = true;
      return change();
    });
  } catch (error) {
    // A failure of the change itself is the caller's to handle. A lock that the browser did
    // not give at all is a refusal: the change never started.
    if (started) throw error;
    const detail = (error as { message?: unknown } | null)?.message;
    throw new NoCoordinationError(`the browser gave no lock: ${typeof detail === 'string' && detail ? detail : String(error)}`);
  }
  if (outcome === HELD_ELSEWHERE) throw new ModelBusyError();
  return outcome;
}
