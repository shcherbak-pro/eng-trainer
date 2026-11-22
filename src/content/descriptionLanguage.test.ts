import { describe, expect, it } from 'vitest';
import { realMaterials } from '../test/content';
import { blockDescriptionLang, CLASSIFIED_BLOCK_IDS } from './descriptionLanguage';

const CYRILLIC = /[Ѐ-ӿ]/;

describe('language of built-in block descriptions (RC1, F5)', () => {
  it('classifies every built-in learning block, and nothing else', () => {
    const ids = realMaterials.blocks.map((block) => block.id);
    expect([...CLASSIFIED_BLOCK_IDS].sort()).toEqual([...ids].sort());
  });

  it('agrees with the text that was classified: English descriptions are English, Ukrainian ones Ukrainian', () => {
    // A consistency check of the hand-made table, not the rule used at run time.
    for (const block of realMaterials.blocks) {
      const lang = blockDescriptionLang(block.id);
      if (lang === 'en') expect(block.description, block.id).not.toMatch(CYRILLIC);
      else expect(block.description, block.id).toMatch(CYRILLIC);
    }
    const added = ['topic-conditionals', 'topic-small-talk', 'topic-interview-english'];
    const released = realMaterials.blocks.filter((block) => !added.includes(block.id));
    expect(released).toHaveLength(39);
    expect(released.filter((block) => blockDescriptionLang(block.id) === 'en')).toHaveLength(23);
    expect(added.map(blockDescriptionLang)).toEqual(['en', 'en', 'en']);
    expect(blockDescriptionLang('irregular-verbs-100')).toBe('en');
    expect(blockDescriptionLang('start-answer')).toBe('uk');
  });

  it('leaves an unknown block unclassified instead of guessing', () => {
    expect(blockDescriptionLang('a-block-added-later')).toBe('');
  });
});
