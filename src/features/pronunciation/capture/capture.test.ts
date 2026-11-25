import { beforeEach, expect, it } from 'vitest';
import { describeExperimental } from '../../../test/product';
import { fakeAudio } from '../testing';
import { CaptureError, createRecorder, type CaptureOptions } from './capture';
import { LEVEL_MESSAGES, MAX_SECONDS, MIN_SECONDS, SAMPLE_RATE, checkLevels } from './levels';

/**
 * Microphone recording with a fake microphone and a fake audio context (ENG-V3-02,
 * stage A): when the microphone is asked for, and that it is always released.
 */
const tone = (length: number, level = 0.2): Float32Array => Float32Array.from({ length }, (_, index) => Math.sin(index / 5) * level);

describeExperimental('recording levels', () => {
  it('accepts ordinary speech levels', () => {
    const report = checkLevels(tone(2 * SAMPLE_RATE));
    expect(report.problem).toBeNull();
    expect(report.seconds).toBe(2);
    expect(report.peak).toBeGreaterThan(0.19);
  });

  it('names the problem: too short, silence, clipped, too long', () => {
    expect(checkLevels(tone(SAMPLE_RATE * MIN_SECONDS - 1)).problem).toBe('too-short');
    expect(checkLevels(tone(SAMPLE_RATE * MIN_SECONDS)).problem).toBeNull();
    expect(checkLevels(new Float32Array(2 * SAMPLE_RATE)).problem).toBe('silence');
    expect(checkLevels(tone(2 * SAMPLE_RATE, 0.019)).problem).toBe('silence');
    expect(checkLevels(tone(2 * SAMPLE_RATE, 1.5).map((value) => Math.max(-1, Math.min(1, value)))).problem).toBe('clipped');
    // A recording that was stopped by the time limit is not recognized, whatever it holds.
    expect(checkLevels(tone(MAX_SECONDS * SAMPLE_RATE), true).problem).toBe('too-long');
  });

  it('allows a few loud samples: a single peak is not distortion', () => {
    const samples = tone(2 * SAMPLE_RATE);
    for (let index = 0; index < 100; index += 1) samples[index * 7] = 1;
    expect(checkLevels(samples).problem).toBeNull();
    expect(checkLevels(new Float32Array(0)).problem).toBe('too-short');
  });

  it('has a message for the learner for every problem, without a judgement of the speaker', () => {
    expect(Object.keys(LEVEL_MESSAGES).sort()).toEqual(['clipped', 'silence', 'too-long', 'too-short']);
    for (const message of Object.values(LEVEL_MESSAGES)) expect(message).not.toMatch(/wrong|incorrect|mistake|score|pronunciation/i);
  });
});

describeExperimental('recorder', () => {
  let audio: ReturnType<typeof fakeAudio>;
  let limits: number;
  let lost: number;
  const options = (): CaptureOptions => ({ maxSeconds: 2, onLimit: () => { limits += 1; }, onLost: () => { lost += 1; } });

  beforeEach(() => {
    audio = fakeAudio();
    limits = 0;
    lost = 0;
  });

  it('prepare loads the recorder\'s script into a paused 16 kHz context, once, without touching the microphone', async () => {
    const recorder = createRecorder(audio.environment);
    await recorder.prepare();
    await recorder.prepare();
    expect(audio.log).toEqual(['createContext 16000', 'addModule /eng-trainer/v3/assets/pcm-collector.worklet-abc.js', 'context.suspend']);
    expect(audio.contexts[0].state).toBe('suspended');
  });

  it('refuses to record before it is prepared, and does not ask for the microphone', async () => {
    const recorder = createRecorder(audio.environment);
    await expect(recorder.start(options())).rejects.toThrow('The recorder is not prepared.');
    expect(audio.log).toEqual([]);
  });

  it('asks for the microphone only on start, for audio only, and loads nothing then', async () => {
    const recorder = createRecorder(audio.environment);
    await recorder.prepare();
    audio.log.length = 0;
    const capture = await recorder.start(options());
    expect(audio.log).toEqual(['getUserMedia {"audio":{"channelCount":1},"video":false}', 'context.resume', 'source.connect']);
    expect(audio.log.some((line) => line.startsWith('addModule'))).toBe(false);
    expect(capture.track).toBe(audio.tracks[0]);
    expect(audio.collectors[0].connected).toBe(true);
  });

  it('stop returns the samples in order and releases everything', async () => {
    const recorder = createRecorder(audio.environment);
    await recorder.prepare();
    const capture = await recorder.start(options());
    audio.hear(Float32Array.from([0.1, 0.2]));
    audio.hear(Float32Array.from([0.3]));
    expect(capture.seconds()).toBeCloseTo(3 / SAMPLE_RATE);

    const samples = await capture.stop();
    expect([...samples].map((value) => Math.round(value * 10))).toEqual([1, 2, 3]);
    expect(audio.tracks[0].stopped).toBe(true);
    expect(audio.collectors[0].connected).toBe(false);
    expect(audio.collectors[0].port.onmessage).toBeNull();
    expect(audio.contexts[0].state).toBe('suspended');
    // Late blocks are ignored, and a second stop or cancel does nothing more.
    audio.hear(Float32Array.from([0.9]));
    expect(capture.seconds()).toBe(0);
    capture.cancel();
    expect(audio.log.filter((line) => line === 'track.stop')).toHaveLength(1);
  });

  it('cancel releases the microphone and drops the samples', async () => {
    const recorder = createRecorder(audio.environment);
    await recorder.prepare();
    const capture = await recorder.start(options());
    audio.hear(tone(100));
    capture.cancel();
    expect(audio.tracks[0].stopped).toBe(true);
    expect(audio.contexts[0].state).toBe('suspended');
    expect(await capture.stop()).toHaveLength(0);
  });

  it('reports the time limit once and never returns more than the limit', async () => {
    const recorder = createRecorder(audio.environment);
    await recorder.prepare();
    const capture = await recorder.start(options());
    audio.hear(tone(SAMPLE_RATE));
    expect(limits).toBe(0);
    audio.hear(tone(SAMPLE_RATE + 500));
    audio.hear(tone(500));
    expect(limits).toBe(1);
    expect(capture.seconds()).toBe(2);
    expect(await capture.stop()).toHaveLength(2 * SAMPLE_RATE);
  });

  it('reports a microphone that ends by itself, but not one that the recorder stopped', async () => {
    const recorder = createRecorder(audio.environment);
    await recorder.prepare();
    const capture = await recorder.start(options());
    audio.tracks[0].onended?.();
    expect(lost).toBe(1);
    capture.cancel();
    expect(audio.tracks[0].onended).toBeNull();
  });

  it('a refused or missing microphone is explained, and nothing is left running', async () => {
    const recorder = createRecorder(audio.environment);
    await recorder.prepare();
    for (const [name, message] of [
      ['NotAllowedError', 'The microphone was not allowed. Allow it for this page in the browser, then record again.'],
      ['NotFoundError', 'No microphone was found.'],
      ['NotReadableError', 'The microphone could not be started. Another program may be using it.']
    ]) {
      audio.setMicrophone(async () => { throw new DOMException('refused', name); });
      const failure = await recorder.start(options()).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(CaptureError);
      expect((failure as CaptureError).message).toBe(message);
    }
    expect(audio.tracks).toHaveLength(0);
    expect(audio.contexts[0].state).toBe('suspended');
    expect(audio.collectors).toHaveLength(0);
  });

  it('a microphone that is granted after the recording was cancelled is stopped at once', async () => {
    const recorder = createRecorder(audio.environment);
    await recorder.prepare();
    let grant: (stream: MediaStream) => void = () => undefined;
    audio.setMicrophone(() => new Promise<MediaStream>((resolve) => { grant = resolve; }));
    const starting = recorder.start(options());
    // The screen is left while the browser still asks for permission.
    recorder.close();
    grant(audio.stream());
    await expect(starting).rejects.toThrow('The recording was cancelled.');
    expect(audio.tracks[0].stopped).toBe(true);
    expect(audio.collectors).toHaveLength(0);
  });

  it('a new recording releases one that is still running', async () => {
    const recorder = createRecorder(audio.environment);
    await recorder.prepare();
    await recorder.start(options());
    await recorder.start(options());
    expect(audio.tracks.map((track) => track.stopped)).toEqual([true, false]);
  });

  it('close releases the microphone and ends the audio context; a later prepare makes a new one', async () => {
    const recorder = createRecorder(audio.environment);
    await recorder.prepare();
    await recorder.start(options());
    recorder.close();
    expect(audio.tracks[0].stopped).toBe(true);
    expect(audio.contexts[0].state).toBe('closed');
    await expect(recorder.start(options())).rejects.toThrow('The recorder is not prepared.');

    await recorder.prepare();
    expect(audio.contexts).toHaveLength(2);
    expect(audio.contexts[1].state).toBe('suspended');
  });

  it('a recorder script that cannot be loaded, or a browser without 16 kHz, fails the preparation and closes the context', async () => {
    audio.failModule();
    const recorder = createRecorder(audio.environment);
    await expect(recorder.prepare()).rejects.toThrow('The recorder could not be prepared: the script could not be loaded');
    expect(audio.contexts[0].state).toBe('closed');

    const other = fakeAudio();
    other.setSampleRate(48000);
    await expect(createRecorder(other.environment).prepare()).rejects.toThrow('This browser cannot record at 16000 Hz.');
    expect(other.contexts[0].state).toBe('closed');
    expect(other.log.some((line) => line.startsWith('getUserMedia'))).toBe(false);
  });
});
