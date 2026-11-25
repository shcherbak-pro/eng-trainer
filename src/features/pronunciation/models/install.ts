import type { PinnedFile } from './pinned';
import type { ModelStore } from './store';
import { IntegrityError, assertPinned } from './verify';

/**
 * Downloads, verifies and installs the pinned files (ENG-V3-02, stage A).
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
 * Not part of stage A: the capacity and persistence checks of the Data Safety Gate.
 * Until that gate has passed, this runs in disposable browser profiles only.
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
  /** The browser refused to store the file, for example for lack of space. */
  | 'storage'
  | 'cancelled';

export class InstallError extends Error {
  constructor(
    readonly reason: InstallFailure,
    message: string
  ) {
    super(message);
    this.name = 'InstallError';
  }
}

export type InstallOptions = {
  store: ModelStore;
  /** The fixed, absolute address of a pinned file on this origin. */
  sourceUrl: (file: PinnedFile) => string;
  signal: AbortSignal;
  onProgress: (loaded: number, total: number) => void;
  fetchFile?: typeof fetch;
};

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

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

/** Installs the model, or throws an InstallError and leaves no usable or partial installation of this version. */
export async function installModel(options: InstallOptions): Promise<void> {
  const { store, signal } = options;
  try {
    if (signal.aborted) throw new InstallError('cancelled', 'The download was cancelled.');
    // Leftovers of an earlier, unfinished attempt of this version are not reused.
    await store.discardStaged();
    const files = store.pinned.files;
    const total = files.reduce((sum, file) => sum + file.bytes, 0);
    let done = 0;
    options.onProgress(0, total);
    for (const file of files) {
      const bytes = await download(file, options.sourceUrl(file), options, done, total);
      await assertPinned(file, bytes);
      if (signal.aborted) throw new InstallError('cancelled', 'The download was cancelled.');
      try {
        await store.stage(file, bytes);
      } catch {
        throw new InstallError('storage', `${file.id} could not be stored in this browser.`);
      }
      done += file.bytes;
      options.onProgress(done, total);
    }
    if (signal.aborted) throw new InstallError('cancelled', 'The download was cancelled.');
    try {
      await store.complete();
    } catch {
      throw new InstallError('storage', 'The installation could not be completed in this browser.');
    }
  } catch (error) {
    await store.discardStaged().catch(() => undefined);
    if (error instanceof InstallError) throw error;
    if (error instanceof IntegrityError) throw new InstallError('integrity', `${error.message}. The file was not stored.`);
    throw new InstallError('network', error instanceof Error ? error.message : String(error));
  }
  // The new installation is complete; an older version is no longer needed.
  await store.pruneOtherVersions().catch(() => undefined);
}
