import type { ContentCatalog } from '../../content/catalog';
import type { ProgressState } from '../../state/progress';
import { buildFlashcards, getTopics } from '../flashcards/flashcards';
import type { Flashcard } from '../flashcards/types';

/**
 * Home statistics (ENG-V2-03). Pure selectors over the current catalog and the existing
 * progress state: nothing here is saved, cached in storage or written anywhere.
 *
 * U is the set of canonical practice-card IDs of the merged catalog (built-in content
 * and imported collections) before Hide, search, filters, Learn Passes or pagination,
 * with the flashcard identity rules: a phrase card keeps its phrase ID, a word joins a
 * phrase only through its explicit sourcePhraseId, an independent word keeps its own ID.
 * L is the learned-ID set.
 */
export type CountPair = { learned: number; available: number };

export type TopicCompletion = CountPair & { name: string; complete: boolean };

export type HomeProgress = {
  /** |U ∩ L| of |U|. */
  vocabulary: CountPair & { remaining: number };
  /** Topics of the flashcard topic selector whose cards are all learned, of those with cards. */
  topics: { completed: number; eligible: number; list: TopicCompletion[] };
  /** Words screen identity: a word is learned when sourcePhraseId ?? id is learned. Overlaps phrases. */
  words: CountPair;
  /** Phrases screen identity: the phrase's own ID. Overlaps words. */
  phrases: CountPair;
  /** The Focus List count shown in the navigation. */
  focus: number;
};

export type LibraryOverview = {
  words: number;
  phrases: number;
  verbs: number;
  topics: number;
  collections: number;
};

type ProgressInput = Pick<ProgressState, 'learnedPhrases' | 'favoriteBlocks' | 'favoritePhrases' | 'favoriteWords' | 'favoriteIrregular'>;

function knownCount(ids: string[], entries: { id: string }[]): number {
  const known = new Set(entries.map((item) => item.id));
  return ids.filter((id) => known.has(id)).length;
}

/**
 * The Focus List count. Entries of removed collections keep their saved Focus flag for a
 * later reimport, but do not count while they are not in the catalog.
 */
export function focusCount(catalog: ContentCatalog, progress: Pick<ProgressState, 'favoriteBlocks' | 'favoritePhrases' | 'favoriteWords' | 'favoriteIrregular'>): number {
  return (
    knownCount(progress.favoriteBlocks, catalog.blocks) +
    knownCount(progress.favoritePhrases, catalog.phrases) +
    knownCount(progress.favoriteWords, catalog.wordIndex) +
    knownCount(progress.favoriteIrregular, catalog.irregularVerbs)
  );
}

/** Topic membership is the existing flashcard topic list: a card in two topics counts in both. */
export function topicCompletion(cards: Flashcard[], learned: ReadonlySet<string>): TopicCompletion[] {
  return getTopics(cards).map((name) => {
    const members = cards.filter((card) => card.topics.includes(name));
    const learnedCount = members.filter((card) => learned.has(card.id)).length;
    // An empty topic is never complete.
    return { name, available: members.length, learned: learnedCount, complete: members.length > 0 && learnedCount === members.length };
  });
}

export function homeProgress(catalog: ContentCatalog, progress: ProgressInput, cards: Flashcard[] = buildFlashcards(catalog)): HomeProgress {
  const learned = new Set(progress.learnedPhrases);
  const universe = new Set(cards.map((card) => card.id));
  // Learned IDs that are not in the catalog (removed collections) do not count.
  const learnedVocabulary = [...universe].filter((id) => learned.has(id)).length;
  const topics = topicCompletion(cards, learned).filter((topic) => topic.available > 0);

  return {
    vocabulary: { learned: learnedVocabulary, available: universe.size, remaining: universe.size - learnedVocabulary },
    topics: { completed: topics.filter((topic) => topic.complete).length, eligible: topics.length, list: topics },
    words: {
      learned: catalog.wordIndex.filter((word) => learned.has(word.sourcePhraseId ?? word.id)).length,
      available: catalog.wordIndex.length
    },
    phrases: { learned: catalog.phrases.filter((phrase) => learned.has(phrase.id)).length, available: catalog.phrases.length },
    focus: focusCount(catalog, progress)
  };
}

/** Inventory of the current library, as the Words, Phrases and Verbs screens list it. Never summed. */
export function libraryOverview(catalog: ContentCatalog, cards: Flashcard[] = buildFlashcards(catalog)): LibraryOverview {
  return {
    words: catalog.wordIndex.length,
    phrases: catalog.phrases.length,
    verbs: catalog.irregularVerbs.length,
    topics: getTopics(cards).length,
    collections: catalog.collections.length
  };
}

/**
 * Whole percent, rounded down so that an unfinished set never shows 100%. A value
 * between 0 and 1 percent shows as "<1%". No value for an empty set.
 */
export function percentLabel(learned: number, available: number): string | null {
  if (available <= 0) return null;
  const value = Math.floor((learned / available) * 100);
  if (value === 0 && learned > 0) return '<1%';
  return `${value}%`;
}
