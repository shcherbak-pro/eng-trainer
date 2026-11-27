import { beforeEach, expect, it } from 'vitest';
import { describeExperimental } from '../../test/product';
import { CaptureCancelled, createRecorder, type Recorder } from './capture/capture';
import { SAMPLE_RATE } from './capture/levels';
import type { Installation, ModelStore } from './models/store';
import { createLocalMlRecognizer } from './recognition/localMl';
import { createPracticeSession, type PracticeSession, type PracticeState } from './session';
import { FakeRecognizerWorker, fakeAudio, fakeLocks, fakeModelStorage, gate, last, roomy } from './testing';

/**
 * The session, the recorder and the recognizer together (ENG-V3-02A-RC1): the three
 * findings of the independent review, each with the real modules and only the browser
 * faked. A browser step that "has not answered yet" is a gate that the test holds shut.
 *
 * F1  Cancel and a hidden page release the microphone while the recorder is still starting.
 * F2  Cancel and leaving the screen during the preparation release what was prepared.
 * F3  A Worker that fails after loading ends the recognition, and the model can be loaded again.
 */
const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const speech = (seconds: number): Float32Array => Float32Array.from({ length: Math.round(seconds * SAMPLE_RATE) }, (_, index) => Math.sin(index / 5) * 0.2);
/** What the model cache holds in these tests: a complete installation. */
const INSTALLED: Installation = { state: 'installed', bytes: 46_792_602, otherBytes: 0 };

describeExperimental('lifecycle: session, recorder and recognizer together', () => {
  let audio: ReturnType<typeof fakeAudio>;
  let recorder: Recorder;
  let workers: FakeRecognizerWorker[];
  let session: PracticeSession;
  let state: PracticeState;

  /** Lets the newest Worker start and load the model, as soon as the session has started it. */
  async function workerLoads(count: number): Promise<void> {
    for (let waited = 0; waited < 50 && workers.length < count; waited += 1) await turn();
    expect(workers).toHaveLength(count);
    last(workers).load();
  }

  /** Prepares the screen: the model is loaded in a Worker, and the recorder is prepared. */
  async function ready(): Promise<void> {
    await session.init();
    const preparing = session.prepare();
    await workerLoads(workers.length + 1);
    await preparing;
    expect(state.phase).toBe('ready');
  }

  /** Records two seconds of speech, stops, and lets the newest Worker answer with `text`. */
  async function recordAndHear(text: string): Promise<void> {
    await session.record();
    expect(state.phase).toBe('recording');
    audio.hear(speech(2));
    const stopping = session.stop();
    await turn();
    const worker = last(workers);
    worker.emit({ type: 'transcribed', id: last(worker.requests()), text, audioSeconds: 2, elapsedMs: 100 });
    await stopping;
  }

  beforeEach(() => {
    audio = fakeAudio();
    recorder = createRecorder(audio.environment);
    workers = [];
    const recognizer = createLocalMlRecognizer({
      store: { isInstalled: async () => true, remove: async () => undefined } as unknown as ModelStore,
      sourceUrl: (file) => `http://localhost:3000/eng-trainer/v3/models/${file.id}`,
      keyBase: 'http://localhost:3000/eng-trainer/model-cache/',
      startWorker: () => {
        const worker = new FakeRecognizerWorker();
        workers.push(worker);
        return worker;
      },
      mayDownload: () => false,
      readEstimate: roomy,
      locks: fakeLocks(),
      unsupported: () => null
    });
    session = createPracticeSession({ recognizer, modelStorage: fakeModelStorage({ installation: INSTALLED }).like, recorder, downloadOffered: false });
    session.subscribe((next) => {
      state = next;
    });
  });

  // ---- F1 ------------------------------------------------------------------------------

  for (const action of ['cancel', 'pageHidden'] as const) {
    it(`F1: ${action} while the audio device is starting stops the acquired microphone at once`, async () => {
      await ready();
      audio.waits.resume = gate();
      const recording = session.record();
      await turn();
      // The browser handed over a live microphone; the recorder still waits for the audio device.
      expect(state.phase).toBe('starting');
      expect(audio.tracks[0].readyState).toBe('live');

      session[action]();
      expect(audio.tracks[0].readyState).toBe('ended');
      expect(state.phase).toBe('ready');
      expect(state.outcome).toEqual(action === 'cancel' ? null : { kind: 'unable', message: 'The recording was stopped because the page was hidden. Record again.' });
      await recording;

      // The audio device answers late: nothing starts recording, and the context is paused again.
      audio.waits.resume.open();
      await turn();
      expect(audio.contexts[0].state).toBe('suspended');
      expect(audio.collectors).toHaveLength(0);
      expect(state.phase).toBe('ready');
      expect(workers[0].requests()).toEqual([]);
    });
  }

  it('F1: cancel while the browser asks for the permission; a microphone that is granted later is stopped as it arrives', async () => {
    await ready();
    audio.waits.permission = gate();
    const recording = session.record();
    await turn();
    expect(state.phase).toBe('starting');
    expect(audio.tracks).toHaveLength(0);

    session.cancel();
    expect(state.phase).toBe('ready');
    await recording;

    audio.waits.permission.open();
    await turn();
    expect(audio.tracks.map((track) => track.readyState)).toEqual(['ended']);
    expect(audio.collectors).toHaveLength(0);
    expect(state).toMatchObject({ phase: 'ready', outcome: null });
  });

  it('F1: retry after a cancelled start records normally, also when the cancelled start finishes during it', async () => {
    await ready();
    const held = gate();
    audio.waits.resume = held;
    const cancelled = session.record();
    await turn();
    session.cancel();
    await cancelled;

    audio.waits.resume = null;
    await session.record();
    expect(state.phase).toBe('recording');
    expect(audio.tracks.map((track) => track.readyState)).toEqual(['ended', 'live']);
    audio.hear(speech(2));

    // The first start's audio device answers now, in the middle of the second recording.
    held.open();
    await turn();
    expect(audio.contexts[0].state).toBe('running');
    expect(audio.tracks[1].readyState).toBe('live');
    expect(state.phase).toBe('recording');

    const stopping = session.stop();
    await turn();
    workers[0].emit({ type: 'transcribed', id: last(workers[0].requests()), text: 'Let me explain.', audioSeconds: 2, elapsedMs: 100 });
    await stopping;
    expect(state).toMatchObject({ phase: 'ready', outcome: { kind: 'heard', text: 'Let me explain.' } });
    expect(audio.tracks.map((track) => track.readyState)).toEqual(['ended', 'ended']);
  });

  it('F1: leaving the screen while the audio device is starting stops the microphone and closes the context', async () => {
    await ready();
    audio.waits.resume = gate();
    const recording = session.record();
    await turn();
    session.dispose();
    expect(audio.tracks[0].readyState).toBe('ended');
    expect(audio.contexts[0].state).toBe('closed');
    expect(workers[0].terminated).toBe(true);
    await recording;
    audio.waits.resume.open();
    await turn();
    expect(audio.contexts[0].state).toBe('closed');
    expect(audio.collectors).toHaveLength(0);
  });

  // ---- F2 ------------------------------------------------------------------------------

  it('F2: leaving while the recorder\'s script loads closes its audio context, and the late answer cannot keep it', async () => {
    await session.init();
    audio.waits.module = gate();
    const preparing = session.prepare();
    await workerLoads(1);
    await turn();
    // The model is loaded; the recorder still waits for its script.
    expect(state.phase).toBe('loading');
    expect(audio.contexts).toHaveLength(1);

    session.dispose();
    expect(audio.contexts[0].state).toBe('closed');
    expect(audio.contexts[0].closes).toBe(1);
    expect(workers[0].terminated).toBe(true);

    audio.waits.module.open();
    await preparing;
    await turn();
    expect(audio.contexts[0].state).toBe('closed');
    expect(audio.contexts[0].closes).toBe(1);
    await expect(recorder.start({ maxSeconds: 1, onLimit: () => undefined, onLost: () => undefined })).rejects.toThrow('The recorder is not prepared.');
  });

  it('F2: Cancel while the recorder\'s script loads ends the preparation: nothing is ready, and what was prepared is released', async () => {
    await session.init();
    audio.waits.module = gate();
    const preparing = session.prepare();
    await workerLoads(1);
    await turn();
    expect(state.phase).toBe('loading');

    session.cancelPrepare();
    // Without waiting for the script: the wait is over at once.
    await preparing;
    expect(state).toMatchObject({ phase: 'no-model', installed: true, notice: null });
    expect(audio.contexts[0].state).toBe('closed');
    expect(workers[0].terminated).toBe(true);

    audio.waits.module.open();
    await turn();
    expect(state.phase).toBe('no-model');
    expect(audio.contexts[0].state).toBe('closed');
    // A recording cannot start in this state.
    await session.record();
    expect(audio.log.some((line) => line.startsWith('getUserMedia'))).toBe(false);
  });

  it('F2: after a cancelled preparation, preparing again works and a recording gives a result', async () => {
    await session.init();
    audio.waits.module = gate();
    const cancelled = session.prepare();
    await workerLoads(1);
    await turn();
    session.cancelPrepare();
    await cancelled;

    audio.waits.module = null;
    const preparing = session.prepare();
    await workerLoads(2);
    await preparing;
    expect(state.phase).toBe('ready');
    expect(audio.contexts.map((context) => context.state)).toEqual(['closed', 'suspended']);
    expect(workers.map((worker) => worker.terminated)).toEqual([true, false]);

    await recordAndHear('Let me explain.');
    expect(state.outcome).toMatchObject({ kind: 'heard', text: 'Let me explain.' });
  });

  it('F2: Cancel while the model loads starts no recorder preparation at all', async () => {
    await session.init();
    const preparing = session.prepare();
    for (let waited = 0; waited < 50 && workers.length < 1; waited += 1) await turn();
    workers[0].emit({ type: 'ready' });
    session.cancelPrepare();
    await preparing;
    expect(state).toMatchObject({ phase: 'no-model', installed: true, notice: null });
    expect(workers[0].terminated).toBe(true);
    expect(audio.contexts).toHaveLength(0);
  });

  it('F2: a recorder that finishes although it was cancelled still does not make the screen ready', async () => {
    // A recorder that ignores the signal and answers late, to test the session's own check.
    let finish: () => void = () => undefined;
    const closed: string[] = [];
    const stubborn: Recorder = {
      prepare: () => new Promise<void>((resolve) => { finish = resolve; }),
      start: () => Promise.reject(new CaptureCancelled()),
      close: () => void closed.push('close')
    };
    const recognizer = createLocalMlRecognizer({
      store: { isInstalled: async () => true, remove: async () => undefined } as unknown as ModelStore,
      sourceUrl: () => '',
      keyBase: 'http://localhost:3000/eng-trainer/model-cache/',
      startWorker: () => {
        const worker = new FakeRecognizerWorker();
        workers.push(worker);
        return worker;
      },
      mayDownload: () => false,
      readEstimate: roomy,
      locks: fakeLocks(),
      unsupported: () => null
    });
    session = createPracticeSession({ recognizer, modelStorage: fakeModelStorage({ installation: INSTALLED }).like, recorder: stubborn, downloadOffered: false });
    session.subscribe((next) => {
      state = next;
    });
    await session.init();
    const preparing = session.prepare();
    await workerLoads(1);
    await turn();
    session.cancelPrepare();
    finish();
    await preparing;
    expect(state).toMatchObject({ phase: 'no-model', installed: true, notice: null });
    expect(closed).toEqual(['close']);
    expect(workers[0].terminated).toBe(true);
  });

  // ---- F3 ------------------------------------------------------------------------------

  it('F3: a Worker error during recognition ends the attempt, says why, and offers to load the model again', async () => {
    await ready();
    await session.record();
    audio.hear(speech(2));
    const stopping = session.stop();
    await turn();
    expect(state.phase).toBe('recognizing');
    expect(workers[0].requests()).toEqual([1]);

    workers[0].fail('error');
    await stopping;
    expect(workers[0].terminated).toBe(true);
    expect(state).toMatchObject({
      phase: 'no-model',
      installed: true,
      outcome: { kind: 'unable', message: 'The recognizer failed: The recognizer stopped working.' },
      notice: 'The recognizer stopped, so the speech model has to be loaded again. (The recognizer stopped working.)'
    });
    expect(audio.tracks[0].readyState).toBe('ended');
  });

  it('F3: recovery: loading again starts a new Worker, and the next recording gives a result', async () => {
    await ready();
    await session.record();
    audio.hear(speech(2));
    const stopping = session.stop();
    await turn();
    workers[0].fail('error');
    await stopping;

    const preparing = session.prepare();
    await workerLoads(2);
    await preparing;
    expect(state).toMatchObject({ phase: 'ready', notice: null });
    expect(workers.map((worker) => worker.terminated)).toEqual([true, false]);

    await recordAndHear('I would like to clarify the requirements.');
    expect(state).toMatchObject({ phase: 'ready', outcome: { kind: 'heard', text: 'I would like to clarify the requirements.' } });
  });

  it('F3: a Worker that fails while the screen is idle: the screen says so at once and offers loading, and no microphone is asked for', async () => {
    await ready();
    workers[0].fail('error');
    await turn();
    expect(workers[0].terminated).toBe(true);
    expect(state).toMatchObject({
      phase: 'no-model',
      installed: true,
      notice: 'The recognizer stopped, so the speech model has to be loaded again. (The recognizer stopped working.)'
    });
    // A recording cannot start in this state: nothing asks for the microphone.
    await session.record();
    expect(audio.tracks).toHaveLength(0);

    const preparing = session.prepare();
    await workerLoads(2);
    await preparing;
    await recordAndHear('Let me explain.');
    expect(state).toMatchObject({ phase: 'ready', notice: null, outcome: { kind: 'heard', text: 'Let me explain.' } });
  });

  it('F3: a Worker that fails during the recording: the microphone is released at once, and the screen says why and offers loading', async () => {
    await ready();
    await session.record();
    audio.hear(speech(2));
    expect(audio.tracks[0].readyState).toBe('live');

    workers[0].fail('error');
    // Nothing could recognize this recording any more.
    expect(audio.tracks[0].readyState).toBe('ended');
    await turn();
    expect(state).toMatchObject({
      phase: 'no-model',
      installed: true,
      outcome: { kind: 'unable', message: 'The recognizer failed: The recognizer stopped working.' },
      notice: 'The recognizer stopped, so the speech model has to be loaded again. (The recognizer stopped working.)'
    });
    // Stop, which the learner may still choose, changes nothing more.
    await session.stop();
    expect(state.phase).toBe('no-model');
  });

  it('F3: a Worker that fails while the microphone is still starting releases it as well', async () => {
    await ready();
    audio.waits.resume = gate();
    const recording = session.record();
    await turn();
    expect(audio.tracks[0].readyState).toBe('live');

    workers[0].fail('error');
    expect(audio.tracks[0].readyState).toBe('ended');
    await recording;
    await turn();
    expect(state).toMatchObject({ phase: 'no-model', installed: true });
    audio.waits.resume.open();
    await turn();
    expect(audio.collectors).toHaveLength(0);
  });

  it('F3: Cancel during a recognition that then fails leaves no result, and the screen still offers loading', async () => {
    await ready();
    await session.record();
    audio.hear(speech(2));
    const stopping = session.stop();
    await turn();
    session.cancel();
    expect(state).toMatchObject({ phase: 'ready', outcome: null });

    workers[0].fail('error');
    await stopping;
    await turn();
    expect(state).toMatchObject({ phase: 'no-model', installed: true, outcome: null });
    expect(state.notice).toContain('the speech model has to be loaded again');

    const preparing = session.prepare();
    await workerLoads(2);
    await preparing;
    await recordAndHear('Let me explain.');
    expect(state.outcome).toMatchObject({ kind: 'heard', text: 'Let me explain.' });
  });

  it('F3: a Worker that fails while the recorder is still being prepared ends the preparation with the reason', async () => {
    await session.init();
    audio.waits.module = gate();
    const preparing = session.prepare();
    await workerLoads(1);
    await turn();
    expect(state.phase).toBe('loading');

    workers[0].fail('error');
    await preparing;
    expect(state).toMatchObject({
      phase: 'no-model',
      installed: true,
      notice: 'The recognizer stopped, so the speech model has to be loaded again. (The recognizer stopped working.)'
    });
    expect(audio.contexts[0].state).toBe('closed');
    audio.waits.module.open();
    await turn();
    expect(state.phase).toBe('no-model');
  });

  it('F3: after leaving the screen, a failing Worker reaches no one', async () => {
    await ready();
    const before = state;
    session.dispose();
    workers[0].fail('error');
    await turn();
    expect(state).toBe(before);
  });
});
