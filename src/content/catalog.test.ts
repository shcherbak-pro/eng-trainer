import { describe, expect, it } from 'vitest';
import realMaterials from '../../public/data/materials.json';
import { createCatalog } from './catalog';
import type { Materials } from './types';

const catalog = createCatalog(realMaterials as Materials);

function duplicates(ids: string[]): string[] {
  return ids.filter((id, index) => ids.indexOf(id) !== index);
}

describe('built-in content catalog', () => {
  it('gives every entry that progress can refer to a unique id', () => {
    const lists = { blocks: catalog.blocks, phrases: catalog.phrases, words: catalog.wordIndex, verbs: catalog.irregularVerbs };

    for (const [name, items] of Object.entries(lists)) {
      const ids = items.map((item) => item.id);
      expect(ids.every((id) => typeof id === 'string' && id.length > 0), `${name} have ids`).toBe(true);
      expect(duplicates(ids), `duplicate ${name} ids`).toEqual([]);
    }
  });

  it('exposes all built-in material', () => {
    const source = realMaterials as Materials;

    expect(catalog.phrases).toHaveLength(source.phrases.length);
    expect(catalog.wordIndex).toHaveLength(source.wordIndex.length);
    expect(catalog.irregularVerbs).toHaveLength(source.irregularVerbs.length);
    expect(catalog.patterns).toHaveLength(source.patterns.length);
    expect(catalog.answers).toHaveLength(source.answers.length);
    expect(catalog.drills).toHaveLength(source.drills.length);
    expect(catalog.blocks.length).toBeGreaterThan(0);
    expect(catalog.verbSets.length).toBeGreaterThan(0);
  });

  it('returns everything for an empty query', () => {
    expect(catalog.searchPhrases('')).toHaveLength(catalog.phrases.length);
    expect(catalog.searchWords('   ')).toHaveLength(catalog.wordIndex.length);
    expect(catalog.searchVerbs('')).toHaveLength(catalog.irregularVerbs.length);
    expect(catalog.searchBlocks('')).toHaveLength(catalog.blocks.length);
  });

  it('finds every phrase, word and verb by its own text, wherever it is in the catalog', () => {
    for (const phrase of catalog.phrases) {
      expect(catalog.searchPhrases(phrase.phrase.toUpperCase()), phrase.id).toContain(phrase);
    }
    for (const word of catalog.wordIndex) {
      expect(catalog.searchWords(word.term), word.id).toContain(word);
    }
    for (const verb of catalog.irregularVerbs) {
      expect(catalog.searchVerbs(verb.pastParticiple), verb.id).toContain(verb);
    }
  });

  it('searches translations, examples, categories and tags, not only the headword', () => {
    const phrase = catalog.phrases.find((item) => item.translation && item.category)!;
    const word = catalog.wordIndex.find((item) => item.examples.length > 0)!;
    const verb = catalog.irregularVerbs[catalog.irregularVerbs.length - 1];

    expect(catalog.searchPhrases(phrase.translation)).toContain(phrase);
    expect(catalog.searchPhrases(phrase.category)).toContain(phrase);
    expect(catalog.searchWords(word.examples[0].en)).toContain(word);
    expect(catalog.searchVerbs(verb.translation)).toContain(verb);
    expect(catalog.searchPhrases('no such text in the dataset zzz')).toEqual([]);
  });

  it('does not match a query across two different fields', () => {
    const local = createCatalog({
      ...(realMaterials as Materials),
      phrases: [{ id: 'p1', category: 'Work', phrase: 'dig into', translation: 'заглибитися' }]
    });

    expect(local.searchPhrases('into заглиб')).toEqual([]);
    expect(local.searchPhrases('dig into')).toHaveLength(1);
  });
});
