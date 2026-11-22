import type { TrainingBlock } from '../content/types';
import type { IconName } from '../shared/ui/icons';
import { DEFAULT_LEARN_PASS_ID, type LearnPass } from '../state/progress';

/**
 * Screens of the application. The id is also the `#hash` in the address and the
 * saved "last page" preference, so released ids never change.
 */
export const PAGE_LABELS: Record<string, string> = {
  index: 'Home',
  phrases: 'Phrases',
  wordIndex: 'Words',
  irregularVerbs: 'Verbs',
  patterns: 'Patterns',
  answers: 'Answers',
  flashcards: 'Flashcards',
  reverse: 'Reverse practice',
  practice: 'Speaking prompts',
  favorites: 'Focus list',
  collections: 'Collections',
  settings: 'Settings'
};

export type DestinationId = 'home' | 'library' | 'practice' | 'focus' | 'more';

export type Destination = {
  id: DestinationId;
  label: string;
  icon: IconName;
  /** Screens that belong to this destination, in display order. */
  pages: string[];
};

/**
 * The five top-level destinations. "Practice" groups Flashcards, Reverse
 * practice and the speaking prompts (#practice, labelled "Speaking prompts").
 */
export const DESTINATIONS: Destination[] = [
  { id: 'home', label: 'Home', icon: 'home', pages: ['index'] },
  { id: 'library', label: 'Library', icon: 'library', pages: ['phrases', 'wordIndex', 'irregularVerbs', 'patterns', 'answers'] },
  { id: 'practice', label: 'Practice', icon: 'practice', pages: ['flashcards', 'reverse', 'practice'] },
  { id: 'focus', label: 'Focus', icon: 'star', pages: ['favorites'] },
  { id: 'more', label: 'More', icon: 'menu', pages: ['collections', 'settings'] }
];

export function destinationOf(page: string): Destination {
  return DESTINATIONS.find((destination) => destination.pages.includes(page)) ?? DESTINATIONS[0];
}

/** Screens of a destination that the active Learn Pass makes available. */
export function destinationPages(destination: Destination, availablePages: string[]): string[] {
  return destination.pages.filter((page) => availablePages.includes(page));
}

const PAGE_BY_BLOCK_TYPE: Partial<Record<TrainingBlock['type'], string>> = {
  phraseCategory: 'phrases',
  wordIndex: 'wordIndex',
  reversePractice: 'reverse',
  irregularVerbs: 'irregularVerbs',
  patterns: 'patterns',
  answers: 'answers',
  practice: 'practice'
};

/** The blocks of the active Learn Pass. The default pass shows every block. */
export function blocksForLearnPass(
  allBlocks: TrainingBlock[],
  selectedLearnPassId: string,
  learnPasses: LearnPass[]
): TrainingBlock[] {
  if (selectedLearnPassId === DEFAULT_LEARN_PASS_ID) return allBlocks;

  const activePass = learnPasses.find((pass) => pass.id === selectedLearnPassId);
  if (!activePass) return allBlocks;

  const allowed = new Set(activePass.blockIds);
  return allBlocks.filter((block) => allowed.has(block.id));
}

/** The screens that have something to show for the given blocks. */
export function availablePagesFor(blocks: TrainingBlock[]): string[] {
  const pages = ['index'];
  const types = new Set(blocks.map((block) => block.type));

  if (types.has('phraseCategory')) pages.push('phrases');
  if (types.has('wordIndex')) pages.push('wordIndex');
  if (types.has('phraseCategory') || types.has('wordIndex')) pages.push('flashcards');
  if (types.has('reversePractice')) pages.push('reverse');
  if (types.has('irregularVerbs')) pages.push('irregularVerbs');
  if (types.has('patterns')) pages.push('patterns');
  if (types.has('answers')) pages.push('answers');
  if (types.has('practice')) pages.push('practice');

  pages.push('favorites', 'collections', 'settings');
  return pages;
}

export function pageForBlock(block: TrainingBlock): string {
  return PAGE_BY_BLOCK_TYPE[block.type] ?? 'index';
}

export function pageFromHash(): string {
  return window.location.hash.replace('#', '');
}
