import { beforeEach, expect, it, vi } from 'vitest';
import { describeExperimental } from '../../../test/product';
import { fakeCacheStorage, inPieces, last, pinnedSet, served, syntheticBytes, type FakeCacheStorage } from '../testing';
import { InstallError, installModel, type InstallFailure } from './install';
import { MODEL, MODEL_VERSION, PINNED, PINNED_FILES, RUNTIME, TOTAL_BYTES, pinnedFile, type PinnedFile, type PinnedSet } from './pinned';
import { MODEL_CACHE_NAME, NotInstalledError, createModelStore } from './store';
import { IntegrityError, assertPinned, sha256Hex } from './verify';

/**
 * The pinned list, the verifier, the model cache and the installer (ENG-V3-02, stage A),
 * with small synthetic files and an in-memory cache. Failures are injected: no real
 * profile, model or network is used.
 */
const KEY_BASE = 'http://localhost:3000/eng-trainer/v3/model-cache/';
const SOURCE = 'http://localhost:3000/eng-trainer/v3/models/test/';

describeExperimental('pinned files', () => {
  it('lists five model files and one runtime file, with exact sizes and SHA-256', () => {
    expect(PINNED_FILES.map((file) => file.id)).toEqual([
      'model/config.json',
      'model/preprocessor_config.json',
      'model/tokenizer.json',
      'model/onnx/encoder_model_quantized.onnx',
      'model/onnx/decoder_model_merged_quantized.onnx',
      'runtime/ort-wasm-simd-threaded.wasm'
    ]);
    for (const file of PINNED_FILES) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Number.isInteger(file.bytes) && file.bytes > 0).toBe(true);
    }
    expect(TOTAL_BYTES).toBe(46_792_602);
    expect(PINNED).toEqual({ version: MODEL_VERSION, files: PINNED_FILES });
  });

  it('pins the model to a full commit, never to a branch or a tag, and names the installation by model and runtime', () => {
    expect(MODEL.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(MODEL.repository).toBe('onnx-community/moonshine-tiny-ONNX');
    expect(MODEL.licence).toBe('MIT');
    expect(MODEL.id).toBe(`moonshine-tiny-q8-${MODEL.revision.slice(0, 12)}`);
    expect(RUNTIME).toEqual({ package: 'onnxruntime-web', version: '1.31.1', licence: 'MIT' });
    expect(MODEL_VERSION).toBe(`${MODEL.id}-ort-${RUNTIME.version}`);
  });

  it('knows no file outside the list', () => {
    expect(pinnedFile('model/config.json').bytes).toBe(921);
    expect(() => pinnedFile('model/generation_config.json')).toThrow('is not a pinned file');
    expect(() => pinnedFile('model/../secret')).toThrow('is not a pinned file');
  });
});

describeExperimental('verifier', () => {
  it('computes SHA-256', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('accepts exactly the pinned bytes: another size or one changed byte is refused', async () => {
    const bytes = syntheticBytes(1, 64);
    const file: PinnedFile = { id: 'model/a.bin', kind: 'model', path: 'a.bin', bytes: 64, sha256: await sha256Hex(bytes) };
    await expect(assertPinned(file, bytes)).resolves.toBeUndefined();

    await expect(assertPinned(file, bytes.slice(0, 63))).rejects.toThrow(IntegrityError);
    await expect(assertPinned(file, bytes.slice(0, 63))).rejects.toThrow('has 63 bytes, the pinned file has 64');
    const changed = bytes.slice();
    changed[10] ^= 1;
    await expect(assertPinned(file, changed)).rejects.toThrow('does not have the pinned SHA-256');
  });
});

describeExperimental('model cache and installer', () => {
  let storage: FakeCacheStorage;
  let files: Record<string, Uint8Array>;
  let pinned: PinnedSet;
  let requested: { url: string; init: RequestInit | undefined }[];

  const store = (set: PinnedSet = pinned) => createModelStore({ storage, keyBase: KEY_BASE, pinned: set });
  const sourceUrl = (file: PinnedFile): string => `${SOURCE}${file.id}`;

  /** A server that has every file. `answer` may replace the answer for one address. */
  function server(answer: (url: string, id: string) => Response | Promise<Response> | undefined = () => undefined): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requested.push({ url, init });
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const id = url.slice(SOURCE.length);
      return (await answer(url, id)) ?? served(url, inPieces(files[id], 16));
    }) as typeof fetch;
  }

  async function install(fetchFile: typeof fetch, options: { signal?: AbortSignal; set?: PinnedSet; onProgress?: (loaded: number, total: number) => void } = {}): Promise<void> {
    await installModel({ store: store(options.set), sourceUrl, signal: options.signal ?? new AbortController().signal, onProgress: options.onProgress ?? (() => undefined), fetchFile });
  }

  async function failure(run: Promise<void>): Promise<InstallFailure> {
    try {
      await run;
    } catch (error) {
      expect(error).toBeInstanceOf(InstallError);
      return (error as InstallError).reason;
    }
    throw new Error('the installation did not fail');
  }

  /** After a failed installation of this version: nothing of it is stored, and it is not installed. */
  async function expectNothingInstalled(set: PinnedSet = pinned): Promise<void> {
    expect(await store(set).isInstalled()).toBe(false);
    expect(storage.entries(MODEL_CACHE_NAME).filter((url) => url.startsWith(`${KEY_BASE}${set.version}/`))).toEqual([]);
  }

  beforeEach(async () => {
    storage = fakeCacheStorage();
    requested = [];
    files = { 'model/config.json': syntheticBytes(1, 40), 'model/weights.bin': syntheticBytes(2, 100), 'runtime/runtime.wasm': syntheticBytes(3, 70) };
    pinned = await pinnedSet('test-model-1', files);
  });

  it('a profile without a model is "not installed", and asking does not create the cache', async () => {
    expect(await store().isInstalled()).toBe(false);
    expect(storage.names()).toEqual([]);
    await expect(store().read(pinned.files[0])).rejects.toThrow(NotInstalledError);
    expect(storage.names()).toEqual([]);
  });

  it('installs: only pinned addresses, each once, no redirect following, no HTTP cache, no credentials', async () => {
    const progress: [number, number][] = [];
    await install(server(), { onProgress: (loaded, total) => progress.push([loaded, total]) });

    expect(requested.map((request) => request.url)).toEqual(pinned.files.map(sourceUrl));
    for (const { init } of requested) expect(init).toMatchObject({ redirect: 'manual', cache: 'no-store', credentials: 'omit' });
    expect(await store().isInstalled()).toBe(true);

    // Progress never goes back, and ends at the exact total.
    expect(progress[0]).toEqual([0, 210]);
    expect(last(progress)).toEqual([210, 210]);
    for (let index = 1; index < progress.length; index += 1) expect(progress[index][0]).toBeGreaterThanOrEqual(progress[index - 1][0]);
  });

  it('writes the marker last, in this product\'s own cache, and reads back verified bytes', async () => {
    await install(server());
    expect(storage.names()).toEqual([MODEL_CACHE_NAME]);
    expect(storage.puts).toEqual([
      `${MODEL_CACHE_NAME} ${KEY_BASE}test-model-1/model/config.json`,
      `${MODEL_CACHE_NAME} ${KEY_BASE}test-model-1/model/weights.bin`,
      `${MODEL_CACHE_NAME} ${KEY_BASE}test-model-1/runtime/runtime.wasm`,
      `${MODEL_CACHE_NAME} ${KEY_BASE}test-model-1/complete.json`
    ]);
    for (const file of pinned.files) expect(new Uint8Array(await store().read(file))).toEqual(files[file.id]);
  });

  it('refuses a file with a wrong hash: it is not stored and nothing is installed', async () => {
    const wrong = files['model/weights.bin'].slice();
    wrong[5] ^= 0xff;
    const reason = await failure(install(server((url, id) => (id === 'model/weights.bin' ? served(url, [wrong]) : undefined))));
    expect(reason).toBe('integrity');
    await expectNothingInstalled();
    // The installer stopped at the bad file: the file after it was never requested.
    expect(requested.map((request) => request.url)).toEqual(pinned.files.slice(0, 2).map(sourceUrl));
  });

  it('refuses a file that is longer or shorter than pinned', async () => {
    const longer = new Uint8Array([...files['model/config.json'], 1, 2, 3]);
    expect(await failure(install(server((url, id) => (id === 'model/config.json' ? served(url, inPieces(longer, 16)) : undefined))))).toBe('integrity');
    await expectNothingInstalled();

    const shorter = files['model/config.json'].slice(0, 39);
    expect(await failure(install(server((url, id) => (id === 'model/config.json' ? served(url, [shorter]) : undefined))))).toBe('integrity');
    await expectNothingInstalled();
  });

  it('a server without the model: "not offered", after one request and without asking anywhere else', async () => {
    const reason = await failure(install(server((url) => served(url, [], { status: 404 }))));
    expect(reason).toBe('not-offered');
    expect(requested).toHaveLength(1);
    await expectNothingInstalled();
  });

  it('refuses a redirect and does not follow it', async () => {
    const elsewhere = 'http://other.example/weights.bin';
    for (const answer of [
      (url: string) => served(url, [], { status: 0, type: 'opaqueredirect' }),
      (url: string) => served(url, [files['model/config.json']], { redirected: true, url: elsewhere }),
      (url: string) => served(url, [files['model/config.json']], { type: 'cors', url: elsewhere })
    ]) {
      requested = [];
      expect(await failure(install(server(answer)))).toBe('redirect');
      // One request, to the pinned address. The other address was never asked.
      expect(requested.map((request) => request.url)).toEqual([sourceUrl(pinned.files[0])]);
      await expectNothingInstalled();
    }
  });

  it('a server error or a failed request is a network failure', async () => {
    expect(await failure(install(server((url) => served(url, [], { status: 503 }))))).toBe('network');
    expect(await failure(install((async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch))).toBe('network');
    await expectNothingInstalled();
  });

  it('an interrupted download leaves nothing usable and removes what it had stored', async () => {
    const reason = await failure(install(server((url, id) => (id === 'model/weights.bin' ? served(url, inPieces(files[id], 16), { failAfter: 3 }) : undefined))));
    expect(reason).toBe('network');
    // The first file had been stored before the interruption. It is gone again.
    expect(storage.puts).toEqual([`${MODEL_CACHE_NAME} ${KEY_BASE}test-model-1/model/config.json`]);
    await expectNothingInstalled();
  });

  it('a cancellation during the download leaves nothing usable', async () => {
    const controller = new AbortController();
    const reason = await failure(install(server((url, id) => {
      if (id === 'model/weights.bin') controller.abort();
      return undefined;
    }), { signal: controller.signal }));
    expect(reason).toBe('cancelled');
    await expectNothingInstalled();

    // Cancelled before it started: no request at all.
    requested = [];
    const before = new AbortController();
    before.abort();
    expect(await failure(install(server(), { signal: before.signal }))).toBe('cancelled');
    expect(requested).toEqual([]);
  });

  it('a write that fails after a good download is handled like any failure', async () => {
    storage.failPut = (url) => url.endsWith('/model/weights.bin');
    expect(await failure(install(server()))).toBe('storage');
    await expectNothingInstalled();

    // Also when only the marker cannot be written: without it the files are not an installation.
    storage.failPut = (url) => url.endsWith('/complete.json');
    expect(await failure(install(server()))).toBe('storage');
    await expectNothingInstalled();

    storage.failPut = null;
    await install(server());
    expect(await store().isInstalled()).toBe(true);
  });

  it('files without a marker are not an installation; the next attempt starts again', async () => {
    const partial = store();
    await partial.stage(pinned.files[0], files['model/config.json'].buffer as ArrayBuffer);
    await partial.stage(pinned.files[1], files['model/weights.bin'].buffer as ArrayBuffer);
    expect(await store().isInstalled()).toBe(false);
    await expect(store().read(pinned.files[0])).rejects.toThrow('the installation is not complete');
    await expect(partial.complete()).rejects.toThrow('runtime/runtime.wasm was not stored');

    await install(server());
    expect(await store().isInstalled()).toBe(true);
    expect(requested).toHaveLength(3);
  });

  it('a missing or damaged entry is noticed: missing means not installed, damaged is refused when read', async () => {
    await install(server());
    const key = store().fileKey(pinned.files[1]);

    storage.corrupt(MODEL_CACHE_NAME, key, syntheticBytes(9, 100));
    await expect(store().read(pinned.files[1])).rejects.toThrow(IntegrityError);
    // The other files are still the pinned ones.
    expect(new Uint8Array(await store().read(pinned.files[0]))).toEqual(files['model/config.json']);

    const cache = await storage.open(MODEL_CACHE_NAME);
    await cache.delete(key);
    expect(await store().isInstalled()).toBe(false);
    await expect(store().read(pinned.files[1])).rejects.toThrow('model/weights.bin is missing');
  });

  it('a marker of another list does not make this list installed', async () => {
    await install(server());
    const other = await pinnedSet('test-model-1', { ...files, 'model/weights.bin': syntheticBytes(8, 100) });
    expect(await store(other).isInstalled()).toBe(false);
    await expect(store(other).read(other.files[0])).rejects.toThrow(NotInstalledError);
  });

  it('a failed update keeps the previous complete version; a completed update removes it', async () => {
    await install(server());
    const previous = pinned;
    const oldFiles = files;

    files = { 'model/config.json': syntheticBytes(4, 40), 'model/weights.bin': syntheticBytes(5, 120), 'runtime/runtime.wasm': syntheticBytes(6, 70) };
    const next = await pinnedSet('test-model-2', files);
    const wrong = files['model/weights.bin'].slice();
    wrong[0] ^= 1;
    expect(await failure(install(server((url, id) => (id === 'model/weights.bin' ? served(url, [wrong]) : undefined)), { set: next }))).toBe('integrity');
    await expectNothingInstalled(next);
    // The previous version was not touched by the failed update.
    expect(await store(previous).isInstalled()).toBe(true);
    expect(new Uint8Array(await store(previous).read(previous.files[1]))).toEqual(oldFiles['model/weights.bin']);

    await install(server(), { set: next });
    expect(await store(next).isInstalled()).toBe(true);
    expect(await store(previous).isInstalled()).toBe(false);
    expect(storage.entries(MODEL_CACHE_NAME).every((url) => url.startsWith(`${KEY_BASE}test-model-2/`))).toBe(true);
  });

  it('deleting the model removes this cache and nothing else', async () => {
    const foreign = await storage.open('another-cache');
    await foreign.put('http://localhost:3000/kept', new Response('kept'));
    await install(server());

    await store().remove();
    expect(storage.names()).toEqual(['another-cache']);
    expect(storage.entries('another-cache')).toEqual(['http://localhost:3000/kept']);
    expect(await store().isInstalled()).toBe(false);
    // Deleting again, with no cache, is not an error and creates nothing.
    await store().remove();
    expect(storage.names()).toEqual(['another-cache']);
  });

  it('never uses the network to read: the store has no fetch at all', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await install(server());
    await store().read(pinned.files[0]);
    await store().isInstalled();
    await expect(store(await pinnedSet('absent', files)).read(pinned.files[0])).rejects.toThrow(NotInstalledError);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
