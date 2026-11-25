/** Messages between the page and the recognizer's Worker. Samples and text travel only this way. */
export type ToWorker =
  /** Load the installed model. `keyBase` names the entries of the model cache (models/store.ts). */
  | { type: 'load'; keyBase: string }
  /** `samples` is mono audio at 16 kHz. Its buffer is transferred, not copied. */
  | { type: 'transcribe'; id: number; samples: Float32Array };

export type LoadFailure = 'not-installed' | 'integrity' | 'runtime';

export type FromWorker =
  /** The Worker module has started and listens. */
  | { type: 'ready' }
  /** The blob could not import the Worker module (bootstrap.ts). */
  | { type: 'bootstrap-failed'; message: string }
  | { type: 'loaded'; loadMs: number }
  | { type: 'load-failed'; reason: LoadFailure; message: string }
  | { type: 'transcribed'; id: number; text: string; audioSeconds: number; elapsedMs: number }
  | { type: 'transcribe-failed'; id: number; message: string };
