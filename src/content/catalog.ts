import { uniqueSorted } from '../shared/text';
import { createSearch } from './search';
import type {
  IrregularVerb,
  LearningTopic,
  Materials,
  MaterialsMeta,
  Pattern,
  Phrase,
  ReadyAnswer,
  TrainingBlock,
  WordIndexItem
} from './types';

export type VerbSet = {
  id: string;
  /** The learning block that defines the set (its description is the set description). */
  blockId: string;
  title: string;
  description?: string;
  count: number;
};

/**
 * The one way the application reads learning material.
 *
 * Screens never fetch or parse content themselves: the shell loads a catalog
 * once and passes it down. Entries keep the ids of the dataset (`phrase-001`,
 * `word-phrase-001`, `iv-001-be`, block ids), and saved progress refers to
 * entries by those ids only, never by position.
 */
export interface ContentCatalog {
  readonly collections: { id: string; name: string }[];
  readonly meta: MaterialsMeta;
  /** Learning blocks that have content, ordered by priority. */
  readonly blocks: TrainingBlock[];
  readonly phrases: Phrase[];
  readonly wordIndex: WordIndexItem[];
  readonly irregularVerbs: IrregularVerb[];
  readonly patterns: Pattern[];
  readonly answers: ReadyAnswer[];
  readonly drills: string[];
  /** Learning topics (ENG-V2-03), in pack order. Empty when the content has none. */
  readonly topics: LearningTopic[];
  readonly phraseCategories: string[];
  readonly wordCategories: string[];
  /** Irregular-verb sets that have at least one verb, in dataset order. */
  readonly verbSets: VerbSet[];
  /** Searches cover the whole catalog. An empty query returns everything. */
  searchBlocks(query: string): TrainingBlock[];
  searchPhrases(query: string): Phrase[];
  searchWords(query: string): WordIndexItem[];
  searchVerbs(query: string): IrregularVerb[];
}

function list<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function alternativesText(value?: string[] | string): string | undefined {
  return Array.isArray(value) ? value.join(' ') : value;
}

function blockHasContent(block: TrainingBlock, data: Materials): boolean {
  if (block.type === 'phraseCategory') return data.phrases.some((item) => item.category === block.category);
  if (block.type === 'wordIndex') return data.wordIndex.length > 0;
  if (block.type === 'reversePractice') return data.wordIndex.length > 0 || data.phrases.length > 0;
  if (block.type === 'irregularVerbs') {
    return block.verbSet
      ? data.irregularVerbs.some((item) => item.verbSet === block.verbSet)
      : data.irregularVerbs.length > 0;
  }
  if (block.type === 'patterns') return data.patterns.length > 0;
  if (block.type === 'answers') return data.answers.length > 0;
  if (block.type === 'practice') return data.drills.length > 0;
  return false;
}

export function createCatalog(source: Materials): ContentCatalog {
  const data: Materials = {
    meta: source.meta,
    blocks: list(source.blocks),
    phrases: list(source.phrases),
    patterns: list(source.patterns),
    answers: list(source.answers),
    drills: list(source.drills),
    wordIndex: list(source.wordIndex),
    irregularVerbs: list(source.irregularVerbs),
    topics: list(source.topics)
  };

  const blocks = data.blocks
    .filter((block) => blockHasContent(block, data))
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  const verbSets = data.blocks
    .filter((block) => block.type === 'irregularVerbs' && block.verbSet)
    .map((block) => ({
      id: block.verbSet as string,
      blockId: block.id,
      title: block.title,
      description: block.description,
      count: data.irregularVerbs.filter((item) => item.verbSet === block.verbSet).length
    }))
    .filter((set) => set.count > 0);

  return {
    collections: source.collections ?? [],
    meta: data.meta,
    blocks,
    phrases: data.phrases,
    wordIndex: data.wordIndex,
    irregularVerbs: data.irregularVerbs,
    patterns: data.patterns,
    answers: data.answers,
    drills: data.drills,
    topics: data.topics ?? [],
    phraseCategories: uniqueSorted(data.phrases.map((item) => item.category)),
    wordCategories: uniqueSorted(data.wordIndex.map((item) => item.category)),
    verbSets,
    searchBlocks: createSearch(blocks, (block) => [block.title, block.description, block.type, block.category, block.tag]),
    searchPhrases: createSearch(data.phrases, (item) => [
      item.phrase,
      item.example,
      ...list(item.examples).flatMap((example) => [example.en, example.ua ?? '']),
      item.translation,
      item.transcription,
      alternativesText(item.commonAlternatives),
      item.category,
      item.section,
      item.tag
    ]),
    searchWords: createSearch(data.wordIndex, (item) => [
      item.term,
      item.meaning,
      item.pronunciation,
      item.transcription,
      alternativesText(item.commonAlternatives),
      ...list(item.examples).flatMap((example) => [example.en, example.ua ?? '']),
      item.category,
      item.section,
      item.tag
    ]),
    searchVerbs: createSearch(data.irregularVerbs, (item) => [
      item.base,
      item.pastSimple,
      item.pastParticiple,
      item.translation,
      item.transcription,
      alternativesText(item.commonAlternatives),
      item.group
    ])
  };
}
