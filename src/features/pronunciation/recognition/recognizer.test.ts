import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { describeExperimental } from '../../../test/product';
import { FakeRecognizerWorker as FakeWorker, fakeLocks, gate, last, roomy } from '../testing';
import { MODEL_LOCK_NAME, ModelBusyError, NoCoordinationError } from '../models/exclusive';
import { InstallError, type InstallOptions } from '../models/install';
import { MODEL, TOTAL_BYTES } from '../models/pinned';
import type { ModelStore } from '../models/store';
import { bootstrapSource, startRecognizerWorker, type RecognizerWorker } from './bootstrap';
import { DownloadNotOffered, ModelFilesError, createLocalMlRecognizer, type LocalMlDependencies } from './localMl';
import { BLOCKED_INTERFACES, lockDownNetwork } from './lockdown';
import { RecognitionCancelled, type LiveCapture } from './types';

/**
 * The recognizer as the page sees it (ENG-V3-02, stage A): how its Worker is started,
 * what the Worker is denied, and the order "prepare, then record". The Worker and the
 * model cache are fakes here. The real ones are checked in a browser
 * (scripts/acceptance/pronunciation.mjs).
 */
describeExperimental('Worker bootstrap', () => {
  const realWorker = (globalThis as { Worker?: unknown }).Worker;
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;

  afterEach(() => {
    (globalThis as { Worker?: unknown }).Worker = realWorker;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    vi.useRealTimers();
  });

  it('is one statement: a dynamic import of the Worker module by its absolute address on this origin', () => {
    const source = bootstrapSource('/eng-trainer/v3/assets/recognizer.worker-abc.js');
    expect(source).toBe(`import("http://localhost:3000/eng-trainer/v3/assets/recognizer.worker-abc.js").catch((error) => self.postMessage({ type: 'bootstrap-failed', message: String(error) }));`);
    // A static import would be a worker request, which the page policy does not allow from an address.
    expect(source).not.toMatch(/^\s*import\s+["'{*]/m);
    expect(source.match(/import\(/g)).toHaveLength(1);
  });

  it('quotes the address, so an unusual address cannot add code', () => {
    const source = bootstrapSource('/a");fetch("http://other.example/x');
    expect(source.startsWith('import("http://localhost:3000/a%22);fetch(%22http://other.example/x")')).toBe(true);
  });

  it('starts a module Worker from a blob: address and releases that address afterwards', async () => {
    vi.useFakeTimers();
    const created: { url: string; options: WorkerOptions }[] = [];
    const blobs: Blob[] = [];
    const revoked: string[] = [];
    (globalThis as { Worker?: unknown }).Worker = class {
      constructor(url: string, options: WorkerOptions) {
        created.push({ url, options });
      }
    };
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      blobs.push(blob as Blob);
      return 'blob:http://localhost:3000/1234';
    };
    URL.revokeObjectURL = (url: string) => void revoked.push(url);

    startRecognizerWorker('/eng-trainer/v3/assets/recognizer.worker-abc.js');
    expect(created).toEqual([{ url: 'blob:http://localhost:3000/1234', options: { type: 'module', name: 'eng-trainer-recognizer' } }]);
    expect(blobs[0].type).toBe('text/javascript');
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(10_000);
    expect(revoked).toEqual(['blob:http://localhost:3000/1234']);

    vi.useRealTimers();
    const content = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blobs[0]);
    });
    expect(content).toBe(bootstrapSource('/eng-trainer/v3/assets/recognizer.worker-abc.js'));
  });
});

describeExperimental('Worker lock-down', () => {
  it('makes every network interface throw, as a call and as a constructor, and cannot be undone', () => {
    const scope: Record<string, unknown> = { fetch: () => 'reached', XMLHttpRequest: class {}, WebSocket: class {}, EventSource: class {}, importScripts: () => 'reached', setTimeout };
    lockDownNetwork(scope);

    expect([...BLOCKED_INTERFACES]).toEqual(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'importScripts']);
    for (const name of BLOCKED_INTERFACES) {
      const blocked = scope[name] as (new (...args: unknown[]) => unknown) & ((...args: unknown[]) => unknown);
      expect(() => blocked('http://other.example/')).toThrow(`The recognizer Worker makes no network request: "${name}" is not available.`);
      expect(() => new blocked('http://other.example/')).toThrow('makes no network request');
      expect(() => {
        'use strict';
        scope[name] = () => 'restored';
      }).toThrow(TypeError);
      expect(Object.getOwnPropertyDescriptor(scope, name)).toMatchObject({ writable: false, configurable: false });
    }
    // Everything else is left alone.
    expect(scope.setTimeout).toBe(setTimeout);
  });

  it('changes nothing on a page: only a Worker is locked down', async () => {
    const before = globalThis.fetch;
    await import('./lockdown');
    expect(globalThis.fetch).toBe(before);
  });
});

describeExperimental('local-ml recognizer', () => {
  let workers: FakeWorker[];
  let installed: boolean;
  let removed: number;
  let installs: number;
  let deps: LocalMlDependencies;

  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const signal = (): AbortSignal => new AbortController().signal;
  const capture = (samples: Float32Array): LiveCapture => ({ track: {} as MediaStreamTrack, pcm: async () => samples });

  const progress = { signal: signal(), onProgress: (): void => undefined };

  /** Loads the model, which is on the device, with a Worker that starts and loads at once. */
  async function ready(recognizer = createLocalMlRecognizer(deps)) {
    installed = true;
    const preparing = recognizer.prepare({ signal: signal() });
    await tick();
    last(workers).emit({ type: 'ready' });
    last(workers).emit({ type: 'loaded', loadMs: 5 });
    await preparing;
    return recognizer;
  }

  beforeEach(() => {
    workers = [];
    installed = false;
    removed = 0;
    installs = 0;
    deps = {
      store: {
        isInstalled: async () => installed,
        remove: async () => {
          removed += 1;
          installed = false;
        }
      } as unknown as ModelStore,
      sourceUrl: (file) => `http://localhost:3000/eng-trainer/v3/models/${file.id}`,
      keyBase: 'http://localhost:3000/eng-trainer/v3/model-cache/',
      readEstimate: roomy,
      locks: fakeLocks(),
      startWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      mayDownload: () => true,
      unsupported: () => null,
      install: async ({ onProgress }) => {
        installs += 1;
        onProgress(TOTAL_BYTES, TOTAL_BYTES);
        installed = true;
      }
    };
  });

  it('describes itself: provider, pinned model revision and runtime', () => {
    expect(createLocalMlRecognizer(deps).descriptor).toEqual({ provider: 'local-ml', model: MODEL.id, revision: MODEL.revision, runtime: 'onnxruntime-web 1.31.1, WebAssembly, one thread' });
  });

  it('reports its state: unsupported, needs a download of the exact size, installed, ready', async () => {
    const recognizer = createLocalMlRecognizer(deps);
    expect(await recognizer.state()).toEqual({ status: 'needs-download', bytes: 46_792_602 });
    installed = true;
    expect(await recognizer.state()).toEqual({ status: 'installed' });
    await ready(recognizer);
    expect(await recognizer.state()).toEqual({ status: 'ready' });

    deps.unsupported = () => 'This browser has no Workers.';
    expect(await createLocalMlRecognizer(deps).state()).toEqual({ status: 'unsupported', reason: 'This browser has no Workers.' });
  });

  it('installs on request and loads as a separate step: installing starts no Worker', async () => {
    const recognizer = createLocalMlRecognizer(deps);
    await recognizer.install({ confirmed: true, ...progress });
    expect(installs).toBe(1);
    expect(workers).toHaveLength(0);
    expect(await recognizer.state()).toEqual({ status: 'installed' });

    await ready(recognizer);
    expect(installs).toBe(1);
    expect(workers).toHaveLength(1);
    expect(workers[0].sent.map((item) => item.message)).toEqual([{ type: 'load', keyBase: 'http://localhost:3000/eng-trainer/v3/model-cache/' }]);

    // Already ready: nothing at all.
    await recognizer.prepare({ signal: signal() });
    expect(installs).toBe(1);
    expect(workers).toHaveLength(1);
  });

  it('loading never installs: without the files it refuses, calls no installer and starts no Worker', async () => {
    // A page that may download, and no model on the device.
    const recognizer = createLocalMlRecognizer(deps);
    const refused = await recognizer.prepare({ signal: signal() }).then(() => null, (reason: unknown) => reason);
    expect(refused).toBeInstanceOf(ModelFilesError);
    expect((refused as ModelFilesError).reason).toBe('not-installed');
    expect((refused as ModelFilesError).message).toBe('The speech model is not installed in this browser.');
    expect(installs).toBe(0);
    expect(workers).toHaveLength(0);
    expect(await recognizer.state()).toEqual({ status: 'needs-download', bytes: TOTAL_BYTES });

    // The files were there, the model was loaded and released, and then another tab removed them.
    await ready(recognizer);
    await recognizer.release();
    installed = false;
    await expect(recognizer.prepare({ signal: signal() })).rejects.toBeInstanceOf(ModelFilesError);
    expect(installs).toBe(0);
    expect(workers).toHaveLength(1);
  });

  it('a loaded model stays loaded when its files are removed elsewhere, and cannot be loaded again without them', async () => {
    const recognizer = await ready();
    // Another tab removes the files. Removing files does not reach into this Worker's memory.
    installed = false;
    expect(await recognizer.state()).toEqual({ status: 'ready' });
    expect(() => recognizer.begin(capture(new Float32Array(16000)), { signal: signal() })).not.toThrow();
    await recognizer.release();
    expect(await recognizer.state()).toEqual({ status: 'needs-download', bytes: TOTAL_BYTES });
    await expect(recognizer.prepare({ signal: signal() })).rejects.toBeInstanceOf(ModelFilesError);
    expect(installs).toBe(0);
  });

  it('downloads nothing where a download is not offered, and starts no Worker', async () => {
    deps.mayDownload = () => false;
    const recognizer = createLocalMlRecognizer(deps);
    await expect(recognizer.install({ confirmed: true, ...progress })).rejects.toThrow(DownloadNotOffered);
    expect(installs).toBe(0);
    expect(workers).toHaveLength(0);

    // A model that is already there can still be loaded: that needs no download.
    await ready(recognizer);
    expect(installs).toBe(0);
  });

  it('a failed or cancelled installation starts no Worker', async () => {
    deps.install = async () => {
      throw new InstallError('integrity', 'model/tokenizer.json does not have the pinned SHA-256');
    };
    const recognizer = createLocalMlRecognizer(deps);
    await expect(recognizer.install({ confirmed: true, ...progress })).rejects.toThrow('does not have the pinned SHA-256');
    expect(workers).toHaveLength(0);
    expect(await recognizer.state()).toEqual({ status: 'needs-download', bytes: TOTAL_BYTES });
  });

  it('a Worker that cannot start or load ends the preparation and is terminated', async () => {
    installed = true;
    for (const [fault, message] of [
      [(worker: FakeWorker) => worker.emit({ type: 'bootstrap-failed', message: 'TypeError: blocked' }), 'The recognizer could not be started: TypeError: blocked'],
      [(worker: FakeWorker) => worker.fail(), 'The recognizer could not be started.'],
      [(worker: FakeWorker) => { worker.emit({ type: 'ready' }); worker.emit({ type: 'load-failed', reason: 'not-installed', message: 'The speech model is not installed: model/config.json is missing' }); }, 'model/config.json is missing'],
      [(worker: FakeWorker) => { worker.emit({ type: 'ready' }); worker.emit({ type: 'load-failed', reason: 'integrity', message: 'model/tokenizer.json: does not have the pinned SHA-256' }); }, 'does not have the pinned SHA-256']
    ] as const) {
      const recognizer = createLocalMlRecognizer(deps);
      const preparing = recognizer.prepare({ signal: signal() });
      await tick();
      fault(last(workers));
      await expect(preparing).rejects.toThrow(message);
      expect(last(workers).terminated).toBe(true);
      expect(await recognizer.state()).toEqual({ status: 'installed' });
    }
  });

  it('files that the Worker refuses are told apart from every other failure of the loading', async () => {
    installed = true;
    const refused = async (emit: (worker: FakeWorker) => void): Promise<unknown> => {
      const recognizer = createLocalMlRecognizer(deps);
      const preparing = recognizer.prepare({ signal: signal() });
      await tick();
      emit(last(workers));
      const error = await preparing.then(() => null, (reason: unknown) => reason);
      // Whatever the reason, nothing is ready and no recording is accepted.
      expect(await recognizer.state()).toEqual({ status: 'installed' });
      expect(() => recognizer.begin(capture(new Float32Array(16000)), { signal: signal() })).toThrow('The recognizer is not ready.');
      return error;
    };

    for (const reason of ['not-installed', 'integrity'] as const) {
      const error = await refused((worker) => {
        worker.emit({ type: 'ready' });
        worker.emit({ type: 'load-failed', reason, message: 'model/tokenizer.json: does not have the pinned SHA-256' });
      });
      expect(error).toBeInstanceOf(ModelFilesError);
      expect((error as ModelFilesError).reason).toBe(reason);
      expect((error as ModelFilesError).message).toBe('model/tokenizer.json: does not have the pinned SHA-256');
    }

    const runtime = await refused((worker) => {
      worker.emit({ type: 'ready' });
      worker.emit({ type: 'load-failed', reason: 'runtime', message: 'out of memory' });
    });
    expect(runtime).not.toBeInstanceOf(ModelFilesError);
    expect((runtime as Error).message).toBe('The speech model could not be loaded: out of memory');
    expect(await refused((worker) => worker.fail())).not.toBeInstanceOf(ModelFilesError);
  });

  it('gives the installer the browser\'s estimate and its locks, and nothing that would let it skip them', async () => {
    const locks = fakeLocks();
    let given: InstallOptions | null = null;
    deps.locks = locks;
    deps.install = async (options) => {
      given = options;
      installed = true;
    };
    const recognizer = createLocalMlRecognizer(deps);
    await recognizer.install({ confirmed: true, ...progress });
    expect(given!.readEstimate).toBe(deps.readEstimate);
    expect(given!.locks).toBe(locks);
    expect(given!.store).toBe(deps.store);
    expect(given!.reserve).toBeUndefined();
    expect(given!.confirmed).toBe(true);
    expect(Object.keys(given!).sort()).toEqual(['confirmed', 'locks', 'onProgress', 'readEstimate', 'signal', 'sourceUrl', 'store']);

    // The confirmation is handed on as it came: the installer is the one that judges it.
    installed = false;
    await recognizer.install({ confirmed: false, ...progress });
    expect(given!.confirmed).toBe(false);
  });

  it('the installer is reached from install() alone: no other operation of the recognizer calls it', async () => {
    const recognizer = createLocalMlRecognizer(deps);
    await recognizer.state();
    await recognizer.prepare({ signal: signal() }).catch(() => undefined);
    await recognizer.release();
    await recognizer.remove();
    expect(installs).toBe(0);
    await recognizer.install({ confirmed: true, ...progress });
    expect(installs).toBe(1);
  });

  it('an installation that is refused for lack of room, or because the cache is busy, starts no Worker', async () => {
    for (const reason of ['capacity', 'busy', 'storage', 'uncoordinated', 'not-confirmed'] as const) {
      deps.install = async () => {
        throw new InstallError(reason, `refused: ${reason}`);
      };
      const recognizer = createLocalMlRecognizer(deps);
      await expect(recognizer.install({ confirmed: true, ...progress })).rejects.toMatchObject({ reason });
      expect(workers).toHaveLength(0);
      expect(await recognizer.state()).toEqual({ status: 'needs-download', bytes: TOTAL_BYTES });
    }
  });

  it('removes under the lock of the model cache, and not at all while another change holds it', async () => {
    const locks = fakeLocks();
    deps.locks = locks;
    installed = true;
    const during: string[][] = [];
    const slow = gate();
    (deps.store as { remove: () => Promise<void> }).remove = async () => {
      during.push(locks.held());
      await slow.promise;
      removed += 1;
      installed = false;
    };
    const recognizer = createLocalMlRecognizer(deps);
    const removing = recognizer.remove();
    await tick();
    expect(during).toEqual([[MODEL_LOCK_NAME]]);
    // A second removal while the first one runs is refused and does nothing.
    await expect(createLocalMlRecognizer(deps).remove()).rejects.toThrow(ModelBusyError);
    expect(during).toHaveLength(1);
    slow.open();
    await removing;
    expect(removed).toBe(1);
    expect(locks.held()).toEqual([]);

    // Another tab installs: the files stay, and the caller is told.
    installed = true;
    locks.heldElsewhere = true;
    await expect(recognizer.remove()).rejects.toThrow('This request changed nothing.');
    expect(removed).toBe(1);
    expect(installed).toBe(true);
  });

  it('removes nothing in a browser that cannot coordinate the tabs', async () => {
    installed = true;
    deps.locks = null;
    await expect(createLocalMlRecognizer(deps).remove()).rejects.toBeInstanceOf(NoCoordinationError);
    expect(removed).toBe(0);
    expect(installed).toBe(true);

    // A lock manager that gives no lock at all is the same refusal.
    const locks = fakeLocks();
    locks.refuse = new DOMException('The operation is insecure.', 'SecurityError');
    deps.locks = locks;
    await expect(createLocalMlRecognizer(deps).remove()).rejects.toThrow('the browser gave no lock: The operation is insecure.');
    expect(removed).toBe(0);
  });

  it('cancelling the loading terminates the Worker', async () => {
    installed = true;
    const controller = new AbortController();
    const recognizer = createLocalMlRecognizer(deps);
    const preparing = recognizer.prepare({ signal: controller.signal });
    await tick();
    workers[0].emit({ type: 'ready' });
    controller.abort();
    await expect(preparing).rejects.toThrow('The loading was cancelled.');
    expect(workers[0].terminated).toBe(true);
  });

  it('refuses to begin before it is ready', () => {
    expect(() => createLocalMlRecognizer(deps).begin(capture(new Float32Array(16000)), { signal: signal() })).toThrow('The recognizer is not ready: prepare it before recording.');
  });

  it('sends the samples to the Worker by message, hands over their memory, and returns the text', async () => {
    const recognizer = await ready();
    const samples = new Float32Array(32000);
    const run = recognizer.begin(capture(samples), { signal: signal() });
    const finished = run.finish();
    await tick();

    const sent = last(workers[0].sent);
    expect(sent.message).toMatchObject({ type: 'transcribe', id: 1 });
    expect((sent.message as { samples: Float32Array }).samples).toBe(samples);
    expect(sent.transfer).toEqual([samples.buffer]);

    workers[0].emit({ type: 'transcribed', id: 1, text: 'Let me explain.', audioSeconds: 2, elapsedMs: 120 });
    expect(await finished).toEqual({ text: 'Let me explain.', uncertainty: null, audioSeconds: 2, elapsedMs: 120 });
  });

  it('reports a failed recognition, and keeps answers apart by their number', async () => {
    const recognizer = await ready();
    const first = recognizer.begin(capture(new Float32Array(16000)), { signal: signal() }).finish();
    const second = recognizer.begin(capture(new Float32Array(16000)), { signal: signal() }).finish();
    await tick();
    workers[0].emit({ type: 'transcribed', id: 2, text: 'second', audioSeconds: 1, elapsedMs: 1 });
    workers[0].emit({ type: 'transcribe-failed', id: 1, message: 'out of memory' });
    await expect(first).rejects.toThrow('out of memory');
    expect((await second).text).toBe('second');
  });

  it('drops the result of a cancelled run, also when it arrives later', async () => {
    const recognizer = await ready();
    const run = recognizer.begin(capture(new Float32Array(16000)), { signal: signal() });
    const finished = run.finish();
    await tick();
    run.cancel();
    await expect(finished).rejects.toThrow(RecognitionCancelled);
    // The Worker still answers. Nobody waits for it, and nothing breaks.
    workers[0].emit({ type: 'transcribed', id: 1, text: 'late', audioSeconds: 1, elapsedMs: 1 });

    // Cancelled before the recording ended: the samples are never sent.
    const early = recognizer.begin(capture(new Float32Array(16000)), { signal: signal() });
    early.cancel();
    const sentBefore = workers[0].sent.length;
    await expect(early.finish()).rejects.toThrow(RecognitionCancelled);
    expect(workers[0].sent.length).toBe(sentBefore);

    // Cancelled through the signal.
    const controller = new AbortController();
    const signalled = recognizer.begin(capture(new Float32Array(16000)), { signal: controller.signal }).finish();
    await tick();
    controller.abort();
    await expect(signalled).rejects.toThrow(RecognitionCancelled);
  });

  it('release terminates the Worker, fails what was waiting and keeps the installed files', async () => {
    const recognizer = await ready();
    const waiting = recognizer.begin(capture(new Float32Array(16000)), { signal: signal() }).finish();
    await tick();
    await recognizer.release();
    await expect(waiting).rejects.toThrow('The recognizer was stopped.');
    expect(workers[0].terminated).toBe(true);
    expect(removed).toBe(0);
    expect(await recognizer.state()).toEqual({ status: 'installed' });
    expect(() => recognizer.begin(capture(new Float32Array(1)), { signal: signal() })).toThrow('not ready');
  });

  it('remove terminates the Worker and deletes the model through the store', async () => {
    const recognizer = await ready();
    await recognizer.remove();
    expect(workers[0].terminated).toBe(true);
    expect(removed).toBe(1);
    expect(await recognizer.state()).toEqual({ status: 'needs-download', bytes: TOTAL_BYTES });
  });
});
