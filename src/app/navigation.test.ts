import { describe, expect, it } from 'vitest';
import { availablePagesFor, DESTINATIONS, destinationOf, destinationPages, PAGE_LABELS, pageForBlock, pageTitle, topicIdOf, topicRoute } from './navigation';
import type { LearningTopic, TrainingBlock } from '../content/types';

/** Every hash route that ENG-V2-02B published. Saved "last page" values use the same ids. */
const RELEASED_ROUTES = ['index', 'phrases', 'wordIndex', 'flashcards', 'reverse', 'irregularVerbs', 'patterns', 'answers', 'practice', 'favorites', 'collections'];

const block = (type: TrainingBlock['type']): TrainingBlock => ({ id: type, title: type, type, description: '' });

describe('route mapping to the five destinations', () => {
  it('keeps every released hash route, adds Settings, and places each screen in exactly one destination', () => {
    expect(DESTINATIONS.map((destination) => destination.label)).toEqual(['Home', 'Library', 'Practice', 'Focus', 'More']);
    const mapped = DESTINATIONS.flatMap((destination) => destination.pages);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect([...mapped].sort()).toEqual([...RELEASED_ROUTES, 'settings'].sort());
    expect(Object.keys(PAGE_LABELS).sort()).toEqual([...mapped].sort());
  });

  it('puts the speaking prompts (#practice) inside the Practice group, under its own name', () => {
    expect(destinationOf('practice').id).toBe('practice');
    expect(PAGE_LABELS.practice).toBe('Speaking prompts');
    expect(destinationOf('flashcards').pages).toEqual(['flashcards', 'reverse', 'practice']);
    expect(destinationOf('wordIndex').id).toBe('library');
    expect(destinationOf('favorites').id).toBe('focus');
    expect(destinationOf('collections').id).toBe('more');
    expect(destinationOf('settings').id).toBe('more');
    expect(destinationOf('unknown').id).toBe('home');
  });

  it('always offers Focus, Collections and Settings, and only the screens a Learn Pass makes available', () => {
    const pages = availablePagesFor([block('irregularVerbs')]);
    expect(pages).toEqual(['index', 'irregularVerbs', 'favorites', 'collections', 'settings']);
    expect(destinationPages(DESTINATIONS[1], pages)).toEqual(['irregularVerbs']);
    expect(destinationPages(DESTINATIONS[2], pages)).toEqual([]);
  });
});

describe('learning topic addresses (ENG-V2-03)', () => {
  const topic = { id: 'small-talk', title: 'Small Talk', blockId: 'topic-small-talk', description: '', sections: [] } as LearningTopic;
  const topicBlock: TrainingBlock = { id: 'topic-small-talk', title: 'Small Talk', type: 'phraseCategory', category: 'Small Talk', description: '' };

  it('uses #topic/<id>, which cannot collide with a released page id', () => {
    expect(topicRoute('small-talk')).toBe('topic/small-talk');
    expect(topicIdOf('topic/small-talk')).toBe('small-talk');
    for (const page of RELEASED_ROUTES) expect(topicIdOf(page)).toBeNull();
    expect(Object.keys(PAGE_LABELS).some((page) => page.includes('/'))).toBe(false);
  });

  it('places topic screens in the Library and titles them by the topic, without a new destination', () => {
    expect(destinationOf('topic/small-talk').id).toBe('library');
    expect(pageTitle('topic/small-talk', [topic])).toBe('Small Talk');
    expect(pageTitle('phrases', [topic])).toBe('Phrases');
    expect(DESTINATIONS).toHaveLength(5);
  });

  it('offers a topic screen only when the active Learn Pass contains its block, and opens it from that block', () => {
    expect(availablePagesFor([topicBlock], [topic])).toEqual(['index', 'phrases', 'flashcards', 'topic/small-talk', 'favorites', 'collections', 'settings']);
    expect(availablePagesFor([block('phraseCategory')], [topic])).not.toContain('topic/small-talk');
    expect(pageForBlock(topicBlock, [topic])).toBe('topic/small-talk');
    expect(pageForBlock(topicBlock)).toBe('phrases');
    expect(pageForBlock(block('phraseCategory'), [topic])).toBe('phrases');
  });
});
