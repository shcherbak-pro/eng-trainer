import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetDatabase } from '../../test/database';
import { describeExperimental } from '../../test/product';
import type { LegacySection } from './format';
import { V1_STATE, V1_STATE_KEY, V1_THEME_KEY, V2_NAME, asPairs, databaseNames, seedLegacy, seedStable, snapshot, syntheticStores } from './testing';

/**
 * The destinations of the other two products, as the preview of a recovery sees them
 * (ENG-V3-R1A-RC1). All data is made up. This module only reads.
 */
const load = () => import('./destinations');

/** The state that the first version writes when it is opened for the first time: every list is there, and empty. */
const V1_DEFAULT = JSON.stringify({
  activePage: 'index', phraseQuery: '', phrasePageSize: 5, selectedLearnPassId: 'default',
  learnedPhrases: [], hiddenPhrases: [], hiddenWords: [], hiddenIrregular: [],
  favoriteBlocks: [], favoritePhrases: [], favoriteWords: [], favoriteIrregular: [],
  learnPasses: [], flashcardMode: 'all', flashcardTopic: '', flashcardSessions: {}
});
const section = (records: LegacySection['records'] = { [V1_STATE_KEY]: V1_STATE, [V1_THEME_KEY]: 'dark' }): LegacySection => ({ storage: 'localStorage', records });

beforeEach(() => {
  resetDatabase();
  window.localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describeExperimental('destination of the stable section', () => {
  it('reports a browser without the stable database as waiting for the stable product, and creates nothing by looking', async () => {
    const { inspectStableDestination } = await load();
    expect(await inspectStableDestination()).toEqual({ state: 'absent' });
    expect(await databaseNames()).toEqual([]);
  });

  it('reports the storage that the stable product created and never wrote to as eligible', async () => {
    await seedStable({});
    const { inspectStableDestination } = await load();
    expect(await inspectStableDestination()).toEqual({ state: 'empty' });
  });

  it('reports the database that the stable product left after its first start as eligible: preferences are not learning data', async () => {
    await seedStable({ settings: { theme: 'light', activePage: 'phrases' }, progress: { learnedPhrases: [], favoriteBlocks: [] } });
    const before = await snapshot(V2_NAME);
    const { inspectStableDestination } = await load();
    expect(await inspectStableDestination()).toEqual({ state: 'empty' });
    expect(await snapshot(V2_NAME)).toEqual(before);
  });

  it('reports learning data, and says what it is', async () => {
    await seedStable();
    const { inspectStableDestination } = await load();
    expect(await inspectStableDestination()).toEqual({
      state: 'occupied',
      holds: ['9 learned, hidden or Focus items', '1 other progress record', '1 Learn pass', '2 flashcard decks with a saved place', '1 imported collection']
    });
  });

  it('recognises a database that holds exactly the section of the file, and only with the digest of that section', async () => {
    await seedStable();
    const format = await import('./format');
    const { inspectStableDestination } = await load();
    const section = { database: V2_NAME, schemaVersion: 2, stores: asPairs(syntheticStores(2)) };
    const digest = await format.sectionDigest(section);

    expect(await inspectStableDestination(digest)).toEqual({ state: 'identical' });
    expect(await inspectStableDestination()).toMatchObject({ state: 'occupied' });
    // One record that differs, and it is learning data to be kept, not the backup's.
    const other = syntheticStores(2);
    other.progress.learnedPhrases = ['phrase-of-another-backup'];
    expect(await inspectStableDestination(await format.sectionDigest({ ...section, stores: asPairs(other) }))).toMatchObject({ state: 'occupied' });
  });

  it('does not call a database identical when it holds a value that no backup can hold', async () => {
    const stores = syntheticStores(2);
    stores.settings.theme = new Date(0) as unknown as string;
    await seedStable(stores);
    const { inspectStableDestination } = await load();
    expect(await inspectStableDestination('0'.repeat(64))).toMatchObject({ state: 'occupied' });
  });

  it.each([
    ['a newer version', 3, ['progress', 'learnPasses', 'flashcardSessions', 'settings', 'userCollections', 'userEntries']],
    ['the older version 1 with four stores', 1, ['progress', 'learnPasses', 'flashcardSessions', 'settings']],
    ['version 2 with one more store', 2, ['progress', 'learnPasses', 'flashcardSessions', 'settings', 'userCollections', 'userEntries', 'meta']]
  ])('reports %s as a schema that is left alone, and does not upgrade it', async (_name, version, stores) => {
    await seedStable({}, version, stores);
    const before = await snapshot(V2_NAME);
    const { inspectStableDestination } = await load();
    expect(await inspectStableDestination()).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('never changed or upgraded from here') });
    expect(await snapshot(V2_NAME)).toEqual(before);
  });

  it('only reads: no read-write transaction, no versioned open, no key-value access', async () => {
    await seedStable();
    const open = vi.spyOn(indexedDB, 'open');
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const storage = [vi.spyOn(Storage.prototype, 'getItem'), vi.spyOn(Storage.prototype, 'setItem'), vi.spyOn(Storage.prototype, 'removeItem')];
    const { inspectStableDestination } = await load();

    await inspectStableDestination();

    expect(open.mock.calls).toEqual([[V2_NAME]]);
    expect(transactions.mock.calls.map(([, mode]) => mode)).toEqual(['readonly']);
    for (const spy of storage) expect(spy).not.toHaveBeenCalled();
  });
});

describeExperimental('learning data in the state of the first version', () => {
  it('finds none in a missing record and in the state that the first version writes at its first start', async () => {
    const { legacyLearningDataIn } = await import('./summary');
    expect(legacyLearningDataIn(null)).toEqual([]);
    expect(legacyLearningDataIn(V1_DEFAULT)).toEqual([]);
    expect(legacyLearningDataIn('{}')).toEqual([]);
    // Preferences alone are not learning data.
    expect(legacyLearningDataIn(JSON.stringify({ activePage: 'phrases', phraseQuery: 'made up', indexPageSize: 12, currentPrompt: 'a prompt' }))).toEqual([]);
  });

  it.each([
    ['a learned phrase', { learnedPhrases: ['phrase-1'] }, ['1 learned, hidden or Focus item']],
    ['hidden and Focus items', { hiddenWords: ['word-1'], favoriteBlocks: ['block-1', 'block-2'] }, ['3 learned, hidden or Focus items']],
    ['a Learn pass', { learnPasses: [{ id: 'pass-1', name: 'Made up' }] }, ['1 Learn pass']],
    ['a flashcard deck', { flashcardSessions: { all: { order: [], index: 0 } } }, ['1 flashcard deck with a saved place']],
    ['a selected Learn pass', { selectedLearnPassId: 'pass-1' }, ['1 other progress record']],
    ['a list of an unknown form', { learnedPhrases: 'phrase-1' }, ['1 other progress record']],
    ['Learn passes of an unknown form', { learnPasses: { 'pass-1': {} } }, ['1 other progress record']],
    ['flashcard sessions of an unknown form', { flashcardSessions: ['all'] }, ['1 other progress record']]
  ])('counts %s as learning data', async (_name, state, holds) => {
    const { legacyLearningDataIn } = await import('./summary');
    expect(legacyLearningDataIn(JSON.stringify({ ...JSON.parse(V1_DEFAULT), ...state }))).toEqual(holds);
  });

  it.each(['', 'not JSON', '[1,2]', '"text"', 'null', '{"learnedPhrases":'])('says that it cannot tell for the text %j', async (text) => {
    const { legacyLearningDataIn } = await import('./summary');
    expect(legacyLearningDataIn(text)).toBeNull();
  });
});

describeExperimental('plan for the section of the first version', () => {
  const plan = async (current: Record<string, string>, wanted?: LegacySection) => (await load()).planLegacyRecovery(current, wanted ?? section());

  it('writes both records into a storage without them, the state first', async () => {
    expect(await plan({})).toEqual({ state: 'empty', writes: [V1_STATE_KEY, V1_THEME_KEY] });
  });

  it('writes over the records of a first start: empty lists and a theme are not learning data', async () => {
    expect(await plan({ [V1_STATE_KEY]: V1_DEFAULT, [V1_THEME_KEY]: 'system' })).toEqual({ state: 'empty', writes: [V1_STATE_KEY, V1_THEME_KEY] });
    // A theme that already is the backup's is not written again.
    expect(await plan({ [V1_STATE_KEY]: V1_DEFAULT, [V1_THEME_KEY]: 'dark' })).toEqual({ state: 'empty', writes: [V1_STATE_KEY] });
  });

  it('completes a recovery that stopped after the state: only the theme is still to write', async () => {
    expect(await plan({ [V1_STATE_KEY]: V1_STATE })).toEqual({ state: 'partial', writes: [V1_THEME_KEY] });
    expect(await plan({ [V1_STATE_KEY]: V1_STATE, [V1_THEME_KEY]: 'system' })).toEqual({ state: 'partial', writes: [V1_THEME_KEY] });
  });

  it('offers no completion when the state is not the text of the backup, character for character', async () => {
    // The same learning data, saved again by the first version with another last screen.
    const changed = JSON.stringify({ ...JSON.parse(V1_STATE), activePage: 'words' });
    expect(await plan({ [V1_STATE_KEY]: changed })).toEqual({ state: 'occupied', holds: ['4 learned, hidden or Focus items', '1 Learn pass', '1 flashcard deck with a saved place'] });
    expect(await plan({ [V1_STATE_KEY]: `${V1_STATE} ` })).toMatchObject({ state: 'occupied' });
  });

  it('has nothing to write when both records are those of the backup', async () => {
    expect(await plan({ [V1_STATE_KEY]: V1_STATE, [V1_THEME_KEY]: 'dark' })).toEqual({ state: 'identical' });
    expect(await plan({ [V1_STATE_KEY]: V1_STATE, [V1_THEME_KEY]: 'light' }, section({ [V1_STATE_KEY]: V1_STATE }))).toEqual({ state: 'identical' });
  });

  it('refuses a storage with other learning data, and one whose state cannot be read', async () => {
    expect(await plan({ [V1_STATE_KEY]: '{"learnedPhrases":["phrase-kept"]}', [V1_THEME_KEY]: 'dark' })).toEqual({ state: 'occupied', holds: ['1 learned, hidden or Focus item'] });
    expect(await plan({ [V1_STATE_KEY]: 'not JSON' })).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('cannot be read') });
  });

  it('never plans a theme alone into a storage that holds learning data', async () => {
    const themeOnly = section({ [V1_THEME_KEY]: 'dark' });
    expect(await plan({ [V1_STATE_KEY]: '{"learnedPhrases":["phrase-kept"]}', [V1_THEME_KEY]: 'light' }, themeOnly)).toMatchObject({ state: 'occupied' });
    expect(await plan({ [V1_STATE_KEY]: V1_DEFAULT, [V1_THEME_KEY]: 'light' }, themeOnly)).toEqual({ state: 'empty', writes: [V1_THEME_KEY] });
  });
});

describeExperimental('destination of the section of the first version', () => {
  it('reads the two records, and nothing else, through the reader of the backup', async () => {
    seedLegacy(V1_DEFAULT, 'system');
    window.localStorage.setItem('another.application', 'kept');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const writes = [vi.spyOn(Storage.prototype, 'setItem'), vi.spyOn(Storage.prototype, 'removeItem'), vi.spyOn(Storage.prototype, 'clear'), vi.spyOn(Storage.prototype, 'key')];
    const open = vi.spyOn(indexedDB, 'open');
    const { inspectLegacyDestination } = await load();

    expect(inspectLegacyDestination(section())).toEqual({ state: 'empty', writes: [V1_STATE_KEY, V1_THEME_KEY] });

    expect(getItem.mock.calls.map(([key]) => key)).toEqual([V1_STATE_KEY, V1_THEME_KEY]);
    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('reports a storage that cannot be read as unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('synthetic refusal', 'SecurityError'); });
    const { inspectLegacyDestination } = await load();
    expect(inspectLegacyDestination(section())).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('synthetic refusal') });
  });
});
