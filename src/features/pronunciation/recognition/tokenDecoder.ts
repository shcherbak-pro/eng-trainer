/**
 * Turns the recognizer's token numbers into text, from the model's tokenizer.json
 * (ENG-V3-02, stage A).
 *
 * It implements exactly the decoder that the pinned model declares, and refuses any
 * other one instead of guessing:
 *
 *   Replace "▁" with a space  ->  ByteFallback  ->  Fuse  ->  Strip one leading space
 *
 * Special tokens (start, end, unknown and the reserved ones) are left out.
 *
 * Checked against the tokenizer library of the model's publisher, on the pinned
 * vocabulary (docs/architecture/PRONUNCIATION-PROTOTYPE.md).
 */
const WORD_START = '▁';
const BYTE_TOKEN = /^<0x([0-9A-Fa-f]{2})>$/;

type TokenizerJson = {
  model?: { type?: string; vocab?: Record<string, number> };
  added_tokens?: { id: number; content: string; special?: boolean }[];
  decoder?: { type?: string; decoders?: Record<string, unknown>[] };
};

const EXPECTED_DECODER = JSON.stringify([
  { type: 'Replace', pattern: { String: WORD_START }, content: ' ' },
  { type: 'ByteFallback' },
  { type: 'Fuse' },
  { type: 'Strip', content: ' ', start: 1, stop: 0 }
]);

export type TokenDecoder = (ids: readonly number[]) => string;

export function createTokenDecoder(tokenizer: unknown): TokenDecoder {
  const source = tokenizer as TokenizerJson;
  if (source?.model?.type !== 'BPE' || typeof source.model.vocab !== 'object' || source.model.vocab === null) {
    throw new Error('tokenizer.json: expected a BPE model with a vocabulary');
  }
  if (source.decoder?.type !== 'Sequence' || JSON.stringify(source.decoder.decoders) !== EXPECTED_DECODER) {
    throw new Error('tokenizer.json: its decoder is not the one this application implements');
  }

  const tokens = new Map<number, string>();
  for (const [token, id] of Object.entries(source.model.vocab)) tokens.set(id, token);
  const special = new Set<number>();
  for (const added of source.added_tokens ?? []) {
    tokens.set(added.id, added.content);
    if (added.special) special.add(added.id);
  }

  const utf8 = new TextDecoder();

  return (ids) => {
    const parts: string[] = [];
    let bytes: number[] = [];
    // A run of byte tokens is one piece of UTF-8. Bytes that are not valid UTF-8 are replaced
    // with the replacement character, by the rules of the standard decoder.
    const flushBytes = (): void => {
      if (!bytes.length) return;
      parts.push(utf8.decode(Uint8Array.from(bytes)));
      bytes = [];
    };

    for (const id of ids) {
      if (special.has(id)) continue;
      const token = tokens.get(id);
      if (token === undefined) throw new Error(`tokenizer.json: no token has the number ${id}`);
      const text = token.split(WORD_START).join(' ');
      const byte = BYTE_TOKEN.exec(text);
      if (byte) {
        bytes.push(Number.parseInt(byte[1], 16));
      } else {
        flushBytes();
        parts.push(text);
      }
    }
    flushBytes();

    const fused = parts.join('');
    return fused.startsWith(' ') ? fused.slice(1) : fused;
  };
}
