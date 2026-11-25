import { expect, it } from 'vitest';
import { createCatalog } from '../../content/catalog';
import { realMaterials } from '../../test/content';
import { describeExperimental } from '../../test/product';
import { last } from './testing';
import { KIND_LABELS, VERBS_GROUP_ID, practiceGroups } from './practiceItems';
import { isLoopbackHost } from './prototypeHost';
import { MAX_IMPORTED_LENGTH, TARGET_CONTRACT, isPlainText, normalizeTargetText, phraseTargets, selectedExample, targetRevision, verbTargets, wordTargets, type PhraseEntry, type SpokenTarget } from './spokenTarget.js';

/**
 * The spoken-target contract, version 1 (ENG-V3-02, stage A): what an entry asks the
 * learner to say, and the revision that names exactly that. Synthetic entries, and the
 * released catalog for the counts.
 */
const phrase = (id: string, text: string, extra: Partial<PhraseEntry> = {}): PhraseEntry => ({ id, phrase: text, ...extra });
const revisionOf = async (targets: SpokenTarget[], kind: SpokenTarget['kind']): Promise<string> => targetRevision(targets.find((target) => target.kind === kind)!);

describeExperimental('spoken targets: derivation', () => {
  it('a plain phrase is one text target under its own identity', () => {
    expect(phraseTargets(phrase('p1', 'Let me explain'))).toEqual([{ contract: 1, entryId: 'p1', kind: 'text', text: 'Let me explain' }]);
    expect(TARGET_CONTRACT).toBe(1);
  });

  it('a sentence frame gives its fixed beginning, and its first complete example as a second target', () => {
    const frame = phrase('p2', 'In my opinion, …', { examples: [{ en: 'In my opinion, …' }, { en: 'In my opinion, we should wait.' }], example: 'In my opinion, it is fine.' });
    expect(phraseTargets(frame)).toEqual([
      { contract: 1, entryId: 'p2', kind: 'frame', text: 'In my opinion,' },
      { contract: 1, entryId: 'p2', kind: 'example', text: 'In my opinion, we should wait.' }
    ]);
    // Three dots are an ellipsis too, and the frame may continue after it.
    expect(phraseTargets(phrase('p3', 'Where are we with ...?'))).toEqual([{ contract: 1, entryId: 'p3', kind: 'frame', text: 'Where are we with' }]);
    // A frame whose examples only repeat the frame has no example target.
    expect(phraseTargets(phrase('p4', 'I suppose …', { examples: [{ en: 'I suppose …' }] })).map((target) => target.kind)).toEqual(['frame']);
  });

  it('a formula is practised through its example only, and a bracket placeholder not at all', () => {
    expect(phraseTargets(phrase('phrase-077', 'may have + V3', { example: 'The client may have missed the update.' }))).toEqual([
      { contract: 1, entryId: 'phrase-077', kind: 'example', text: 'The client may have missed the update.' }
    ]);
    expect(phraseTargets(phrase('p5', 'will have + V3'))).toEqual([]);
    expect(phraseTargets(phrase('p6', 'Both [A] and [B] help with [goal].', { example: 'Both tests help.' }))).toEqual([]);
    expect(phraseTargets(phrase('p7', 'The main difference is that [A] ..., whereas [B] ...'))).toEqual([]);
  });

  it('selects the first complete example: the list in order, then the single field', () => {
    expect(selectedExample({ examples: [{ en: '' }, { en: 'Use [A] here.' }, { en: 'First whole one.' }, { en: 'Second whole one.' }], example: 'Single.' })).toBe('First whole one.');
    expect(selectedExample({ examples: [{ en: 'Half …' }], example: 'Single.' })).toBe('Single.');
    expect(selectedExample({ examples: [], example: 'may have + V3' })).toBeNull();
    expect(selectedExample({})).toBeNull();
    expect(isPlainText('  ')).toBe(false);
    expect(isPlainText(undefined)).toBe(false);
  });

  it('an irregular verb is its three forms, joined by a comma and a space', () => {
    expect(verbTargets({ id: 'iv-001-be', base: 'be', pastSimple: 'was/were', pastParticiple: 'been' })).toEqual([{ contract: 1, entryId: 'iv-001-be', kind: 'verb-forms', text: 'be, was/were, been' }]);
  });

  it('a linked word is practised under its phrase, by the explicit link only', () => {
    const phrases = new Map([['p1', phrase('p1', 'Let me explain')]]);
    const find = (id: string): PhraseEntry | undefined => phrases.get(id);
    // One target, under the phrase's identity: the word adds none of its own.
    expect(wordTargets({ id: 'w1', term: 'Let me explain', sourcePhraseId: 'p1' }, find)).toEqual(phraseTargets(phrases.get('p1')!));
    // A link to a phrase that is not there gives nothing. Equal text never stands in for a link.
    expect(wordTargets({ id: 'w2', term: 'Let me explain', sourcePhraseId: 'missing' }, find)).toEqual([]);
    expect(wordTargets({ id: 'w3', term: 'Let me explain' }, find)).toEqual([{ contract: 1, entryId: 'w3', kind: 'text', text: 'Let me explain' }]);
  });

  it('an imported entry is one text target as written: no frame rules, and not when too long or without Latin letters', () => {
    const imported = { collectionId: 'user-collection-1' };
    expect(phraseTargets(phrase('u1', 'What about …', imported))).toEqual([{ contract: 1, entryId: 'u1', kind: 'text', text: 'What about …' }]);
    expect(phraseTargets(phrase('u2', 'a'.repeat(MAX_IMPORTED_LENGTH), imported))).toHaveLength(1);
    expect(phraseTargets(phrase('u3', 'a'.repeat(MAX_IMPORTED_LENGTH + 1), imported))).toEqual([]);
    expect(phraseTargets(phrase('u4', 'Доброго ранку', imported))).toEqual([]);
    expect(phraseTargets(phrase('u5', '   ', imported))).toEqual([]);
    expect(wordTargets({ id: 'u6', term: 'SLA', collectionId: 'user-collection-1' }, () => undefined)).toEqual([{ contract: 1, entryId: 'u6', kind: 'text', text: 'SLA' }]);
  });

  it('a spoken hint replaces the text of a text target', () => {
    expect(phraseTargets(phrase('p8', 'Our SLA is strict'), 'Our S L A is strict')).toEqual([{ contract: 1, entryId: 'p8', kind: 'text', text: 'Our S L A is strict' }]);
    expect(wordTargets({ id: 'u6', term: 'SLA', collectionId: 'c' }, () => undefined, 'S L A')).toEqual([{ contract: 1, entryId: 'u6', kind: 'text', text: 'S L A' }]);
    // A frame has no text target, so a hint does not apply to it.
    expect(phraseTargets(phrase('p9', 'I would say …'), 'hint').map((target) => target.kind)).toEqual(['frame']);
  });
});

describeExperimental('spoken targets: revision', () => {
  const base = phrase('p1', 'Let me explain');
  const revision = (text: string, id = 'p1'): Promise<string> => targetRevision(phraseTargets(phrase(id, text))[0]);

  it('is 12 hex digits of the SHA-256 of [contract, entry, kind, text]', async () => {
    const target = phraseTargets(base)[0];
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('[1,"p1","text","Let me explain"]'));
    const expected = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 12);
    expect(await targetRevision(target)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{12}$/);
  });

  it('does not change for whitespace runs, line breaks, leading or trailing space, or an equivalent Unicode form', async () => {
    const original = await revision('Let me explain');
    expect(await revision('  Let   me\texplain \n')).toBe(original);
    expect(await revision('Let\r\nme explain')).toBe(original);
    expect(normalizeTargetText(' a \n\t b ')).toBe('a b');
    // "é" as one character and as "e" with a combining accent.
    expect(await revision('caf\u00E9')).toBe(await revision('cafe\u0301'));
    expect('caf\u00E9').not.toBe('cafe\u0301');
  });

  it('changes for capitalization and for punctuation, including an added full stop', async () => {
    const original = await revision('Let me explain');
    expect(await revision('let me explain')).not.toBe(original);
    expect(await revision('Let me explain.')).not.toBe(original);
    expect(await revision('Let me, explain')).not.toBe(original);
  });

  it('does not change for a translation, a tag or a transcription: they are not part of the target', async () => {
    const withMetadata = { ...base, translation: 'Дозвольте пояснити', tag: 'meeting', transcription: 'let mi ik-SPLEIN' } as PhraseEntry;
    expect(await targetRevision(phraseTargets(withMetadata)[0])).toBe(await targetRevision(phraseTargets(base)[0]));
  });

  it('an example that is not the selected one does not matter; the selected one changes the example target only', async () => {
    const frame = (examples: string[]): PhraseEntry => phrase('p2', 'In my opinion, …', { examples: examples.map((en) => ({ en })) });
    const before = phraseTargets(frame(['In my opinion, we should wait.', 'In my opinion, it works.']));
    const otherChanged = phraseTargets(frame(['In my opinion, we should wait.', 'In my opinion, it fails.']));
    const selectedChanged = phraseTargets(frame(['In my opinion, we should go.', 'In my opinion, it works.']));

    expect(await revisionOf(otherChanged, 'example')).toBe(await revisionOf(before, 'example'));
    expect(await revisionOf(selectedChanged, 'example')).not.toBe(await revisionOf(before, 'example'));
    // The frame target of the same entry is not affected by any example.
    expect(await revisionOf(selectedChanged, 'frame')).toBe(await revisionOf(before, 'frame'));
    // Practising the example instead of the frame is another target, with its own revision.
    expect(await revisionOf(before, 'frame')).not.toBe(await revisionOf(before, 'example'));
  });

  it('regression case of the review: changing the example of "may have + V3" changes that entry\'s only target', async () => {
    const before = phraseTargets(phrase('phrase-077', 'may have + V3', { example: 'The client may have missed the update.' }));
    const after = phraseTargets(phrase('phrase-077', 'may have + V3', { example: 'She may have missed the train.' }));
    expect(before.map((target) => target.kind)).toEqual(['example']);
    expect(after.map((target) => target.kind)).toEqual(['example']);
    expect(await targetRevision(after[0])).not.toBe(await targetRevision(before[0]));
  });

  it('a spoken hint that is added, changed or removed changes the revision each time', async () => {
    const entry = phrase('p8', 'Our SLA is strict');
    const none = await targetRevision(phraseTargets(entry)[0]);
    const added = await targetRevision(phraseTargets(entry, 'Our S L A is strict')[0]);
    const changed = await targetRevision(phraseTargets(entry, 'Our ess el ay is strict')[0]);
    expect(new Set([none, added, changed]).size).toBe(3);
    expect(await targetRevision(phraseTargets(entry)[0])).toBe(none);
  });

  it('equal text never merges two entries, and the contract version is part of the revision', async () => {
    expect(await revision('Let me explain', 'p1')).not.toBe(await revision('Let me explain', 'p2'));
    const target = phraseTargets(base)[0];
    expect(await targetRevision({ ...target, contract: 2 as unknown as 1 })).not.toBe(await targetRevision(target));
  });
});

describeExperimental('spoken targets: the released catalog', () => {
  const catalog = createCatalog(realMaterials);
  const targets = catalog.phrases.map((item) => phraseTargets(item));
  const count = (kind: SpokenTarget['kind']): number => targets.flat().filter((target) => target.kind === kind).length;

  it('covers every kind of entry with the counts of the approved plan', () => {
    expect(catalog.phrases).toHaveLength(638);
    expect(count('text')).toBe(524);
    expect(count('frame')).toBe(92);
    // 69 frames and all 3 formulas have a complete example.
    expect(count('example')).toBe(72);
    expect(targets.filter((list) => list.length === 0)).toHaveLength(19);
    expect(catalog.irregularVerbs.flatMap((verb) => verbTargets(verb))).toHaveLength(339);
    expect(verbTargets(catalog.irregularVerbs.find((verb) => verb.id === 'iv-001-be')!)[0].text).toBe('be, was/were, been');
  });

  it('practises every built-in word under its phrase: no word has a target of its own', () => {
    const byId = new Map(catalog.phrases.map((item) => [item.id, item]));
    expect(catalog.wordIndex).toHaveLength(566);
    for (const word of catalog.wordIndex) {
      const own = wordTargets(word, (id) => byId.get(id));
      expect(own.every((target) => target.entryId === word.sourcePhraseId)).toBe(true);
    }
  });

  it('the real "may have + V3" entry yields its example and nothing else', () => {
    const entry = catalog.phrases.find((item) => item.id === 'phrase-077')!;
    expect(entry.phrase).toBe('may have + V3');
    expect(phraseTargets(entry)).toEqual([{ contract: 1, entryId: 'phrase-077', kind: 'example', text: 'The client may have missed the update.' }]);
  });

  it('gives every target a revision of its own', async () => {
    const all = [...targets.flat(), ...catalog.irregularVerbs.flatMap((verb) => verbTargets(verb))];
    const revisions = await Promise.all(all.map((target) => targetRevision(target)));
    expect(new Set(revisions).size).toBe(all.length);
  });

  it('offers the targets on the screen by topic, with the verbs as a group of their own', () => {
    const groups = practiceGroups(catalog);
    const items = groups.flatMap((group) => group.items);
    expect(items).toHaveLength(524 + 92 + 72 + 339);
    expect(last(groups)).toMatchObject({ id: VERBS_GROUP_ID, title: 'Irregular verbs' });
    expect(last(groups).items).toHaveLength(339);
    expect(groups.every((group) => group.items.length > 0)).toBe(true);
    // A text target shows the entry's meaning; a part or an example shows where it comes from.
    const text = items.find((item) => item.target.kind === 'text')!;
    expect(text.translation).not.toBe('');
    expect(text.source).toBe('');
    const example = items.find((item) => item.target.entryId === 'phrase-077')!;
    expect(example).toMatchObject({ translation: '', source: 'may have + V3' });
    expect(Object.keys(KIND_LABELS).sort()).toEqual(['example', 'frame', 'text', 'verb-forms']);
  });
});

describeExperimental('prototype host', () => {
  it('offers a model download on this computer\'s own loopback address only', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) expect(isLoopbackHost(host)).toBe(true);
    for (const host of ['shcherbak-pro.github.io', 'example.com', '127.0.0.1.example.com', 'localhost.example.com', '192.168.1.10', '0.0.0.0', '']) expect(isLoopbackHost(host)).toBe(false);
  });
});
