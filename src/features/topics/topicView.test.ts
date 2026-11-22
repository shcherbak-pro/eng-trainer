import { describe, expect, it } from 'vitest';
import { createCatalog } from '../../content/catalog';
import type { LearningTopic, Materials } from '../../content/types';
import { realMaterials } from '../../test/content';
import { hasPlaceholder, topicPhraseIds, topicSectionViews, type TopicViewOptions } from './topicView';

const catalog = createCatalog(realMaterials as Materials);
const phraseById = new Map(catalog.phrases.map((phrase) => [phrase.id, phrase]));
const answerById = new Map(catalog.answers.filter((answer) => answer.id).map((answer) => [answer.id as string, answer]));
const topic = (id: string): LearningTopic => catalog.topics.find((item) => item.id === id)!;
const none: TopicViewOptions = { matches: null, sectionId: '', hiddenPhraseIds: new Set(), showHidden: false };
const view = (id: string, options: Partial<TopicViewOptions> = {}) => topicSectionViews(topic(id), phraseById, answerById, { ...none, ...options });
const matches = (query: string) => new Set(catalog.searchPhrases(query).map((phrase) => phrase.id));

describe('topic screen view model', () => {
  it('shows every subsection and practice row in topic order without filters', () => {
    const smallTalk = view('small-talk');
    expect(smallTalk.map((item) => item.section.id)).toEqual(topic('small-talk').sections.map((section) => section.id));
    expect(smallTalk.flatMap((item) => item.rows.map((row) => row.id))).toEqual(topicPhraseIds(topic('small-talk')));
  });

  it('shows one situation for a selected chip, and everything for "All" or an unknown chip', () => {
    const coffee = view('small-talk', { sectionId: 'coffee-and-lunch' });
    expect(coffee.map((item) => item.section.title)).toEqual(['Coffee and lunch breaks']);
    expect(coffee[0].rows).toHaveLength(6);
    expect(view('small-talk', { sectionId: 'no-such-situation' })).toHaveLength(6);
  });

  it('combines a situation chip with the shared search, and leaves out subsections without a match', () => {
    const search = matches('have you');
    const all = view('small-talk', { matches: search });
    expect(all.map((item) => item.section.id)).toEqual(['before-a-meeting', 'free-time-and-weekends', 'traveling']);
    expect(all.flatMap((item) => item.rows.map((row) => row.phrase))).toEqual([
      'Have you had a busy morning?',
      'Have you watched anything good lately?',
      'Have you read any good books recently?',
      'Have you been here before?',
      'Have you had a chance to explore the city?'
    ]);
    const chip = view('small-talk', { matches: search, sectionId: 'traveling' });
    expect(chip.flatMap((item) => item.rows.map((row) => row.phrase))).toEqual(['Have you been here before?', 'Have you had a chance to explore the city?']);
    // The shared search also matches the subsection title, as on the Phrases screen.
    expect(view('small-talk', { matches: matches('weekends') }).map((item) => [item.section.id, item.rows.length])).toEqual([['free-time-and-weekends', 6]]);
    expect(view('small-talk', { matches: matches('zzz no match'), sectionId: '' })).toEqual([]);
  });

  it('leaves hidden rows out unless hidden items are shown, keeping the subsection itself', () => {
    const [first, second] = topic('conditionals').sections[0].items;
    const hidden = new Set([first, second]);
    const views = view('conditionals', { hiddenPhraseIds: hidden });
    expect(views).toHaveLength(6);
    expect(views[0].rows.map((row) => row.id)).toEqual([topic('conditionals').sections[0].items[2]]);
    expect(view('conditionals', { hiddenPhraseIds: hidden, showHidden: true })[0].rows).toHaveLength(3);
  });

  it('puts a group heading on the first visible subsection of the group only', () => {
    expect(view('conditionals').map((item) => item.groupHeading)).toEqual([null, null, null, null, 'Mixed Conditionals', null]);
    const second = view('conditionals', { matches: matches('yesterday') });
    expect(second.map((item) => [item.section.id, item.groupHeading])).toEqual([['mixed-general-to-past', 'Mixed Conditionals']]);
  });

  it('resolves each interview subsection to its model answer', () => {
    expect(view('interview-english').map((item) => item.answer?.id)).toEqual(topic('interview-english').sections.map((section) => section.answerId));
    expect(view('conditionals').every((item) => item.answer === null)).toBe(true);
  });

  it('recognizes bracket placeholders as literal teaching text', () => {
    expect(hasPlaceholder("Hi, I'm [name]. It's nice to meet you.")).toBe(true);
    expect(hasPlaceholder('Both [A] and [B] help with [goal], but they solve different problems.')).toBe(true);
    expect(hasPlaceholder('If the tests pass, we\'ll deploy the update.')).toBe(false);
    expect(hasPlaceholder('[]')).toBe(false);
  });
});
