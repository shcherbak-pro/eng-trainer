import type { LearningTopic, Phrase, ReadyAnswer, TopicSection } from '../../content/types';

/** Square brackets mark the parts of a template the learner replaces, e.g. "[name]" or "[A]". */
const PLACEHOLDER = /\[[^\]\n]+\]/;

export function hasPlaceholder(text: string): boolean {
  return PLACEHOLDER.test(text);
}

export type TopicSectionView = {
  section: TopicSection;
  /** The group heading shown before this subsection: set on the first visible subsection of a group. */
  groupHeading: string | null;
  /** Practice rows shown now, in the order the topic lists them. */
  rows: Phrase[];
  /** The model answer the subsection refers to, if any. */
  answer: ReadyAnswer | null;
};

export type TopicViewOptions = {
  /** IDs of the phrases that match the search, or null without a search. */
  matches: ReadonlySet<string> | null;
  /** The selected subsection chip; "" shows every subsection. */
  sectionId: string;
  hiddenPhraseIds: ReadonlySet<string>;
  showHidden: boolean;
};

/**
 * The subsections and practice rows a topic screen shows. Chips and search only choose
 * what is displayed: they never change progress, cards or topic membership. During a
 * search, subsections without a matching row are left out.
 */
export function topicSectionViews(
  topic: LearningTopic,
  phraseById: ReadonlyMap<string, Phrase>,
  answerById: ReadonlyMap<string, ReadyAnswer>,
  options: TopicViewOptions
): TopicSectionView[] {
  const selected = topic.sections.some((section) => section.id === options.sectionId) ? options.sectionId : '';
  const views: TopicSectionView[] = [];
  let previousGroup: string | undefined;

  for (const section of topic.sections) {
    if (selected && section.id !== selected) continue;
    const rows = section.items
      .map((id) => phraseById.get(id))
      .filter((phrase): phrase is Phrase => phrase !== undefined)
      .filter((phrase) => !options.matches || options.matches.has(phrase.id))
      .filter((phrase) => options.showHidden || !options.hiddenPhraseIds.has(phrase.id));
    if (options.matches && rows.length === 0) continue;

    views.push({
      section,
      groupHeading: section.group && section.group !== previousGroup ? section.group : null,
      rows,
      answer: section.answerId ? answerById.get(section.answerId) ?? null : null
    });
    previousGroup = section.group;
  }

  return views;
}

/** Every practice phrase the topic lists, in order. */
export function topicPhraseIds(topic: LearningTopic): string[] {
  return topic.sections.flatMap((section) => section.items);
}
