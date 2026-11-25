import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { describeExperimental } from '../../../test/product';
import type { ModelStore } from '../models/store';
import { FakeRecognizerWorker, last } from '../testing';
import { RECOGNITION_TIMEOUT_MS, createLocalMlRecognizer, type LocalMlDependencies } from './localMl';
import { RecognitionCancelled, type LiveCapture, type SpeechRecognizer } from './types';

/**
 * The recognizer when its Worker fails after the model was loaded (ENG-V3-02A-RC1,
 * finding F3 of the review): an uncaught error, a message that cannot be read or sent,
 * or a Worker that stops answering. Each one refuses what waits, ends the Worker and
 * leaves a state from which preparing again works.
 */
describeExperimental('local-ml recognizer: a Worker that fails after loading (F3)', () => {
  let workers: FakeRecognizerWorker[];
  let deps: LocalMlDependencies;

  const signal = (): AbortSignal => new AbortController().signal;
  const capture = (): LiveCapture => ({ track: {} as MediaStreamTrack, pcm: async () => new Float32Array(16000) });
  const flush = async (): Promise<void> => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
  };

  /** A recognizer whose model is loaded. */
  async function loaded(recognizer: SpeechRecognizer = createLocalMlRecognizer(deps)): Promise<SpeechRecognizer> {
    const preparing = recognizer.prepare({ signal: signal(), onProgress: () => undefined });
    await flush();
    last(workers).load();
    await preparing;
    return recognizer;
  }

  /** Starts a recognition and waits until the Worker was asked. */
  async function pending(recognizer: SpeechRecognizer) {
    const run = recognizer.begin(capture(), { signal: signal() });
    const outcome: { state: 'pending' | 'resolved' | 'rejected'; error: Error | null; text: string | null } = { state: 'pending', error: null, text: null };
    run.finish().then((heard) => { outcome.state = 'resolved'; outcome.text = heard.text; }, (error: Error) => { outcome.state = 'rejected'; outcome.error = error; });
    await flush();
    return { run, outcome };
  }

  beforeEach(() => {
    workers = [];
    deps = {
      store: { isInstalled: async () => true, remove: async () => undefined } as unknown as ModelStore,
      sourceUrl: (file) => `http://localhost:3000/eng-trainer/v3/models/${file.id}`,
      keyBase: 'http://localhost:3000/eng-trainer/model-cache/',
      startWorker: () => {
        const worker = new FakeRecognizerWorker();
        workers.push(worker);
        return worker;
      },
      mayDownload: () => false,
      unsupported: () => null
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('an error in the Worker refuses the recognition that waits, ends the Worker and clears readiness', async () => {
    const recognizer = await loaded();
    const { outcome } = await pending(recognizer);
    expect(workers[0].requests()).toEqual([1]);
    expect(outcome.state).toBe('pending');

    workers[0].fail('error');
    await flush();
    expect(outcome.state).toBe('rejected');
    expect(outcome.error!.message).toBe('The recognizer stopped working.');
    expect(workers[0].terminated).toBe(true);
    expect(await recognizer.state()).toEqual({ status: 'installed' });
  });

  it('recovery: preparing again starts a new Worker, and a recognition works', async () => {
    const recognizer = await loaded();
    await pending(recognizer);
    workers[0].fail('error');
    await flush();
    // A recording is refused until the model is loaded again, with the reason.
    expect(() => recognizer.begin(capture(), { signal: signal() })).toThrow('The recognizer is not ready. The recognizer stopped working.');

    await loaded(recognizer);
    expect(workers).toHaveLength(2);
    expect(workers[1].terminated).toBe(false);
    expect(await recognizer.state()).toEqual({ status: 'ready' });

    const { outcome } = await pending(recognizer);
    const id = last(workers[1].requests());
    workers[1].emit({ type: 'transcribed', id, text: 'Let me explain.', audioSeconds: 1, elapsedMs: 80 });
    await flush();
    expect(outcome).toMatchObject({ state: 'resolved', text: 'Let me explain.' });
  });

  it('every recognition that waits is refused, not only the newest', async () => {
    const recognizer = await loaded();
    const first = await pending(recognizer);
    const second = await pending(recognizer);
    workers[0].fail('error');
    await flush();
    expect([first.outcome.state, second.outcome.state]).toEqual(['rejected', 'rejected']);
  });

  it('a message of the Worker that cannot be read is handled the same way', async () => {
    const recognizer = await loaded();
    const { outcome } = await pending(recognizer);
    workers[0].fail('messageerror');
    await flush();
    expect(outcome.error!.message).toBe('A message of the recognizer could not be read.');
    expect(workers[0].terminated).toBe(true);
    expect(await recognizer.state()).toEqual({ status: 'installed' });
  });

  it('a recording that cannot be given to the Worker refuses that recognition and ends the Worker', async () => {
    const recognizer = await loaded();
    workers[0].refusePost = new DOMException('The object could not be cloned.', 'DataCloneError');
    const { outcome } = await pending(recognizer);
    expect(outcome.state).toBe('rejected');
    expect(outcome.error!.message).toBe('The recording could not be given to the recognizer: The object could not be cloned.');
    expect(workers[0].terminated).toBe(true);
    expect(await recognizer.state()).toEqual({ status: 'installed' });
  });

  it('a Worker that does not answer in time is taken for failed', async () => {
    vi.useFakeTimers();
    const recognizer = await loaded();
    const { outcome } = await pending(recognizer);

    await vi.advanceTimersByTimeAsync(RECOGNITION_TIMEOUT_MS - 1);
    expect(outcome.state).toBe('pending');
    expect(workers[0].terminated).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(outcome.state).toBe('rejected');
    expect(outcome.error!.message).toBe('The recognizer did not answer in time.');
    expect(workers[0].terminated).toBe(true);
    expect(await recognizer.state()).toEqual({ status: 'installed' });
  });

  it('an answer in time stops the clock: a later recognition is not cut short by an earlier one', async () => {
    vi.useFakeTimers();
    const recognizer = await loaded();
    const first = await pending(recognizer);
    await vi.advanceTimersByTimeAsync(RECOGNITION_TIMEOUT_MS - 1000);
    workers[0].emit({ type: 'transcribed', id: 1, text: 'first', audioSeconds: 1, elapsedMs: 1 });
    await flush();
    expect(first.outcome.text).toBe('first');

    const second = await pending(recognizer);
    await vi.advanceTimersByTimeAsync(2000);
    expect(second.outcome.state).toBe('pending');
    expect(workers[0].terminated).toBe(false);
    expect(await recognizer.state()).toEqual({ status: 'ready' });
  });

  it('cancelling a result does not hide a Worker that hangs: the next attempt is not left waiting for ever', async () => {
    vi.useFakeTimers();
    const recognizer = await loaded();
    const first = await pending(recognizer);
    first.run.cancel();
    await flush();
    expect(first.outcome.error).toBeInstanceOf(RecognitionCancelled);
    // Cancel alone repairs nothing: the Worker still has the first recording and has not answered.
    expect(await recognizer.state()).toEqual({ status: 'ready' });

    const retry = await pending(recognizer);
    await vi.advanceTimersByTimeAsync(RECOGNITION_TIMEOUT_MS);
    // The first request ran out of time, although nobody waited for its result any more.
    expect(retry.outcome.state).toBe('rejected');
    expect(retry.outcome.error!.message).toBe('The recognizer did not answer in time.');
    expect(workers[0].terminated).toBe(true);

    await loaded(recognizer);
    expect(await recognizer.state()).toEqual({ status: 'ready' });
  });

  it('a cancelled result that does arrive in time leaves the Worker in use', async () => {
    vi.useFakeTimers();
    const recognizer = await loaded();
    const first = await pending(recognizer);
    first.run.cancel();
    workers[0].emit({ type: 'transcribed', id: 1, text: 'late', audioSeconds: 1, elapsedMs: 1 });
    await vi.advanceTimersByTimeAsync(RECOGNITION_TIMEOUT_MS * 2);
    expect(workers[0].terminated).toBe(false);
    expect(await recognizer.state()).toEqual({ status: 'ready' });
  });

  it('an error while nothing waits also ends the Worker, and the next recording says why it is refused', async () => {
    const recognizer = await loaded();
    workers[0].fail('error');
    expect(workers[0].terminated).toBe(true);
    expect(await recognizer.state()).toEqual({ status: 'installed' });
    expect(() => recognizer.begin(capture(), { signal: signal() })).toThrow('The recognizer is not ready. The recognizer stopped working.');
  });

  it('a recording that was started before the Worker failed is refused when it ends', async () => {
    const recognizer = await loaded();
    // The run begins when the recording starts, as the screen does it.
    let deliver: (samples: Float32Array) => void = () => undefined;
    const samples = new Promise<Float32Array>((resolve) => { deliver = resolve; });
    const run = recognizer.begin({ track: {} as MediaStreamTrack, pcm: () => samples }, { signal: signal() });
    const finishing = run.finish();
    workers[0].fail('error');
    deliver(new Float32Array(16000));
    await expect(finishing).rejects.toThrow('The recognizer stopped working.');
    expect(workers[0].requests()).toEqual([]);
  });

  it('a Worker that was released or replaced can fail without touching its successor', async () => {
    const recognizer = await loaded();
    await recognizer.release();
    await loaded(recognizer);
    const { outcome } = await pending(recognizer);

    workers[0].fail('error');
    workers[0].fail('messageerror');
    await flush();
    expect(outcome.state).toBe('pending');
    expect(workers[1].terminated).toBe(false);
    expect(await recognizer.state()).toEqual({ status: 'ready' });
  });

  it('tells its listeners at once when a Worker failed by itself, and not when it was released, removed or never loaded', async () => {
    const recognizer = createLocalMlRecognizer(deps);
    const told: string[] = [];
    const forget = recognizer.onFailure!((reason) => told.push(reason));

    // A loading that fails is reported by `prepare`, not here.
    const failing = recognizer.prepare({ signal: signal(), onProgress: () => undefined });
    await flush();
    workers[0].fail('error');
    await expect(failing).rejects.toThrow('The recognizer could not be started.');
    expect(told).toEqual([]);

    await loaded(recognizer);
    await recognizer.release();
    await loaded(recognizer);
    await recognizer.remove();
    expect(told).toEqual([]);

    await loaded(recognizer);
    last(workers).fail('error');
    expect(told).toEqual(['The recognizer stopped working.']);
    // The same Worker failing again, and a listener that stopped listening, add nothing.
    last(workers).fail('messageerror');
    forget();
    await loaded(recognizer);
    last(workers).fail('error');
    expect(told).toEqual(['The recognizer stopped working.']);
  });

  it('a message that cannot be read while the model loads fails the loading', async () => {
    const recognizer = createLocalMlRecognizer(deps);
    const preparing = recognizer.prepare({ signal: signal(), onProgress: () => undefined });
    await flush();
    workers[0].emit({ type: 'ready' });
    workers[0].fail('messageerror');
    await expect(preparing).rejects.toThrow('The recognizer could not be started.');
    expect(workers[0].terminated).toBe(true);
    expect(await recognizer.state()).toEqual({ status: 'installed' });
  });
});
