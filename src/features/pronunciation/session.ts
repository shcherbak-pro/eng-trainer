import { CaptureCancelled, CaptureError, type Capture, type Recorder } from './capture/capture';
import { LEVEL_MESSAGES, MAX_SECONDS, checkLevels } from './capture/levels';
import { InstallError } from './models/install';
import { DownloadNotOffered } from './recognition/localMl';
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

export type PracticeState = {
  phase: Phase;
  installed: boolean;
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
  /** Downloads if needed (the click is the consent), then loads the model. */
  prepare(): Promise<void>;
  cancelPrepare(): void;
  removeModel(): Promise<void>;
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
  recorder: Recorder;
  downloadOffered: boolean;
  /** Reference playback elsewhere in the application is stopped before recording, so it is not recorded. */
  stopPlayback?: () => void;
};

export function createPracticeSession(deps: PracticeDependencies): PracticeSession {
  let state: PracticeState = { phase: 'checking', installed: false, downloadOffered: deps.downloadOffered, downloadBytes: 0, progress: null, notice: null, outcome: null };
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

  async function refresh(notice: string | null = null): Promise<void> {
    const recognizer = await deps.recognizer.state();
    if (recognizer.status === 'unsupported') set({ phase: 'unsupported', notice: recognizer.reason, progress: null });
    else if (recognizer.status === 'ready') set({ phase: 'ready', installed: true, notice: null, progress: null });
    else if (recognizer.status === 'installed') set({ phase: 'no-model', installed: true, notice, progress: null });
    else set({ phase: 'no-model', installed: false, downloadBytes: recognizer.bytes, notice, progress: null });
  }

  function describePrepareFailure(error: unknown): string | null {
    if (error instanceof InstallError && error.reason === 'cancelled') return null;
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    if (error instanceof CaptureCancelled) return null;
    if (error instanceof DownloadNotOffered) return 'This page does not offer a model download.';
    if (error instanceof InstallError) {
      if (error.reason === 'not-offered') return 'This server does not provide the speech model files. Nothing was downloaded.';
      if (error.reason === 'integrity') return `A downloaded file is not the expected one and was discarded. Nothing was installed. (${error.message})`;
      if (error.reason === 'redirect') return `The download was refused: ${error.message} Nothing was installed.`;
      if (error.reason === 'storage') return `The browser could not store the model. Nothing was installed. (${error.message})`;
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
      const controller = new AbortController();
      preparing = controller;
      const willDownload = !state.installed;
      set({ phase: willDownload ? 'installing' : 'loading', notice: null, progress: willDownload ? { loaded: 0, total: state.downloadBytes } : null });
      const cancelled = (): CaptureCancelled => new CaptureCancelled('The preparation was cancelled.');
      let notice: string | null = null;
      try {
        await deps.recognizer.prepare({
          signal: controller.signal,
          onProgress: (loaded, total) => {
            if (preparing !== controller) return;
            set(loaded >= total ? { phase: 'loading', progress: null } : { phase: 'installing', progress: { loaded, total } });
          }
        });
        if (controller.signal.aborted) throw cancelled();
        // The recorder's own script is loaded here too, so recording itself requests nothing.
        await deps.recorder.prepare(controller.signal);
        if (controller.signal.aborted) throw cancelled();
      } catch (error) {
        notice = describePrepareFailure(error);
        // Failed or cancelled: whatever was prepared so far is released, so the screen is
        // not left half ready. The installed files stay.
        deps.recorder.close();
        await deps.recognizer.release().catch(() => undefined);
      }
      if (preparing === controller) preparing = null;
      const stopped = stoppedWhilePreparing;
      stoppedWhilePreparing = null;
      await refresh(notice ?? stopped).catch(() => undefined);
    },

    cancelPrepare() {
      preparing?.abort();
    },

    async removeModel() {
      endAttempt();
      preparing?.abort();
      preparing = null;
      deps.recorder.close();
      set({ outcome: null });
      try {
        await deps.recognizer.remove();
        await refresh();
      } catch (error) {
        await refresh(`The model could not be deleted: ${error instanceof Error ? error.message : String(error)}`).catch(() => undefined);
      }
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
