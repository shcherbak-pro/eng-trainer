import { beforeEach, expect, it } from 'vitest';
import { describeExperimental } from '../../../test/product';
import { fakeAudio, gate } from '../testing';
import { CaptureCancelled, createRecorder, type CaptureOptions, type Recorder } from './capture';

/**
 * The recorder while the browser has not answered yet (ENG-V3-02A-RC1, findings F1 and
 * F2 of the review): the permission, the audio device and the recorder's script can each
 * stay pending. Ending such a wait releases at once what was acquired, and whatever the
 * browser delivers afterwards is released as it arrives.
 */
const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describeExperimental('recorder: a start that is ended while it waits (F1)', () => {
  let audio: ReturnType<typeof fakeAudio>;
  let recorder: Recorder;
  const options = (signal?: AbortSignal): CaptureOptions => ({ maxSeconds: 2, onLimit: () => undefined, onLost: () => undefined, signal });

  /** The outcome of a promise that is not awaited yet. */
  function watch(promise: Promise<unknown>): { state: 'pending' | 'resolved' | 'rejected'; error: unknown } {
    const seen: { state: 'pending' | 'resolved' | 'rejected'; error: unknown } = { state: 'pending', error: null };
    promise.then(() => { seen.state = 'resolved'; }, (error: unknown) => { seen.state = 'rejected'; seen.error = error; });
    return seen;
  }

  beforeEach(async () => {
    audio = fakeAudio();
    recorder = createRecorder(audio.environment);
    await recorder.prepare();
    audio.log.length = 0;
  });

  it('ended while the audio device is starting: the microphone it holds is stopped at once', async () => {
    audio.waits.resume = gate();
    const control = new AbortController();
    const starting = watch(recorder.start(options(control.signal)));
    await turn();
    // The browser has handed the microphone over, and the audio device has not started yet.
    expect(audio.tracks[0].readyState).toBe('live');
    expect(starting.state).toBe('pending');

    control.abort();
    // At once: not when the audio device answers, which it may never do.
    expect(audio.tracks[0].readyState).toBe('ended');
    await turn();
    expect(starting.state).toBe('rejected');
    expect(starting.error).toBeInstanceOf(CaptureCancelled);
    expect(audio.collectors).toHaveLength(0);
  });

  it('the audio device that starts afterwards is paused again, and nothing records', async () => {
    audio.waits.resume = gate();
    const control = new AbortController();
    const starting = watch(recorder.start(options(control.signal)));
    await turn();
    control.abort();

    audio.waits.resume.open();
    await turn();
    expect(audio.contexts[0].state).toBe('suspended');
    expect(audio.collectors).toHaveLength(0);
    expect(audio.log.filter((line) => line === 'source.connect')).toEqual([]);
    expect(audio.tracks.map((track) => track.readyState)).toEqual(['ended']);
    expect(starting.state).toBe('rejected');
  });

  it('ended while the browser asks for the permission: the start ends at once, and a microphone that arrives later is stopped as it arrives', async () => {
    audio.waits.permission = gate();
    const control = new AbortController();
    const starting = watch(recorder.start(options(control.signal)));
    await turn();
    expect(audio.tracks).toHaveLength(0);

    control.abort();
    await turn();
    expect(starting.state).toBe('rejected');
    expect(starting.error).toBeInstanceOf(CaptureCancelled);

    // The learner answers the permission question after all.
    audio.waits.permission.open();
    await turn();
    expect(audio.tracks.map((track) => track.readyState)).toEqual(['ended']);
    expect(audio.log.some((line) => line === 'context.resume')).toBe(false);
    expect(audio.collectors).toHaveLength(0);
  });

  it('retry: a new recording is not disturbed when the ended one finishes late', async () => {
    const first = gate();
    audio.waits.resume = first;
    const control = new AbortController();
    const ended = watch(recorder.start(options(control.signal)));
    await turn();
    control.abort();
    await turn();
    expect(ended.state).toBe('rejected');

    // Record again. This time the audio device answers.
    audio.waits.resume = null;
    const capture = await recorder.start(options(new AbortController().signal));
    expect(audio.contexts[0].state).toBe('running');
    audio.hear(Float32Array.from([0.1, 0.2]));

    // Now the first start's audio device answers. The running recording must stay as it is.
    first.open();
    await turn();
    expect(audio.contexts[0].state).toBe('running');
    expect(audio.tracks.map((track) => track.readyState)).toEqual(['ended', 'live']);
    expect(audio.collectors).toHaveLength(1);
    expect(audio.collectors[0].connected).toBe(true);
    audio.hear(Float32Array.from([0.3]));
    expect(await capture.stop()).toHaveLength(3);
    expect(audio.tracks[1].readyState).toBe('ended');
    expect(audio.contexts[0].state).toBe('suspended');
  });

  it('closing the recorder ends a waiting start in the same way', async () => {
    audio.waits.resume = gate();
    const starting = watch(recorder.start(options()));
    await turn();
    recorder.close();
    expect(audio.tracks[0].readyState).toBe('ended');
    expect(audio.contexts[0].state).toBe('closed');
    await turn();
    expect(starting.error).toBeInstanceOf(CaptureCancelled);

    audio.waits.resume.open();
    await turn();
    expect(audio.contexts[0].state).toBe('closed');
    expect(audio.collectors).toHaveLength(0);
  });

  it('a signal that is aborted already asks for no microphone', async () => {
    const control = new AbortController();
    control.abort();
    await expect(recorder.start(options(control.signal))).rejects.toBeInstanceOf(CaptureCancelled);
    expect(audio.log).toEqual([]);
  });

  it('aborting a running recording releases it, like cancel', async () => {
    const control = new AbortController();
    const capture = await recorder.start(options(control.signal));
    audio.hear(Float32Array.from([0.1]));
    control.abort();
    expect(audio.tracks[0].readyState).toBe('ended');
    expect(audio.collectors[0].connected).toBe(false);
    expect(audio.contexts[0].state).toBe('suspended');
    // The samples of a released recording are still returned to a caller that asks.
    expect(await capture.stop()).toHaveLength(1);
  });

  it('a microphone that is refused after the start was ended changes nothing more', async () => {
    audio.waits.permission = gate();
    audio.setMicrophone(async () => { throw new DOMException('refused', 'NotAllowedError'); });
    const control = new AbortController();
    const starting = watch(recorder.start(options(control.signal)));
    await turn();
    control.abort();
    audio.waits.permission.open();
    await turn();
    expect(starting.error).toBeInstanceOf(CaptureCancelled);
    expect(audio.tracks).toHaveLength(0);
  });
});

describeExperimental('recorder: a preparation that is ended while it waits (F2)', () => {
  let audio: ReturnType<typeof fakeAudio>;
  let recorder: Recorder;
  const options: CaptureOptions = { maxSeconds: 2, onLimit: () => undefined, onLost: () => undefined };

  beforeEach(() => {
    audio = fakeAudio();
    recorder = createRecorder(audio.environment);
  });

  it('closing while the recorder\'s script loads closes that audio context at once', async () => {
    audio.waits.module = gate();
    const preparing = recorder.prepare();
    const outcome = preparing.catch((error: unknown) => error);
    await turn();
    expect(audio.contexts).toHaveLength(1);
    expect(audio.contexts[0].state).toBe('running');

    recorder.close();
    expect(audio.contexts[0].state).toBe('closed');
    expect(audio.contexts[0].closes).toBe(1);
    const error = await outcome;
    expect(error).toBeInstanceOf(CaptureCancelled);
    expect((error as Error).message).toBe('The preparation was cancelled.');
  });

  it('the script that loads afterwards cannot bring the closed context back', async () => {
    audio.waits.module = gate();
    const preparing = recorder.prepare().catch(() => undefined);
    await turn();
    recorder.close();

    audio.waits.module.open();
    await preparing;
    await turn();
    expect(audio.contexts[0].state).toBe('closed');
    expect(audio.contexts[0].closes).toBe(1);
    // It was not paused, and it is not the recorder's context: recording is refused.
    expect(audio.log.filter((line) => line === 'context.suspend')).toEqual([]);
    await expect(recorder.start(options)).rejects.toThrow('The recorder is not prepared.');
    expect(audio.log.some((line) => line.startsWith('getUserMedia'))).toBe(false);
  });

  it('an aborted signal ends the preparation at once, while the script loads and while the context is being paused', async () => {
    for (const step of ['module', 'suspend'] as const) {
      audio = fakeAudio();
      recorder = createRecorder(audio.environment);
      audio.waits[step] = gate();
      const control = new AbortController();
      const outcome = recorder.prepare(control.signal).catch((error: unknown) => error);
      await turn();

      control.abort();
      expect(audio.contexts[0].state).toBe('closed');
      expect(await outcome).toBeInstanceOf(CaptureCancelled);

      audio.waits[step]!.open();
      await turn();
      expect(audio.contexts[0].state).toBe('closed');
      await expect(recorder.start(options)).rejects.toThrow('The recorder is not prepared.');
    }
  });

  it('after an ended preparation, preparing again makes a new context and recording works', async () => {
    audio.waits.module = gate();
    const control = new AbortController();
    const ended = recorder.prepare(control.signal).catch(() => undefined);
    await turn();
    control.abort();
    await ended;

    audio.waits.module = null;
    await recorder.prepare();
    expect(audio.contexts.map((context) => context.state)).toEqual(['closed', 'suspended']);
    const capture = await recorder.start(options);
    expect(audio.contexts[1].state).toBe('running');
    capture.cancel();
    expect(audio.tracks[0].readyState).toBe('ended');
  });

  it('a signal that is aborted already creates no audio context', async () => {
    const control = new AbortController();
    control.abort();
    await expect(recorder.prepare(control.signal)).rejects.toBeInstanceOf(CaptureCancelled);
    expect(audio.contexts).toHaveLength(0);
    expect(audio.log).toEqual([]);
  });

  it('a second preparation ends one that has not finished: only one context is ever kept', async () => {
    audio.waits.module = gate();
    const first = recorder.prepare().catch((error: unknown) => error);
    await turn();
    const held = audio.waits.module;
    audio.waits.module = null;
    await recorder.prepare();
    expect(await first).toBeInstanceOf(CaptureCancelled);
    held.open();
    await turn();
    expect(audio.contexts.map((context) => context.state)).toEqual(['closed', 'suspended']);
  });

  it('a signal that is aborted after the preparation finished does not close the prepared context', async () => {
    const control = new AbortController();
    await recorder.prepare(control.signal);
    control.abort();
    expect(audio.contexts[0].state).toBe('suspended');
    const capture = await recorder.start(options);
    capture.cancel();
  });
});
