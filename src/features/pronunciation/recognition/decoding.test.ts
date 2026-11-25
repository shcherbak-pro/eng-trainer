import { expect, it } from 'vitest';
import { describeExperimental } from '../../../test/product';
import { SAMPLE_RATE, maxNewTokens, parseMoonshineConfig, transcribe, type MoonshineRuntime, type RuntimeTensor, type TensorData } from './moonshine';
import { createTokenDecoder } from './tokenDecoder';

/**
 * From audio samples to text (ENG-V3-02, stage A): the decoding loop with a scripted
 * model, and the token decoder with a small synthetic tokenizer. No model file is used.
 */
const DECODER = {
  type: 'Sequence',
  decoders: [{ type: 'Replace', pattern: { String: '▁' }, content: ' ' }, { type: 'ByteFallback' }, { type: 'Fuse' }, { type: 'Strip', content: ' ', start: 1, stop: 0 }]
};

const TOKENIZER = {
  model: {
    type: 'BPE',
    vocab: { '<unk>': 0, '<s>': 1, '</s>': 2, '▁Let': 3, '▁me': 4, '▁ex': 5, 'plain': 6, '.': 7, '<0xC3>': 8, '<0xA9>': 9, '<0xFF>': 10, '▁caf': 11, '▁': 12, ',': 13, '<0xE2>': 14, '<0x82>': 15, '<0xAC>': 16 }
  },
  added_tokens: [
    { id: 0, content: '<unk>', special: true },
    { id: 1, content: '<s>', special: true },
    { id: 2, content: '</s>', special: true },
    { id: 20, content: '<<ST_0>>', special: true },
    { id: 21, content: '[note]', special: false }
  ],
  decoder: DECODER
};

describeExperimental('token decoder', () => {
  const decode = createTokenDecoder(TOKENIZER);

  it('joins word pieces, turns the word-start mark into a space and drops the first space', () => {
    expect(decode([3, 4, 5, 6, 7])).toBe('Let me explain.');
    expect(decode([6, 13, 4])).toBe('plain, me');
    expect(decode([12, 12, 6])).toBe('  plain'.slice(1));
    expect(decode([])).toBe('');
  });

  it('leaves out special tokens and keeps added tokens that are not special', () => {
    expect(decode([1, 3, 4, 2])).toBe('Let me');
    expect(decode([0, 20, 3])).toBe('Let');
    expect(decode([3, 21])).toBe('Let[note]');
  });

  it('reads a run of byte tokens as UTF-8, and marks bytes that are not', () => {
    expect(decode([11, 8, 9])).toBe('café');
    expect(decode([6, 14, 15, 16])).toBe('plain\u20AC');
    // Bytes that are not UTF-8 are replaced as the standard decoder replaces them: a sequence
    // that is cut off becomes one replacement character, each impossible byte one of its own.
    expect(decode([11, 8])).toBe('caf\uFFFD');
    expect(decode([6, 14, 15])).toBe('plain\uFFFD');
    expect(decode([10, 10, 6])).toBe('\uFFFD\uFFFDplain');
    // Bytes split by an ordinary token are two separate runs.
    expect(decode([8, 6, 9])).toBe('\uFFFDplain\uFFFD');
  });

  it('refuses a token number it does not know, instead of skipping it', () => {
    expect(() => decode([3, 999])).toThrow('no token has the number 999');
  });

  it('refuses a tokenizer whose decoder it does not implement', () => {
    expect(() => createTokenDecoder({ ...TOKENIZER, decoder: { type: 'Sequence', decoders: [{ type: 'Metaspace' }] } })).toThrow('its decoder is not the one this application implements');
    expect(() => createTokenDecoder({ ...TOKENIZER, decoder: { type: 'ByteFallback' } })).toThrow('its decoder is not the one');
    expect(() => createTokenDecoder({ ...TOKENIZER, model: { type: 'Unigram', vocab: {} } })).toThrow('expected a BPE model');
    expect(() => createTokenDecoder(null)).toThrow('expected a BPE model');
  });
});

describeExperimental('Moonshine decoding loop', () => {
  const CONFIG = { model_type: 'moonshine', decoder_start_token_id: 1, eos_token_id: 2, decoder_num_hidden_layers: 2, decoder_num_attention_heads: 8, decoder_num_key_value_heads: 8, hidden_size: 288, vocab_size: 8 };
  const config = parseMoonshineConfig(CONFIG);
  const VOCABULARY = 8;

  type Tensor = RuntimeTensor & { type: string; data: TensorData; label?: string };
  type Step = { feeds: Record<string, Tensor> };

  /** A model that answers with the given token at each step. */
  function scripted(tokens: number[]): { runtime: MoonshineRuntime; steps: Step[]; encoded: Record<string, Tensor>[] } {
    const steps: Step[] = [];
    const encoded: Record<string, Tensor>[] = [];
    const tensor = (type: string, data: TensorData, dims: readonly number[], label?: string): Tensor => ({ type, data, dims, label });
    const runtime: MoonshineRuntime = {
      tensor: (type, data, dims) => tensor(type, data, dims),
      async encode(feeds) {
        encoded.push(feeds as Record<string, Tensor>);
        return { last_hidden_state: tensor('float32', new Float32Array(4), [1, 2, 2], 'hidden') };
      },
      async decode(feeds) {
        const step = steps.length;
        steps.push({ feeds: feeds as Record<string, Tensor> });
        // Two positions of scores. Only the last one counts: the first one favours token 3.
        const logits = new Float32Array(2 * VOCABULARY).fill(-5);
        logits[3] = 99;
        logits[VOCABULARY + (tokens[step] ?? 2)] = 9;
        const output: Record<string, Tensor> = { logits: tensor('float32', logits, [1, 2, VOCABULARY]) };
        for (let layer = 0; layer < 2; layer += 1) {
          for (const part of ['key', 'value']) {
            output[`present.${layer}.decoder.${part}`] = tensor('float32', new Float32Array(1), [1, 8, step + 1, 36], `decoder ${layer} ${part} step ${step}`);
            // Only the first step returns a real encoder part; later ones return an empty one.
            output[`present.${layer}.encoder.${part}`] = tensor('float32', new Float32Array(step === 0 ? 1 : 0), [1, 8, step === 0 ? 2 : 0, 36], `encoder ${layer} ${part} step ${step}`);
          }
        }
        return output;
      }
    };
    return { runtime, steps, encoded };
  }

  const decodeTokens = (ids: readonly number[]): string => ids.join(' ');
  const audio = (seconds: number): Float32Array => new Float32Array(Math.round(seconds * SAMPLE_RATE));

  it('reads the model\'s numbers from its configuration and refuses another kind of model', () => {
    expect(config).toEqual({ decoder_start_token_id: 1, eos_token_id: 2, decoder_num_hidden_layers: 2, decoder_num_attention_heads: 8, decoder_num_key_value_heads: 8, hidden_size: 288 });
    expect(() => parseMoonshineConfig({ ...CONFIG, model_type: 'whisper' })).toThrow('not a Moonshine model');
    expect(() => parseMoonshineConfig({ ...CONFIG, eos_token_id: undefined })).toThrow('"eos_token_id" is missing');
  });

  it('gives the encoder the samples as one mono row, and starts the decoder with the start token and nothing remembered', async () => {
    const { runtime, steps, encoded } = scripted([4, 5, 2]);
    const samples = audio(3);
    samples[7] = 0.25;
    await transcribe(runtime, config, decodeTokens, samples);

    expect(encoded).toHaveLength(1);
    expect(encoded[0].input_values.dims).toEqual([1, samples.length]);
    expect(encoded[0].input_values.data).toBe(samples);

    const first = steps[0].feeds;
    expect([...(first.input_ids.data as BigInt64Array)]).toEqual([1n]);
    expect(first.input_ids.dims).toEqual([1, 1]);
    expect([...(first.use_cache_branch.data as Uint8Array)]).toEqual([0]);
    expect(first.encoder_hidden_states.label).toBe('hidden');
    // Two layers, each with a decoder and an encoder part, each a key and a value: empty at first.
    const remembered = Object.keys(first).filter((name) => name.startsWith('past_key_values.')).sort();
    expect(remembered).toHaveLength(8);
    for (const name of remembered) expect(first[name].dims).toEqual([1, 8, 0, 36]);
  });

  it('feeds each chosen token back, reuses the decoder\'s memory and keeps the encoder part of the first step', async () => {
    const { runtime, steps } = scripted([4, 5, 6, 2]);
    const result = await transcribe(runtime, config, decodeTokens, audio(3));

    expect(result).toEqual({ tokens: [4, 5, 6], text: '4 5 6' });
    expect(steps).toHaveLength(4);
    expect(steps.map((step) => Number((step.feeds.input_ids.data as BigInt64Array)[0]))).toEqual([1, 4, 5, 6]);
    expect(steps.map((step) => (step.feeds.use_cache_branch.data as Uint8Array)[0])).toEqual([0, 1, 1, 1]);
    // Step 3 gets the decoder memory of step 2, and still the encoder memory of step 0.
    expect(steps[3].feeds['past_key_values.1.decoder.key'].label).toBe('decoder 1 key step 2');
    expect(steps[3].feeds['past_key_values.0.encoder.value'].label).toBe('encoder 0 value step 0');
    expect(steps[1].feeds['past_key_values.0.encoder.value'].label).toBe('encoder 0 value step 0');
  });

  it('takes the scores of the last position only', async () => {
    // The scripted model scores token 3 highest at the first position of every step. It must never win.
    const { runtime } = scripted([4, 5, 2]);
    expect((await transcribe(runtime, config, decodeTokens, audio(3))).tokens).toEqual([4, 5]);
  });

  it('stops at the end token, and otherwise at the limit that the audio length sets', async () => {
    expect(maxNewTokens(audio(1).length)).toBe(5);
    expect(maxNewTokens(audio(4).length)).toBe(25);
    expect(maxNewTokens(audio(0.1).length)).toBe(1);

    // A model that never ends: 2 seconds allow floor(2 * 6.5) - 1 = 12 tokens.
    const endless = scripted(new Array(100).fill(4));
    const result = await transcribe(endless.runtime, config, decodeTokens, audio(2));
    expect(result.tokens).toHaveLength(12);
    expect(endless.steps).toHaveLength(12);

    const silent = scripted([2]);
    expect(await transcribe(silent.runtime, config, decodeTokens, audio(2))).toEqual({ tokens: [], text: '' });
  });

  it('fails clearly when the model does not return what the loop needs', async () => {
    const { runtime } = scripted([4, 2]);
    const noLogits: MoonshineRuntime = { ...runtime, decode: async () => ({}) };
    await expect(transcribe(noLogits, config, decodeTokens, audio(2))).rejects.toThrow('returned no "logits"');
    const noHidden: MoonshineRuntime = { ...runtime, encode: async () => ({}) };
    await expect(transcribe(noHidden, config, decodeTokens, audio(2))).rejects.toThrow('returned no "last_hidden_state"');
  });
});
