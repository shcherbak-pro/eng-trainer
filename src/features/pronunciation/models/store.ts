import { PINNED, type PinnedFile, type PinnedSet } from './pinned';
import { assertPinned } from './verify';

/**
 * The model cache of the experimental product (ENG-V3-02, stage A).
 *
 * One Cache Storage cache, named for this product, holds the installed files. Rules:
 *
 * - A file enters the cache only after its bytes matched the pinned list (the installer
 *   calls `stage` after `assertPinned`), and it is checked again each time it is read.
 * - An installation is usable only when its marker exists. The marker is written last
 *   and repeats the pinned list, so a partial or older installation is "not installed".
 * - A missing entry means "not installed". Nothing here fetches from the network.
 * - Deletion touches entries of this cache only: never another cache, a database or
 *   localStorage.
 *
 * The page (installer, state) and the Worker (loading) both use this module. Keys are
 * absolute addresses below the site's base path, the same at whatever route the product
 * is published. They are never requested from a server: they only name entries.
 */
export const MODEL_CACHE_NAME = 'eng-trainer-v3-models';

/** The model is not on this device, or its installation is incomplete. */
export class NotInstalledError extends Error {
  constructor(detail: string) {
    super(`The speech model is not installed: ${detail}`);
    this.name = 'NotInstalledError';
  }
}

export type CacheStorageLike = Pick<CacheStorage, 'open' | 'has' | 'delete'>;

/** Whether this browser offers Cache Storage here. It does so in secure contexts only. */
export function hasCacheStorage(): boolean {
  return typeof caches !== 'undefined';
}

type Marker = { version: string; files: { id: string; bytes: number; sha256: string }[] };

export type ModelStore = ReturnType<typeof createModelStore>;

/** `pinned` is the application's own list. Tests pass a small one. */
export function createModelStore(options: { keyBase: string; storage?: CacheStorageLike; pinned?: PinnedSet }) {
  const pinned = options.pinned ?? PINNED;
  const expectedMarker = (): Marker => ({
    version: pinned.version,
    files: pinned.files.map((file) => ({ id: file.id, bytes: file.bytes, sha256: file.sha256 }))
  });
  const storage = (): CacheStorageLike => options.storage ?? caches;
  const keyBase = options.keyBase;
  const versionPrefix = `${keyBase}${pinned.version}/`;
  const markerKey = `${versionPrefix}complete.json`;
  const fileKey = (file: PinnedFile): string => `${versionPrefix}${file.id}`;

  async function hasMarker(cache: Cache): Promise<boolean> {
    const response = await cache.match(markerKey);
    if (!response) return false;
    try {
      return JSON.stringify(await response.json()) === JSON.stringify(expectedMarker());
    } catch {
      return false;
    }
  }

  /** True when the marker is valid and every pinned file has an entry. Never creates the cache. */
  async function isInstalled(): Promise<boolean> {
    if (!(await storage().has(MODEL_CACHE_NAME))) return false;
    const cache = await storage().open(MODEL_CACHE_NAME);
    if (!(await hasMarker(cache))) return false;
    for (const file of pinned.files) if (!(await cache.match(fileKey(file)))) return false;
    return true;
  }

  /** The verified bytes of an installed file. Throws when it is missing or is not the pinned file. */
  async function read(file: PinnedFile): Promise<ArrayBuffer> {
    if (!(await storage().has(MODEL_CACHE_NAME))) throw new NotInstalledError('no model cache');
    const cache = await storage().open(MODEL_CACHE_NAME);
    if (!(await hasMarker(cache))) throw new NotInstalledError('the installation is not complete');
    const response = await cache.match(fileKey(file));
    if (!response) throw new NotInstalledError(`${file.id} is missing`);
    const bytes = await response.arrayBuffer();
    await assertPinned(file, bytes);
    return bytes;
  }

  /** Stores one file of an installation in progress. The caller has verified `bytes`. */
  async function stage(file: PinnedFile, bytes: ArrayBuffer): Promise<void> {
    const cache = await storage().open(MODEL_CACHE_NAME);
    await cache.put(fileKey(file), new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.byteLength) } }));
  }

  /** Writes the marker. Called last, after every file was staged. */
  async function complete(): Promise<void> {
    const cache = await storage().open(MODEL_CACHE_NAME);
    for (const file of pinned.files) if (!(await cache.match(fileKey(file)))) throw new NotInstalledError(`${file.id} was not stored`);
    await cache.put(markerKey, new Response(JSON.stringify(expectedMarker()), { headers: { 'Content-Type': 'application/json' } }));
  }

  async function deleteWhere(keep: (url: string) => boolean): Promise<void> {
    if (!(await storage().has(MODEL_CACHE_NAME))) return;
    const cache = await storage().open(MODEL_CACHE_NAME);
    for (const request of await cache.keys()) if (!keep(request.url)) await cache.delete(request);
  }

  /** Removes the files of an unfinished installation of this version. Other versions stay. */
  async function discardStaged(): Promise<void> {
    await deleteWhere((url) => !url.startsWith(versionPrefix));
  }

  /** After a completed installation: removes the entries of every other version in this cache. */
  async function pruneOtherVersions(): Promise<void> {
    await deleteWhere((url) => url.startsWith(versionPrefix));
  }

  /** "Delete downloaded model": this cache and nothing else. */
  async function remove(): Promise<void> {
    await deleteWhere(() => false);
    await storage().delete(MODEL_CACHE_NAME);
  }

  return { pinned, isInstalled, read, stage, complete, discardStaged, pruneOtherVersions, remove, markerKey, fileKey };
}
