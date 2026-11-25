// The lock-down must stay the first import: it runs before the runtime library does.
import './lockdown';
import * as ort from 'onnxruntime-web/wasm';
import { pinnedFile } from '../models/pinned';
import { NotInstalledError, createModelStore } from '../models/store';
import { IntegrityError } from '../models/verify';
import { SAMPLE_RATE, parseMoonshineConfig, transcribe, type MoonshineConfig, type MoonshineRuntime } from './moonshine';
import type { FromWorker, LoadFailure, ToWorker } from './protocol';
import { createTokenDecoder, type TokenDecoder } from './tokenDecoder';

/**
 * The recognizer's Worker (ENG-V3-02, stage A): it owns the speech model.
 *
 * - It is started only through bootstrap.ts, so the page's policy governs it.
 * - It reads its files from the model cache and checks each against the pinned list
 *   before use. A missing file means "not installed". It never asks a server.
 * - The WebAssembly runtime gets its binary as verified bytes, so it loads nothing by
 *   itself. It runs on one thread, without a helper Worker.
 * - Audio arrives as samples in a message and leaves as text in a message. Nothing is
 *   stored, and nothing is sent anywhere else.
 *
 * Terminating the Worker frees the model's memory.
 */
const scope = globalThis as unknown as {
  postMessage(message: FromWorker): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ToWorker>) => void): void;
};

type Loaded = { runtime: MoonshineRuntime; config: MoonshineConfig; decodeTokens: TokenDecoder };
let loaded: Loaded | null = null;

async function load(keyBase: string): Promise<Loaded> {
  const store = createModelStore({ keyBase });
  const bytes = (id: string): Promise<ArrayBuffer> => store.read(pinnedFile(id));
  const json = async (id: string): Promise<unknown> => JSON.parse(new TextDecoder().decode(await bytes(id)));

  const config = parseMoonshineConfig(await json('model/config.json'));
  const preprocessor = (await json('model/preprocessor_config.json')) as { sampling_rate?: number };
  if (preprocessor.sampling_rate !== SAMPLE_RATE) throw new Error(`The model expects ${preprocessor.sampling_rate} Hz audio, this application records ${SAMPLE_RATE} Hz`);
  const decodeTokens = createTokenDecoder(await json('model/tokenizer.json'));

  // One thread, no helper Worker, and the binary handed over: the runtime requests nothing.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmBinary = await bytes('runtime/ort-wasm-simd-threaded.wasm');
  ort.env.logLevel = 'error';

  const options = { executionProviders: ['wasm'] };
  const encoder = await ort.InferenceSession.create(new Uint8Array(await bytes('model/onnx/encoder_model_quantized.onnx')), options);
  const decoder = await ort.InferenceSession.create(new Uint8Array(await bytes('model/onnx/decoder_model_merged_quantized.onnx')), options);

  const runtime: MoonshineRuntime = {
    tensor: (type, data, dims) => new ort.Tensor(type, data, dims),
    encode: (feeds) => encoder.run(feeds as Record<string, ort.Tensor>),
    decode: (feeds) => decoder.run(feeds as Record<string, ort.Tensor>)
  };
  return { runtime, config, decodeTokens };
}

function failureOf(error: unknown): LoadFailure {
  if (error instanceof NotInstalledError) return 'not-installed';
  if (error instanceof IntegrityError) return 'integrity';
  return 'runtime';
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function handle(message: ToWorker): Promise<void> {
  if (message.type === 'load') {
    const started = performance.now();
    try {
      loaded = await load(message.keyBase);
      scope.postMessage({ type: 'loaded', loadMs: Math.round(performance.now() - started) });
    } catch (error) {
      loaded = null;
      scope.postMessage({ type: 'load-failed', reason: failureOf(error), message: describe(error) });
    }
    return;
  }

  const started = performance.now();
  try {
    if (!loaded) throw new Error('The model is not loaded');
    const { text } = await transcribe(loaded.runtime, loaded.config, loaded.decodeTokens, message.samples);
    scope.postMessage({ type: 'transcribed', id: message.id, text, audioSeconds: message.samples.length / SAMPLE_RATE, elapsedMs: Math.round(performance.now() - started) });
  } catch (error) {
    scope.postMessage({ type: 'transcribe-failed', id: message.id, message: describe(error) });
  }
}

// One message at a time: a second recording waits for the first to finish.
let queue: Promise<void> = Promise.resolve();
scope.addEventListener('message', (event) => {
  queue = queue.then(() => handle(event.data));
});

scope.postMessage({ type: 'ready' });
