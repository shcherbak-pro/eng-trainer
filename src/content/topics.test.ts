import { describe, expect, it } from 'vitest';
import editorialSource from '../test/fixtures/eng-v2-03-editorial.json';
import { packs, realMaterials } from '../test/content';
import { ENG_V2_03_ADDITIONS, legacyProjection } from '../test/legacyProjection.js';
import { pageForBlock, topicRoute } from '../app/navigation';
import { buildFlashcards, filterDeck, getTopics } from '../features/flashcards/flashcards';
import { createCatalog } from './catalog';
import { blockDescriptionLang } from './descriptionLanguage';
import type { LearningTopic, Materials, Phrase } from './types';

/**
 * ENG-V2-03 content: the three learning topics against the editorial source (section 8 of
 * the task, transcribed into the fixture), plus preservation of every released search result.
 */
type EditorialItem = { sourceId: string; catalogId: string; en: string; uk: string };
type EditorialGroup = {
  heading: string;
  key?: string;
  use?: string;
  pattern?: string;
  structure?: string;
  note?: string;
  questions?: { en: string; uk: string }[];
  modelAnswer?: { label: string | null; en: string; uk: string };
  items: EditorialItem[];
};
type EditorialTopic = { label: string; pack: string; description: string; situations?: { label: string; key: string }[]; groups: EditorialGroup[]; notes: { kind: string; text: string }[] };
const editorial = editorialSource as { topics: EditorialTopic[] };

const catalog = createCatalog(realMaterials as Materials);
const legacy = legacyProjection(realMaterials as Materials, packs);
const legacyCatalog = createCatalog(legacy);
const topics = catalog.topics;
const phraseById = new Map(catalog.phrases.map((phrase) => [phrase.id, phrase]));
const CYRILLIC = /[Ѐ-ӿ]/;
const PREFIX: Record<string, string> = { conditionals: 'cond-', 'small-talk': 'small-', 'interview-english': 'interview-' };

function topic(id: string): LearningTopic {
  const match = topics.find((item) => item.id === id);
  if (!match) throw new Error(`No topic ${id}`);
  return match;
}

function rows(item: LearningTopic): Phrase[] {
  return item.sections.flatMap((section) => section.items.map((id) => phraseById.get(id)!));
}

const newPhrases = topics.flatMap(rows);

describe('learning topic content (ENG-V2-03)', () => {
  it('implements every editorial item exactly, with the documented ID mapping, in source order', () => {
    expect(editorial.topics.map((item) => item.label)).toEqual(['Conditionals', 'Small Talk', 'Interview English']);
    for (const source of editorial.topics) {
      const item = topic(source.pack);
      expect(item.title).toBe(source.label);
      expect(item.description).toBe(source.description);
      expect(item.sections).toHaveLength(source.groups.length);
      source.groups.forEach((group, index) => {
        const section = item.sections[index];
        const heading = section.group ? `${section.group} — ${section.title}` : section.title;
        expect(heading).toBe(group.heading);
        expect(section.items).toEqual(group.items.map((entry) => entry.catalogId));
        for (const entry of group.items) {
          // The catalog ID is the pack ID plus the editorial ID without its short prefix.
          expect(entry.catalogId).toBe(`${source.pack}-${entry.sourceId.slice(PREFIX[source.pack].length)}`);
          const phrase = phraseById.get(entry.catalogId)!;
          expect(phrase, entry.sourceId).toBeDefined();
          expect(phrase).toEqual({ id: entry.catalogId, category: source.label, phrase: entry.en, translation: entry.uk, section: group.heading, tag: section.id });
        }
      });
    }
  });

  it('has the agreed counts: 18 conditional examples, 36 Small Talk phrases and 18 interview frames', () => {
    const counts = (id: string) => topic(id).sections.map((section) => section.items.length);
    expect(counts('conditionals')).toEqual([3, 3, 3, 3, 3, 3]);
    expect(counts('small-talk')).toEqual([6, 6, 6, 6, 6, 6]);
    expect(counts('interview-english')).toEqual([3, 3, 3, 3, 3, 3]);
    expect(newPhrases).toHaveLength(72);
    expect(topic('conditionals').sections.filter((section) => section.group === 'Mixed Conditionals')).toHaveLength(2);
    for (const section of topic('interview-english').sections) {
      expect(section.questions, section.id).toHaveLength(2);
      expect(section.structure, section.id).toBeTruthy();
      expect(section.answerId, section.id).toBeTruthy();
    }
  });

  it('keeps the supporting material: rules, notes, situations, questions, structures and model answers', () => {
    const [conditionals, smallTalk, interview] = editorial.topics;
    conditionals.groups.forEach((group, index) => {
      expect(topic('conditionals').sections[index]).toMatchObject({ use: group.use, pattern: group.pattern });
    });
    expect(topic('conditionals').usageNote).toBe(conditionals.notes.find((note) => note.kind === 'usage')!.text);

    expect(topic('small-talk').filter).toEqual({ label: 'Situations', all: 'All situations' });
    expect(topic('small-talk').sections.map((section) => [section.title, section.id])).toEqual(smallTalk.situations!.map((item) => [item.label, item.key]));
    // Documented editorial change: quotation marks around the study phrase in the note.
    expect(topic('small-talk').sections[1].note).toBe('Use “Shall we get started?” to move from small talk into the meeting.');
    expect(smallTalk.groups[1].note).toBe('Use Shall we get started? to move from small talk into the meeting.');

    expect(topic('interview-english').note).toBe(interview.notes.find((note) => note.kind === 'shared')!.text);
    interview.groups.forEach((group, index) => {
      const section = topic('interview-english').sections[index];
      expect(section.id).toBe(group.key);
      expect(section.structure).toBe(group.structure);
      expect(section.questions).toEqual(group.questions!.map((question) => ({ en: question.en, ua: question.uk })));
      const answer = catalog.answers.find((item) => item.id === section.answerId)!;
      expect(answer).toMatchObject({ topic: 'Interview English', question: group.questions![0].en, answer: group.modelAnswer!.en, translation: group.modelAnswer!.uk, tag: group.heading });
      const label = group.modelAnswer!.label;
      expect(answer.label).toBe(label ? label.charAt(0).toUpperCase() + label.slice(1) : undefined);
    });
    expect(catalog.answers.filter((item) => item.label).map((item) => item.label)).toEqual(['Hypothetical server-backed application', 'Fictional practice example']);
  });

  it('uses English for every label, rule and note, and Ukrainian for every translation', () => {
    for (const item of topics) {
      const english = [item.title, item.description, item.note, item.usageNote, item.filter?.label, item.filter?.all,
        ...item.sections.flatMap((section) => [section.title, section.group, section.use, section.pattern, section.note, section.structure, ...(section.questions ?? []).map((question) => question.en)])];
      for (const value of english.filter(Boolean)) expect(value, item.id).not.toMatch(CYRILLIC);
      for (const question of item.sections.flatMap((section) => section.questions ?? [])) expect(question.ua).toMatch(CYRILLIC);
    }
    for (const phrase of newPhrases) {
      expect(phrase.phrase, phrase.id).not.toMatch(CYRILLIC);
      expect(phrase.translation, phrase.id).toMatch(CYRILLIC);
    }
    for (const answer of catalog.answers.filter((item) => item.id)) {
      expect(answer.answer).not.toMatch(CYRILLIC);
      expect(answer.translation).toMatch(CYRILLIC);
    }
  });

  it('gives every practice item a stable, namespaced, unique ID; no released ID changes and no text is merged', () => {
    const ids = newPhrases.map((phrase) => phrase.id);
    expect(new Set(ids).size).toBe(72);
    for (const id of ids) expect(id).toMatch(/^(conditionals|small-talk|interview-english)-[a-z]+(?:-[a-z]+)*-\d{2}$/);
    const legacyIds = new Set([...legacy.phrases, ...legacy.wordIndex, ...legacy.irregularVerbs, ...legacy.blocks].map((item) => item.id));
    expect(ids.filter((id) => legacyIds.has(id))).toEqual([]);
    // No editorial item is an exact copy of released vocabulary, so nothing is reused by ID.
    // Near matches (for example "The main difference is that …") stay separate entries.
    const releasedTexts = new Set([...legacy.phrases.map((item) => item.phrase), ...legacy.wordIndex.map((item) => item.term)]);
    expect(newPhrases.filter((phrase) => releasedTexts.has(phrase.phrase)).map((phrase) => phrase.id)).toEqual([]);
    // One supporting question equals a released speaking prompt; both stay as they are, and neither is a card.
    expect(legacy.drills).toContain('Tell me about a time you solved a difficult problem.');
    expect(topic('interview-english').sections[5].questions![0].en).toBe('Tell me about a time you solved a difficult problem.');
  });

  it('makes only the 72 practice items learnable: one card each, with the phrase ID', () => {
    const cards = buildFlashcards(catalog);
    const legacyCards = buildFlashcards(legacyCatalog);
    expect(cards).toHaveLength(legacyCards.length + 72);
    const byId = new Map(cards.map((card) => [card.id, card]));
    for (const phrase of newPhrases) {
      expect(byId.get(phrase.id)).toMatchObject({ id: phrase.id, phraseId: phrase.id, text: phrase.phrase, translation: phrase.translation, topics: [phrase.category], wordIds: [] });
    }
    // Questions, rules and model answers are supporting material, never cards.
    const supporting = new Set(topics.flatMap((item) => item.sections.flatMap((section) => [...(section.questions ?? []).map((question) => question.en), section.pattern, section.structure])));
    const answerTexts = new Set(catalog.answers.filter((item) => item.id).map((item) => item.answer));
    expect(cards.filter((card) => supporting.has(card.text) || answerTexts.has(card.text))).toEqual([]);
    expect(catalog.wordIndex).toHaveLength(legacy.wordIndex.length);
  });

  it('adds the three topics to the flashcard topic selector; subsections and situations are not topics', () => {
    const cards = buildFlashcards(catalog);
    const names = getTopics(cards);
    expect(names).toEqual(expect.arrayContaining(['Conditionals', 'Small Talk', 'Interview English']));
    expect(names).toHaveLength(getTopics(buildFlashcards(legacyCatalog)).length + 3);
    for (const section of topics.flatMap((item) => item.sections)) expect(names).not.toContain(section.title);
    for (const item of topics) {
      expect(filterDeck(cards, 'topic', item.title).map((card) => card.id)).toEqual(rows(item).map((phrase) => phrase.id));
    }
  });

  it('opens each topic from its own phrase-category block with an English description', () => {
    for (const item of topics) {
      const block = catalog.blocks.find((entry) => entry.id === item.blockId)!;
      expect(block).toMatchObject({ type: 'phraseCategory', category: item.title, title: item.title, description: item.description, itemsCount: rows(item).length });
      expect(blockDescriptionLang(block.id)).toBe('en');
      expect(pageForBlock(block, topics)).toBe(topicRoute(item.id));
    }
    expect(topics.map((item) => item.blockId)).toEqual([...ENG_V2_03_ADDITIONS.blocks]);
    // Every other block keeps its released screen.
    for (const block of legacy.blocks) expect(pageForBlock(block, topics)).toBe(pageForBlock(block));
  });

  it('finds new items through the shared phrase search by English, Ukrainian, topic and situation', () => {
    for (const phrase of newPhrases) {
      expect(catalog.searchPhrases(phrase.phrase).map((item) => item.id), phrase.id).toContain(phrase.id);
      expect(catalog.searchPhrases(phrase.translation).map((item) => item.id), phrase.id).toContain(phrase.id);
    }
    expect(catalog.searchPhrases('Small Talk').filter((item) => item.category === 'Small Talk')).toHaveLength(36);
    expect(catalog.searchPhrases('coffee-and-lunch').map((item) => item.id)).toEqual(topic('small-talk').sections[2].items);
  });

  it('keeps every released search result and its order when results are projected onto released IDs', () => {
    const legacyIds = new Set(legacy.phrases.map((item) => item.id));
    const queries = new Set(['', 'if', 'meeting', 'time', 'weekend', 'coffee', 'travel', 'interview', 'difference', 'example', 'api', 'час', 'роботи', 'would', "i'll",
      ...newPhrases.map((phrase) => phrase.phrase), ...legacy.phrases.slice(0, 120).map((phrase) => phrase.phrase)]);
    for (const query of queries) {
      const projected = catalog.searchPhrases(query).map((item) => item.id).filter((id) => legacyIds.has(id));
      expect(projected, query).toEqual(legacyCatalog.searchPhrases(query).map((item) => item.id));
    }
    // The other searches are untouched: no word, verb or released block was added.
    for (const query of ['', 'be', 'meeting', 'AI']) {
      expect(catalog.searchWords(query)).toEqual(legacyCatalog.searchWords(query));
      expect(catalog.searchVerbs(query)).toEqual(legacyCatalog.searchVerbs(query));
      expect(catalog.searchBlocks(query).filter((block) => !ENG_V2_03_ADDITIONS.blocks.includes(block.id))).toEqual(legacyCatalog.searchBlocks(query));
    }
  });
});
