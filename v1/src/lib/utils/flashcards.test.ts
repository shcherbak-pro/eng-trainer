import { describe, expect, it } from 'vitest';
import realMaterials from '../../../public/data/materials.json';
import type { Materials, Phrase, WordIndexItem } from '../types/materials';
import type { FlashcardProgress } from '../types/flashcards';
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

  it('creates one card when a phrase and a word-index entry are the same item', () => {
    expect(cards.map((card) => card.id)).toEqual(['p1', 'p2', 'p4', 'w5']);
    expect(byId.get('p2')).toMatchObject({ phraseIds: ['p2'], wordIds: ['w2'] });
  });

  it('merges the same text listed in two categories into one card with both topics', () => {
    const card = byId.get('p1')!;
    expect(card.topics).toEqual(['Start answer', 'Hedging']);
    expect(card.phraseIds).toEqual(['p1', 'p3']);
    expect(card.wordIds).toEqual(['w1', 'w3']);
    expect(card.learnIds).toEqual(['p1', 'p3']);
  });

  it('keeps word-index entries without a phrase as their own cards', () => {
    expect(byId.get('w5')).toMatchObject({ text: 'standalone word', learnIds: ['w5'], topics: ['AI'] });
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

describe('buildFlashcards with the real dataset', () => {
  const real = realMaterials as unknown as Materials;
  const cards = buildFlashcards(real);

  it('never shows the same vocabulary item twice', () => {
    const ids = cards.map((card) => card.id);
    const texts = cards.map((card) => card.text.toLowerCase());

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(texts).size).toBe(texts.length);
    expect(cards.length).toBeLessThanOrEqual(real.phrases.length);
    expect(cards.length).toBeGreaterThan(0);
  });

  it('accounts for every phrase and word-index entry exactly once', () => {
    expect(cards.flatMap((card) => card.phraseIds).sort()).toEqual(real.phrases.map((item) => item.id).sort());
    expect(cards.flatMap((card) => card.wordIds).sort()).toEqual(real.wordIndex.map((item) => item.id).sort());
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
    expect(filterDeck(cards, 'all', '').map((card) => card.id)).toEqual(['p1', 'p2', 'p4', 'w5']);
  });

  it('By Topic contains only the cards of that topic', () => {
    expect(getTopics(cards)).toEqual(['AI', 'Hedging', 'Start answer']);
    expect(filterDeck(cards, 'topic', 'AI').map((card) => card.id)).toEqual(['p2', 'w5']);
    expect(filterDeck(cards, 'topic', 'Hedging').map((card) => card.id)).toEqual(['p1', 'p4']);
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
    expect(ids(summary.learning)).toEqual(['p1', 'p2', 'p4', 'w5']);
    expect(summary.learned).toEqual([]);
    expect(summary.hiddenCount).toBe(0);
  });

  it('excludes learned cards from the learning pool', () => {
    const summary = summarizeDeck(cards, { ...noProgress, learnedPhrases: ['p2'] });
    expect(ids(summary.learning)).toEqual(['p1', 'p4', 'w5']);
    expect(ids(summary.learned)).toEqual(['p2']);
  });

  it('keeps the learned status the same in All Vocabulary and in every topic deck', () => {
    // The card was learned through its "Hedging" entry (phrase p3).
    const progress = { ...noProgress, learnedPhrases: ['p3'] };

    expect(ids(summarizeDeck(filterDeck(cards, 'all', ''), progress).learned)).toEqual(['p1']);
    expect(ids(summarizeDeck(filterDeck(cards, 'topic', 'Hedging'), progress).learned)).toEqual(['p1']);
    expect(ids(summarizeDeck(filterDeck(cards, 'topic', 'Start answer'), progress).learned)).toEqual(['p1']);
    expect(ids(summarizeDeck(filterDeck(cards, 'topic', 'AI'), progress).learned)).toEqual([]);
  });

  it('leaves out items hidden on the Phrases or Words page', () => {
    const summary = summarizeDeck(cards, { learnedPhrases: [], hiddenPhrases: ['p4'], hiddenWords: ['w5'] });
    expect(ids(summary.learning)).toEqual(['p1', 'p2']);
    expect(summary.hiddenCount).toBe(2);
  });

  it('ignores stale ids that are not in the dataset any more', () => {
    const summary = summarizeDeck(cards, { learnedPhrases: ['removed'], hiddenPhrases: ['gone'], hiddenWords: [] });
    expect(summary.learning).toHaveLength(4);
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
