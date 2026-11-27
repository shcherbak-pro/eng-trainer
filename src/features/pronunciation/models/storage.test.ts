import { beforeEach, expect, it } from 'vitest';
import { describeExperimental } from '../../../test/product';
import { fakeCacheStorage, fakeLocks, fakeStorageManager, gate, inPieces, pinnedSet, served, syntheticBytes, type FakeCacheStorage } from '../testing';
import { LEARNING_RESERVE_BYTES, askForPersistence, canAskForPersistence, describeCapacity, judgeCapacity, needFor, readEstimate, readPersistence, type Estimate } from './capacity';
import { MODEL_LOCK_NAME, ModelBusyError, NoCoordinationError, canCoordinate, exclusively } from './exclusive';
import { InstallError, installModel } from './install';
import { createModelStorage } from './management';
import { PINNED_FILES, TOTAL_BYTES, type PinnedFile, type PinnedSet } from './pinned';
import { MODEL_CACHE_NAME, createModelStore } from './store';

/**
 * Storage safety of the speech model (ENG-V3-R1B): what the browser says about the site's
 * storage, whether a model fits, what the model cache holds, and an installer that asks
 * for room and survives a full storage. Small synthetic files, an in-memory cache and a
 * storage manager under the test's control: no real profile, model or network.
 */
const KEY_BASE = 'http://localhost:3000/eng-trainer/model-cache/';
const SOURCE = 'http://localhost:3000/eng-trainer/v3/models/test/';
const known = (usage: number, quota: number): Estimate => ({ known: true, usage, quota });

describeExperimental('storage estimate', () => {
  it('gives the two numbers of the whole site', async () => {
    const manager = fakeStorageManager({ usage: 1_234_567, quota: 2_000_000_000 });
    expect(await readEstimate(manager.like)).toEqual({ known: true, usage: 1_234_567, quota: 2_000_000_000 });
    expect(manager.calls).toEqual(['estimate']);
  });

  it('a browser without the interface, a failure and an answer that does not come are all "not known"', async () => {
    expect(await readEstimate(null)).toEqual({ known: false, reason: 'This browser does not say how much storage this site uses or may use.' });
    expect(await readEstimate({})).toEqual({ known: false, reason: 'This browser does not say how much storage this site uses or may use.' });

    const failing = fakeStorageManager();
    failing.fail = new Error('The operation is insecure.');
    expect(await readEstimate(failing.like)).toEqual({ known: false, reason: "The browser gave no estimate of this site's storage (The operation is insecure.)." });

    const silent = { estimate: () => new Promise<{ usage?: number; quota?: number }>(() => undefined) };
    expect(await readEstimate(silent, 20)).toEqual({ known: false, reason: "The browser gave no estimate of this site's storage (the browser did not answer)." });
  });

  it('an answer that is not two usable numbers is "not known"', async () => {
    const unusable = { known: false, reason: "The browser gave an estimate of this site's storage that cannot be used." };
    const answers: unknown[] = [undefined, null, {}, { usage: 5 }, { quota: 5 }, { usage: -1, quota: 100 }, { usage: 1, quota: -100 }, { usage: Number.NaN, quota: 100 }, { usage: 1, quota: Number.POSITIVE_INFINITY }, { usage: '1', quota: '100' }, { usage: 0, quota: 0 }];
    for (const answer of answers) {
      expect(await readEstimate({ estimate: async () => answer as { usage?: number; quota?: number } }), JSON.stringify(answer)).toEqual(unusable);
    }
    // Nothing used yet is a usable answer.
    expect(await readEstimate({ estimate: async () => ({ usage: 0, quota: 100 }) })).toEqual({ known: true, usage: 0, quota: 100 });
  });
});

describeExperimental('room for a model', () => {
  it('asks for every file, one more copy of the largest, and headroom for learning data', () => {
    expect(needFor([{ bytes: 40 }, { bytes: 100 }, { bytes: 70 }], 500)).toEqual({ files: 210, verifying: 100, reserve: 500, total: 810 });
    expect(needFor([], 500)).toEqual({ files: 0, verifying: 0, reserve: 500, total: 500 });
    // The application's own model: 46.8 MB of files, the 20.2 MB decoder once more, 64 MB of reserve.
    expect(LEARNING_RESERVE_BYTES).toBe(64_000_000);
    expect(needFor(PINNED_FILES)).toEqual({ files: TOTAL_BYTES, verifying: 20_243_286, reserve: 64_000_000, total: 131_035_888 });
  });

  it('is sufficient only when the free part of the estimate covers all of it', () => {
    const need = needFor([{ bytes: 100 }], 50);
    expect(need.total).toBe(250);
    expect(judgeCapacity(known(750, 1000), need)).toEqual({ state: 'sufficient', usage: 750, quota: 1000, free: 250, need });
    expect(judgeCapacity(known(751, 1000), need)).toEqual({ state: 'insufficient', usage: 751, quota: 1000, free: 249, need, shortBy: 1 });
    // What the site uses already is never counted as room, also not when it is more than the limit.
    expect(judgeCapacity(known(1200, 1000), need)).toEqual({ state: 'insufficient', usage: 1200, quota: 1000, free: 0, need, shortBy: 250 });
  });

  it('without an estimate there is no verdict in favour of a download', () => {
    const need = needFor([{ bytes: 100 }], 50);
    expect(judgeCapacity({ known: false, reason: 'No answer.' }, need)).toEqual({ state: 'unknown', reason: 'No answer.', need });
  });

  it('says the verdict in words, with the numbers and with the reserve', () => {
    const need = needFor(PINNED_FILES);
    expect(describeCapacity(judgeCapacity(known(400_000_000, 500_000_000), need))).toBe(
      'The browser estimates 100.0 MB of free storage for this site, and the installation asks for 131.0 MB, 64.0 MB of them as headroom for learning data. 31.0 MB are missing, so the model is not downloaded.'
    );
    expect(describeCapacity(judgeCapacity(known(0, 500_000_000), need))).toBe('The browser estimates 500.0 MB of free storage for this site, and the installation asks for 131.0 MB, 64.0 MB of them as headroom for learning data.');
    expect(describeCapacity(judgeCapacity({ known: false, reason: 'No answer.' }, need))).toBe('No answer. Without an estimate the model is not downloaded.');
  });
});

describeExperimental('what the browser says about keeping data', () => {
  it('reads the state without asking for anything', async () => {
    const manager = fakeStorageManager({ persisted: false });
    expect(await readPersistence(manager.like)).toBe('best-effort');
    manager.persisted = true;
    expect(await readPersistence(manager.like)).toBe('persistent');
    expect(manager.calls).toEqual(['persisted', 'persisted']);
  });

  it('a browser that cannot say, fails or does not answer is "unknown"', async () => {
    expect(await readPersistence(null)).toBe('unknown');
    expect(await readPersistence({})).toBe('unknown');
    const failing = fakeStorageManager();
    failing.fail = new Error('denied');
    expect(await readPersistence(failing.like)).toBe('unknown');
    expect(await readPersistence({ persisted: () => new Promise<boolean>(() => undefined) }, 20)).toBe('unknown');
    // Only a plain "true" is taken for a promise of the browser.
    expect(await readPersistence({ persisted: async () => 'yes' as unknown as boolean })).toBe('best-effort');
  });

  it('asks only when told to, and reports the answer as it is', async () => {
    const granting = fakeStorageManager({ grant: true });
    expect(canAskForPersistence(granting.like)).toBe(true);
    expect(granting.calls).toEqual([]);
    expect(await askForPersistence(granting.like)).toBe('granted');
    expect(granting.calls).toEqual(['persist']);

    expect(await askForPersistence(fakeStorageManager({ grant: false }).like)).toBe('declined');

    const failing = fakeStorageManager();
    failing.fail = new Error('not allowed');
    expect(await askForPersistence(failing.like)).toBe('failed');

    expect(canAskForPersistence(null)).toBe(false);
    expect(canAskForPersistence({ estimate: async () => ({}) })).toBe(false);
    expect(await askForPersistence(null)).toBe('unsupported');
    expect(await askForPersistence({})).toBe('unsupported');
  });

  it('waits for an answer that depends on the learner, for as long as it takes', async () => {
    const manager = fakeStorageManager({ grant: true });
    manager.wait = gate();
    let answer: string | null = null;
    void askForPersistence(manager.like).then((value) => { answer = value; });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(answer).toBeNull();
    manager.wait.open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(answer).toBe('granted');
  });
});

describeExperimental('one change of the model cache at a time', () => {
  it('holds the lock of the model cache for the whole change, and releases it after a failure too', async () => {
    const locks = fakeLocks();
    const during: string[][] = [];
    expect(await exclusively(async () => {
      during.push(locks.held());
      return 'done';
    }, locks)).toBe('done');
    expect(during).toEqual([[MODEL_LOCK_NAME]]);
    expect(MODEL_LOCK_NAME).toBe('eng-trainer-v3-models');
    expect(locks.held()).toEqual([]);

    await expect(exclusively(async () => { throw new Error('the change failed'); }, locks)).rejects.toThrow('the change failed');
    expect(locks.held()).toEqual([]);
  });

  it('refuses a second change at once, and that change does not run', async () => {
    const locks = fakeLocks();
    const first = gate();
    const running = exclusively(() => first.promise, locks);
    let ran = false;
    await expect(exclusively(async () => { ran = true; }, locks)).rejects.toThrow(ModelBusyError);
    expect(ran).toBe(false);
    first.open();
    await running;

    // Another tab holds the lock.
    locks.heldElsewhere = true;
    await expect(exclusively(async () => { ran = true; }, locks)).rejects.toThrow('This request changed nothing.');
    expect(ran).toBe(false);
  });

  it('F2: without a lock manager the change does not run: there is no unprotected path', async () => {
    let ran = false;
    const refused = await exclusively(async () => { ran = true; }, null).then(() => null, (error: unknown) => error);
    expect(refused).toBeInstanceOf(NoCoordinationError);
    expect((refused as Error).message).toBe('This browser cannot make sure that only one tab changes the speech model at a time (it has no Web Locks). So the model is not downloaded, replaced or removed here. This request changed nothing.');
    expect(ran).toBe(false);
    expect(canCoordinate(null)).toBe(false);
    expect(canCoordinate(fakeLocks())).toBe(true);
  });

  it('F2: a lock that the browser does not give at all is a refusal too, and the change does not run', async () => {
    const locks = fakeLocks();
    locks.refuse = new DOMException('The operation is insecure.', 'SecurityError');
    let ran = false;
    const refused = await exclusively(async () => { ran = true; }, locks).then(() => null, (error: unknown) => error);
    expect(refused).toBeInstanceOf(NoCoordinationError);
    expect((refused as Error).message).toContain('the browser gave no lock: The operation is insecure.');
    expect(ran).toBe(false);
  });

  it('a failure of the change itself is not taken for a missing lock', async () => {
    const failure = new Error('the change failed');
    await expect(exclusively(async () => { throw failure; }, fakeLocks())).rejects.toBe(failure);
  });
});

describeExperimental('what the model cache holds, and an installer that asks for room', () => {
  let storage: FakeCacheStorage;
  let files: Record<string, Uint8Array>;
  let pinned: PinnedSet;
  let requested: string[];
  /** What the browser estimates. Tests change it between files. */
  let estimate: Estimate;
  let estimates: number;

  const RESERVE = 1000;
  const store = (set: PinnedSet = pinned) => createModelStore({ storage, keyBase: KEY_BASE, pinned: set });
  const sourceUrl = (file: PinnedFile): string => `${SOURCE}${file.id}`;
  const prefix = (set: PinnedSet = pinned): string => `${KEY_BASE}${set.version}/`;
  const staged = (set: PinnedSet = pinned): string[] => storage.entries(MODEL_CACHE_NAME).filter((url) => url.startsWith(prefix(set)));
  const bufferOf = (id: string): ArrayBuffer => files[id].slice().buffer as ArrayBuffer;

  function server(answer: (url: string, id: string) => Response | undefined | Promise<Response | undefined> = () => undefined): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requested.push(url);
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const id = url.slice(SOURCE.length);
      return (await answer(url, id)) ?? served(url, inPieces(files[id], 16));
    }) as typeof fetch;
  }

  type Options = { set?: PinnedSet; signal?: AbortSignal; readEstimate?: () => Promise<Estimate>; locks?: ReturnType<typeof fakeLocks> | null; confirmed?: boolean };
  const install = (fetchFile: typeof fetch = server(), options: Options = {}): Promise<void> =>
    installModel({
      store: store(options.set),
      sourceUrl,
      signal: options.signal ?? new AbortController().signal,
      onProgress: () => undefined,
      reserve: RESERVE,
      readEstimate: options.readEstimate ?? (async () => {
        estimates += 1;
        return estimate;
      }),
      // Every installation needs the learner's confirmation and a lock manager. A test that looks at their absence says so.
      confirmed: options.confirmed ?? true,
      locks: options.locks === undefined ? fakeLocks() : options.locks,
      fetchFile
    });

  async function failure(run: Promise<void>): Promise<InstallError> {
    try {
      await run;
    } catch (error) {
      expect(error).toBeInstanceOf(InstallError);
      return error as InstallError;
    }
    throw new Error('the installation did not fail');
  }

  beforeEach(async () => {
    storage = fakeCacheStorage();
    requested = [];
    estimates = 0;
    // 40 + 100 + 70 bytes. The whole installation asks for 210 + 100 + 1000 = 1310 bytes.
    files = { 'model/config.json': syntheticBytes(1, 40), 'model/weights.bin': syntheticBytes(2, 100), 'runtime/runtime.wasm': syntheticBytes(3, 70) };
    pinned = await pinnedSet('test-model-1', files);
    estimate = known(0, 1_000_000);
  });

  // ---- What the cache holds -------------------------------------------------------------

  it('nothing: "absent", and looking does not create the cache', async () => {
    expect(await store().inspect()).toEqual({ state: 'absent', bytes: 0, otherBytes: 0 });
    expect(await store().verify()).toEqual(['no model cache']);
    expect(storage.names()).toEqual([]);
  });

  it('a complete installation: "installed", with the bytes it takes', async () => {
    await install();
    // 210 bytes of files and the marker.
    const marker = JSON.stringify({ version: pinned.version, files: pinned.files.map((file) => ({ id: file.id, bytes: file.bytes, sha256: file.sha256 })) }).length;
    expect(await store().inspect()).toEqual({ state: 'installed', bytes: 210 + marker, otherBytes: 0 });
    expect(await store().verify()).toEqual([]);
    // Looking writes nothing.
    const puts = storage.puts.length;
    await store().inspect();
    await store().verify();
    expect(storage.puts).toHaveLength(puts);
  });

  it('files without the marker: "incomplete", never installed, never readable', async () => {
    await store().stage(pinned.files[0], bufferOf('model/config.json'));
    await store().stage(pinned.files[1], bufferOf('model/weights.bin'));
    expect(await store().inspect()).toEqual({ state: 'incomplete', bytes: 140, files: 2, otherBytes: 0 });
    expect(await store().isInstalled()).toBe(false);
    expect(await store().verify()).toEqual(['the installation is not complete']);
    await expect(store().read(pinned.files[0])).rejects.toThrow('the installation is not complete');

    // Every file, and still no marker: an interruption just before the last write.
    await store().stage(pinned.files[2], bufferOf('runtime/runtime.wasm'));
    expect(await store().inspect()).toEqual({ state: 'incomplete', bytes: 210, files: 3, otherBytes: 0 });
    expect(await store().isInstalled()).toBe(false);
  });

  it('a marker with a missing or shortened file: "damaged", never installed', async () => {
    await install();
    const cache = await storage.open(MODEL_CACHE_NAME);
    await cache.delete(store().fileKey(pinned.files[0]));
    // An entry that was stored with another length, as another writer would leave it.
    await cache.put(store().fileKey(pinned.files[2]), new Response(syntheticBytes(3, 5).buffer as ArrayBuffer, { headers: { 'Content-Length': '5' } }));

    const found = await store().inspect();
    expect(found.state).toBe('damaged');
    expect(found.state === 'damaged' && found.problems).toEqual(['model/config.json is missing', 'runtime/runtime.wasm has 5 bytes, not 70']);
    expect(await store().isInstalled()).toBe(false);
    await expect(store().read(pinned.files[0])).rejects.toThrow('model/config.json is missing');
    expect(await store().verify()).toEqual(['model/config.json is missing', 'runtime/runtime.wasm: has 5 bytes, the pinned file has 70']);
  });

  it('a file of the right length with other contents is found when it is read or checked', async () => {
    await install();
    storage.corrupt(MODEL_CACHE_NAME, store().fileKey(pinned.files[1]), syntheticBytes(9, 100));
    // The quick look goes by lengths.
    expect((await store().inspect()).state).toBe('installed');
    // Reading and the full check go by contents.
    expect(await store().verify()).toEqual(['model/weights.bin: does not have the pinned SHA-256']);
    await expect(store().read(pinned.files[1])).rejects.toThrow('does not have the pinned SHA-256');

    // The same for a body that lost its end on the disk, while the entry still says the stored length.
    storage.corrupt(MODEL_CACHE_NAME, store().fileKey(pinned.files[1]), files['model/weights.bin'].slice(0, 60));
    expect((await store().inspect()).state).toBe('installed');
    expect(await store().verify()).toEqual(['model/weights.bin: has 60 bytes, the pinned file has 100']);
    await expect(store().read(pinned.files[1])).rejects.toThrow('has 60 bytes, the pinned file has 100');
  });

  it('a look at the cache reads no file: the lengths come from the entries', async () => {
    await install();
    const other = await pinnedSet('test-model-0', files);
    await store(other).stage(other.files[1], bufferOf('model/weights.bin'));
    storage.bodiesRead.length = 0;

    const found = await store().inspect();
    expect(found.state).toBe('installed');
    expect(found.otherBytes).toBe(100);
    expect(await store().isInstalled()).toBe(true);
    // Only the marker was read, which is a few hundred bytes. No model file and no runtime.
    expect(storage.bodiesRead.length).toBeGreaterThan(0);
    expect(storage.bodiesRead.every((url) => url === store().markerKey)).toBe(true);

    // An entry without a stored length is measured, so that it is still counted.
    const cache = await storage.open(MODEL_CACHE_NAME);
    await cache.put(`${KEY_BASE}test-model-9/model/unknown.bin`, new Response(syntheticBytes(7, 33).buffer as ArrayBuffer));
    expect((await store().inspect()).otherBytes).toBe(133);

    // The full check and a read do read the files.
    storage.bodiesRead.length = 0;
    await store().verify();
    expect(storage.bodiesRead.filter((url) => url !== store().markerKey)).toEqual(pinned.files.map((file) => store().fileKey(file)));
  });

  it('a marker that is not this list\'s marker counts as no marker', async () => {
    await install();
    const cache = await storage.open(MODEL_CACHE_NAME);
    await cache.put(store().markerKey, new Response('not json'));
    expect((await store().inspect()).state).toBe('incomplete');
    await cache.put(store().markerKey, new Response(JSON.stringify({ version: pinned.version, files: [] })));
    expect((await store().inspect()).state).toBe('incomplete');
    expect(await store().isInstalled()).toBe(false);
  });

  it('entries of another version are counted apart and are not this version\'s installation', async () => {
    await install();
    const next = await pinnedSet('test-model-2', files);
    const installed = await store().inspect();
    expect(await store(next).inspect()).toEqual({ state: 'absent', bytes: 0, otherBytes: installed.bytes });
    await store(next).stage(next.files[0], bufferOf('model/config.json'));
    expect(await store(next).inspect()).toEqual({ state: 'incomplete', bytes: 40, files: 1, otherBytes: installed.bytes });
    expect(await store().inspect()).toEqual({ ...installed, otherBytes: 40 });
  });

  // ---- ENG-V3-R1B-RC1, F4: what a look is ------------------------------------------------

  it('F4: a look is not a snapshot. A cache that another tab removes between the two steps of a look comes back empty, and that changes nothing', async () => {
    await install();
    const puts = storage.puts.length;
    // The reviewer's schedule: the look has asked "is it there", and before it opens the cache another tab removes it.
    const arrived = gate();
    const finish = gate();
    const reader = createModelStore({
      keyBase: KEY_BASE,
      pinned,
      storage: {
        ...storage,
        async has(name: string) {
          const found = await storage.has(name);
          arrived.open();
          await finish.promise;
          return found;
        }
      }
    });
    const looking = reader.inspect();
    await arrived.promise;
    await store().remove();
    expect(storage.names()).toEqual([]);
    finish.open();

    // What the look says is right: nothing is there.
    expect(await looking).toEqual({ state: 'absent', bytes: 0, otherBytes: 0 });
    // The limit: a browser cannot open a cache only if it exists. An empty cache of this name is back.
    expect(storage.names()).toEqual([MODEL_CACHE_NAME]);
    expect(storage.entries(MODEL_CACHE_NAME)).toEqual([]);
    expect(storage.puts).toHaveLength(puts);

    // It holds nothing and makes nothing usable. Nothing is requested because of it.
    expect(await store().inspect()).toEqual({ state: 'absent', bytes: 0, otherBytes: 0 });
    expect(await store().isInstalled()).toBe(false);
    expect(await store().verify()).toEqual(['the installation is not complete']);
    await expect(store().read(pinned.files[0])).rejects.toThrow('The speech model is not installed');
    expect(requested).toHaveLength(pinned.files.length);

    // The next removal deletes it, and the next installation fills it.
    await store().remove();
    expect(storage.names()).toEqual([]);
    await install();
    expect((await store().inspect()).state).toBe('installed');
  });

  // ---- ENG-V3-R1B-RC1, F1 and F2: who may start an installation ----------------------------

  it('F1: the installer starts nothing without the learner\'s confirmation: no lock, no estimate, no request, no cache', async () => {
    const locks = fakeLocks();
    for (const confirmed of [false, undefined, null, 1, 'true', {}] as unknown as boolean[]) {
      const error = await failure(installModel({ store: store(), sourceUrl, signal: new AbortController().signal, onProgress: () => undefined, readEstimate: async () => { estimates += 1; return estimate; }, reserve: RESERVE, locks, fetchFile: server(), confirmed }));
      expect(error.reason).toBe('not-confirmed');
      expect(error.message).toBe('The download of the speech model was not confirmed. Nothing was requested.');
    }
    expect(locks.requests).toEqual([]);
    expect(estimates).toBe(0);
    expect(requested).toEqual([]);
    expect(storage.names()).toEqual([]);

    await install(server(), { locks, confirmed: true });
    expect(await store().isInstalled()).toBe(true);
  });

  it('F1: a complete installation is left alone: a second installation requests nothing and removes nothing', async () => {
    await install();
    const entries = storage.entries(MODEL_CACHE_NAME);
    const puts = storage.puts.length;
    requested = [];
    estimates = 0;
    // Another tab finished the model, and this screen still asked for a download. Even a server that fails does no harm.
    await install((async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch);
    expect(requested).toEqual([]);
    expect(estimates).toBe(0);
    expect(storage.entries(MODEL_CACHE_NAME)).toEqual(entries);
    expect(storage.puts).toHaveLength(puts);
    expect(await store().verify()).toEqual([]);
  });

  it('F2: without a lock manager nothing is installed, and the leftovers of an earlier attempt are not touched either', async () => {
    await store().stage(pinned.files[0], bufferOf('model/config.json'));
    const error = await failure(install(server(), { locks: null }));
    expect(error.reason).toBe('uncoordinated');
    expect(error.message).toBe('This browser cannot make sure that only one tab changes the speech model at a time (it has no Web Locks). So the model is not downloaded, replaced or removed here. This request changed nothing.');
    expect(estimates).toBe(0);
    expect(requested).toEqual([]);
    // The cleanup did not start either: one tab without a lock must not remove what another tab stores.
    expect(staged()).toHaveLength(1);

    const refusing = fakeLocks();
    refusing.refuse = new DOMException('The operation is insecure.', 'SecurityError');
    const second = await failure(install(server(), { locks: refusing }));
    expect(second.reason).toBe('uncoordinated');
    expect(second.message).toContain('the browser gave no lock: The operation is insecure.');
    expect(requested).toEqual([]);
    expect(staged()).toHaveLength(1);
  });

  it('F2: the reviewer\'s schedule: an attempt that fails cannot erase the model that another tab completed', async () => {
    // Without locks, where the review found it: A starts and waits, B installs, A fails and cleans up. Now neither starts.
    const arrived = gate();
    const finish = gate();
    const interrupted = (async () => {
      arrived.open();
      await finish.promise;
      throw new Error('A interrupted');
    }) as typeof fetch;
    expect((await failure(install(interrupted, { locks: null }))).reason).toBe('uncoordinated');
    expect((await failure(install(server(), { locks: null }))).reason).toBe('uncoordinated');
    expect(storage.names()).toEqual([]);

    // With locks: while A downloads, B is refused. B installs after A has ended, and A's cleanup is over by then.
    const locks = fakeLocks();
    const a = failure(install(interrupted, { locks }));
    await arrived.promise;
    expect((await failure(install(server(), { locks }))).reason).toBe('busy');
    finish.open();
    expect((await a).reason).toBe('network');
    expect((await store().inspect()).state).toBe('absent');
    await install(server(), { locks });
    expect((await store().inspect()).state).toBe('installed');
    expect(locks.held()).toEqual([]);
  });

  // ---- Room before a download -----------------------------------------------------------

  it('installs when the estimate leaves exactly the room that is asked for, and asks before every file', async () => {
    estimate = known(1_000_000 - 1310, 1_000_000);
    await install();
    expect(await store().isInstalled()).toBe(true);
    expect(estimates).toBe(3);
    expect(requested).toEqual(pinned.files.map(sourceUrl));
  });

  it('one byte short: nothing is requested, nothing is stored, and the cache is not even created', async () => {
    estimate = known(1_000_000 - 1309, 1_000_000);
    const error = await failure(install());
    expect(error.reason).toBe('capacity');
    expect(error.capacity).toEqual({ state: 'insufficient', usage: 998_691, quota: 1_000_000, free: 1309, need: { files: 210, verifying: 100, reserve: 1000, total: 1310 }, shortBy: 1 });
    expect(error.message).toContain('so the model is not downloaded');
    expect(requested).toEqual([]);
    expect(storage.names()).toEqual([]);
    expect(storage.puts).toEqual([]);
  });

  it('no estimate, an unusable one or a failing question: no download', async () => {
    const questions: (() => Promise<Estimate>)[] = [
      async () => ({ known: false, reason: 'This browser does not say how much storage this site uses or may use.' }),
      // The application's own reading of an answer with one number only.
      () => readEstimate({ estimate: async () => ({ usage: 5 }) }),
      async () => { throw new Error('the storage manager is gone'); }
    ];
    for (const ask of questions) {
      const error = await failure(install(server(), { readEstimate: ask }));
      expect(error.reason).toBe('capacity');
      expect(error.capacity?.state).toBe('unknown');
      expect(error.message).toContain('Without an estimate the model is not downloaded.');
    }
    expect(requested).toEqual([]);
    expect(storage.names()).toEqual([]);
  });

  it('a storage that fills up during the download ends it before the next file is requested', async () => {
    // Room for everything at first. After the first file the site has almost none left.
    const fetchFile = server((_url, id) => {
      if (id === 'model/config.json') estimate = known(1_000_000 - 1200, 1_000_000);
      return undefined;
    });
    const error = await failure(install(fetchFile));
    expect(error.reason).toBe('capacity');
    // Asked for what was still to be stored: 100 + 70 bytes, the largest once more, and the reserve.
    expect(error.capacity).toMatchObject({ state: 'insufficient', free: 1200, need: { files: 170, verifying: 100, reserve: 1000, total: 1270 }, shortBy: 70 });
    expect(requested).toEqual([sourceUrl(pinned.files[0])]);
    // The file of this attempt is gone again, and nothing is installed.
    expect(staged()).toEqual([]);
    expect(await store().inspect()).toEqual({ state: 'absent', bytes: 0, otherBytes: 0 });
  });

  it('the leftovers of an earlier attempt are removed before room is asked for, so they do not count against the new attempt', async () => {
    await store().stage(pinned.files[1], bufferOf('model/weights.bin'));
    expect((await store().inspect()).state).toBe('incomplete');
    const seen: string[][] = [];
    await install(server(), { readEstimate: async () => {
      seen.push(staged());
      return estimate;
    } });
    expect(seen[0]).toEqual([]);
    expect(await store().isInstalled()).toBe(true);
    // Every file was requested again: a leftover is never reused.
    expect(requested).toEqual(pinned.files.map(sourceUrl));
  });

  it('a damaged installation is replaced by a new download', async () => {
    await install();
    const cache = await storage.open(MODEL_CACHE_NAME);
    await cache.delete(store().fileKey(pinned.files[0]));
    expect((await store().inspect()).state).toBe('damaged');
    requested = [];
    await install();
    expect((await store().inspect()).state).toBe('installed');
    expect(await store().verify()).toEqual([]);
    expect(requested).toEqual(pinned.files.map(sourceUrl));
  });

  // ---- A write that fails after a good estimate ------------------------------------------

  it('a full storage at any write ends the installation, leaves nothing of it, and says so', async () => {
    const foreign = await storage.open('another-cache');
    await foreign.put('http://localhost:3000/kept', new Response('kept'));

    for (const file of pinned.files) {
      storage.failPut = (url) => url === store().fileKey(file);
      const error = await failure(install());
      expect(error.reason).toBe('storage');
      expect(error.message).toBe(`The browser refused to store ${file.id}: its storage for this site is full.`);
      expect(staged()).toEqual([]);
      expect(await store().isInstalled()).toBe(false);
    }
    storage.failPut = (url) => url === store().markerKey;
    const error = await failure(install());
    expect(error.reason).toBe('storage');
    expect(error.message).toBe('The browser refused to complete the installation: its storage for this site is full.');
    expect(staged()).toEqual([]);

    // Nothing else was touched to make room.
    expect(storage.names()).toEqual(['another-cache', MODEL_CACHE_NAME]);
    expect(storage.entries('another-cache')).toEqual(['http://localhost:3000/kept']);

    // The next attempt, with room again, installs.
    storage.failPut = null;
    await install();
    expect(await store().isInstalled()).toBe(true);
    expect(await store().verify()).toEqual([]);
  });

  it('says "full" for the names that browsers give a full storage, and handles every other failed write the same way', async () => {
    const message = async (name: string): Promise<string> => {
      storage.failName = name;
      storage.failPut = (url) => url === store().fileKey(pinned.files[1]);
      const error = await failure(install());
      expect(error.reason).toBe('storage');
      expect(staged()).toEqual([]);
      expect(await store().isInstalled()).toBe(false);
      return error.message;
    };
    const full = 'The browser refused to store model/weights.bin: its storage for this site is full.';
    // Chromium, and Firefox for a cache write (seen in the browser acceptance test).
    expect(await message('QuotaExceededError')).toBe(full);
    expect(await message('NS_ERROR_FILE_NO_DEVICE_SPACE')).toBe(full);
    expect(await message('NS_ERROR_DOM_QUOTA_EXCEEDED_ERR')).toBe(full);
    // A failure with another name is not called a full storage, and is not treated more kindly.
    expect(await message('UnknownError')).toBe('model/weights.bin could not be stored in this browser.');
    expect(await message('InvalidStateError')).toBe('model/weights.bin could not be stored in this browser.');
  });

  it('a cleanup that fails does not hide the failure, and leaves only files that are never used', async () => {
    storage.failPut = (url) => url === store().fileKey(pinned.files[2]);
    storage.failDelete = () => true;
    const error = await failure(install());
    expect(error.reason).toBe('storage');
    expect(error.message).toBe('The browser refused to store runtime/runtime.wasm: its storage for this site is full.');
    // The two files that were stored could not be removed. They have no marker.
    expect(await store().inspect()).toMatchObject({ state: 'incomplete', files: 2 });
    expect(await store().isInstalled()).toBe(false);
    await expect(store().read(pinned.files[0])).rejects.toThrow('the installation is not complete');

    // The next attempt cannot remove them either: it ends before anything is requested.
    storage.failPut = null;
    requested = [];
    const again = await failure(install());
    expect(again.reason).toBe('storage');
    expect(again.message).toBe('The files of an earlier download that did not finish could not be removed in this browser.');
    expect(requested).toEqual([]);

    storage.failDelete = null;
    await install();
    expect(await store().isInstalled()).toBe(true);
    expect(await store().verify()).toEqual([]);
  });

  it('a deletion that is interrupted leaves files without a marker, never a marker without its files', async () => {
    await install();
    expect((await store().inspect()).state).toBe('installed');
    // The removal fails at the second entry it reaches.
    let deletions = 0;
    storage.failDelete = () => (deletions += 1) === 2;
    await expect(store().remove()).rejects.toThrow('The entry could not be deleted.');
    expect(staged()).not.toContain(store().markerKey);
    expect(await store().inspect()).toMatchObject({ state: 'incomplete', files: 3 });
    expect(await store().isInstalled()).toBe(false);

    // The same for the cleanup before a new download, which replaces a damaged installation: a marker
    // and two of three files. Here every deletion after the first one fails.
    storage.failDelete = null;
    await install();
    await (await storage.open(MODEL_CACHE_NAME)).delete(store().fileKey(pinned.files[0]));
    expect((await store().inspect()).state).toBe('damaged');
    deletions = 0;
    storage.failDelete = () => (deletions += 1) >= 2;
    expect((await failure(install())).reason).toBe('storage');
    expect(staged()).not.toContain(store().markerKey);
    expect(await store().inspect()).toMatchObject({ state: 'incomplete', files: 2 });

    storage.failDelete = null;
    await store().remove();
    expect(storage.names()).toEqual([]);
  });

  it('a failed update keeps the complete previous version, whatever the failure', async () => {
    await install();
    const previous = pinned;
    const previousState = await store(previous).inspect();
    const oldFiles = files;
    files = { 'model/config.json': syntheticBytes(4, 40), 'model/weights.bin': syntheticBytes(5, 120), 'runtime/runtime.wasm': syntheticBytes(6, 70) };
    const next = await pinnedSet('test-model-2', files);

    // No room for the update: the old model is not removed to make room.
    estimate = known(1_000_000 - 100, 1_000_000);
    expect((await failure(install(server(), { set: next }))).reason).toBe('capacity');
    expect(await store(previous).inspect()).toEqual(previousState);

    // A full storage in the middle of the update.
    estimate = known(0, 1_000_000);
    storage.failPut = (url) => url === store(next).fileKey(next.files[1]);
    expect((await failure(install(server(), { set: next }))).reason).toBe('storage');
    expect(await store(previous).inspect()).toEqual(previousState);
    expect(new Uint8Array(await store(previous).read(previous.files[1]))).toEqual(oldFiles['model/weights.bin']);
    expect(staged(next)).toEqual([]);
  });

  // ---- Interruption, retry, cycles -------------------------------------------------------

  it('an interrupted installation is never usable, and a retry installs', async () => {
    // The page is closed in the middle: the first file is stored and nothing after it happens.
    await store().stage(pinned.files[0], bufferOf('model/config.json'));
    expect(await store().isInstalled()).toBe(false);
    await expect(store().read(pinned.files[0])).rejects.toThrow('The speech model is not installed');

    // A retry that is interrupted by the network, and one that is cancelled.
    expect((await failure(install(server((url, id) => (id === 'model/weights.bin' ? served(url, inPieces(files[id], 16), { failAfter: 2 }) : undefined))))).reason).toBe('network');
    expect(staged()).toEqual([]);
    const controller = new AbortController();
    expect((await failure(install(server((_url, id) => {
      if (id === 'runtime/runtime.wasm') controller.abort();
      return undefined;
    }), { signal: controller.signal }))).reason).toBe('cancelled');
    expect(staged()).toEqual([]);
    expect(await store().inspect()).toEqual({ state: 'absent', bytes: 0, otherBytes: 0 });

    await install();
    expect(await store().isInstalled()).toBe(true);
    expect(await store().verify()).toEqual([]);
  });

  it('installing and removing again and again ends in the same two states, and touches nothing else', async () => {
    const foreign = await storage.open('another-cache');
    await foreign.put('http://localhost:3000/kept', new Response('kept'));
    let installedState: unknown = null;
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await install();
      const found = await store().inspect();
      expect(found.state).toBe('installed');
      installedState ??= found;
      expect(found).toEqual(installedState);
      expect(await store().verify()).toEqual([]);

      await store().remove();
      expect(await store().inspect()).toEqual({ state: 'absent', bytes: 0, otherBytes: 0 });
      expect(storage.names()).toEqual(['another-cache']);
    }
    expect(storage.entries('another-cache')).toEqual(['http://localhost:3000/kept']);
    expect(await (await foreign.match('http://localhost:3000/kept'))!.text()).toBe('kept');
  });

  it('removing takes incomplete files, damaged files and other versions with it, and only this cache', async () => {
    const foreign = await storage.open('another-cache');
    await foreign.put('http://localhost:3000/kept', new Response('kept'));
    await install();
    const next = await pinnedSet('test-model-2', files);
    await store(next).stage(next.files[0], bufferOf('model/config.json'));
    expect(await store(next).inspect()).toMatchObject({ state: 'incomplete', files: 1 });
    expect((await store(next).inspect()).otherBytes).toBeGreaterThan(0);

    await store(next).remove();
    expect(storage.names()).toEqual(['another-cache']);
    expect(await store(next).inspect()).toEqual({ state: 'absent', bytes: 0, otherBytes: 0 });
    expect(await store().inspect()).toEqual({ state: 'absent', bytes: 0, otherBytes: 0 });
  });

  // ---- Two tabs ---------------------------------------------------------------------------

  it('holds the lock while it installs: a second installation is refused and does not disturb the first', async () => {
    const locks = fakeLocks();
    const held = gate();
    const first = install(server(async (_url, id) => {
      if (id === 'model/weights.bin') await held.promise;
      return undefined;
    }), { locks });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(locks.held()).toEqual([MODEL_LOCK_NAME]);
    expect(staged()).toHaveLength(1);

    const requestsBefore = requested.length;
    const second = await failure(install(server(), { locks }));
    expect(second.reason).toBe('busy');
    expect(second.message).toContain('This request changed nothing.');
    // The refused installation requested nothing and removed nothing of the running one.
    expect(requested).toHaveLength(requestsBefore);
    expect(staged()).toHaveLength(1);

    held.open();
    await first;
    expect(await store().isInstalled()).toBe(true);
    expect(locks.held()).toEqual([]);
  });

  it('another tab holds the lock: no estimate is read, nothing is requested, nothing changes', async () => {
    await store().stage(pinned.files[0], bufferOf('model/config.json'));
    const locks = fakeLocks();
    locks.heldElsewhere = true;
    expect((await failure(install(server(), { locks }))).reason).toBe('busy');
    expect(estimates).toBe(0);
    expect(requested).toEqual([]);
    // The other tab's files in progress are still there.
    expect(staged()).toHaveLength(1);
  });

  it('releases the lock after a failed installation', async () => {
    const locks = fakeLocks();
    estimate = known(999_999, 1_000_000);
    expect((await failure(install(server(), { locks }))).reason).toBe('capacity');
    expect(locks.held()).toEqual([]);
    estimate = known(0, 1_000_000);
    await install(server(), { locks });
    expect(await store().isInstalled()).toBe(true);
  });

  // ---- What the screen is told -------------------------------------------------------------

  it('the storage facts: the estimate, the verdict for the whole model, and what the browser says about keeping data', async () => {
    const manager = fakeStorageManager({ usage: 1_000_000, quota: 2_000_000_000, persisted: false });
    const modelStorage = createModelStorage({ store: store(), manager: () => manager.like });
    const facts = await modelStorage.facts();
    expect(facts.estimate).toEqual({ known: true, usage: 1_000_000, quota: 2_000_000_000 });
    expect(facts.capacity).toMatchObject({ state: 'sufficient', free: 1_999_000_000, need: { files: 210, verifying: 100, reserve: 64_000_000 } });
    expect(facts.persistence).toBe('best-effort');
    expect(facts.canAskForPersistence).toBe(true);
    // Reading the facts asked for nothing.
    expect(manager.calls.sort()).toEqual(['estimate', 'persisted']);

    manager.quota = 60_000_000;
    expect((await modelStorage.facts()).capacity.state).toBe('insufficient');

    manager.grant = true;
    expect(await modelStorage.askForPersistence()).toBe('granted');
    expect((await modelStorage.facts()).persistence).toBe('persistent');

    expect(await modelStorage.inspect()).toEqual({ state: 'absent', bytes: 0, otherBytes: 0 });
    expect(await modelStorage.verify()).toEqual(['no model cache']);
    expect(storage.names()).toEqual([]);
  });

  it('a browser without a storage manager: nothing is known, nothing can be asked, and no download is allowed', async () => {
    const modelStorage = createModelStorage({ store: store(), manager: () => null });
    const facts = await modelStorage.facts();
    expect(facts.estimate.known).toBe(false);
    expect(facts.capacity.state).toBe('unknown');
    expect(facts.persistence).toBe('unknown');
    expect(facts.canAskForPersistence).toBe(false);
    expect(await modelStorage.askForPersistence()).toBe('unsupported');
  });
});
