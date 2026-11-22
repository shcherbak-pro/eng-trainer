import { describe, expect, it } from 'vitest';
import { availablePagesFor, DESTINATIONS, destinationOf, destinationPages, PAGE_LABELS } from './navigation';
import type { TrainingBlock } from '../content/types';

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
