import { readCollections } from '../../collections/service';
import { readProgress } from '../../state/progress';
import { STORE_NAMES } from '../../storage/database';
import { LEGACY_STATE_KEY, LEGACY_THEME_KEY, isPlainObject, type DatabaseSection, type LegacySection, type StorePairs } from './format';
import { toStoredRecords } from './records';

/**
 * What a section holds, in the learner's terms, for the preview before a recovery and for
 * the report after an export (ENG-V3-R1A). Counts only: no entry text is shown.
 */
export type SectionSummary = {
  /** Phrases and cards marked as learned. */
  learned: number;
  /** Hidden phrases, words and verbs. */
  hidden: number;
  /** Items in the Focus list. */
  focus: number;
  learnPasses: number;
  /** Flashcard decks with a saved place. */
  flashcardDecks: number;
  /** Saved preferences. Null for the first version, which keeps them inside its state. */
  preferences: number | null;
  /** Imported collections, each with the number of its entries. */
  collections: { name: string; entries: number }[];
};

const LIST_GROUPS = {
  learned: ['learnedPhrases'],
  hidden: ['hiddenPhrases', 'hiddenWords', 'hiddenIrregular'],
  focus: ['favoriteBlocks', 'favoritePhrases', 'favoriteWords', 'favoriteIrregular']
} as const;

export function summarizeDatabaseSection(section: DatabaseSection): SectionSummary {
  const records = toStoredRecords(section.stores);
  const progress = readProgress(records);
  const vocabulary = readCollections(records);
  const count = (keys: readonly (keyof typeof progress)[]): number => keys.reduce((sum, key) => sum + (progress[key] as string[]).length, 0);
  return {
    learned: count(LIST_GROUPS.learned),
    hidden: count(LIST_GROUPS.hidden),
    focus: count(LIST_GROUPS.focus),
    learnPasses: progress.learnPasses.length,
    flashcardDecks: Object.keys(progress.flashcardSessions).length,
    preferences: section.stores.settings.length,
    collections: vocabulary.collections.map((collection) => ({
      name: collection.name,
      entries: vocabulary.entries.filter((entry) => entry.collectionId === collection.id).length
    }))
  };
}

/** The first version keeps one state object. Only the lists the other products also have are counted. */
export function summarizeLegacySection(section: LegacySection): SectionSummary {
  let state: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(section.records[LEGACY_STATE_KEY] ?? '{}');
    if (isPlainObject(parsed)) state = parsed;
  } catch {
    // A section that reached this point has passed validation. An unreadable state counts as empty.
  }
  const size = (key: string): number => (Array.isArray(state[key]) ? (state[key] as unknown[]).length : 0);
  const count = (keys: readonly string[]): number => keys.reduce((sum, key) => sum + size(key), 0);
  const sessions = state.flashcardSessions;
  return {
    learned: count(LIST_GROUPS.learned),
    hidden: count(LIST_GROUPS.hidden),
    focus: count(LIST_GROUPS.focus),
    learnPasses: size('learnPasses'),
    flashcardDecks: isPlainObject(sessions) ? Object.keys(sessions).length : 0,
    preferences: null,
    collections: []
  };
}

/** Whether the first version's section has its theme record. */
export function legacyTheme(section: LegacySection): string | null {
  return section.records[LEGACY_THEME_KEY] ?? null;
}

/**
 * The learning data that a set of stores holds, as a list of short descriptions. An
 * empty list means: no learning data. Preferences are not learning data.
 *
 * It is judged by value, not by the mere presence of a record: after "Reset learning
 * progress" the lists are still there, and they are empty. Anything unexpected counts as
 * data, so a doubtful destination is never written over.
 */
export function learningDataIn(stores: Record<string, StorePairs>): string[] {
  const found: string[] = [];
  const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

  let listed = 0;
  let other = 0;
  for (const [key, value] of stores.progress ?? []) {
    if (key === 'selectedLearnPassId') {
      if (value !== 'default') other += 1;
    } else if (Array.isArray(value)) {
      listed += value.length;
    } else {
      other += 1;
    }
  }
  if (listed) found.push(plural(listed, 'learned, hidden or Focus item', 'learned, hidden or Focus items'));
  if (other) found.push(plural(other, 'other progress record', 'other progress records'));

  const count = (name: string): number => (stores[name] ?? []).length;
  if (count('learnPasses')) found.push(plural(count('learnPasses'), 'Learn pass', 'Learn passes'));
  if (count('flashcardSessions')) found.push(plural(count('flashcardSessions'), 'flashcard deck with a saved place', 'flashcard decks with a saved place'));
  if (count('userCollections')) found.push(plural(count('userCollections'), 'imported collection', 'imported collections'));
  else if (count('userEntries')) found.push(plural(count('userEntries'), 'imported entry', 'imported entries'));
  return found;
}

const LEGACY_LISTS = [...LIST_GROUPS.learned, ...LIST_GROUPS.hidden, ...LIST_GROUPS.focus];

/**
 * The learning data in the state record of the first version, as a list of short
 * descriptions (ENG-V3-R1A-RC1). An empty list means: no learning data. `null` means that
 * the record cannot be read, so nothing can be said about it.
 *
 * It is judged by value, as `learningDataIn` does. The first version writes its state as
 * soon as it is opened, with empty lists, so the mere presence of the record says nothing.
 * Its other members (the last screen, filters, page sizes) are preferences. Anything
 * unexpected in a learning member counts as data.
 */
export function legacyLearningDataIn(stateText: string | null): string[] | null {
  if (stateText === null) return [];
  let state: unknown;
  try {
    state = JSON.parse(stateText);
  } catch {
    return null;
  }
  if (!isPlainObject(state)) return null;

  const found: string[] = [];
  const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
  let listed = 0;
  let other = 0;
  for (const key of LEGACY_LISTS) {
    const value = state[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) listed += value.length;
    else other += 1;
  }
  const selected = state.selectedLearnPassId;
  if (selected !== undefined && selected !== 'default') other += 1;

  let passes = 0;
  if (Array.isArray(state.learnPasses)) passes = state.learnPasses.length;
  else if (state.learnPasses !== undefined) other += 1;
  let decks = 0;
  if (isPlainObject(state.flashcardSessions)) decks = Object.keys(state.flashcardSessions).length;
  else if (state.flashcardSessions !== undefined) other += 1;

  if (listed) found.push(plural(listed, 'learned, hidden or Focus item', 'learned, hidden or Focus items'));
  if (other) found.push(plural(other, 'other progress record', 'other progress records'));
  if (passes) found.push(plural(passes, 'Learn pass', 'Learn passes'));
  if (decks) found.push(plural(decks, 'flashcard deck with a saved place', 'flashcard decks with a saved place'));
  return found;
}

/** The number of records in the six learning stores of a section. */
export function recordCount(section: DatabaseSection): number {
  return STORE_NAMES.reduce((sum, name) => sum + section.stores[name].length, 0);
}
