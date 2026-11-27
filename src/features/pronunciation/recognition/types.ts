/**
 * What the practice screen needs from a speech recognizer (ENG-V3-02, stage A).
 *
 * The screen never knows which provider runs. Stage A has one provider, `local-ml`: a
 * downloaded model in a Worker on this device. A browser's own recognizer would be a
 * second provider with the same interface. There is no cloud provider and no fallback
 * to one.
 */
export type RecognizerDescriptor = {
  provider: 'local-ml' | 'browser-local';
  model: string;
  /** Null when the provider cannot report it. It is then recorded as unknown. */
  revision: string | null;
  runtime: string;
};

export type RecognizerState =
  /** The model is loaded: recording can start. */
  | { status: 'ready' }
  /** The model is on this device and has to be loaded into memory. No network is needed, and none is used. */
  | { status: 'installed' }
  /** The model has to be downloaded first. `bytes` is the exact size. */
  | { status: 'needs-download'; bytes: number }
  | { status: 'unsupported'; reason: string };

export type Recognition = {
  /** What the recognizer heard. It is not a judgement of the speaker. */
  text: string;
  /** Null when the provider has no measure of its own uncertainty. */
  uncertainty: number | null;
  audioSeconds: number;
  elapsedMs: number;
};

/** A recording in progress: the live track, and the samples (16 kHz, mono) once it stopped. */
export type LiveCapture = {
  track: MediaStreamTrack;
  pcm(): Promise<Float32Array>;
};

export type RecognitionRun = {
  finish(): Promise<Recognition>;
  /** The run's result is dropped, also when it arrives later. */
  cancel(): void;
};

/** The run was cancelled: its result, if one still arrives, is not used. */
export class RecognitionCancelled extends Error {
  constructor() {
    super('The recognition was cancelled.');
    this.name = 'RecognitionCancelled';
  }
}

export interface SpeechRecognizer {
  readonly descriptor: RecognizerDescriptor;
  state(): Promise<RecognizerState>;
  /**
   * Downloads, verifies and stores the model's files. It loads nothing. This is the only
   * operation of a recognizer that may use the network, and it starts only with
   * `confirmed: true`: the learner confirmed this download on the screen.
   */
  install(options: { confirmed: boolean; signal: AbortSignal; onProgress: (loaded: number, total: number) => void }): Promise<void>;
  /**
   * Loads the installed model into memory. It never downloads. When the files are not on
   * this device it refuses, and the screen has to ask for a download again.
   */
  prepare(options: { signal: AbortSignal }): Promise<void>;
  /** Starts before the learner speaks. Refused unless the state is "ready". */
  begin(capture: LiveCapture, options: { signal: AbortSignal }): RecognitionRun;
  /** Frees the model's memory. The installed files stay. */
  release(): Promise<void>;
  /** Removes the downloaded files of this recognizer, and nothing else. */
  remove(): Promise<void>;
  /**
   * Tells the listener when the recognizer stopped by itself, with the reason: it is no
   * longer ready and has to be prepared again. Returns how to stop listening. A provider
   * without it reports such a failure when the next recognition is asked for.
   */
  onFailure?(listener: (reason: string) => void): () => void;
}
