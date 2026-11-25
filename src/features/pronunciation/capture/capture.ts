import { SAMPLE_RATE } from '../audio';

/**
 * Microphone recording, from the permission request to the release of the microphone
 * (ENG-V3-02, stage A).
 *
 * - `prepare` loads the recorder's own script into an audio context that stays paused.
 *   It belongs to preparing the screen, together with loading the model: after it,
 *   recording needs no request of any kind.
 * - `start` is the only place that asks for the microphone, and the screen calls it only
 *   from the click handler of the record control.
 * - The samples stay in this tab's memory as 16 kHz mono numbers. They are not stored,
 *   not played back and not sent anywhere.
 * - `stop`, `cancel`, an error during set-up and a lost device all end the same way:
 *   every track is stopped, the nodes are disconnected and the audio context is paused.
 *   `close` ends the audio context and its worklet; the screen calls it when it is left.
 *
 * Preparing and starting wait for the browser: for the recorder's script, for the
 * permission, for the audio device. Each of these waits can be ended at once, by the
 * caller's signal or by `close`, and may never finish by itself. Ending one releases
 * what was acquired so far right away: a microphone track is stopped, and an audio
 * context that was being prepared is closed. Whatever the browser delivers afterwards is
 * released as it arrives and is never used.
 */
export type CaptureEnvironment = {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createContext(sampleRate: number): AudioContext;
  createCollector(context: AudioContext): AudioWorkletNode;
  /** Address of pcm-collector.worklet.js, a file of this application. */
  workletUrl: string;
};

export type Capture = {
  readonly track: MediaStreamTrack;
  /** Stops recording, releases the microphone and returns the samples. */
  stop(): Promise<Float32Array>;
  /** Releases the microphone and drops the samples. */
  cancel(): void;
  /** How much has been recorded so far. */
  seconds(): number;
};

export type CaptureOptions = {
  maxSeconds: number;
  /** The time limit was reached. The caller stops the recording. */
  onLimit: () => void;
  /** The microphone ended by itself: unplugged, or the permission was taken away. */
  onLost: () => void;
  /** Aborting it ends the start, or the recording, at once and releases the microphone. */
  signal?: AbortSignal;
};

export type Recorder = {
  /**
   * Loads the recorder's script. The last request before recording; safe to call again.
   * Aborting the signal ends it at once and closes the audio context it was preparing.
   */
  prepare(signal?: AbortSignal): Promise<void>;
  /** Asks for the microphone and records. Refused unless `prepare` has finished. */
  start(options: CaptureOptions): Promise<Capture>;
  /** Releases the microphone, and ends the audio context and its worklet, also one that is still being prepared. */
  close(): void;
};

/** The microphone could not be used. `message` is written for the learner. */
export class CaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureError';
  }
}

/** A preparation or a start that was ended on purpose, by the caller or by `close`. Not a failure. */
export class CaptureCancelled extends CaptureError {
  constructor(message = 'The recording was cancelled.') {
    super(message);
    this.name = 'CaptureCancelled';
  }
}

function describeFailure(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'The microphone was not allowed. Allow it for this page in the browser, then record again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The microphone could not be started. Another program may be using it.';
  return `The recording could not be started: ${error instanceof Error ? error.message : String(error)}`;
}

export function createRecorder(environment: CaptureEnvironment): Recorder {
  /** The prepared audio context. It is paused between recordings. */
  let context: AudioContext | null = null;
  /** A preparation that has not finished: how to end it. Its audio context is closed with it. */
  let pending: { cancel: () => void } | null = null;
  /** Releases the recording that is starting or running, if there is one. */
  let releaseActive: (() => void) | null = null;

  const isOpen = (candidate: AudioContext | null): candidate is AudioContext => candidate !== null && candidate.state !== 'closed';
  const closeQuietly = (audio: AudioContext): void => {
    if (audio.state !== 'closed') void audio.close().catch(() => undefined);
  };
  /** Pauses the context, unless a recording is starting or running on it. */
  const pauseIfIdle = (audio: AudioContext): void => {
    if (releaseActive === null && audio.state === 'running') void audio.suspend().catch(() => undefined);
  };

  function prepare(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new CaptureCancelled('The preparation was cancelled.'));
    if (isOpen(context)) return Promise.resolve();
    // One preparation at a time: an earlier one that has not finished is ended.
    pending?.cancel();

    const created = environment.createContext(SAMPLE_RATE);
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const own = { cancel: (): void => finish(new CaptureCancelled('The preparation was cancelled.')) };
      /** Ends this preparation once. Only a preparation that succeeds keeps its context. */
      function finish(error?: CaptureError): void {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', own.cancel);
        if (pending === own) pending = null;
        if (error) {
          closeQuietly(created);
          reject(error);
        } else {
          context = created;
          resolve();
        }
      }
      pending = own;
      signal?.addEventListener('abort', own.cancel, { once: true });

      (async () => {
        if (created.sampleRate !== SAMPLE_RATE) throw new CaptureError(`This browser cannot record at ${SAMPLE_RATE} Hz.`);
        await created.audioWorklet.addModule(environment.workletUrl);
        // Ended while the script was loading: the context is closed already and stays unused.
        if (settled) return;
        // Paused until a recording starts: nothing is heard and nothing runs meanwhile.
        await created.suspend();
      })().then(
        () => finish(),
        (error: unknown) => finish(error instanceof CaptureError ? error : new CaptureError(`The recorder could not be prepared: ${error instanceof Error ? error.message : String(error)}`))
      );
    });
  }

  function start(options: CaptureOptions): Promise<Capture> {
    const audio = context;
    if (!isOpen(audio)) return Promise.reject(new CaptureError('The recorder is not prepared.'));
    if (options.signal?.aborted) return Promise.reject(new CaptureCancelled());
    releaseActive?.();

    return new Promise<Capture>((resolve, reject) => {
      let stream: MediaStream | null = null;
      let source: MediaStreamAudioSourceNode | null = null;
      let collector: AudioWorkletNode | null = null;
      let released = false;
      /** Whether the caller has its answer: the capture, or the reason there is none. */
      let answered = false;
      let chunks: Float32Array[] = [];
      let length = 0;
      let limitReported = false;
      const limit = options.maxSeconds * SAMPLE_RATE;

      const release = (): void => {
        if (released) return;
        released = true;
        options.signal?.removeEventListener('abort', release);
        if (releaseActive === release) releaseActive = null;
        if (collector) collector.port.onmessage = null;
        try {
          source?.disconnect();
          collector?.disconnect();
        } catch {
          // Already disconnected.
        }
        for (const track of stream?.getTracks() ?? []) {
          track.onended = null;
          track.stop();
        }
        pauseIfIdle(audio);
        // A start that is still waiting for the browser ends here, without waiting any longer.
        if (!answered) {
          answered = true;
          reject(new CaptureCancelled());
        }
      };
      releaseActive = release;
      options.signal?.addEventListener('abort', release, { once: true });

      (async () => {
        const granted = await environment.getUserMedia({ audio: { channelCount: 1 }, video: false });
        // Ended while the browser was asking for the microphone: it is stopped as it arrives.
        if (released) {
          for (const track of granted.getTracks()) track.stop();
          return;
        }
        // From here on, releasing stops these tracks at once.
        stream = granted;
        const track = granted.getAudioTracks()[0];
        if (!track) throw new CaptureError('No microphone was found.');

        await audio.resume();
        // Ended while the audio device was starting: the tracks are stopped already. The
        // context has just started; it is paused again unless a newer recording uses it.
        if (released) {
          pauseIfIdle(audio);
          return;
        }

        source = audio.createMediaStreamSource(granted);
        collector = environment.createCollector(audio);
        collector.port.onmessage = (event: MessageEvent<Float32Array>) => {
          if (released) return;
          chunks.push(event.data);
          length += event.data.length;
          if (length >= limit && !limitReported) {
            limitReported = true;
            options.onLimit();
          }
        };
        track.onended = () => {
          if (!released) options.onLost();
        };
        source.connect(collector);
        // The collector writes no output, so this plays nothing. It keeps the graph running in every browser.
        collector.connect(audio.destination);

        answered = true;
        resolve({
          track,
          async stop(): Promise<Float32Array> {
            release();
            const samples = new Float32Array(Math.min(length, limit));
            let offset = 0;
            for (const chunk of chunks) {
              if (offset >= samples.length) break;
              const part = offset + chunk.length > samples.length ? chunk.subarray(0, samples.length - offset) : chunk;
              samples.set(part, offset);
              offset += part.length;
            }
            chunks = [];
            length = 0;
            return samples;
          },
          cancel(): void {
            release();
            chunks = [];
            length = 0;
          },
          seconds: () => Math.min(length, limit) / SAMPLE_RATE
        });
      })().catch((error: unknown) => {
        // Ended already: the caller has its answer, and nothing was left running.
        if (released) return;
        answered = true;
        reject(error instanceof CaptureError ? error : new CaptureError(describeFailure(error)));
        release();
      });
    });
  }

  function close(): void {
    releaseActive?.();
    pending?.cancel();
    if (isOpen(context)) closeQuietly(context);
    context = null;
  }

  return { prepare, start, close };
}

/** Whether this browser can record here at all. Asks for nothing. */
export function canRecord(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined';
}

/** The capture environment of the running application. `workletUrl` is the address of pcm-collector.worklet.js. */
export function browserCaptureEnvironment(workletUrl: string): CaptureEnvironment {
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    createContext: (sampleRate) => new AudioContext({ sampleRate }),
    createCollector: (context) => new AudioWorkletNode(context, 'pcm-collector', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' }),
    workletUrl
  };
}
