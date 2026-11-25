/**
 * From a learning entry to what the learner is asked to say (ENG-V3-02, stage A).
 *
 * Contract 1 of the spoken-target rules. An entry yields zero or more targets. A target
 * names the entry it belongs to, its kind and the exact text to say. Its revision is a
 * hash of exactly that, so a result recorded for one text is never taken for another.
 *
 * Plain JavaScript, like src/content/packFormat.js, so that the content generator can
 * use the same rules later. It reads no storage and no network, and it compares nothing
 * with a transcript.
 *
 * @typedef {'text' | 'frame' | 'example' | 'verb-forms'} SpokenTargetKind
 * @typedef {{ contract: 1, entryId: string, kind: SpokenTargetKind, text: string }} SpokenTarget
 * @typedef {{ id: string, phrase: string, example?: string, examples?: { en: string }[], collectionId?: string }} PhraseEntry
 * @typedef {{ id: string, term: string, sourcePhraseId?: string, collectionId?: string }} WordEntry
 * @typedef {{ id: string, base: string, pastSimple: string, pastParticiple: string }} VerbEntry
 */

/** Version of the derivation and normalization rules below. Changing a rule means raising it. */
export const TARGET_CONTRACT = 1;

/** Imported text longer than this is not offered for recording. */
export const MAX_IMPORTED_LENGTH = 300;

const ELLIPSIS = /…|\.\.\./;
const PLACEHOLDER = /\[[^\]]*\]/;
const FORMULA = /\s\+\s/;
const LATIN_LETTER = /[A-Za-z]/;

/**
 * Plain text can be said as it is written: it is not empty and has no ellipsis, no
 * bracket placeholder such as "[A]" and no formula such as "may have + V3".
 * @param {unknown} text
 * @returns {text is string}
 */
export function isPlainText(text) {
  return typeof text === 'string' && text.trim() !== '' && !ELLIPSIS.test(text) && !PLACEHOLDER.test(text) && !FORMULA.test(text);
}

/**
 * The first complete example of an entry: `examples[].en` in order, then `example`.
 * @param {{ example?: string, examples?: { en: string }[] }} entry
 * @returns {string | null}
 */
export function selectedExample(entry) {
  for (const text of [...(entry.examples ?? []).map((example) => example.en), entry.example]) {
    if (isPlainText(text)) return text;
  }
  return null;
}

/**
 * @param {string} entryId
 * @param {SpokenTargetKind} kind
 * @param {string} text
 * @returns {SpokenTarget}
 */
const target = (entryId, kind, text) => ({ contract: TARGET_CONTRACT, entryId, kind, text });

/**
 * An imported entry, or a spoken hint: one `text` target, unless the text is too long
 * or has no Latin letter at all.
 * @param {string} entryId
 * @param {string} text
 * @returns {SpokenTarget[]}
 */
function freeText(entryId, text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_IMPORTED_LENGTH || !LATIN_LETTER.test(trimmed)) return [];
  return [target(entryId, 'text', text)];
}

/**
 * Targets of a phrase. `hint` is the entry's spoken hint, when it has one: it replaces
 * the text of a `text` target.
 * @param {PhraseEntry} phrase
 * @param {string} [hint]
 * @returns {SpokenTarget[]}
 */
export function phraseTargets(phrase, hint) {
  if (phrase.collectionId) return freeText(phrase.id, hint ?? phrase.phrase);
  if (PLACEHOLDER.test(phrase.phrase)) return [];

  const example = selectedExample(phrase);
  if (FORMULA.test(phrase.phrase)) return example ? [target(phrase.id, 'example', example)] : [];

  const ellipsis = ELLIPSIS.exec(phrase.phrase);
  if (ellipsis) {
    const fixed = phrase.phrase.slice(0, ellipsis.index).trim();
    return [...(fixed ? [target(phrase.id, 'frame', fixed)] : []), ...(example ? [target(phrase.id, 'example', example)] : [])];
  }
  return hint === undefined ? [target(phrase.id, 'text', phrase.phrase)] : freeText(phrase.id, hint);
}

/**
 * Targets of a word. A word that names a phrase in `sourcePhraseId` is practised under
 * that phrase: it yields the phrase's targets, with the phrase's ID. Equal text never
 * links two entries; only this explicit link does.
 * @param {WordEntry} word
 * @param {(id: string) => PhraseEntry | undefined} findPhrase
 * @param {string} [hint] Spoken hint of the entry the word is practised under.
 * @returns {SpokenTarget[]}
 */
export function wordTargets(word, findPhrase, hint) {
  if (word.sourcePhraseId) {
    const phrase = findPhrase(word.sourcePhraseId);
    return phrase ? phraseTargets(phrase, hint) : [];
  }
  if (word.collectionId || hint !== undefined) return freeText(word.id, hint ?? word.term);
  return isPlainText(word.term) ? [target(word.id, 'text', word.term)] : [];
}

/**
 * An irregular verb: its three forms, joined by a comma and a space.
 * @param {VerbEntry} verb
 * @returns {SpokenTarget[]}
 */
export function verbTargets(verb) {
  return [target(verb.id, 'verb-forms', `${verb.base}, ${verb.pastSimple}, ${verb.pastParticiple}`)];
}

/**
 * The text as it enters the revision: Unicode NFC, every run of whitespace is one space,
 * no whitespace at the ends. Nothing else changes: case and punctuation count.
 * @param {string} text
 */
export function normalizeTargetText(text) {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * The target revision: the first 12 hex digits of the SHA-256 of the JSON array
 * `[contract, entryId, kind, text]`, with the text normalized as above.
 * @param {SpokenTarget} spokenTarget
 * @returns {Promise<string>}
 */
export async function targetRevision(spokenTarget) {
  const canonical = JSON.stringify([spokenTarget.contract, spokenTarget.entryId, spokenTarget.kind, normalizeTargetText(spokenTarget.text)]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 12);
}
