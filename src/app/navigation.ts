import type { LearningTopic, TrainingBlock } from '../content/types';
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

/**
 * The experimental product has one more screen (ENG-V3-01). The condition is a compile-time
 * constant, so the stable build contains neither this block nor the screen's name.
 */
if (__ENG_PRONUNCIATION__) {
  PAGE_LABELS.pronunciation = 'Pronunciation';
  DESTINATIONS[2].pages.push('pronunciation');
}

/**
 * Learning topics (ENG-V2-03) have one shared screen with the address #topic/<topic id>.
 * Topic ids are slugs, so the address needs no escaping. Released page ids never contain
 * a slash, so the two kinds of address cannot collide.
 */
export const TOPIC_ROUTE_PREFIX = 'topic/';

export function topicRoute(topicId: string): string {
  return `${TOPIC_ROUTE_PREFIX}${topicId}`;
}

/** The topic id of a topic address, or null for every other page. */
export function topicIdOf(page: string): string | null {
  return page.startsWith(TOPIC_ROUTE_PREFIX) ? page.slice(TOPIC_ROUTE_PREFIX.length) : null;
}

/** A topic screen belongs to the Library: topics are library material, not a sixth destination. */
export function destinationOf(page: string): Destination {
  if (topicIdOf(page) !== null) return DESTINATIONS[1];
  return DESTINATIONS.find((destination) => destination.pages.includes(page)) ?? DESTINATIONS[0];
}

/** The page heading: the screen's label, or the topic title on a topic screen. */
export function pageTitle(page: string, topics: LearningTopic[] = []): string {
  const topicId = topicIdOf(page);
  if (topicId !== null) return topics.find((topic) => topic.id === topicId)?.title ?? 'Topic';
  return PAGE_LABELS[page] ?? 'English Trainer';
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

/**
 * The screens that have something to show for the given blocks. A topic screen is
 * available when the active Learn Pass contains the topic's learning block.
 */
export function availablePagesFor(blocks: TrainingBlock[], topics: LearningTopic[] = []): string[] {
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

  const blockIds = new Set(blocks.map((block) => block.id));
  for (const topic of topics) if (blockIds.has(topic.blockId)) pages.push(topicRoute(topic.id));

  if (__ENG_PRONUNCIATION__) pages.push('pronunciation');
  pages.push('favorites', 'collections', 'settings');
  return pages;
}

/** A topic's learning block opens the topic screen; every other block keeps its released screen. */
export function pageForBlock(block: TrainingBlock, topics: LearningTopic[] = []): string {
  const topic = topics.find((item) => item.blockId === block.id);
  if (topic) return topicRoute(topic.id);
  return PAGE_BY_BLOCK_TYPE[block.type] ?? 'index';
}

export function pageFromHash(): string {
  return window.location.hash.replace('#', '');
}
