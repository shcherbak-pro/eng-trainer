import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collection, native } from '../test/collections';
import { readDatabase, resetDatabase, seedDatabase } from '../test/database';
import { parseImport } from '../collections/format';

beforeEach(() => resetDatabase());

describe('Reset progress (confirmation copy derived from the operation)', () => {
  it('names every learning-state field and every preference except the theme', async () => {
    vi.resetModules();
    const { resetSummaryCoverage, RESET_PROGRESS_SUMMARY } = await import('./index');
    const coverage = resetSummaryCoverage();
    expect([...coverage.progressKeys].sort()).toEqual([...coverage.allProgressKeys].sort());
    expect([...coverage.settingKeys].sort()).toEqual(coverage.allSettingKeys.filter((key) => key !== 'theme').sort());
    expect(new Set(coverage.progressKeys).size).toBe(coverage.progressKeys.length);
    expect(RESET_PROGRESS_SUMMARY.keeps).toEqual(['Your imported vocabulary collections', 'Your theme', 'The built-in study material']);
  });

  it('clears exactly what the summary lists, and keeps the theme and the imported collections', async () => {
    await seedDatabase({
      progress: {
        learnedPhrases: ['phrase-001'], hiddenPhrases: ['phrase-002'], hiddenWords: ['word-phrase-003'], hiddenIrregular: ['iv-001-be'],
        favoriteBlocks: ['start-answer'], favoritePhrases: ['phrase-004'], favoriteWords: ['word-phrase-005'], favoriteIrregular: ['iv-002-have'],
        selectedLearnPassId: 'pass'
      },
      settings: { theme: 'dark', speechRepeatCount: 20, phrasePageSize: 20, activePage: 'phrases', phraseCategory: 'Structure', showHiddenWords: true },
      learnPasses: { pass: { id: 'pass', name: 'Pass', description: '', blockIds: ['start-answer'], createdAt: '2026-11-20', updatedAt: '2026-11-20' } },
      flashcardSessions: { all: { order: ['phrase-001'], index: 0 } }
    });
    vi.resetModules();
    const state = await import('./index');
    const persistence = await import('./persistence');
    const service = await import('../collections/service');
    const { createCatalog } = await import('../content/catalog');
    const { realMaterials } = await import('../test/content');
    await state.initState();
    await service.acceptImport(service.prepareImport(parseImport(JSON.stringify(native()), 'synthetic.json'), createCatalog(realMaterials)));
    const before = await readDatabase();

    state.resetAllState();
    await persistence.persistenceSettled();
    const after = await readDatabase();

    expect(get(state.progress)).toMatchObject({
      learnedPhrases: [], hiddenPhrases: [], hiddenWords: [], hiddenIrregular: [],
      favoriteBlocks: [], favoritePhrases: [], favoriteWords: [], favoriteIrregular: [],
      learnPasses: [], selectedLearnPassId: 'default', flashcardSessions: {}
    });
    expect(after.learnPasses).toEqual({});
    expect(after.flashcardSessions).toEqual({});
    expect(get(state.settings)).toMatchObject({ theme: 'dark', speechRepeatCount: 10, phrasePageSize: 5, activePage: 'index', phraseCategory: 'All', showHiddenWords: false });
    expect(after.settings.theme).toBe('dark');
    expect(after.userCollections).toEqual(before.userCollections);
    expect(after.userEntries).toEqual(before.userEntries);
    expect(Object.keys(after.userCollections)).toEqual([collection.id]);
  });
});
