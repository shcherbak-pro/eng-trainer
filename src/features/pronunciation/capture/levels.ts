import { SAMPLE_RATE } from '../audio';

/**
 * Checks on a finished recording, before it is given to the recognizer (ENG-V3-02, stage A).
 *
 * A recording that fails one of them is not recognized, and the screen says why. The
 * limits are first values for the prototype: they are to be set on real devices.
 */
export { SAMPLE_RATE };
/** The model may repeat itself on clips shorter than about one second. */
export const MIN_SECONDS = 1;
/** The longest built-in phrase takes about ten seconds to say. Recording stops by itself here. */
export const MAX_SECONDS = 20;
/** Below this peak the recording counts as silence. Full scale is 1. */
const SILENCE_PEAK = 0.02;
/** A sample at or above this level counts as clipped. */
const CLIP_LEVEL = 0.99;
/** More than this share of clipped samples makes the recording distorted. */
const CLIP_SHARE = 0.005;

export type LevelProblem = 'silence' | 'too-short' | 'too-long' | 'clipped';

export type LevelReport = { problem: LevelProblem | null; seconds: number; peak: number; clippedShare: number };

export const LEVEL_MESSAGES: Record<LevelProblem, string> = {
  silence: 'Nothing was heard. Check that the microphone is on and not muted, then record again.',
  'too-short': 'The recording is shorter than one second. Record the whole phrase.',
  'too-long': `The recording reached the limit of ${MAX_SECONDS} seconds and was stopped. Record one phrase at a time.`,
  clipped: 'The recording is distorted because it is too loud. Move back from the microphone, then record again.'
};

/** `reachedLimit` is true when the recording was stopped by the time limit, not by the learner. */
export function checkLevels(samples: Float32Array, reachedLimit = false): LevelReport {
  let peak = 0;
  let clipped = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const level = Math.abs(samples[index]);
    if (level > peak) peak = level;
    if (level >= CLIP_LEVEL) clipped += 1;
  }
  const seconds = samples.length / SAMPLE_RATE;
  const clippedShare = samples.length ? clipped / samples.length : 0;

  let problem: LevelProblem | null = null;
  if (reachedLimit) problem = 'too-long';
  else if (seconds < MIN_SECONDS) problem = 'too-short';
  else if (peak < SILENCE_PEAK) problem = 'silence';
  else if (clippedShare > CLIP_SHARE) problem = 'clipped';
  return { problem, seconds, peak, clippedShare };
}
