import { describe, expect, it } from 'vitest';
import realMaterials from '../../../public/data/materials.json';
import type { Materials, Phrase, WordIndexItem } from '../../content/types';
import type { FlashcardProgress } from './types';
import {
  ALL_DECK_KEY,
  SWIPE_THRESHOLD,
  actionForKey,
  answerCard,
  answerForSwipe,
  buildFlashcards,
  deckKey,
  filterDeck,
  getTopics,
  isHorizontalDrag,
  resolveSession,
  shuffleSession,
  summarizeDeck
} from './flashcards';

function phrase(id: string, text: string, category: string, extra: Partial<Phrase> = {}): Phrase {
  return { id, phrase: text, category, translation: `${text} (ua)`, ...extra };
}

function word(id: string, term: string, category: string, extra: Partial<WordIndexItem> = {}): WordIndexItem {
  return { id, term, category, meaning: `${term} (meaning)`, pronunciation: '', examples: [], ...extra };
}

const materials: Pick<Materials, 'phrases' | 'wordIndex'> = {
  phrases: [
    phrase('p1', 'From my perspective, …', 'Start answer', { example: 'From my perspective, it works.' }),
    phrase('p2', 'dig into', 'AI', { transcription: '/dɪɡ ˈɪntuː/' }),
    phrase('p3', 'From my perspective', 'Hedging'),
    phrase('p4', 'to some extent', 'Hedging')
  ],
  wordIndex: [
    word('w1', 'From my perspective, …', 'Start answer', {
      sourcePhraseId: 'p1',
      pronunciation: 'from my per-SPEC-tive',
      examples: [{ en: 'From my perspective, it works.', ua: 'На мій погляд, це працює.' }]
    }),
    word('w2', 'dig into', 'AI', { sourcePhraseId: 'p2', pronunciation: 'dig into' }),
    word('w3', 'From my perspective', 'Hedging', { sourcePhraseId: 'p3' }),
    word('w4', 'to some extent', 'Hedging', { sourcePhraseId: 'p4' }),
    word('w5', 'standalone word', 'AI')
  ]
};

const noProgress: FlashcardProgress = { learnedPhrases: [], hiddenPhrases: [], hiddenWords: [] };

describe('buildFlashcards', () => {
  const cards = buildFlashcards(materials);
  const byId = new Map(cards.map((card) => [card.id, card]));

  it('creates one card for a phrase and the word-index entry linked to it', () => {
    expect(cards.map((card) => card.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'w5']);
    expect(byId.get('p2')).toMatchObject({ phraseId: 'p2', wordIds: ['w2'] });
  });

  it('keeps the same text listed under two ids as two cards, each with its own topic', () => {
    // "From my perspective, …" and "From my perspective" differ only in punctuation.
    expect(byId.get('p1')).toMatchObject({ phraseId: 'p1', wordIds: ['w1'], topics: ['Start answer'] });
    expect(byId.get('p3')).toMatchObject({ phraseId: 'p3', wordIds: ['w3'], topics: ['Hedging'] });
  });

  it('keeps word-index entries without a phrase as their own cards', () => {
    expect(byId.get('w5')).toMatchObject({ text: 'standalone word', phraseId: null, wordIds: ['w5'], topics: ['AI'] });
  });

  it('fills the card from both sources', () => {
    const card = byId.get('p1')!;
    expect(card.translation).toBe('From my perspective, … (meaning)');
    expect(card.transcription).toBe('from my per-SPEC-tive');
    expect(card.examples).toEqual([{ en: 'From my perspective, it works.', ua: 'На мій погляд, це працює.' }]);
  });

  it('does not show a pronunciation that only repeats the term', () => {
    expect(byId.get('p2')!.transcription).toBe('/dɪɡ ˈɪntuː/');
    expect(byId.get('p4')!.transcription).toBe('');
  });

  it('ignores malformed entries instead of failing', () => {
    const broken = {
      phrases: [null, { id: 'x' }, phrase('ok', 'fine', 'Topic')],
      wordIndex: [undefined, { term: 'no id' }]
    } as unknown as Pick<Materials, 'phrases' | 'wordIndex'>;

    expect(buildFlashcards(broken).map((card) => card.id)).toEqual(['ok']);
    expect(buildFlashcards({} as Pick<Materials, 'phrases' | 'wordIndex'>)).toEqual([]);
  });
});

describe('card identity', () => {
  const ids = (list: { id: string }[]) => list.map((card) => card.id);

  it('does not join entries whose text differs only in punctuation or case', () => {
    const cards = buildFlashcards({
      phrases: [
        phrase('review-cpp', 'C++', 'Languages'),
        phrase('review-csharp', 'C#', 'Languages'),
        phrase('lower', 'consequently', 'Conjunctions'),
        phrase('upper', 'Consequently, …', 'Linking')
      ],
      wordIndex: []
    });

    expect(ids(cards)).toEqual(['review-cpp', 'review-csharp', 'lower', 'upper']);
    expect(cards.map((card) => card.text)).toEqual(['C++', 'C#', 'consequently', 'Consequently, …']);
    expect(cards.map((card) => card.topics)).toEqual([['Languages'], ['Languages'], ['Conjunctions'], ['Linking']]);
  });

  it('learning one of two similar-looking entries leaves the other one to learn', () => {
    const cards = buildFlashcards({
      phrases: [phrase('review-cpp', 'C++', 'Languages'), phrase('review-csharp', 'C#', 'Languages')],
      wordIndex: []
    });
    const summary = summarizeDeck(cards, { ...noProgress, learnedPhrases: ['review-cpp'] });

    expect(ids(summary.learned)).toEqual(['review-cpp']);
    expect(ids(summary.learning)).toEqual(['review-csharp']);
  });

  it('does not join identical text listed under two phrase ids', () => {
    const cards = buildFlashcards({
      phrases: [phrase('a', 'That being said, …', 'Contrast'), phrase('b', 'That being said, …', 'Linking')],
      wordIndex: [
        word('wa', 'That being said, …', 'Contrast', { sourcePhraseId: 'a' }),
        word('wb', 'That being said, …', 'Linking', { sourcePhraseId: 'b' })
      ]
    });

    expect(cards.map((card) => [card.id, card.phraseId, card.wordIds, card.topics])).toEqual([
      ['a', 'a', ['wa'], ['Contrast']],
      ['b', 'b', ['wb'], ['Linking']]
    ]);
  });

  it('joins a word-index entry to its phrase through sourcePhraseId only, also when the texts differ', () => {
    const cards = buildFlashcards({
      phrases: [phrase('p', 'dig into', 'AI')],
      wordIndex: [word('w', 'to dig into something', 'AI', { sourcePhraseId: 'p' })]
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: 'p', text: 'dig into', phraseId: 'p', wordIds: ['w'] });
  });

  it('does not join a word-index entry to a phrase because the text is the same', () => {
    const cards = buildFlashcards({
      phrases: [phrase('p', 'dig into', 'AI')],
      wordIndex: [word('w', 'dig into', 'AI')]
    });

    expect(cards.map((card) => [card.id, card.phraseId, card.wordIds])).toEqual([
      ['p', 'p', []],
      ['w', null, ['w']]
    ]);
  });

  it('makes a word-index entry its own card when its sourcePhraseId names no phrase', () => {
    const cards = buildFlashcards({
      phrases: [phrase('p', 'dig into', 'AI')],
      wordIndex: [word('w', 'dig into', 'AI', { sourcePhraseId: 'removed-phrase' })]
    });

    expect(cards.map((card) => [card.id, card.phraseId, card.wordIds])).toEqual([
      ['p', 'p', []],
      ['w', null, ['w']]
    ]);
  });

  it('keeps every word-index entry linked to one phrase on that phrase card', () => {
    const cards = buildFlashcards({
      phrases: [phrase('p', 'dig into', 'AI')],
      wordIndex: [word('w1', 'dig into', 'AI', { sourcePhraseId: 'p' }), word('w2', 'dig', 'Verbs', { sourcePhraseId: 'p' })]
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: 'p', phraseId: 'p', wordIds: ['w1', 'w2'], topics: ['AI', 'Verbs'] });
  });

  it('a phrase card is learned through the phrase id only, never through its linked word-index id', () => {
    const cards = buildFlashcards({
      phrases: [phrase('p', 'dig into', 'AI')],
      wordIndex: [word('w', 'dig into', 'AI', { sourcePhraseId: 'p' })]
    });

    expect(ids(summarizeDeck(cards, { ...noProgress, learnedPhrases: ['w'] }).learned)).toEqual([]);
    expect(ids(summarizeDeck(cards, { ...noProgress, learnedPhrases: ['p'] }).learned)).toEqual(['p']);
  });

  it('a card without a phrase is learned through its own word-index id', () => {
    const cards = buildFlashcards({ phrases: [], wordIndex: [word('w', 'standalone', 'AI')] });

    expect(ids(summarizeDeck(cards, { ...noProgress, learnedPhrases: ['w'] }).learned)).toEqual(['w']);
  });

  it('never creates two cards with one id', () => {
    const cards = buildFlashcards({
      phrases: [phrase('same', 'first', 'A'), phrase('same', 'second', 'B')],
      wordIndex: [word('same', 'third', 'C'), word('own', 'fourth', 'C'), word('own', 'fifth', 'C')]
    });

    expect(cards.map((card) => [card.id, card.text])).toEqual([
      ['same', 'first'],
      ['own', 'fourth']
    ]);
  });
});

describe('buildFlashcards with the real dataset', () => {
  const real = realMaterials as unknown as Materials;
  const cards = buildFlashcards(real);
  const byId = new Map(cards.map((card) => [card.id, card]));

  it('creates exactly one card per phrase, in dataset order, with unique ids', () => {
    const ids = cards.map((card) => card.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(real.phrases.map((item) => item.id));
    expect(cards.every((card) => card.phraseId === card.id)).toBe(true);
  });

  it('accounts for every phrase and word-index entry exactly once', () => {
    expect(cards.flatMap((card) => (card.phraseId ? [card.phraseId] : [])).sort()).toEqual(real.phrases.map((item) => item.id).sort());
    expect(cards.flatMap((card) => card.wordIds).sort()).toEqual(real.wordIndex.map((item) => item.id).sort());
  });

  it('puts every word-index entry on the card of the phrase it names in sourcePhraseId', () => {
    for (const item of real.wordIndex) {
      expect(byId.get(item.sourcePhraseId ?? '')?.wordIds, item.id).toContain(item.id);
    }
  });

  it('keeps "consequently" and "Consequently, …" as two cards with separate progress', () => {
    const lower = byId.get('phrase-084')!;
    const linking = byId.get('advanced-linking-004-consequently')!;

    expect(lower).toMatchObject({ text: 'consequently', topics: ['Conjunctions'] });
    expect(linking).toMatchObject({ text: 'Consequently, …', topics: ['Advanced Linking Words'] });

    const progress = { ...noProgress, learnedPhrases: ['phrase-084'] };
    const linkingDeck = summarizeDeck(filterDeck(cards, 'topic', 'Advanced Linking Words'), progress);
    const conjunctionsDeck = summarizeDeck(filterDeck(cards, 'topic', 'Conjunctions'), progress);
    const allDeck = summarizeDeck(cards, progress);

    expect(linkingDeck.learned).toEqual([]);
    expect(linkingDeck.learning).toContain(linking);
    expect(conjunctionsDeck.learned).toEqual([lower]);
    expect(allDeck.learned).toEqual([lower]);
  });

  it('shows every entry whose text also exists under another id as its own card', () => {
    const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const idsByText = new Map<string, string[]>();
    for (const item of real.phrases) idsByText.set(plain(item.phrase), [...(idsByText.get(plain(item.phrase)) ?? []), item.id]);
    const sharedText = [...idsByText.values()].filter((group) => group.length > 1).flat();

    // The built-in content has such entries, and none of them is folded into another card.
    expect(sharedText).toContain('phrase-084');
    expect(sharedText).toContain('advanced-linking-004-consequently');
    for (const id of sharedText) expect(byId.get(id)?.topics, id).toHaveLength(1);
  });

  it('gives every card a translation and at least one topic from the dataset categories', () => {
    const categories = new Set(real.phrases.map((item) => item.category));

    for (const card of cards) {
      expect(card.translation, card.id).not.toBe('');
      expect(card.topics.length, card.id).toBeGreaterThan(0);
      expect(card.topics.every((topic) => categories.has(topic)), card.id).toBe(true);
    }
    expect(getTopics(cards)).toEqual([...categories].sort((a, b) => a.localeCompare(b)));
  });
});

describe('deck filtering', () => {
  const cards = buildFlashcards(materials);

  it('All Vocabulary contains every card once', () => {
    expect(filterDeck(cards, 'all', '').map((card) => card.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'w5']);
  });

  it('By Topic contains only the cards of that topic', () => {
    expect(getTopics(cards)).toEqual(['AI', 'Hedging', 'Start answer']);
    expect(filterDeck(cards, 'topic', 'AI').map((card) => card.id)).toEqual(['p2', 'w5']);
    expect(filterDeck(cards, 'topic', 'Hedging').map((card) => card.id)).toEqual(['p3', 'p4']);
    expect(filterDeck(cards, 'topic', 'Start answer').map((card) => card.id)).toEqual(['p1']);
    expect(filterDeck(cards, 'topic', 'Unknown topic')).toEqual([]);
  });

  it('uses a separate storage key per deck', () => {
    expect(deckKey('all', 'Hedging')).toBe(ALL_DECK_KEY);
    expect(deckKey('topic', 'Hedging')).toBe('topic:Hedging');
  });
});

describe('summarizeDeck', () => {
  const cards = buildFlashcards(materials);
  const ids = (list: { id: string }[]) => list.map((card) => card.id);

  it('starts with every card in the learning pool', () => {
    const summary = summarizeDeck(cards, noProgress);
    expect(ids(summary.learning)).toEqual(['p1', 'p2', 'p3', 'p4', 'w5']);
    expect(summary.learned).toEqual([]);
    expect(summary.hiddenCount).toBe(0);
  });

  it('excludes learned cards from the learning pool', () => {
    const summary = summarizeDeck(cards, { ...noProgress, learnedPhrases: ['p2'] });
    expect(ids(summary.learning)).toEqual(['p1', 'p3', 'p4', 'w5']);
    expect(ids(summary.learned)).toEqual(['p2']);
  });

  it('keeps the learned status the same in All Vocabulary and in the topic deck of the card, and nowhere else', () => {
    // "From my perspective" (p3, Hedging) is learned. "From my perspective, …" (p1, Start answer) is not.
    const progress = { ...noProgress, learnedPhrases: ['p3'] };

    expect(ids(summarizeDeck(filterDeck(cards, 'all', ''), progress).learned)).toEqual(['p3']);
    expect(ids(summarizeDeck(filterDeck(cards, 'topic', 'Hedging'), progress).learned)).toEqual(['p3']);
    expect(ids(summarizeDeck(filterDeck(cards, 'topic', 'Start answer'), progress).learned)).toEqual([]);
    expect(ids(summarizeDeck(filterDeck(cards, 'topic', 'Start answer'), progress).learning)).toEqual(['p1']);
    expect(ids(summarizeDeck(filterDeck(cards, 'topic', 'AI'), progress).learned)).toEqual([]);
  });

  it('leaves out items hidden on the Phrases or Words page', () => {
    const summary = summarizeDeck(cards, { learnedPhrases: [], hiddenPhrases: ['p4'], hiddenWords: ['w5'] });
    expect(ids(summary.learning)).toEqual(['p1', 'p2', 'p3']);
    expect(summary.hiddenCount).toBe(2);
  });

  it('leaves out a phrase card when its linked word-index entry is hidden, and only that card', () => {
    const summary = summarizeDeck(cards, { learnedPhrases: [], hiddenPhrases: [], hiddenWords: ['w3'] });
    expect(ids(summary.learning)).toEqual(['p1', 'p2', 'p4', 'w5']);
    expect(summary.hiddenCount).toBe(1);
  });

  it('ignores stale ids that are not in the dataset any more', () => {
    const summary = summarizeDeck(cards, { learnedPhrases: ['removed'], hiddenPhrases: ['gone'], hiddenWords: [] });
    expect(summary.learning).toHaveLength(5);
  });
});

describe('review sequence', () => {
  it('starts in deck order at the first card', () => {
    expect(resolveSession(undefined, ['a', 'b', 'c'])).toEqual({ order: ['a', 'b', 'c'], index: 0 });
  });

  it('removes a known card and shows the next one', () => {
    const session = { order: ['a', 'b', 'c'], index: 0 };
    expect(answerCard(session, 'a', 'know')).toEqual({ order: ['b', 'c'], index: 0 });
  });

  it('keeps a card that is still being learned and shows it again on the next round', () => {
    let session = { order: ['a', 'b', 'c'], index: 0 };

    session = answerCard(session, 'a', 'again');
    expect(session).toEqual({ order: ['a', 'b', 'c'], index: 1 });

    session = answerCard(session, 'b', 'know');
    expect(session).toEqual({ order: ['a', 'c'], index: 1 });

    session = answerCard(session, 'c', 'again');
    expect(session).toEqual({ order: ['a', 'c'], index: 0 });
    expect(session.order[session.index]).toBe('a');
  });

  it('finishes when the last card is known', () => {
    expect(answerCard({ order: ['a'], index: 0 }, 'a', 'know')).toEqual({ order: [], index: 0 });
  });

  it('keeps a single remaining card on screen when it is still being learned', () => {
    expect(answerCard({ order: ['a'], index: 0 }, 'a', 'again')).toEqual({ order: ['a'], index: 0 });
  });

  it('ignores an answer for a card that is not in the sequence', () => {
    const session = { order: ['a', 'b'], index: 1 };
    expect(answerCard(session, 'zzz', 'know')).toBe(session);
  });

  it('drops saved cards that left the deck and keeps the position on the same card', () => {
    // "a" was learned in another deck, "x" no longer exists.
    const saved = { order: ['a', 'x', 'b', 'c'], index: 2 };
    const resolved = resolveSession(saved, ['b', 'c']);

    expect(resolved).toEqual({ order: ['b', 'c'], index: 0 });
    expect(resolved.order[resolved.index]).toBe('b');
  });

  it('adds cards that are new or marked "Learn again" at the end', () => {
    const saved = { order: ['b', 'c'], index: 1 };
    expect(resolveSession(saved, ['a', 'b', 'c'])).toEqual({ order: ['b', 'c', 'a'], index: 1 });
  });

  it('recovers from malformed saved sequences', () => {
    const learning = ['a', 'b'];
    const broken = [
      { order: ['a', 'a', 'b'], index: 99 },
      { order: 'nope', index: -5 },
      { order: ['b'], index: Number.NaN },
      {}
    ] as never[];

    for (const saved of broken) {
      const resolved = resolveSession(saved, learning);
      expect([...resolved.order].sort()).toEqual(['a', 'b']);
      expect(resolved.index).toBeGreaterThanOrEqual(0);
      expect(resolved.index).toBeLessThan(resolved.order.length);
    }
    expect(resolveSession({ order: ['a'], index: 3 }, [])).toEqual({ order: [], index: 0 });
  });

  it('shuffles without losing or duplicating cards', () => {
    const session = { order: ['a', 'b', 'c', 'd', 'e'], index: 3 };
    const shuffled = shuffleSession(session, () => 0);

    expect(shuffled.index).toBe(0);
    expect([...shuffled.order].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(shuffled.order).not.toEqual(session.order);
    expect(session.order).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('input mapping', () => {
  it('maps keyboard keys to actions', () => {
    expect(actionForKey('ArrowRight')).toBe('know');
    expect(actionForKey('ArrowLeft')).toBe('again');
    expect(actionForKey('Enter')).toBe('flip');
    expect(actionForKey(' ')).toBe('flip');
    expect(actionForKey('ArrowUp')).toBeNull();
    expect(actionForKey('a')).toBeNull();
  });

  it('maps a swipe to an answer only after the threshold', () => {
    expect(answerForSwipe(SWIPE_THRESHOLD)).toBe('know');
    expect(answerForSwipe(-SWIPE_THRESHOLD)).toBe('again');
    expect(answerForSwipe(SWIPE_THRESHOLD - 1)).toBeNull();
    expect(answerForSwipe(-(SWIPE_THRESHOLD - 1))).toBeNull();
    expect(answerForSwipe(0)).toBeNull();
  });

  it('treats only clearly horizontal moves as a swipe so vertical scrolling keeps working', () => {
    expect(isHorizontalDrag(30, 5)).toBe(true);
    expect(isHorizontalDrag(-30, 5)).toBe(true);
    expect(isHorizontalDrag(5, 60)).toBe(false);
    expect(isHorizontalDrag(20, 40)).toBe(false);
    expect(isHorizontalDrag(4, 0)).toBe(false);
  });
});
