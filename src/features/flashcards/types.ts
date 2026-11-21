import type { WordExample } from '../../content/types';
import type { FlashcardSession } from '../../state/progress';
import type { FlashcardMode } from '../../state/settings';

export type { FlashcardMode, FlashcardSession };

/**
 * One vocabulary item shown as a flashcard.
 *
 * Identity comes from the dataset only:
 * - every phrase is one card, and the card id is the phrase id;
 * - a word-index entry that names a phrase in `sourcePhraseId` belongs to that
 *   phrase's card;
 * - a word-index entry without such a phrase is its own card, and the card id
 *   is the word-index id.
 *
 * Two entries with different ids are never one card, however similar their
 * text is. The card id is also the id saved as "learned", so a phrase is
 * learned on the Flashcards page exactly when it is learned on the Phrases page
 * and in the Focus List.
 */
export type Flashcard = {
  /** The phrase id, or the word-index id for a card without a phrase. */
  id: string;
  text: string;
  translation: string;
  /** IPA transcription or stress hint. Empty when the dataset has none. */
  transcription: string;
  examples: WordExample[];
  alternatives: string[];
  /** Categories of the phrase and of its linked word-index entries. Usually one. */
  topics: string[];
  section?: string;
  level?: string;
  tag?: string;
  /** The phrase this card shows, or `null` for a word-index entry without a phrase. */
  phraseId: string | null;
  /** The word-index entries of this card: linked through `sourcePhraseId`, or the entry itself. */
  wordIds: string[];
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
