import type { Materials, Phrase, WordExample, WordIndexItem } from '../types/materials';
import type {
  DeckSummary,
  Flashcard,
  FlashcardAction,
  FlashcardAnswer,
  FlashcardMode,
  FlashcardProgress,
  FlashcardSession
} from '../types/flashcards';

export const ALL_DECK_KEY = 'all';

/** Horizontal distance in pixels after which a swipe counts as an answer. */
export const SWIPE_THRESHOLD = 90;

/** Horizontal distance in pixels after which a pointer move becomes a drag. */
const DRAG_START_DISTANCE = 10;

/** Lower-cased text without punctuation, used to recognise the same item twice. */
export function normalizeTerm(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizeAlternatives(value?: string[] | string): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : value.split(';');
  return list.map((item) => String(item).trim()).filter(Boolean);
}

function cleanExamples(value?: WordExample[]): WordExample[] {
  if (!Array.isArray(value)) return [];
  return value.filter((example) => example && typeof example.en === 'string' && example.en.trim() !== '');
}

function addTopic(card: Flashcard, topic?: string): void {
  if (topic && !card.topics.includes(topic)) card.topics.push(topic);
}

function createCard(id: string, text: string): Flashcard {
  return {
    id,
    text,
    translation: '',
    transcription: '',
    examples: [],
    alternatives: [],
    topics: [],
    phraseIds: [],
    wordIds: [],
    learnIds: []
  };
}

function mergePhrase(card: Flashcard, phrase: Phrase): void {
  card.phraseIds.push(phrase.id);
  addTopic(card, phrase.category);
  card.translation ||= phrase.translation ?? '';
  card.transcription ||= phrase.transcription ?? '';
  card.section ??= phrase.section;
  card.level ??= phrase.level;
  card.tag ??= phrase.tag;

  if (!card.alternatives.length) card.alternatives = normalizeAlternatives(phrase.commonAlternatives);
  if (!card.examples.length) {
    const examples = cleanExamples(phrase.examples);
    card.examples = examples.length ? examples : phrase.example ? [{ en: phrase.example }] : [];
  }
}

function mergeWord(card: Flashcard, word: WordIndexItem): void {
  const isFirstWord = card.wordIds.length === 0;
  card.wordIds.push(word.id);
  addTopic(card, word.category);

  // `meaning` translates the term itself. Some older phrases store the
  // translation of their example sentence instead, so the meaning wins.
  if (isFirstWord && word.meaning) card.translation = word.meaning;

  if (!card.transcription) {
    const pronunciation = word.pronunciation ?? '';
    const isStressHint = pronunciation !== '' && normalizeTerm(pronunciation) !== normalizeTerm(word.term);
    card.transcription = word.transcription || (isStressHint ? pronunciation : '');
  }

  card.section ??= word.section;
  card.level ??= word.level;
  card.tag ??= word.tag;

  if (!card.alternatives.length) card.alternatives = normalizeAlternatives(word.commonAlternatives);

  // Word-index examples carry a translation, so prefer them over an
  // untranslated single example taken from the phrase.
  const examples = cleanExamples(word.examples);
  const hasTranslatedExample = card.examples.some((example) => example.ua);
  if (examples.length && !hasTranslatedExample) card.examples = examples;
}

/**
 * Builds the flashcard list from the existing vocabulary data.
 *
 * - A word-index entry that points to a phrase (`sourcePhraseId`) joins that phrase's card.
 * - Items with the same text (for example the same phrase listed in two categories)
 *   share one card that belongs to both topics.
 * - Card ids come from the dataset ids, never from array positions.
 */
export function buildFlashcards(materials: Pick<Materials, 'phrases' | 'wordIndex'>): Flashcard[] {
  const cards: Flashcard[] = [];
  const cardByTerm = new Map<string, Flashcard>();
  const cardByPhraseId = new Map<string, Flashcard>();

  const phrases = Array.isArray(materials?.phrases) ? materials.phrases : [];
  const words = Array.isArray(materials?.wordIndex) ? materials.wordIndex : [];

  for (const phrase of phrases) {
    if (!phrase || typeof phrase.id !== 'string' || !phrase.id || !phrase.phrase) continue;

    const term = normalizeTerm(phrase.phrase) || phrase.id;
    let card = cardByTerm.get(term);
    if (!card) {
      card = createCard(phrase.id, phrase.phrase);
      cards.push(card);
      cardByTerm.set(term, card);
    }
    cardByPhraseId.set(phrase.id, card);
    mergePhrase(card, phrase);
  }

  for (const word of words) {
    if (!word || typeof word.id !== 'string' || !word.id || !word.term) continue;

    const term = normalizeTerm(word.term) || word.id;
    let card = (word.sourcePhraseId ? cardByPhraseId.get(word.sourcePhraseId) : undefined) ?? cardByTerm.get(term);
    if (!card) {
      card = createCard(word.id, word.term);
      cards.push(card);
      cardByTerm.set(term, card);
    }
    mergeWord(card, word);
  }

  for (const card of cards) {
    card.learnIds = card.phraseIds.length ? [...card.phraseIds] : [...card.wordIds];
  }

  return cards;
}

export function getTopics(cards: Flashcard[]): string[] {
  const topics = new Set<string>();
  for (const card of cards) {
    for (const topic of card.topics) topics.add(topic);
  }
  return [...topics].sort((a, b) => a.localeCompare(b));
}

/** Storage key of a deck's review sequence. */
export function deckKey(mode: FlashcardMode, topic: string): string {
  return mode === 'topic' ? `topic:${topic}` : ALL_DECK_KEY;
}

export function filterDeck(cards: Flashcard[], mode: FlashcardMode, topic: string): Flashcard[] {
  if (mode !== 'topic') return cards;
  return cards.filter((card) => card.topics.includes(topic));
}

/** Splits a deck into cards still being learned and cards already learned. */
export function summarizeDeck(cards: Flashcard[], progress: FlashcardProgress): DeckSummary {
  const learnedIds = new Set(progress.learnedPhrases);
  const hiddenPhrases = new Set(progress.hiddenPhrases);
  const hiddenWords = new Set(progress.hiddenWords);

  const summary: DeckSummary = { learning: [], learned: [], hiddenCount: 0 };

  for (const card of cards) {
    const hidden =
      card.phraseIds.some((id) => hiddenPhrases.has(id)) || card.wordIds.some((id) => hiddenWords.has(id));

    if (hidden) {
      summary.hiddenCount += 1;
    } else if (card.learnIds.some((id) => learnedIds.has(id))) {
      summary.learned.push(card);
    } else {
      summary.learning.push(card);
    }
  }

  return summary;
}

/**
 * Brings a saved review sequence in line with the cards that are being learned now.
 *
 * Saved ids that are no longer in the deck (learned elsewhere, hidden, removed
 * from the dataset) are dropped. Cards missing from the saved sequence (new
 * items, or items marked "Learn again") are added at the end.
 */
export function resolveSession(saved: FlashcardSession | undefined, learningIds: string[]): FlashcardSession {
  const learning = new Set(learningIds);
  const seen = new Set<string>();
  const order: string[] = [];
  const savedOrder = Array.isArray(saved?.order) ? saved.order : [];
  const savedIndex = typeof saved?.index === 'number' && saved.index > 0 ? Math.floor(saved.index) : 0;
  let index = 0;

  savedOrder.forEach((id, position) => {
    if (!learning.has(id) || seen.has(id)) return;
    if (position < savedIndex) index += 1;
    seen.add(id);
    order.push(id);
  });

  for (const id of learningIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }

  return { order, index: index < order.length ? index : 0 };
}

/**
 * Applies an answer to the review sequence.
 *
 * - `know` removes the card from the sequence.
 * - `again` keeps the card and moves on, so it comes back on the next round.
 *
 * After the last card the sequence starts again from the first one.
 */
export function answerCard(session: FlashcardSession, cardId: string, answer: FlashcardAnswer): FlashcardSession {
  const position = session.order.indexOf(cardId);
  if (position === -1) return session;

  if (answer === 'know') {
    const order = session.order.filter((id) => id !== cardId);
    return { order, index: position < order.length ? position : 0 };
  }

  const next = position + 1;
  return { order: session.order, index: next < session.order.length ? next : 0 };
}

/** Returns a new review sequence with the same cards in random order. */
export function shuffleSession(session: FlashcardSession, random: () => number = Math.random): FlashcardSession {
  const order = [...session.order];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { order, index: 0 };
}

/** Maps a keyboard key to a flashcard action. */
export function actionForKey(key: string): FlashcardAction | null {
  if (key === 'ArrowRight') return 'know';
  if (key === 'ArrowLeft') return 'again';
  if (key === 'Enter' || key === ' ' || key === 'Spacebar') return 'flip';
  return null;
}

/**
 * True when a pointer move is clearly horizontal. Vertical moves are left
 * alone so the page can still scroll under the finger.
 */
export function isHorizontalDrag(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaX) >= DRAG_START_DISTANCE && Math.abs(deltaX) > Math.abs(deltaY);
}

/** Maps a finished horizontal swipe to an answer: right = know, left = keep learning. */
export function answerForSwipe(deltaX: number, threshold: number = SWIPE_THRESHOLD): FlashcardAnswer | null {
  if (Math.abs(deltaX) < threshold) return null;
  return deltaX > 0 ? 'know' : 'again';
}
