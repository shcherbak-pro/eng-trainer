export type WordExample = {
  en: string;
  ua?: string;
};

export type Phrase = {
  id: string;
  category: string;
  phrase: string;
  example?: string;
  examples?: WordExample[];
  translation: string;
  transcription?: string;
  commonAlternatives?: string[] | string;
  section?: string;
  sequence?: number;
  level?: string;
  tag?: string;
};

export type Pattern = {
  id?: string;
  title: string;
  formula: string;
  use: string;
  example: string;
  translation: string;
  transcription?: string;
  commonAlternatives?: string[] | string;
  tag?: string;
  level?: string;
};

export type ReadyAnswer = {
  topic: string;
  question: string;
  answer: string;
  translation: string;
  transcription?: string;
  commonAlternatives?: string[] | string;
  tag?: string;
  level?: string;
};

export type TrainingBlock = {
  id: string;
  title: string;
  category?: string;
  type: 'phraseCategory' | 'patterns' | 'answers' | 'practice' | 'wordIndex' | 'reversePractice' | 'irregularVerbs';
  verbSet?: string;
  description: string;
  icon?: string;
  tag?: string;
  itemsCount?: number;
  priority?: number;
};

export type WordIndexItem = {
  id: string;
  sourcePhraseId?: string;
  term: string;
  category: string;
  section?: string;
  sequence?: number;
  level?: string;
  tag?: string;
  meaning: string;
  pronunciation: string;
  transcription?: string;
  commonAlternatives?: string[] | string;
  examples: WordExample[];
};

export type IrregularVerb = {
  id: string;
  verbSet?: string;
  group: string;
  base: string;
  pastSimple: string;
  pastParticiple: string;
  translation: string;
  transcription: string;
  commonAlternatives?: string[] | string;
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
