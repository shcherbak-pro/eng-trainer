import type { TrainingBlock } from '../content/types';
import { DEFAULT_LEARN_PASS_ID, type LearnPass } from '../state/progress';

/** Screens of the application. The id is also the `#hash` in the address. */
export const PAGE_LABELS: Record<string, string> = {
  index: 'Index',
  phrases: 'Phrases',
  wordIndex: 'Words',
  flashcards: 'Flashcards',
  reverse: 'Reverse',
  irregularVerbs: 'Verbs',
  patterns: 'Patterns',
  answers: 'Answers',
  practice: 'Practice',
  favorites: 'Focus'
};

/** Screens shown in the bottom navigation on small screens. */
export const MOBILE_PAGES = ['index', 'phrases', 'wordIndex', 'flashcards', 'reverse', 'irregularVerbs', 'favorites'];

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

  pages.push('favorites');
  return pages;
}

export function pageForBlock(block: TrainingBlock): string {
  return PAGE_BY_BLOCK_TYPE[block.type] ?? 'index';
}

export function pageFromHash(): string {
  return window.location.hash.replace('#', '');
}
