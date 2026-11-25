import { canRecord } from '../capture/capture';
import { InstallError, installModel } from '../models/install';
import { MODEL, RUNTIME, TOTAL_BYTES, type PinnedFile } from '../models/pinned';
import { createModelStore, hasCacheStorage, type ModelStore } from '../models/store';
import { canStartWorker, startRecognizerWorker, type RecognizerWorker } from './bootstrap';
import type { FromWorker, ToWorker } from './protocol';
import { RecognitionCancelled, type LiveCapture, type Recognition, type RecognitionRun, type RecognizerState, type SpeechRecognizer } from './types';

/**
 * The `local-ml` provider (ENG-V3-02, stage A): a downloaded, pinned model that runs in
 * a Worker on this device.
 *
 * Order of things, and it is enforced here:
 *
 *   prepare()  download and verify if needed, then load. All network use ends here.
 *   begin()    refused unless the model is loaded. From here to the result nothing is requested.
 *
 * The page sends samples to the Worker by message and gets text back by message.
 *
 * A Worker can fail at any time, not only while it loads: it can throw, a message can be
 * lost, or it can stop answering. For as long as a Worker lives, each of these ends it:
 * the Worker is terminated, every recognition that waits is refused with the reason, and
 * the state goes back to "installed". Preparing again starts a new Worker.
 */
export type LocalMlDependencies = {
  store: ModelStore;
  /** The fixed, absolute address of a pinned file on this origin. */
  sourceUrl: (file: PinnedFile) => string;
  startWorker: () => RecognizerWorker;
  /** Names the entries of the model cache for the Worker. */
  keyBase: string;
  /** Whether this page may download a model at all (see prototypeHost.ts). */
  mayDownload: () => boolean;
  /** Null when the browser has what the recognizer needs, or the missing thing. */
  unsupported: () => string | null;
  install?: typeof installModel;
};

/** The model cannot be downloaded from this page. */
export class DownloadNotOffered extends Error {
  constructor() {
    super('This page does not offer a model download.');
    this.name = 'DownloadNotOffered';
  }
}

const LOAD_TIMEOUT_MS = 120_000;
/**
 * How long the Worker may take to answer one recording. A recording is at most 20 seconds
 * long and is recognized in a few seconds, so a Worker that is silent for this long is
 * taken for failed. The time runs for every request, also one whose result was cancelled.
 */
export const RECOGNITION_TIMEOUT_MS = 120_000;

export function createLocalMlRecognizer(deps: LocalMlDependencies): SpeechRecognizer {
  let worker: RecognizerWorker | null = null;
  let ready = false;
  /** Why the last Worker was stopped. Said again when a recording is refused for that reason. */
  let stopped = '';
  let nextId = 1;
  /** Runs that still wait for the Worker's answer, by request number. */
  const waiting = new Map<number, { resolve: (value: Recognition) => void; reject: (error: Error) => void }>();
  /** Requests that the Worker has not answered yet, each with its time limit. */
  const unanswered = new Map<number, ReturnType<typeof setTimeout>>();
  /** Told when a Worker failed by itself. Not told about a release, a removal or a failed loading. */
  const failureListeners = new Set<(reason: string) => void>();

  function stopWorker(reason: string): void {
    worker?.terminate();
    worker = null;
    ready = false;
    stopped = reason;
    for (const timer of unanswered.values()) clearTimeout(timer);
    unanswered.clear();
    for (const run of waiting.values()) run.reject(new Error(reason));
    waiting.clear();
  }

  /** Ends a Worker that failed, unless it has been replaced or stopped already. */
  function workerFailed(failed: RecognizerWorker, reason: string): void {
    if (worker !== failed) return;
    stopWorker(reason);
    for (const listener of [...failureListeners]) listener(reason);
  }

  function onMessage(event: Event): void {
    const message = (event as MessageEvent<FromWorker>).data;
    if (message.type !== 'transcribed' && message.type !== 'transcribe-failed') return;
    // The Worker answered: it is alive, whether or not anyone still waits for this result.
    clearTimeout(unanswered.get(message.id));
    unanswered.delete(message.id);
    const run = waiting.get(message.id);
    // No one waits any more: the run was cancelled or the screen was left. The result is dropped.
    if (!run) return;
    waiting.delete(message.id);
    if (message.type === 'transcribed') run.resolve({ text: message.text, uncertainty: null, audioSeconds: message.audioSeconds, elapsedMs: message.elapsedMs });
    else run.reject(new Error(message.message));
  }

  /** Starts the Worker and has it load the installed model. */
  function load(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const started = deps.startWorker();
      worker = started;
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        started.removeEventListener('message', onLoadMessage);
        started.removeEventListener('error', onError);
        started.removeEventListener('messageerror', onError);
        if (error) {
          if (worker === started) stopWorker(error.message);
          else started.terminate();
          reject(error);
        } else {
          started.addEventListener('message', onMessage);
          // From here on, for as long as this Worker lives: an error in it, or a message
          // that cannot be read, ends it. Nothing is left waiting for a Worker that is gone.
          started.addEventListener('error', () => workerFailed(started, 'The recognizer stopped working.'));
          started.addEventListener('messageerror', () => workerFailed(started, 'A message of the recognizer could not be read.'));
          ready = true;
          stopped = '';
          resolve();
        }
      };
      const onLoadMessage = (event: Event): void => {
        const message = (event as MessageEvent<FromWorker>).data;
        if (message.type === 'ready') started.postMessage({ type: 'load', keyBase: deps.keyBase } satisfies ToWorker);
        else if (message.type === 'loaded') finish();
        else if (message.type === 'load-failed') finish(new Error(message.reason === 'runtime' ? `The speech model could not be loaded: ${message.message}` : message.message));
        else if (message.type === 'bootstrap-failed') finish(new Error(`The recognizer could not be started: ${message.message}`));
      };
      const onError = (): void => finish(new Error('The recognizer could not be started.'));
      const onAbort = (): void => finish(new DOMException('The loading was cancelled.', 'AbortError'));
      const timer = setTimeout(() => finish(new Error('The speech model did not load in time.')), LOAD_TIMEOUT_MS);
      started.addEventListener('message', onLoadMessage);
      started.addEventListener('error', onError);
      started.addEventListener('messageerror', onError);
      signal.addEventListener('abort', onAbort);
      if (signal.aborted) onAbort();
    });
  }

  return {
    descriptor: {
      provider: 'local-ml',
      model: MODEL.id,
      revision: MODEL.revision,
      runtime: `${RUNTIME.package} ${RUNTIME.version}, WebAssembly, one thread`
    },

    async state(): Promise<RecognizerState> {
      const missing = deps.unsupported();
      if (missing) return { status: 'unsupported', reason: missing };
      if (ready) return { status: 'ready' };
      if (await deps.store.isInstalled()) return { status: 'installed' };
      return { status: 'needs-download', bytes: TOTAL_BYTES };
    },

    async prepare({ signal, onProgress }): Promise<void> {
      if (ready) return;
      if (!(await deps.store.isInstalled())) {
        if (!deps.mayDownload()) throw new DownloadNotOffered();
        await (deps.install ?? installModel)({ store: deps.store, sourceUrl: deps.sourceUrl, signal, onProgress });
      }
      if (signal.aborted) throw new InstallError('cancelled', 'The download was cancelled.');
      await load(signal);
    },

    begin(capture: LiveCapture, { signal }): RecognitionRun {
      if (!ready || !worker) throw new Error(stopped ? `The recognizer is not ready. ${stopped}` : 'The recognizer is not ready: prepare it before recording.');
      const target = worker;
      const id = nextId++;
      let cancelled = signal.aborted;
      const cancel = (): void => {
        cancelled = true;
        const run = waiting.get(id);
        waiting.delete(id);
        run?.reject(new RecognitionCancelled());
      };
      signal.addEventListener('abort', cancel, { once: true });

      return {
        async finish(): Promise<Recognition> {
          try {
            const samples = await capture.pcm();
            if (cancelled) throw new RecognitionCancelled();
            if (worker !== target) throw new Error(stopped || 'The recognizer was stopped.');
            const answer = new Promise<Recognition>((resolve, reject) => waiting.set(id, { resolve, reject }));
            unanswered.set(id, setTimeout(() => workerFailed(target, 'The recognizer did not answer in time.'), RECOGNITION_TIMEOUT_MS));
            try {
              target.postMessage({ type: 'transcribe', id, samples } satisfies ToWorker, [samples.buffer]);
            } catch (error) {
              // The recording could not be handed over. The Worker is not trusted after that.
              const detail = (error as { message?: unknown } | null)?.message;
              workerFailed(target, `The recording could not be given to the recognizer: ${typeof detail === 'string' ? detail : String(error)}`);
            }
            return await answer;
          } finally {
            signal.removeEventListener('abort', cancel);
          }
        },
        cancel
      };
    },

    async release(): Promise<void> {
      stopWorker('The recognizer was stopped.');
    },

    async remove(): Promise<void> {
      stopWorker('The speech model was deleted.');
      await deps.store.remove();
    },

    onFailure(listener): () => void {
      failureListeners.add(listener);
      return () => failureListeners.delete(listener);
    }
  };
}

/** The recognizer of the running application, with the real Worker, cache and addresses. */
export function createBrowserRecognizer(options: { runtimeWasmUrl: string; workerModuleUrl: string; mayDownload: () => boolean }): SpeechRecognizer {
  const base = new URL(import.meta.env.BASE_URL, globalThis.location.href).href;
  // Entries are named below the site's base path, not below the product's route: a product
  // that moves to another route keeps its installed model.
  const keyBase = `${new URL(__SITE_BASE__, globalThis.location.href).href}model-cache/`;
  return createLocalMlRecognizer({
    store: createModelStore({ keyBase }),
    keyBase,
    sourceUrl: (file) => (file.kind === 'runtime' ? new URL(options.runtimeWasmUrl, globalThis.location.href).href : `${base}models/${MODEL.id}/${file.path}`),
    startWorker: () => startRecognizerWorker(options.workerModuleUrl),
    mayDownload: options.mayDownload,
    unsupported: () => {
      if (!globalThis.isSecureContext) return 'This page is not a secure context, so the browser gives it no microphone.';
      if (typeof WebAssembly === 'undefined') return 'This browser has no WebAssembly.';
      if (!canStartWorker()) return 'This browser has no Workers.';
      if (!hasCacheStorage()) return 'This browser has no Cache Storage here.';
      if (!canRecord()) return 'This browser cannot record from a microphone here.';
      return null;
    }
  });
}
