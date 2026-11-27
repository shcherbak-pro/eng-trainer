import { PINNED, type PinnedFile, type PinnedSet } from './pinned';
import { assertPinned } from './verify';

/**
 * The model cache of the experimental product (ENG-V3-02 stage A, ENG-V3-R1B).
 *
 * One Cache Storage cache, named for this product, holds the installed files. Rules:
 *
 * - A file enters the cache only after its bytes matched the pinned list (the installer
 *   calls `stage` after `assertPinned`), and it is checked again each time it is read.
 * - An installation is usable only when its marker exists. The marker is written last
 *   and repeats the pinned list, so a partial or older installation is "not installed".
 * - A missing entry, or one of another length than pinned, means "not installed". Nothing
 *   here fetches from the network.
 * - What the cache holds is said as it is (`inspect`): nothing, a complete installation,
 *   the files of an installation that did not finish, or a damaged one. Looking reads no
 *   file.
 * - **A look is not a snapshot.** Reading takes no lock, so it can run while another tab
 *   installs or removes. It then describes a moment in between: for example files without
 *   a marker while an installation runs. A look does not open a cache that is not there.
 *   But the browser has no way to open a cache only if it exists, so one schedule is left:
 *   a cache that another tab deletes between the question "is it there" and the opening
 *   comes back empty. It holds nothing, is reported as "absent", and goes with the next
 *   removal or is filled by the next installation. Nothing is fetched or removed because
 *   of it.
 * - The marker is written last and deleted first, so an interrupted installation and an
 *   interrupted deletion both leave files without a marker: "incomplete", never usable.
 * - Deletion touches entries of this cache only. Every call names this one cache. The
 *   caches of the site are never listed, and no other cache, database or key-value record
 *   is opened, changed or removed, also not to make room.
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

/**
 * What the model cache holds, for the version of the model that this build uses.
 *
 * `bytes` is what the entries of this version take. `otherBytes` is what everything else
 * in this cache takes: an older or newer version, which this build does not use. Both are
 * this module's own count of stored bytes, not an estimate of the browser.
 */
export type Installation =
  /** No entry of this version. */
  | { state: 'absent'; bytes: 0; otherBytes: number }
  /** The marker, and every pinned file with its pinned length. */
  | { state: 'installed'; bytes: number; otherBytes: number }
  /** Files without the marker: an installation that did not finish. Never usable. */
  | { state: 'incomplete'; bytes: number; files: number; otherBytes: number }
  /** The marker, but a pinned file is missing or has another length. Never usable. */
  | { state: 'damaged'; bytes: number; problems: string[]; otherBytes: number };

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

  /**
   * The length of an entry, as it was stored. `stage` writes the length with each file, and
   * it is read from there: a look at the cache reads no file. Reading 47 MB to count them
   * would be slow, and it would run just before a recording starts. An entry that carries
   * no length is measured: the marker, and an entry that this module did not write.
   */
  async function storedBytes(cache: Cache, url: string): Promise<number | null> {
    const response = await cache.match(url);
    if (!response) return null;
    const stored = response.headers.get('Content-Length');
    if (stored !== null && /^\d+$/.test(stored)) return Number(stored);
    return (await response.blob()).size;
  }

  /**
   * What the cache holds. It looks at the entries and at the lengths that were stored with
   * them, not at contents: that is quick, and a file is checked by size and SHA-256 each
   * time it is read anyway (`read`, `verify`). It does not open a cache that is not there.
   * It is not a snapshot: see the top of this file.
   */
  async function inspect(): Promise<Installation> {
    if (!(await storage().has(MODEL_CACHE_NAME))) return { state: 'absent', bytes: 0, otherBytes: 0 };
    const cache = await storage().open(MODEL_CACHE_NAME);
    let bytes = 0;
    let otherBytes = 0;
    let entries = 0;
    for (const request of await cache.keys()) {
      const size = (await storedBytes(cache, request.url)) ?? 0;
      if (request.url.startsWith(versionPrefix)) {
        bytes += size;
        entries += 1;
      } else {
        otherBytes += size;
      }
    }
    if (!entries) return { state: 'absent', bytes: 0, otherBytes };
    if (!(await hasMarker(cache))) return { state: 'incomplete', bytes, files: entries, otherBytes };
    const problems: string[] = [];
    for (const file of pinned.files) {
      const size = await storedBytes(cache, fileKey(file));
      if (size === null) problems.push(`${file.id} is missing`);
      else if (size !== file.bytes) problems.push(`${file.id} has ${size} bytes, not ${file.bytes}`);
    }
    return problems.length ? { state: 'damaged', bytes, problems, otherBytes } : { state: 'installed', bytes, otherBytes };
  }

  /** True when the marker is valid and every pinned file is there with its pinned length. */
  async function isInstalled(): Promise<boolean> {
    return (await inspect()).state === 'installed';
  }

  /**
   * Reads every pinned file and compares it with the pinned list, by size and SHA-256.
   * Returns what is wrong, one line per file. An empty list means that the installation
   * is exactly the pinned one. This reads the whole model, so it runs on request only.
   */
  async function verify(): Promise<string[]> {
    if (!(await storage().has(MODEL_CACHE_NAME))) return ['no model cache'];
    const cache = await storage().open(MODEL_CACHE_NAME);
    if (!(await hasMarker(cache))) return ['the installation is not complete'];
    const problems: string[] = [];
    for (const file of pinned.files) {
      const response = await cache.match(fileKey(file));
      if (!response) {
        problems.push(`${file.id} is missing`);
        continue;
      }
      try {
        await assertPinned(file, await response.arrayBuffer());
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
    return problems;
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

  /** The marker of an installation, of whatever version. */
  const isMarker = (url: string): boolean => url.endsWith('/complete.json');

  /**
   * Deletes the entries that `keep` does not keep. Markers go first: whatever interrupts a
   * deletion leaves files without a marker, never a marker that promises files.
   */
  async function deleteWhere(keep: (url: string) => boolean): Promise<void> {
    if (!(await storage().has(MODEL_CACHE_NAME))) return;
    const cache = await storage().open(MODEL_CACHE_NAME);
    const doomed = (await cache.keys()).filter((request) => !keep(request.url));
    for (const request of [...doomed.filter((item) => isMarker(item.url)), ...doomed.filter((item) => !isMarker(item.url))]) await cache.delete(request);
  }

  /** Removes the files of an unfinished installation of this version. Other versions stay. */
  async function discardStaged(): Promise<void> {
    await deleteWhere((url) => !url.startsWith(versionPrefix));
  }

  /** After a completed installation: removes the entries of every other version in this cache. */
  async function pruneOtherVersions(): Promise<void> {
    await deleteWhere((url) => url.startsWith(versionPrefix));
  }

  /**
   * "Delete downloaded model", and the removal of leftover or damaged files: this cache
   * and nothing else. Every version in it goes, because no build uses another version.
   */
  async function remove(): Promise<void> {
    await deleteWhere(() => false);
    await storage().delete(MODEL_CACHE_NAME);
  }

  return { pinned, inspect, isInstalled, verify, read, stage, complete, discardStaged, pruneOtherVersions, remove, markerKey, fileKey };
}
