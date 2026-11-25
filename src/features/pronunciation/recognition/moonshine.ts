import { SAMPLE_RATE } from '../audio';
import type { TokenDecoder } from './tokenDecoder';

/**
 * Speech to text with the Moonshine model: one encoder pass, then the decoder picks the
 * most likely next token until it ends the text (ENG-V3-02, stage A).
 *
 * This file knows the model's inputs and outputs and nothing about ONNX Runtime, the
 * network or storage: the Worker hands it a `MoonshineRuntime`. It produces the
 * recognizer's text. It does not compare, score or judge anything.
 */
export { SAMPLE_RATE };

/**
 * The model's authors limit the output to 6.5 tokens per second of audio, counted with
 * the start token, because the model can otherwise repeat itself on short clips.
 */
const TOKENS_PER_SECOND = 6.5;

export type MoonshineConfig = {
  decoder_start_token_id: number;
  eos_token_id: number;
  decoder_num_hidden_layers: number;
  decoder_num_attention_heads: number;
  decoder_num_key_value_heads: number;
  hidden_size: number;
};

export type TensorData = Float32Array | BigInt64Array | Uint8Array;
/** The part of a runtime tensor that this file reads. */
export type RuntimeTensor = { readonly dims: readonly number[]; readonly data: unknown };

export type MoonshineRuntime = {
  tensor(type: 'float32' | 'int64' | 'bool', data: TensorData, dims: readonly number[]): RuntimeTensor;
  encode(feeds: Record<string, RuntimeTensor>): Promise<Record<string, RuntimeTensor>>;
  decode(feeds: Record<string, RuntimeTensor>): Promise<Record<string, RuntimeTensor>>;
};

export function parseMoonshineConfig(json: unknown): MoonshineConfig {
  const source = json as Record<string, unknown>;
  const keys = ['decoder_start_token_id', 'eos_token_id', 'decoder_num_hidden_layers', 'decoder_num_attention_heads', 'decoder_num_key_value_heads', 'hidden_size'] as const;
  if (source?.model_type !== 'moonshine') throw new Error('config.json: this is not a Moonshine model');
  for (const key of keys) if (!Number.isInteger(source[key]) || (source[key] as number) < 0) throw new Error(`config.json: "${key}" is missing`);
  return Object.fromEntries(keys.map((key) => [key, source[key]])) as MoonshineConfig;
}

export function maxNewTokens(sampleCount: number): number {
  return Math.max(1, Math.floor((sampleCount / SAMPLE_RATE) * TOKENS_PER_SECOND) - 1);
}

const SIDES = ['decoder', 'encoder'] as const;
const PARTS = ['key', 'value'] as const;

export type Transcript = { text: string; tokens: number[] };

/** `samples` is mono audio at 16 kHz, in the range -1 to 1. */
export async function transcribe(runtime: MoonshineRuntime, config: MoonshineConfig, decodeTokens: TokenDecoder, samples: Float32Array): Promise<Transcript> {
  const encoded = await runtime.encode({ input_values: runtime.tensor('float32', samples, [1, samples.length]) });
  const hidden = encoded.last_hidden_state;
  if (!hidden) throw new Error('The encoder returned no "last_hidden_state"');

  const layers = config.decoder_num_hidden_layers;
  const emptyShape = [1, config.decoder_num_key_value_heads, 0, config.hidden_size / config.decoder_num_attention_heads];
  // What the decoder remembers between steps. Empty before the first step.
  let past: Record<string, RuntimeTensor> = {};
  for (let layer = 0; layer < layers; layer += 1) {
    for (const side of SIDES) for (const part of PARTS) past[`past_key_values.${layer}.${side}.${part}`] = runtime.tensor('float32', new Float32Array(0), emptyShape);
  }

  const tokens: number[] = [];
  const limit = maxNewTokens(samples.length);
  let next = config.decoder_start_token_id;
  for (let step = 0; step < limit; step += 1) {
    const output = await runtime.decode({
      input_ids: runtime.tensor('int64', BigInt64Array.from([BigInt(next)]), [1, 1]),
      encoder_hidden_states: hidden,
      // The first step computes everything; later steps reuse what was remembered.
      use_cache_branch: runtime.tensor('bool', Uint8Array.from([step > 0 ? 1 : 0]), [1]),
      ...past
    });
    const logits = output.logits;
    if (!logits) throw new Error('The decoder returned no "logits"');
    const vocabulary = logits.dims[logits.dims.length - 1];
    const scores = logits.data as Float32Array;
    const offset = scores.length - vocabulary;
    let best = 0;
    for (let index = 1; index < vocabulary; index += 1) if (scores[offset + index] > scores[offset + best]) best = index;

    const remembered: Record<string, RuntimeTensor> = {};
    for (let layer = 0; layer < layers; layer += 1) {
      for (const part of PARTS) {
        remembered[`past_key_values.${layer}.decoder.${part}`] = output[`present.${layer}.decoder.${part}`];
        // The encoder part is produced by the first step only. Later steps return an empty one.
        remembered[`past_key_values.${layer}.encoder.${part}`] = step === 0 ? output[`present.${layer}.encoder.${part}`] : past[`past_key_values.${layer}.encoder.${part}`];
      }
    }
    for (const [name, value] of Object.entries(remembered)) if (!value) throw new Error(`The decoder returned no value for "${name}"`);
    past = remembered;

    if (best === config.eos_token_id) break;
    tokens.push(best);
    next = best;
  }
  return { text: decodeTokens(tokens), tokens };
}
