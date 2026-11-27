import { CaptureCancelled, CaptureError, type Capture, type Recorder } from './capture/capture';
import { LEVEL_MESSAGES, MAX_SECONDS, checkLevels } from './capture/levels';
import { describeCapacity, type PersistenceAnswer } from './models/capacity';
import { ModelBusyError, NoCoordinationError } from './models/exclusive';
import { InstallError } from './models/install';
import type { ModelStorage, StorageFacts } from './models/management';
import type { Installation } from './models/store';
import { DownloadNotOffered, ModelFilesError } from './recognition/localMl';
import { RecognitionCancelled, type RecognitionRun, type SpeechRecognizer } from './recognition/types';

/**
 * One practice session on the Pronunciation screen (ENG-V3-02, stage A): the model's
 * state, one recording at a time, and what the recognizer heard.
 *
 * It decides the order of things:
 *
 *   model loaded  ->  click  ->  microphone  ->  recording  ->  level checks  ->  recognizer  ->  text
 *
 * It keeps no recording and no result beyond the last one, marks nothing as learned and
 * compares nothing with the phrase. A result that arrives after a cancel, after a new
 * recording started or after the screen was left is dropped.
 *
 * Three waits can be ended at any moment, and each releases what it had acquired:
 *
 * - Preparing (download, model, recorder): Cancel, deleting the model and leaving the
 *   screen end it. The model's memory and the recorder's audio context are released, and
 *   the screen does not become ready.
 * - Starting a recording (permission, audio device): Cancel, a hidden page and leaving
 *   the screen end it. A microphone that the browser has handed over is stopped at once.
 * - Recognizing: Cancel drops the result. A recognizer that fails or stops answering is
 *   released, and the screen offers to load the model again.
 *
 * Storage (ENG-V3-R1B). The session also says what the model cache holds and what the
 * browser says about the site's storage, and it keeps the order of a download:
 *
 *   room by the browser's estimate  ->  the learner confirms, with the backup in view  ->  download
 *
 * - **Loading and installing are two requests** (ENG-V3-R1B-RC1). `prepare` loads what is
 *   installed and can start no download: when the files are not there, or no longer
 *   there, it says so and the screen has to ask for a download again. `install` is the
 *   only way to a download.
 * - A download does not start without the confirmation, and not without room. Both are
 *   asked here before the screen changes. The installer checks the confirmation again and
 *   asks for room again by itself. Two requests at once start one download, and a screen
 *   that is left while the estimate is read starts nothing.
 * - **What is on the device and what is in memory are two things.** `installed` is what
 *   the cache holds, taken from the cache each time it is read, also by "Read again". The
 *   phase "ready" is a model in memory. Another tab can remove the files of a model that
 *   is loaded here: it stays loaded, and it cannot be loaded again without a download.
 * - Files that are incomplete or damaged are never loaded. The session says what is there
 *   and offers to remove it. It removes nothing by itself.
 * - The browser is asked to keep the site's data only when the learner asks for that. Its
 *   answer is shown as what it is. It is never shown as a backup.
 */
export type Outcome =
  /** The recognizer's text. `text` may be empty: the recognizer heard no words. */
  | { kind: 'heard'; text: string; audioSeconds: number; elapsedMs: number }
  /** No text, with the reason in words. */
  | { kind: 'unable'; message: string };

export type Phase =
  | 'checking'
  | 'unsupported'
  /** The model is not loaded. `installed` says whether it is on this device already. */
  | 'no-model'
  | 'installing'
  | 'loading'
  | 'ready'
  /** Waiting for the microphone, which may mean a permission question. */
  | 'starting'
  | 'recording'
  | 'recognizing';

/** The browser's answers about the site's storage, with its answer to a request of this session, if one was made. */
export type StorageView = StorageFacts & { answer: PersistenceAnswer | null };

export type PracticeState = {
  phase: Phase;
  /** Whether the cache held a complete installation when it was last read. Not whether a model is in memory: that is the phase. */
  installed: boolean;
  /** What the model cache holds. Null until it was read. */
  installation: Installation | null;
  /** Null until it was read, and when it could not be read. */
  storage: StorageView | null;
  /** What a check of every installed file found wrong. Null when no check ran, or the files were removed since. */
  fileProblems: string[] | null;
  /** A check or a removal of the model's files that has not finished yet. */
  working: 'files' | 'removal' | null;
  /** The browser was asked to keep this site's data and has not answered yet. It may be waiting for the learner. */
  askingPersistence: boolean;
  /** Whether this page may download the model (prototypeHost.ts). */
  downloadOffered: boolean;
  downloadBytes: number;
  progress: { loaded: number; total: number } | null;
  /** A message about the model: why it is unsupported, or why preparing it failed. */
  notice: string | null;
  outcome: Outcome | null;
};

export type PracticeSession = {
  subscribe(run: (state: PracticeState) => void): () => void;
  /** Reads the recognizer's state. Call once when the screen opens. */
  init(): Promise<void>;
  /**
   * Loads the installed model. It never downloads, whatever the screen showed: when the
   * files are not in the cache, nothing is requested and the state says that a download
   * is needed.
   */
  prepare(): Promise<void>;
  /**
   * Downloads and installs the model, then loads it. It needs room by the browser's
   * estimate and `confirmed`: the learner has read what is stored and what that means for
   * the learning data, and has confirmed it. Without either, nothing is requested.
   */
  install(options?: { confirmed?: boolean }): Promise<void>;
  cancelPrepare(): void;
  /** Removes the model cache, whatever it holds: an installation, leftovers or damaged files. Nothing else. */
  removeModel(): Promise<void>;
  /** Reads the browser's storage facts and the model cache again. */
  refreshStorage(): Promise<void>;
  /** Asks the browser to keep this site's data. Call only from the click handler of the control that says so. */
  askForPersistence(): Promise<void>;
  /** Reads and hashes every installed file, and says what is wrong. */
  checkFiles(): Promise<void>;
  /** Starts a recording. Call only from the click handler of the record control. */
  record(): Promise<void>;
  stop(): Promise<void>;
  /** Ends a recording or a recognition without a result. */
  cancel(): void;
  /** The phrase changed: the last result belongs to another phrase. */
  clearOutcome(): void;
  /** The page was hidden: a recording in progress ends and the microphone is released. */
  pageHidden(): void;
  recordedSeconds(): number;
  /** Leaves the screen: releases the microphone and the model's memory. */
  dispose(): void;
};

export type PracticeDependencies = {
  recognizer: SpeechRecognizer;
  /** The model cache and the browser's storage facts (models/management.ts). */
  modelStorage: ModelStorage;
  recorder: Recorder;
  downloadOffered: boolean;
  /** Reference playback elsewhere in the application is stopped before recording, so it is not recorded. */
  stopPlayback?: () => void;
};

/** How long a removal waits for an installation of this screen that it has just ended. */
export const ENDING_TIMEOUT_MS = 10_000;

/** Said when a failure concerns the model: what was not touched, and what must not be done to make room. */
const LEARNING_DATA_UNTOUCHED = 'Your learning data was not changed. Do not clear the data of this site to make room: that would remove your learning data too.';
const FILES_NOT_USED = 'The installed files of the speech model are incomplete or damaged, so they were not used. Remove them and download the model again.';
const MODEL_GONE = 'The speech model is not in this browser any more. It may have been removed in another tab. Nothing was downloaded. To record, download the model again.';
const NOT_CONFIRMED = 'The model was not downloaded: the download has to be confirmed first.';

export function createPracticeSession(deps: PracticeDependencies): PracticeSession {
  let state: PracticeState = { phase: 'checking', installed: false, installation: null, storage: null, fileProblems: null, working: null, askingPersistence: false, downloadOffered: deps.downloadOffered, downloadBytes: deps.modelStorage.totalBytes, progress: null, notice: null, outcome: null };
  const listeners = new Set<(state: PracticeState) => void>();
  let disposed = false;
  let preparing: AbortController | null = null;
  /** Each recording has a number. Whatever belongs to an older number is ignored. */
  let attempt = 0;
  /** Ends the recorder's start, also while it still waits for the permission or the audio device. */
  let starting: AbortController | null = null;
  let capture: Capture | null = null;
  let run: RecognitionRun | null = null;
  let runAbort: AbortController | null = null;
  let deliver: ((samples: Float32Array) => void) | null = null;
  /** Set when the recognizer stopped while the screen was still being prepared. */
  let stoppedWhilePreparing: string | null = null;
  /** Resolves when the preparation that runs has ended and its installer has let go of the model cache. */
  let preparation: Promise<void> | null = null;

  /**
   * Waits for a preparation that was just ended, but not for ever. Its installer holds the
   * lock of the model cache until it has removed the files of its attempt. A removal that
   * still finds the cache busy after this wait says so and changes nothing.
   */
  function ended(running: Promise<void> | null): Promise<void> {
    if (!running) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ENDING_TIMEOUT_MS);
      void running.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  const stoppedNotice = (reason: string): string => `The recognizer stopped, so the speech model has to be loaded again. (${reason})`;

  function set(next: Partial<PracticeState>): void {
    if (disposed) return;
    state = { ...state, ...next };
    for (const listener of listeners) listener(state);
  }

  /** Ends the current recording and recognition, if any, and releases the microphone. */
  function endAttempt(): void {
    attempt += 1;
    // The recorder stops a microphone it has acquired at once, also before it returned a capture.
    starting?.abort();
    starting = null;
    capture?.cancel();
    capture = null;
    run?.cancel();
    run = null;
    runAbort?.abort();
    runAbort = null;
    deliver = null;
  }

  /**
   * What the model cache holds and what the browser says about the site's storage. A
   * question that cannot be answered leaves "not known", which the screen shows as such
   * and which never allows a download.
   */
  async function readStorage(): Promise<Pick<PracticeState, 'installed' | 'installation' | 'storage'>> {
    const [installation, facts] = await Promise.all([deps.modelStorage.inspect().catch(() => null), deps.modelStorage.facts().catch(() => null)]);
    // What can be loaded follows what the cache holds now, each time it is read: a complete
    // installation and nothing else. So a cache that another tab changed changes what this
    // screen offers. A model in memory is another matter: that is the phase.
    return { installed: installation?.state === 'installed', installation, storage: facts ? { ...facts, answer: state.storage?.answer ?? null } : null };
  }

  async function refresh(notice: string | null = null): Promise<void> {
    const recognizer = await deps.recognizer.state();
    if (recognizer.status === 'unsupported') {
      set({ phase: 'unsupported', notice: recognizer.reason, progress: null });
      return;
    }
    const storage = await readStorage();
    // "ready" is the model in memory. Whether its files are still on the device is in `storage`.
    if (recognizer.status === 'ready') set({ phase: 'ready', notice: null, progress: null, ...storage });
    else set({ phase: 'no-model', notice, progress: null, ...storage });
  }

  function describePrepareFailure(error: unknown): string | null {
    if (error instanceof InstallError && error.reason === 'cancelled') return null;
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    if (error instanceof CaptureCancelled) return null;
    if (error instanceof DownloadNotOffered) return 'This page does not offer a model download.';
    if (error instanceof ModelFilesError) return `${FILES_NOT_USED} (${error.message})`;
    if (error instanceof ModelBusyError || error instanceof NoCoordinationError) return error.message;
    if (error instanceof InstallError) {
      if (error.reason === 'not-confirmed') return NOT_CONFIRMED;
      if (error.reason === 'uncoordinated') return error.message;
      if (error.reason === 'not-offered') return 'This server does not provide the speech model files. Nothing was downloaded.';
      if (error.reason === 'integrity') return `A downloaded file is not the expected one and was discarded. Nothing was installed. (${error.message})`;
      if (error.reason === 'redirect') return `The download was refused: ${error.message} Nothing was installed.`;
      if (error.reason === 'capacity') return `The model was not downloaded: there is not enough room for it in this browser, or the browser cannot say. ${error.message} ${LEARNING_DATA_UNTOUCHED}`;
      if (error.reason === 'storage') return `The browser could not store the model. Nothing was installed. (${error.message}) ${LEARNING_DATA_UNTOUCHED}`;
      if (error.reason === 'busy') return error.message;
      return `The download failed and nothing was installed. (${error.message})`;
    }
    return error instanceof Error ? error.message : String(error);
  }

  // A recognizer that stops by itself says so at once. The screen then offers to load the
  // model again, instead of offering a recording that could only fail.
  const forgetFailures = deps.recognizer.onFailure?.((reason) => {
    if (disposed) return;
    // A recognition that waits is refused by the recognizer; `finish` reports that.
    if (state.phase === 'recognizing') return;
    if (state.phase === 'installing' || state.phase === 'loading') {
      stoppedWhilePreparing = stoppedNotice(reason);
      preparing?.abort();
      return;
    }
    if (state.phase === 'starting' || state.phase === 'recording') {
      // Nothing could recognize this recording any more: the microphone is released now.
      endAttempt();
      set({ phase: 'ready', outcome: { kind: 'unable', message: `The recognizer failed: ${reason}` } });
    }
    void refresh(stoppedNotice(reason)).catch(() => undefined);
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },

    async init() {
      try {
        await refresh();
      } catch (error) {
        set({ phase: 'unsupported', notice: `The speech model's state could not be read: ${error instanceof Error ? error.message : String(error)}` });
      }
    },

    async prepare() {
      if (state.phase !== 'no-model') return;
      // Loading only. No download can start from here, whatever the screen believed about the
      // cache: the recognizer looks at the cache itself and refuses when the files are not there.
      await bring(null);
    },

    async install(options = {}) {
      if (state.phase !== 'no-model') return;
      // The order of a download: room first, then the learner's confirmation. Asked before the
      // screen changes and before anything is requested. The installer checks both again.
      if (!deps.downloadOffered) {
        set({ notice: 'This page does not offer a model download.' });
        return;
      }
      const storage = await readStorage();
      // The screen was left while the browser answered, or another request got here first and
      // changed the screen: nothing is started. So two requests at once start one download.
      if (disposed || state.phase !== 'no-model') return;
      if (storage.storage && !storage.storage.canCoordinate) {
        set({ ...storage, notice: new NoCoordinationError('it has no Web Locks').message });
        return;
      }
      if (storage.storage?.capacity.state !== 'sufficient') {
        set({ ...storage, notice: `The model was not downloaded: ${storage.storage ? describeCapacity(storage.storage.capacity) : 'the browser\'s storage could not be asked, so there is no estimate to decide on.'} ${LEARNING_DATA_UNTOUCHED}` });
        return;
      }
      if (options.confirmed !== true) {
        set({ ...storage, notice: NOT_CONFIRMED });
        return;
      }
      set(storage);
      // A complete installation is there already, for example from another tab: it is loaded, and nothing is downloaded.
      await bring(storage.installed ? null : { confirmed: options.confirmed });
    },

    cancelPrepare() {
      preparing?.abort();
    },

    async removeModel() {
      if (state.working) return;
      endAttempt();
      const ending = preparation;
      preparing?.abort();
      preparing = null;
      deps.recorder.close();
      set({ outcome: null, working: 'removal' });
      // An installation of this screen that was just ended lets go of the model cache first.
      await ended(ending);
      try {
        await deps.recognizer.remove();
        set({ working: null, fileProblems: null });
        await refresh();
      } catch (error) {
        set({ working: null });
        await refresh(`The model could not be deleted: ${error instanceof Error ? error.message : String(error)} ${LEARNING_DATA_UNTOUCHED}`).catch(() => undefined);
      }
    },

    async refreshStorage() {
      if (state.phase === 'checking' || state.phase === 'unsupported' || state.phase === 'installing') return;
      set(await readStorage());
    },

    async askForPersistence() {
      if (state.askingPersistence || !state.storage?.canAskForPersistence) return;
      set({ askingPersistence: true });
      // Some browsers answer with a question to the learner. However long that takes, nothing
      // else on the screen waits for it, and the answer is taken when it comes.
      const answer = await deps.modelStorage.askForPersistence().catch((): PersistenceAnswer => 'failed');
      const storage = await readStorage();
      set({ askingPersistence: false, ...storage, storage: storage.storage ? { ...storage.storage, answer } : null });
    },

    async checkFiles() {
      if (state.working || state.installation?.state !== 'installed') return;
      set({ working: 'files' });
      const problems = await deps.modelStorage.verify().catch((error: unknown) => [`The files could not be read: ${error instanceof Error ? error.message : String(error)}`]);
      set({ working: null, fileProblems: problems, ...(await readStorage()) });
    },

    async record() {
      if (state.phase !== 'ready') return;
      endAttempt();
      const mine = attempt;
      set({ phase: 'starting', outcome: null });
      deps.stopPlayback?.();

      const control = new AbortController();
      starting = control;
      let started: Capture;
      try {
        started = await deps.recorder.start({
          maxSeconds: MAX_SECONDS,
          signal: control.signal,
          onLimit: () => {
            if (mine === attempt) void finish(true);
          },
          onLost: () => {
            if (mine !== attempt) return;
            endAttempt();
            set({ phase: 'ready', outcome: { kind: 'unable', message: 'The microphone stopped. Record again.' } });
          }
        });
      } catch (error) {
        if (mine !== attempt) return;
        set({ phase: 'ready', outcome: { kind: 'unable', message: error instanceof CaptureError ? error.message : String(error) } });
        return;
      }
      // Cancelled, hidden or left while the recorder was starting. The recorder has released
      // the microphone already; this is for a recorder that answered all the same.
      if (mine !== attempt || disposed) {
        started.cancel();
        return;
      }

      capture = started;
      const samples = new Promise<Float32Array>((resolve) => {
        deliver = resolve;
      });
      runAbort = new AbortController();
      try {
        // The run starts before the learner speaks, so a provider may listen to the live track.
        run = deps.recognizer.begin({ track: started.track, pcm: () => samples }, { signal: runAbort.signal });
      } catch (error) {
        endAttempt();
        await recognizerFailed(error);
        return;
      }
      set({ phase: 'recording' });
    },

    stop: () => finish(false),

    cancel() {
      if (state.phase !== 'starting' && state.phase !== 'recording' && state.phase !== 'recognizing') return;
      endAttempt();
      set({ phase: 'ready', outcome: null });
    },

    clearOutcome() {
      if (state.outcome) set({ outcome: null });
    },

    pageHidden() {
      if (state.phase !== 'starting' && state.phase !== 'recording') return;
      endAttempt();
      set({ phase: 'ready', outcome: { kind: 'unable', message: 'The recording was stopped because the page was hidden. Record again.' } });
    },

    recordedSeconds: () => capture?.seconds() ?? 0,

    dispose() {
      endAttempt();
      preparing?.abort();
      preparing = null;
      disposed = true;
      listeners.clear();
      forgetFailures?.();
      deps.recorder.close();
      void deps.recognizer.release();
    }
  };

  /**
   * Brings the model into memory. With `download`, the files are installed first: that is
   * given only by `install`, with the learner's confirmation in it. Without it this loads
   * and nothing else.
   */
  async function bring(download: { confirmed: boolean } | null): Promise<void> {
    const controller = new AbortController();
    preparing = controller;
    set({ phase: download ? 'installing' : 'loading', notice: null, fileProblems: null, progress: download ? { loaded: 0, total: state.downloadBytes } : null });
    const cancelled = (): CaptureCancelled => new CaptureCancelled('The preparation was cancelled.');
    let notice: string | null = null;
    let filesRefused: ModelFilesError | null = null;
    let letGo: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    preparation = running;
    try {
      try {
        if (download) {
          await deps.recognizer.install({
            confirmed: download.confirmed,
            signal: controller.signal,
            onProgress: (loaded, total) => {
              if (preparing !== controller) return;
              set(loaded >= total ? { phase: 'loading', progress: null } : { phase: 'installing', progress: { loaded, total } });
            }
          });
          if (controller.signal.aborted) throw cancelled();
          if (preparing === controller) set({ phase: 'loading', progress: null });
        }
        await deps.recognizer.prepare({ signal: controller.signal });
        if (controller.signal.aborted) throw cancelled();
        // The recorder's own script is loaded here too, so recording itself requests nothing.
        await deps.recorder.prepare(controller.signal);
        if (controller.signal.aborted) throw cancelled();
      } finally {
        // Ended, one way or the other: the installer no longer holds the model cache.
        if (preparation === running) preparation = null;
        letGo();
      }
    } catch (error) {
      notice = describePrepareFailure(error);
      // Failed or cancelled: whatever was prepared so far is released, so the screen is
      // not left half ready. The installed files stay.
      deps.recorder.close();
      await deps.recognizer.release().catch(() => undefined);
      if (error instanceof ModelFilesError) filesRefused = error;
    }
    if (preparing === controller) preparing = null;
    const stopped = stoppedWhilePreparing;
    stoppedWhilePreparing = null;
    await refresh(notice ?? stopped).catch(() => undefined);
    if (!filesRefused || disposed || state.phase !== 'no-model') return;
    // The files were refused. What the cache holds now decides what the screen says, and no
    // download follows from it: a download is asked for again, with its confirmation.
    if (state.installation?.state === 'installed') {
      // Complete by its entries, and still refused: the files are looked at one by one.
      const refused = filesRefused;
      const problems = await deps.modelStorage.verify().catch(() => [refused.message]);
      set({ fileProblems: problems.length ? problems : [FILES_NOT_USED] });
    } else if (state.installation?.state === 'absent') {
      set({ notice: MODEL_GONE });
    }
    // Leftovers, a damaged installation, or a cache that could not be read: the notice above stays.
  }

  async function finish(reachedLimit: boolean): Promise<void> {
    if (state.phase !== 'recording' || !capture || !run || !deliver) return;
    const mine = attempt;
    const current = run;
    const hand = deliver;
    const recording = capture;
    capture = null;
    set({ phase: 'recognizing' });

    const samples = await recording.stop();
    if (mine !== attempt) return;
    const levels = checkLevels(samples, reachedLimit);
    if (levels.problem) {
      endAttempt();
      set({ phase: 'ready', outcome: { kind: 'unable', message: LEVEL_MESSAGES[levels.problem] } });
      return;
    }

    try {
      hand(samples);
      const heard = await current.finish();
      if (mine !== attempt) return;
      run = null;
      set({ phase: 'ready', outcome: { kind: 'heard', text: heard.text.trim(), audioSeconds: heard.audioSeconds, elapsedMs: heard.elapsedMs } });
    } catch (error) {
      if (mine !== attempt || error instanceof RecognitionCancelled) return;
      run = null;
      await recognizerFailed(error);
    }
  }

  /**
   * The recognizer refused a recording or failed during one. The attempt gets no result.
   * A recognizer that is no longer ready has lost its model: the screen says so and offers
   * to load it again, which starts a new Worker.
   */
  async function recognizerFailed(error: unknown): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error);
    set({ phase: 'ready', outcome: { kind: 'unable', message: `The recognizer failed: ${reason}` } });
    await refresh(stoppedNotice(reason)).catch(() => undefined);
  }
}
