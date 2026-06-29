export type Phrase = {
  id: string;
  category: string;
  phrase: string;
  example: string;
  translation: string;
  level?: string;
  tag?: string;
};

export type Pattern = {
  title: string;
  formula: string;
  use: string;
  example: string;
  translation: string;
};

export type ReadyAnswer = {
  topic: string;
  question: string;
  answer: string;
  translation: string;
};

export type TrainingBlock = {
  id: string;
  title: string;
  category?: string;
  type: 'phraseCategory' | 'patterns' | 'answers' | 'practice' | 'wordIndex' | 'reversePractice' | 'irregularVerbs';
  description: string;
  icon?: string;
  tag?: string;
  itemsCount?: number;
  priority?: number;
};

export type WordExample = {
  en: string;
  ua: string;
};

export type WordIndexItem = {
  id: string;
  sourcePhraseId?: string;
  term: string;
  category: string;
  level?: string;
  tag?: string;
  meaning: string;
  pronunciation: string;
  examples: WordExample[];
};

export type IrregularVerb = {
  id: string;
  group: string;
  base: string;
  pastSimple: string;
  pastParticiple: string;
  translation: string;
  transcription: string;
  examples: WordExample[];
};

export type MaterialsMeta = {
  title: string;
  subtitle: string;
  version: string;
  language: string;
  updated: string;
  goal: string;
  updatedFeature?: string;
};

export type Materials = {
  meta: MaterialsMeta;
  blocks: TrainingBlock[];
  phrases: Phrase[];
  patterns: Pattern[];
  answers: ReadyAnswer[];
  drills: string[];
  wordIndex: WordIndexItem[];
  irregularVerbs: IrregularVerb[];
};

export type LearnPass = {
  id: string;
  name: string;
  description?: string;
  blockIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type LearnPassDraft = {
  id?: string;
  name: string;
  description?: string;
  blockIds: string[];
};

export type FocusKind = 'block' | 'phrase' | 'word' | 'irregular';
export type HideKind = 'phrase' | 'word' | 'irregular';
