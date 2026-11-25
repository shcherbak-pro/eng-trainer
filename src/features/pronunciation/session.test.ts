import { beforeEach, expect, it } from 'vitest';
import { describeExperimental } from '../../test/product';
import { last } from './testing';
import { CaptureError, type Capture, type CaptureOptions, type Recorder } from './capture/capture';
import { LEVEL_MESSAGES, MAX_SECONDS, SAMPLE_RATE } from './capture/levels';
import { InstallError } from './models/install';
import { DownloadNotOffered } from './recognition/localMl';
import { RecognitionCancelled, type LiveCapture, type Recognition, type RecognizerState, type SpeechRecognizer } from './recognition/types';
import { createPracticeSession, type PracticeSession, type PracticeState } from './session';

/**
 * The practice session with a fake recognizer and a fake recorder (ENG-V3-02, stage A):
 * the order of things, retry, cancellation, and that late results are dropped.
 */
const speech = (seconds: number, level = 0.2): Float32Array => Float32Array.from({ length: Math.round(seconds * SAMPLE_RATE) }, (_, index) => Math.sin(index / 5) * level);
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function fakes() {
  const log: string[] = [];
  let recognizerState: RecognizerState = { status: 'needs-download', bytes: 46_792_602 };
  let prepare: (options: { signal: AbortSignal; onProgress: (loaded: number, total: number) => void }) => Promise<void> = async ({ onProgress }) => {
    onProgress(10, 100);
    onProgress(100, 100);
    recognizerState = { status: 'ready' };
  };
  /** Runs that wait for the fake recognizer's answer. */
  const runs: { samples: Float32Array | null; resolve: (value: Recognition) => void; reject: (error: Error) => void; cancelled: boolean }[] = [];
  /** Recordings that were started. */
  const captures: { options: CaptureOptions; samples: Float32Array; stopped: boolean; cancelled: boolean }[] = [];
  let startCapture: (() => Promise<void>) | null = null;
  let recorderPrepare: () => Promise<void> = async () => undefined;

  const recognizer: SpeechRecognizer = {
    descriptor: { provider: 'local-ml', model: 'test', revision: 'abc', runtime: 'test' },
    state: async () => recognizerState,
    prepare: (options) => {
      log.push('recognizer.prepare');
      return prepare(options);
    },
    begin(capture: LiveCapture, { signal }) {
      if (recognizerState.status !== 'ready') throw new Error('The recognizer is not ready: prepare it before recording.');
      log.push('recognizer.begin');
      const run = { samples: null as Float32Array | null, resolve: (_: Recognition): void => undefined, reject: (_: Error): void => undefined, cancelled: false };
      runs.push(run);
      signal.addEventListener('abort', () => { run.cancelled = true; });
      return {
        finish: async () => {
          run.samples = await capture.pcm();
          log.push('recognizer.finish');
          return new Promise<Recognition>((resolve, reject) => {
            run.resolve = resolve;
            run.reject = reject;
          });
        },
        cancel: () => {
          run.cancelled = true;
          run.reject(new RecognitionCancelled());
        }
      };
    },
    release: async () => {
      log.push('recognizer.release');
      if (recognizerState.status === 'ready') recognizerState = { status: 'installed' };
    },
    remove: async () => {
      log.push('recognizer.remove');
      recognizerState = { status: 'needs-download', bytes: 46_792_602 };
    }
  };

  const recorder: Recorder = {
    prepare: () => {
      log.push('recorder.prepare');
      return recorderPrepare();
    },
    async start(options) {
      log.push('recorder.start');
      if (startCapture) await startCapture();
      const record = { options, samples: speech(2), stopped: false, cancelled: false };
      captures.push(record);
      const capture: Capture = {
        track: {} as MediaStreamTrack,
        stop: async () => {
          record.stopped = true;
          log.push('capture.stop');
          return record.samples;
        },
        cancel: () => {
          record.cancelled = true;
          log.push('capture.cancel');
        },
        seconds: () => 1.5
      };
      return capture;
    },
    close: () => void log.push('recorder.close')
  };

  return {
    recognizer, recorder, log, runs, captures,
    setState: (next: RecognizerState) => { recognizerState = next; },
    setPrepare: (next: typeof prepare) => { prepare = next; },
    setRecorderPrepare: (next: typeof recorderPrepare) => { recorderPrepare = next; },
    setStartCapture: (next: typeof startCapture) => { startCapture = next; },
    makeReady: () => { recognizerState = { status: 'ready' }; }
  };
}

describeExperimental('practice session', () => {
  let fake: ReturnType<typeof fakes>;
  let session: PracticeSession;
  let state: PracticeState;
  let history: PracticeState['phase'][];
  let playbackStopped: number;

  function create(downloadOffered = true): void {
    session = createPracticeSession({ recognizer: fake.recognizer, recorder: fake.recorder, downloadOffered, stopPlayback: () => { playbackStopped += 1; } });
    history = [];
    session.subscribe((next) => {
      state = next;
      if (last(history) !== next.phase) history.push(next.phase);
    });
  }

  /** A session whose model is loaded. */
  async function ready(): Promise<void> {
    await session.init();
    await session.prepare();
    expect(state.phase).toBe('ready');
    history.length = 0;
  }

  /** Records, stops, and lets the recognizer answer with `text`. */
  async function recordAndHear(text: string): Promise<void> {
    await session.record();
    const stopping = session.stop();
    await tick();
    last(fake.runs).resolve({ text, uncertainty: null, audioSeconds: 2, elapsedMs: 310 });
    await stopping;
  }

  beforeEach(() => {
    fake = fakes();
    playbackStopped = 0;
    create();
  });

  it('starts by reading the model\'s state: no model, with the exact download size', async () => {
    expect(state.phase).toBe('checking');
    await session.init();
    expect(state).toMatchObject({ phase: 'no-model', installed: false, downloadOffered: true, downloadBytes: 46_792_602, notice: null, outcome: null });
  });

  it('shows an installed model, an unsupported browser and a page without a download', async () => {
    fake.setState({ status: 'installed' });
    await session.init();
    expect(state).toMatchObject({ phase: 'no-model', installed: true });

    fake.setState({ status: 'unsupported', reason: 'This browser has no Workers.' });
    create();
    await session.init();
    expect(state).toMatchObject({ phase: 'unsupported', notice: 'This browser has no Workers.' });

    fake.setState({ status: 'needs-download', bytes: 100 });
    create(false);
    await session.init();
    expect(state).toMatchObject({ phase: 'no-model', installed: false, downloadOffered: false });
  });

  it('prepares on request only: download with progress, then loading, then the recorder, then ready', async () => {
    await session.init();
    expect(fake.log).toEqual([]);
    const progress: (PracticeState['progress'])[] = [];
    session.subscribe((next) => progress.push(next.progress));
    await session.prepare();

    expect(history).toEqual(['checking', 'no-model', 'installing', 'loading', 'ready']);
    expect(progress).toContainEqual({ loaded: 10, total: 100 });
    expect(fake.log).toEqual(['recognizer.prepare', 'recorder.prepare']);
    expect(state).toMatchObject({ phase: 'ready', installed: true, progress: null, notice: null });
  });

  it('loads an installed model without a download phase', async () => {
    fake.setState({ status: 'installed' });
    await session.init();
    fake.setPrepare(async () => fake.makeReady());
    await session.prepare();
    expect(history).toEqual(['checking', 'no-model', 'loading', 'ready']);
  });

  it('explains a failed preparation and stays without a model', async () => {
    const cases: [Error, string][] = [
      [new InstallError('not-offered', 'x'), 'This server does not provide the speech model files. Nothing was downloaded.'],
      [new InstallError('integrity', 'model/tokenizer.json: does not have the pinned SHA-256. The file was not stored.'), 'A downloaded file is not the expected one and was discarded. Nothing was installed.'],
      [new InstallError('redirect', 'model/config.json was answered with a redirect or from another address. It was not followed.'), 'The download was refused:'],
      [new InstallError('storage', 'model/weights could not be stored in this browser.'), 'The browser could not store the model. Nothing was installed.'],
      [new InstallError('network', 'model/config.json: the download was interrupted.'), 'The download failed and nothing was installed.'],
      [new DownloadNotOffered(), 'This page does not offer a model download.'],
      [new Error('The speech model could not be loaded: out of memory'), 'The speech model could not be loaded: out of memory']
    ];
    for (const [error, notice] of cases) {
      fake = fakes();
      create();
      await session.init();
      fake.setPrepare(async () => { throw error; });
      await session.prepare();
      expect(state.phase).toBe('no-model');
      expect(state.notice).toContain(notice);
      expect(fake.log).not.toContain('recorder.prepare');
    }
  });

  it('a cancelled preparation is not an error', async () => {
    await session.init();
    fake.setPrepare(({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new InstallError('cancelled', 'The download was cancelled.')))));
    const preparing = session.prepare();
    await tick();
    expect(state.phase).toBe('installing');
    session.cancelPrepare();
    await preparing;
    expect(state).toMatchObject({ phase: 'no-model', notice: null });
  });

  it('a recorder that cannot be prepared releases the model again and says why', async () => {
    await session.init();
    fake.setRecorderPrepare(async () => { throw new CaptureError('This browser cannot record at 16000 Hz.'); });
    await session.prepare();
    expect(fake.log).toEqual(['recognizer.prepare', 'recorder.prepare', 'recorder.close', 'recognizer.release']);
    expect(state).toMatchObject({ phase: 'no-model', installed: true, notice: 'This browser cannot record at 16000 Hz.' });
  });

  it('does not record before the model is ready: the microphone is not asked for', async () => {
    await session.init();
    await session.record();
    expect(fake.log).toEqual([]);
    expect(state.phase).toBe('no-model');
  });

  it('records in order: stop playback, microphone, recognizer run, stop, level check, text', async () => {
    await ready();
    fake.log.length = 0;
    await session.record();
    expect(state.phase).toBe('recording');
    expect(playbackStopped).toBe(1);
    expect(fake.captures[0].options.maxSeconds).toBe(MAX_SECONDS);
    expect(session.recordedSeconds()).toBe(1.5);

    const stopping = session.stop();
    await tick();
    expect(state.phase).toBe('recognizing');
    expect(fake.runs[0].samples).toBe(fake.captures[0].samples);
    fake.runs[0].resolve({ text: '  Let me explain. ', uncertainty: null, audioSeconds: 2, elapsedMs: 310 });
    await stopping;

    expect(fake.log).toEqual(['recorder.start', 'recognizer.begin', 'capture.stop', 'recognizer.finish']);
    expect(history).toEqual(['starting', 'recording', 'recognizing', 'ready']);
    expect(state.outcome).toEqual({ kind: 'heard', text: 'Let me explain.', audioSeconds: 2, elapsedMs: 310 });
    expect(session.recordedSeconds()).toBe(0);
  });

  it('retry: a new recording clears the last result and gives a new one', async () => {
    await ready();
    await recordAndHear('first');
    expect(state.outcome).toMatchObject({ kind: 'heard', text: 'first' });

    await session.record();
    expect(state).toMatchObject({ phase: 'recording', outcome: null });
    const stopping = session.stop();
    await tick();
    last(fake.runs).resolve({ text: 'second', uncertainty: null, audioSeconds: 2, elapsedMs: 1 });
    await stopping;
    expect(state.outcome).toMatchObject({ kind: 'heard', text: 'second' });
    expect(fake.captures).toHaveLength(2);
  });

  it('an empty text is a result too: the recognizer heard no words', async () => {
    await ready();
    await recordAndHear('   ');
    expect(state.outcome).toEqual({ kind: 'heard', text: '', audioSeconds: 2, elapsedMs: 310 });
  });

  it('does not ask the recognizer about a recording that fails the level checks', async () => {
    for (const [samples, problem] of [
      [new Float32Array(2 * SAMPLE_RATE), 'silence'],
      [speech(0.5), 'too-short'],
      [speech(2, 3).map((value) => Math.max(-1, Math.min(1, value))), 'clipped']
    ] as const) {
      fake = fakes();
      create();
      await ready();
      await session.record();
      fake.captures[0].samples = samples as Float32Array;
      await session.stop();
      expect(state).toMatchObject({ phase: 'ready', outcome: { kind: 'unable', message: LEVEL_MESSAGES[problem] } });
      expect(fake.log).not.toContain('recognizer.finish');
      expect(fake.runs[0].cancelled).toBe(true);
    }
  });

  it('stops by itself at the time limit and gives no result for that recording', async () => {
    await ready();
    await session.record();
    fake.captures[0].options.onLimit();
    await tick();
    expect(fake.captures[0].stopped).toBe(true);
    expect(state).toMatchObject({ phase: 'ready', outcome: { kind: 'unable', message: LEVEL_MESSAGES['too-long'] } });
    expect(fake.log).not.toContain('recognizer.finish');
  });

  it('a microphone that is refused, or that stops by itself, ends the attempt with the reason', async () => {
    await ready();
    fake.setStartCapture(async () => { throw new CaptureError('The microphone was not allowed. Allow it for this page in the browser, then record again.'); });
    await session.record();
    expect(state).toMatchObject({ phase: 'ready', outcome: { kind: 'unable', message: 'The microphone was not allowed. Allow it for this page in the browser, then record again.' } });
    expect(fake.runs).toHaveLength(0);

    fake.setStartCapture(null);
    await session.record();
    fake.captures[0].options.onLost();
    expect(fake.captures[0].cancelled).toBe(true);
    expect(state).toMatchObject({ phase: 'ready', outcome: { kind: 'unable', message: 'The microphone stopped. Record again.' } });
  });

  it('cancel while recording releases the microphone and leaves no result', async () => {
    await ready();
    await session.record();
    session.cancel();
    expect(fake.captures[0].cancelled).toBe(true);
    expect(fake.runs[0].cancelled).toBe(true);
    expect(state).toMatchObject({ phase: 'ready', outcome: null });
    // Stop after a cancel does nothing.
    await session.stop();
    expect(fake.captures[0].stopped).toBe(false);
  });

  it('cancel while the browser asks for the microphone: the microphone is released as soon as it arrives', async () => {
    await ready();
    let grant: () => void = () => undefined;
    fake.setStartCapture(() => new Promise<void>((resolve) => { grant = resolve; }));
    const recording = session.record();
    await tick();
    expect(state.phase).toBe('starting');
    session.cancel();
    expect(state.phase).toBe('ready');
    grant();
    await recording;
    expect(fake.captures[0].cancelled).toBe(true);
    expect(fake.runs).toHaveLength(0);
    expect(state.phase).toBe('ready');
  });

  it('drops a result that arrives after a cancel', async () => {
    await ready();
    await session.record();
    const stopping = session.stop();
    await tick();
    expect(state.phase).toBe('recognizing');
    session.cancel();
    expect(state).toMatchObject({ phase: 'ready', outcome: null });
    fake.runs[0].resolve({ text: 'late', uncertainty: null, audioSeconds: 2, elapsedMs: 1 });
    await stopping;
    await tick();
    expect(state.outcome).toBeNull();
  });

  it('drops the result of an earlier recording when a new one has started', async () => {
    await ready();
    await session.record();
    const first = session.stop();
    await tick();
    session.cancel();
    await session.record();
    fake.runs[0].resolve({ text: 'old', uncertainty: null, audioSeconds: 2, elapsedMs: 1 });
    await first;
    await tick();
    expect(state).toMatchObject({ phase: 'recording', outcome: null });
  });

  it('a recognizer failure is reported as "no result", and the model\'s state is read again', async () => {
    await ready();
    await session.record();
    const stopping = session.stop();
    await tick();
    fake.setState({ status: 'installed' });
    fake.runs[0].reject(new Error('out of memory'));
    await stopping;
    expect(state).toMatchObject({ phase: 'no-model', installed: true, outcome: { kind: 'unable', message: 'The recognizer failed: out of memory' } });
  });

  it('a hidden page ends a recording and releases the microphone, and leaves a recognition alone', async () => {
    await ready();
    await session.record();
    session.pageHidden();
    expect(fake.captures[0].cancelled).toBe(true);
    expect(state).toMatchObject({ phase: 'ready', outcome: { kind: 'unable', message: 'The recording was stopped because the page was hidden. Record again.' } });

    await session.record();
    const stopping = session.stop();
    await tick();
    session.pageHidden();
    expect(state.phase).toBe('recognizing');
    last(fake.runs).resolve({ text: 'kept', uncertainty: null, audioSeconds: 2, elapsedMs: 1 });
    await stopping;
    expect(state.outcome).toMatchObject({ kind: 'heard', text: 'kept' });
  });

  it('another phrase clears the last result', async () => {
    await ready();
    await recordAndHear('first');
    session.clearOutcome();
    expect(state.outcome).toBeNull();
  });

  it('deleting the model ends a recording, closes the recorder and returns to "no model"', async () => {
    await ready();
    await session.record();
    fake.log.length = 0;
    await session.removeModel();
    expect(fake.captures[0].cancelled).toBe(true);
    expect(fake.log).toEqual(['capture.cancel', 'recorder.close', 'recognizer.remove']);
    expect(state).toMatchObject({ phase: 'no-model', installed: false, outcome: null });
  });

  it('leaving the screen releases the microphone, the recorder and the model, and nothing is reported afterwards', async () => {
    await ready();
    await session.record();
    const stopping = session.stop();
    await tick();
    fake.log.length = 0;
    const before = state;
    session.dispose();
    expect(fake.log).toEqual(['recorder.close', 'recognizer.release']);
    expect(fake.runs[0].cancelled).toBe(true);
    fake.runs[0].resolve({ text: 'late', uncertainty: null, audioSeconds: 2, elapsedMs: 1 });
    await stopping;
    await tick();
    expect(state).toBe(before);
  });

  it('leaving while the browser asks for the microphone releases it when it arrives', async () => {
    await ready();
    let grant: () => void = () => undefined;
    fake.setStartCapture(() => new Promise<void>((resolve) => { grant = resolve; }));
    const recording = session.record();
    await tick();
    session.dispose();
    grant();
    await recording;
    expect(fake.captures[0].cancelled).toBe(true);
  });
});
