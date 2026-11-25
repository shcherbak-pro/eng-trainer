/**
 * Addresses of the feature's own files, as the build names them. All three are files of
 * this application, served from its own origin. Nothing here is a model file.
 */
import runtimeWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import workletModuleUrl from '../capture/pcm-collector.worklet.js?url&no-inline';
import workerModuleUrl from './recognizer.worker.ts?worker&url';

export { runtimeWasmUrl, workerModuleUrl, workletModuleUrl };
