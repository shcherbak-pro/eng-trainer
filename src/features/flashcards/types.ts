import type { WordExample } from '../../content/types';
import type { FlashcardSession } from '../../state/progress';
import type { FlashcardMode } from '../../state/settings';

export type { FlashcardMode, FlashcardSession };

/**
 * One vocabulary item shown as a flashcard.
 *
 * Cards are derived from the existing `phrases` and `wordIndex` datasets.
 * A phrase and the word-index entry that mirrors it become a single card.
 */
export type Flashcard = {
  /** Stable identifier: the phrase id, or the word-index id for word-only items. */
  id: string;
  text: string;
  translation: string;
  /** IPA transcription or stress hint. Empty when the dataset has none. */
  transcription: string;
  examples: WordExample[];
  alternatives: string[];
  /** Dataset categories this item belongs to. Usually one. */
  topics: string[];
  section?: string;
  level?: string;
  tag?: string;
  /** Phrase ids merged into this card. */
  phraseIds: string[];
  /** Word-index ids merged into this card. */
  wordIds: string[];
  /** Ids stored in the progress store when the card is marked as learned. */
  learnIds: string[];
};

/** The two answers a learner can give for a card. */
export type FlashcardAnswer = 'know' | 'again';

export type FlashcardAction = FlashcardAnswer | 'flip';

/** The parts of the saved progress that decide which cards are in a deck. */
export type FlashcardProgress = {
  learnedPhrases: string[];
  hiddenPhrases: string[];
  hiddenWords: string[];
};

export type DeckSummary = {
  /** Cards still in the learning pool, in dataset order. */
  learning: Flashcard[];
  /** Cards already marked as learned. */
  learned: Flashcard[];
  /** Cards left out because the item is hidden on the Phrases or Words page. */
  hiddenCount: number;
};
