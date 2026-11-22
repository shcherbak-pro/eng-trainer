export type WordExample = {
  en: string;
  ua?: string;
};

export type Phrase = {
  id: string;
  collectionId?: string;
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
  /** Optional. Only answers that a learning topic refers to need one (ENG-V2-03). */
  id?: string;
  topic: string;
  question: string;
  answer: string;
  translation: string;
  transcription?: string;
  commonAlternatives?: string[] | string;
  tag?: string;
  level?: string;
  /** A short English label shown with the answer, e.g. "Fictional practice example". */
  label?: string;
};

/** An English study text with its Ukrainian translation (`ua`, as in word examples). */
export type TopicText = {
  en: string;
  ua: string;
};

/**
 * One subsection (or situation) of a learning topic. Its practice rows are phrases,
 * named explicitly by ID; everything else is supporting material and never a card.
 */
export type TopicSection = {
  /** Stable slug, unique within the topic. The phrases of this subsection carry it as their `tag`. */
  id: string;
  title: string;
  /** Optional heading that groups consecutive subsections, e.g. "Mixed Conditionals". */
  group?: string;
  pattern?: string;
  use?: string;
  note?: string;
  questions?: TopicText[];
  structure?: string;
  /** Phrase IDs, in display order. */
  items: string[];
  /** ID of the model answer (a ready answer) for this subsection. */
  answerId?: string;
};

/**
 * Presentation of one learning topic (ENG-V2-03). The topic's practice cards are the
 * phrases whose category equals `title`, which is also the topic in the flashcard
 * topic selector. The record adds descriptions, rules and answers; it creates no cards.
 */
export type LearningTopic = {
  /** Stable slug, also used in the address: #topic/<id>. */
  id: string;
  title: string;
  /** The phraseCategory learning block that opens this topic. */
  blockId: string;
  description: string;
  /** A note shown with the description. */
  note?: string;
  /** A note shown after the subsections, under "Usage note". */
  usageNote?: string;
  /** Present when the subsections act as filter chips. */
  filter?: { label: string; all: string };
  sections: TopicSection[];
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
  collectionId?: string;
  sourcePhraseId?: string;
  term: string;
  category: string;
  section?: string;
  sequence?: number;
  level?: string;
  tag?: string;
  meaning: string;
  pronunciation: string;
  transcription?: string | null;
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
  collections?: { id: string; name: string }[];
  meta: MaterialsMeta;
  blocks: TrainingBlock[];
  phrases: Phrase[];
  patterns: Pattern[];
  answers: ReadyAnswer[];
  drills: string[];
  wordIndex: WordIndexItem[];
  irregularVerbs: IrregularVerb[];
  /** Optional collection (ENG-V2-03). Absent or empty means no learning topics. */
  topics?: LearningTopic[];
};
