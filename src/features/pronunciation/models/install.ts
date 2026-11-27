import { describeCapacity, judgeCapacity, needFor, type Capacity, type Estimate } from './capacity';
import { ModelBusyError, NoCoordinationError, exclusively, type LockManagerLike } from './exclusive';
import type { PinnedFile } from './pinned';
import type { ModelStore } from './store';
import { IntegrityError, assertPinned } from './verify';

/**
 * Downloads, verifies and installs the pinned files (ENG-V3-02 stage A, ENG-V3-R1B).
 *
 * This is the only code of the feature that uses the network, and it runs on the page,
 * before any recording. Rules:
 *
 * - Only pinned files are requested, each from one fixed address of this application's
 *   own origin. There is no other host and no fallback.
 * - A redirect is refused, not followed.
 * - A file is held in memory until its size and SHA-256 matched the pinned list. Only
 *   then is it stored. A file that is larger than pinned is dropped while it arrives.
 * - The marker that makes an installation usable is written last. After a failure, a
 *   cancellation or an interruption, the files of this unfinished installation are
 *   removed and the state is "not installed". Files of another version are not touched.
 *
 * Who may start it (ENG-V3-R1B-RC1):
 *
 * - **Only a confirmed download.** `installModel` is the entry point of every download,
 *   and it requests nothing unless it is told that the learner confirmed this download.
 *   Loading a model is another operation (recognition/localMl.ts) and never comes here.
 * - **Only under the lock.** Without the lock of exclusive.ts nothing is requested, stored
 *   or removed: not in a browser without such locks either.
 * - **A complete installation is left alone.** When the cache already holds one, for
 *   example because another tab has just finished it, nothing is requested or removed.
 *
 * Storage (ENG-V3-R1B):
 *
 * - **No request without room.** Before the first request the browser's estimate must
 *   leave room for every file, for one more copy of the largest one, and for headroom for
 *   learning data (capacity.ts). An estimate that is missing or makes no sense means no
 *   download. The estimate is approximate and nothing is reserved: a download that
 *   succeeds does not prove that this headroom is left afterwards.
 * - **Asked again before every further file,** for what is still to be stored. A storage
 *   that filled up meanwhile ends the installation before the next file is requested.
 * - **A write can fail all the same.** An estimate is not a reservation. A file that the
 *   browser refuses to store ends the installation like any other failure.
 * - **Making room is not this module's business.** It removes files of its own unfinished
 *   attempt, in its own cache, and nothing else: no other cache, no database, no record.
 * - **One change at a time.** The whole installation holds the lock of exclusive.ts, so a
 *   second tab cannot remove files under it.
 */
export type InstallFailure =
  /** The server does not have the file: this build is not served together with a model. */
  | 'not-offered'
  /** The request failed or was answered with an error. */
  | 'network'
  /** The server answered with a redirect, or the answer came from another address. */
  | 'redirect'
  /** The bytes are not the pinned file. */
  | 'integrity'
  /** The browser's estimate leaves no room for the model and its headroom, or there is no usable estimate. Nothing was requested for the files that were still missing. */
  | 'capacity'
  /** The browser refused to store a file, for example because its storage for this site is full. */
  | 'storage'
  /** Another tab is installing or removing the model. */
  | 'busy'
  /** This browser cannot make sure that only one tab changes the model cache. Nothing was started. */
  | 'uncoordinated'
  /** The download was not confirmed by the learner. Nothing was started. */
  | 'not-confirmed'
  | 'cancelled';

export class InstallError extends Error {
  constructor(
    readonly reason: InstallFailure,
    message: string,
    /** For `capacity`: the verdict with its numbers. */
    readonly capacity?: Capacity
  ) {
    super(message);
    this.name = 'InstallError';
  }
}

export type InstallOptions = {
  /**
   * True when the learner confirmed this download, on the screen, after reading what it
   * means for the site's storage. Anything else, and nothing is requested.
   */
  confirmed: boolean;
  store: ModelStore;
  /** The fixed, absolute address of a pinned file on this origin. */
  sourceUrl: (file: PinnedFile) => string;
  signal: AbortSignal;
  onProgress: (loaded: number, total: number) => void;
  /** The browser's estimate of this site's storage, read anew at each call. There is no installation without it. */
  readEstimate: () => Promise<Estimate>;
  /** Bytes of headroom that are asked for learning data. Tests pass a small number. */
  reserve?: number;
  fetchFile?: typeof fetch;
  /** The browser's lock manager. Tests pass their own, or null for a browser without one: then nothing is installed. */
  locks?: LockManagerLike | null;
};

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';
/**
 * How browsers name a write that was refused because the site's storage is full. Chromium
 * says QuotaExceededError. Firefox says it for a database, and NS_ERROR_FILE_NO_DEVICE_SPACE
 * for a cache. Any other failure of a write is handled the same way, with a plainer message.
 */
const FULL_STORAGE_ERRORS = ['QuotaExceededError', 'NS_ERROR_FILE_NO_DEVICE_SPACE', 'NS_ERROR_DOM_QUOTA_EXCEEDED_ERR'];
const isQuota = (error: unknown): boolean => FULL_STORAGE_ERRORS.includes(String((error as { name?: unknown } | null)?.name));

async function download(file: PinnedFile, url: string, options: InstallOptions, done: number, total: number): Promise<ArrayBuffer> {
  const fetchFile = options.fetchFile ?? fetch;
  let response: Response;
  try {
    // "manual": a redirect is reported and not followed. "no-store": the browser's HTTP cache is not involved.
    response = await fetchFile(url, { redirect: 'manual', cache: 'no-store', credentials: 'omit', signal: options.signal });
  } catch (error) {
    if (isAbort(error) || options.signal.aborted) throw new InstallError('cancelled', 'The download was cancelled.');
    throw new InstallError('network', `${file.id} could not be requested.`);
  }
  if (response.type === 'opaqueredirect' || response.redirected || response.type !== 'basic' || response.url !== url) {
    throw new InstallError('redirect', `${file.id} was answered with a redirect or from another address. It was not followed.`);
  }
  if (response.status === 404) throw new InstallError('not-offered', `${file.id} is not available from this server.`);
  if (!response.ok || !response.body) throw new InstallError('network', `${file.id}: the server answered ${response.status}.`);

  const reader = response.body.getReader();
  const bytes = new Uint8Array(file.bytes);
  let received = 0;
  try {
    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      if (received + value.byteLength > file.bytes) {
        await reader.cancel();
        throw new IntegrityError(file.id, `is larger than the pinned ${file.bytes} bytes`);
      }
      bytes.set(value, received);
      received += value.byteLength;
      options.onProgress(done + received, total);
    }
  } catch (error) {
    if (error instanceof IntegrityError) throw error;
    if (isAbort(error) || options.signal.aborted) throw new InstallError('cancelled', 'The download was cancelled.');
    throw new InstallError('network', `${file.id}: the download was interrupted.`);
  }
  if (received !== file.bytes) throw new IntegrityError(file.id, `has ${received} bytes, the pinned file has ${file.bytes}`);
  return bytes.buffer;
}

/**
 * Stops unless the browser's estimate leaves room for `remaining` and the reserve. The
 * estimate is read now: what was true before the previous file may not be true any more.
 */
async function requireRoom(remaining: readonly PinnedFile[], options: InstallOptions): Promise<void> {
  let estimate: Estimate;
  try {
    estimate = await options.readEstimate();
  } catch (error) {
    estimate = { known: false, reason: `The browser gave no estimate of this site's storage (${error instanceof Error ? error.message : String(error)}).` };
  }
  const capacity = judgeCapacity(estimate, needFor(remaining, options.reserve));
  if (capacity.state !== 'sufficient') throw new InstallError('capacity', describeCapacity(capacity), capacity);
}

async function install(options: InstallOptions): Promise<void> {
  const { store, signal } = options;
  // Asked under the lock: a complete installation stays as it is. Another tab may have finished
  // it since this screen last looked. Nothing is requested for it, and nothing of it is removed.
  if (await store.isInstalled()) return;
  try {
    if (signal.aborted) throw new InstallError('cancelled', 'The download was cancelled.');
    // Leftovers of an earlier, unfinished attempt of this version are not reused. Removing them
    // comes first, so the room they took counts for this attempt.
    try {
      await store.discardStaged();
    } catch {
      throw new InstallError('storage', 'The files of an earlier download that did not finish could not be removed in this browser.');
    }
    const files = store.pinned.files;
    const total = files.reduce((sum, file) => sum + file.bytes, 0);
    let done = 0;
    for (const [index, file] of files.entries()) {
      // Before the first request, and again before each further one.
      await requireRoom(files.slice(index), options);
      if (signal.aborted) throw new InstallError('cancelled', 'The download was cancelled.');
      if (index === 0) options.onProgress(0, total);
      const bytes = await download(file, options.sourceUrl(file), options, done, total);
      await assertPinned(file, bytes);
      if (signal.aborted) throw new InstallError('cancelled', 'The download was cancelled.');
      try {
        await store.stage(file, bytes);
      } catch (error) {
        throw new InstallError('storage', isQuota(error) ? `The browser refused to store ${file.id}: its storage for this site is full.` : `${file.id} could not be stored in this browser.`);
      }
      done += file.bytes;
      options.onProgress(done, total);
    }
    if (signal.aborted) throw new InstallError('cancelled', 'The download was cancelled.');
    try {
      await store.complete();
    } catch (error) {
      throw new InstallError('storage', isQuota(error) ? 'The browser refused to complete the installation: its storage for this site is full.' : 'The installation could not be completed in this browser.');
    }
  } catch (error) {
    // Only the files of this attempt, in this product's own cache. If even that fails, they
    // stay as files without a marker: never usable, and shown as such.
    await store.discardStaged().catch(() => undefined);
    if (error instanceof InstallError) throw error;
    if (error instanceof IntegrityError) throw new InstallError('integrity', `${error.message}. The file was not stored.`);
    throw new InstallError('network', error instanceof Error ? error.message : String(error));
  }
  // The new installation is complete; an older version is no longer needed.
  await store.pruneOtherVersions().catch(() => undefined);
}

/**
 * Installs the model, or throws an InstallError and leaves no usable or partial installation
 * of this version. This is the entry point of every download: without the learner's
 * confirmation and without the lock of the model cache it starts nothing.
 */
export async function installModel(options: InstallOptions): Promise<void> {
  if (options.confirmed !== true) throw new InstallError('not-confirmed', 'The download of the speech model was not confirmed. Nothing was requested.');
  try {
    await exclusively(() => install(options), options.locks);
  } catch (error) {
    if (error instanceof ModelBusyError) throw new InstallError('busy', error.message);
    if (error instanceof NoCoordinationError) throw new InstallError('uncoordinated', error.message);
    throw error;
  }
}
