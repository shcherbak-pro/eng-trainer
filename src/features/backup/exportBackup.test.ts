import { openDB } from 'idb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetDatabase } from '../../test/database';
import { describeExperimental } from '../../test/product';
import type { AppStorage } from '../../storage/database';
import { SYNTHETIC_META, V1_STATE, V1_STATE_KEY, V1_THEME, V1_THEME_KEY, V2_NAME, V3_NAME, asPairs, bytesOf, databaseNames, seedExperimental, seedLegacy, seedStable, snapshot, syntheticStores } from './testing';

/**
 * Making a backup (ENG-V3-R1A): what is read, what the file holds, and that nothing is
 * written anywhere. All data is made up. Every test starts with fresh modules, as a page
 * that was just opened.
 */
const V3 = 'experimental-v3';
const V2 = 'stable-v2';
const V1 = 'legacy-v1';

async function load() {
  const [exporter, format, validate, persistence, database] = await Promise.all([
    import('./exportBackup'),
    import('./format'),
    import('./validate'),
    import('../../state/persistence'),
    import('../../storage/database')
  ]);
  return { ...exporter, ...format, ...validate, persistence, database };
}

const byProduct = <T extends { product: string }>(reports: T[]): Record<string, T> => Object.fromEntries(reports.map((report) => [report.product, report]));

beforeEach(() => {
  resetDatabase();
  window.localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describeExperimental('making a backup: what is read', () => {
  it('reads the saved data of all three products, each as it is saved', async () => {
    const [own, stable] = [syntheticStores(3), syntheticStores(2)];
    await seedExperimental(own);
    await seedStable(stable);
    seedLegacy();
    const { collectSections } = await load();

    const { reports, sections } = await collectSections();

    expect(reports.map((report) => [report.product, report.state])).toEqual([[V3, 'included'], [V2, 'included'], [V1, 'included']]);
    expect(sections[V3]).toEqual({ database: 'eng-trainer-v3', schemaVersion: 1, stores: asPairs({ ...own, meta: SYNTHETIC_META }) });
    expect(sections[V2]).toEqual({ database: 'eng-trainer-v2', schemaVersion: 2, stores: asPairs(stable) });
    expect(sections[V1]).toEqual({ storage: 'localStorage', records: { [V1_STATE_KEY]: V1_STATE, [V1_THEME_KEY]: V1_THEME } });
    // The two database products hold different data under the same keys, and stay apart.
    expect(sections[V3]?.stores.progress).not.toEqual(sections[V2]?.stores.progress);
  });

  it('summarizes each product in the learner\'s terms, without mixing them', async () => {
    await seedExperimental();
    await seedStable();
    seedLegacy();
    const { collectSections } = await load();
    const reports = byProduct((await collectSections()).reports);

    expect(reports[V3]).toMatchObject({ state: 'included', summary: { learned: 3, hidden: 2, focus: 4, learnPasses: 1, flashcardDecks: 2, preferences: 8, collections: [{ name: 'Synthetic collection 3', entries: 2 }] } });
    expect(reports[V2]).toMatchObject({ state: 'included', summary: { learned: 3, collections: [{ name: 'Synthetic collection 2', entries: 2 }] } });
    expect(reports[V1]).toMatchObject({ state: 'included', summary: { learned: 2, hidden: 1, focus: 1, learnPasses: 1, flashcardDecks: 1, preferences: null, collections: [] } });
  });

  it('writes nothing: both databases and the records of the first version are the same afterwards', async () => {
    await seedExperimental();
    await seedStable();
    seedLegacy();
    window.localStorage.setItem('another.application', 'not ours');
    const before = { own: await snapshot(V3_NAME), stable: await snapshot(V2_NAME) };
    const { collectSections, composeBackup } = await load();

    const open = vi.spyOn(indexedDB, 'open');
    const modes = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const databaseWrites = [vi.spyOn(IDBObjectStore.prototype, 'put'), vi.spyOn(IDBObjectStore.prototype, 'add'), vi.spyOn(IDBObjectStore.prototype, 'delete'), vi.spyOn(IDBObjectStore.prototype, 'clear'), vi.spyOn(indexedDB, 'deleteDatabase'), vi.spyOn(IDBDatabase.prototype, 'createObjectStore')];
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const storageWrites = [vi.spyOn(Storage.prototype, 'setItem'), vi.spyOn(Storage.prototype, 'removeItem'), vi.spyOn(Storage.prototype, 'clear')];

    await composeBackup((await collectSections()).sections);

    // Each database is opened once, without a version, and read in one read-only transaction.
    expect(open.mock.calls).toEqual([[V3_NAME], [V2_NAME]]);
    expect(modes.mock.calls.map(([, mode]) => mode)).toEqual(['readonly', 'readonly']);
    for (const spy of [...databaseWrites, ...storageWrites]) expect(spy).not.toHaveBeenCalled();
    expect(getItem.mock.calls.map(([key]) => key)).toEqual([V1_STATE_KEY, V1_THEME_KEY]);
    vi.restoreAllMocks();

    expect(await snapshot(V3_NAME)).toEqual(before.own);
    expect(await snapshot(V2_NAME)).toEqual(before.stable);
    expect(await databaseNames()).toEqual([V2_NAME, V3_NAME]);
    expect(window.localStorage.length).toBe(3);
    expect(window.localStorage.getItem(V1_STATE_KEY)).toBe(V1_STATE);
    expect(window.localStorage.getItem(V1_THEME_KEY)).toBe(V1_THEME);
  });

  it('on an origin that only this version used: reports the other two as absent and creates nothing for them', async () => {
    const { collectSections, database } = await load();
    (await database.openStorage()).close();

    const { reports, sections } = await collectSections();

    expect(reports).toEqual([
      { product: V3, state: 'included', summary: { learned: 0, hidden: 0, focus: 0, learnPasses: 0, flashcardDecks: 0, preferences: 0, collections: [] } },
      { product: V2, state: 'absent' },
      { product: V1, state: 'absent' }
    ]);
    expect(Object.keys(sections)).toEqual([V3]);
    expect(await databaseNames()).toEqual([V3_NAME]);
    expect(window.localStorage.length).toBe(0);
  });

  it('waits for changes that are still on their way to the database, and includes them', async () => {
    const { collectSections, database, persistence } = await load();
    const storage = await database.openStorage();
    // The first save is held back, as a slow disk or a busy browser would hold it.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const slow: AppStorage = { readAll: () => storage.readAll(), close: () => storage.close(), write: async (ops, conditions) => { await held; return storage.write(ops, conditions); } };
    persistence.connectStorage(slow);
    persistence.persist([{ type: 'put', store: 'progress', key: 'learnedPhrases', value: ['phrase-just-learned'] }]);

    const collecting = collectSections();
    // Long enough for a backup that did not wait to have read the database without the change.
    await new Promise((resolve) => setTimeout(resolve, 60));
    release();
    const { sections } = await collecting;

    expect(sections[V3]?.stores.progress).toEqual([['learnedPhrases', ['phrase-just-learned']]]);
    storage.close();
  });
});

describeExperimental('making a backup: saved data that cannot be read or accepted', () => {
  it('does not make a backup that silently lacks a product: each failure is reported with its reason', async () => {
    await seedExperimental();
    await seedStable(syntheticStores(2), 1, ['progress', 'learnPasses', 'flashcardSessions', 'settings']);
    seedLegacy('{"learnedPhrases":[', 'dark');
    const { collectSections } = await load();

    const { reports, sections } = await collectSections();
    const found = byProduct(reports);

    expect(found[V3].state).toBe('included');
    expect(found[V2]).toMatchObject({ state: 'failed', reason: expect.stringContaining('older storage schema 1') });
    expect(found[V2]).toMatchObject({ reason: expect.stringContaining('Open that version of the application once') });
    expect(found[V1]).toMatchObject({ state: 'failed', reason: expect.stringContaining('is not JSON text') });
    expect(Object.keys(sections)).toEqual([V3]);
    // Reading the older stable database did not upgrade it.
    expect((await snapshot(V2_NAME)).version).toBe(1);
  });

  it('reports a stable database of a newer schema, one with a record it cannot accept, and one it cannot open', async () => {
    const { collectSections } = await load();
    const reasonFor = async (): Promise<string> => {
      const report = byProduct((await collectSections()).reports)[V2];
      return report.state === 'failed' ? report.reason : `not failed: ${report.state}`;
    };

    await seedStable(syntheticStores(2), 3);
    expect(await reasonFor()).toContain('newer storage schema 3');

    resetDatabase();
    const odd = syntheticStores(2);
    odd.settings.theme = 'purple';
    await seedStable(odd);
    expect(await reasonFor()).toContain('settings: "theme" has a value that the application does not accept');

    resetDatabase();
    await seedStable();
    vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new DOMException('The operation is insecure.', 'SecurityError'); });
    expect(await reasonFor()).toContain('The browser storage could not be read');
  });

  it('refuses a database with pronunciation records, instead of leaving them out', async () => {
    await seedExperimental(syntheticStores(3), SYNTHETIC_META, ['pronunciationAttempts', 'pronunciationHints']);
    const { collectSections } = await load();
    const report = byProduct((await collectSections()).reports)[V3];
    expect(report).toMatchObject({ state: 'failed', reason: expect.stringContaining('does not leave them out') });
  });

  it('refuses this version\'s data while its latest changes are not saved', async () => {
    await seedExperimental();
    const { collectSections, persistence } = await load();
    const failing: AppStorage = { readAll: () => Promise.reject(new Error('unused')), write: () => Promise.reject(new Error('synthetic write failure')), close: () => undefined };
    persistence.connectStorage(failing);
    persistence.persist([{ type: 'put', store: 'settings', key: 'theme', value: 'light' }]);
    await persistence.persistenceSettled();

    const report = byProduct((await collectSections()).reports)[V3];
    expect(report).toMatchObject({ state: 'failed', reason: expect.stringContaining('latest changes are not saved yet') });
  });

  it('reports the records of the first version as failed when the browser refuses access to them', async () => {
    seedLegacy();
    const { collectSections } = await load();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('The operation is insecure.', 'SecurityError'); });
    expect(byProduct((await collectSections()).reports)[V1]).toMatchObject({ state: 'failed', reason: expect.stringContaining('could not be read') });
  });
});

describeExperimental('making a backup: the file', () => {
  it('holds the sections with one digest each, in a text that its own reader accepts', async () => {
    await seedExperimental();
    await seedStable();
    seedLegacy();
    const { collectSections, composeBackup, readBackup, sectionDigest } = await load();
    const { sections } = await collectSections();

    const made = await composeBackup(sections, new Date('2026-11-25T14:03:22.123Z'));

    expect(made.fileName).toBe('eng-trainer-backup-20261125-140322.json');
    expect(made.text.endsWith('}\n')).toBe(true);
    const parsed = JSON.parse(made.text);
    expect(Object.keys(parsed)).toEqual(['format', 'version', 'exportedAt', 'exportedBy', 'sections', 'integrity']);
    expect(parsed).toMatchObject({ format: 'eng-trainer-backup', version: 1, exportedAt: '2026-11-25T14:03:22.123Z', exportedBy: { product: V3 } });
    expect(Object.keys(parsed.sections)).toEqual([V3, V2, V1]);
    expect(parsed.sections).toEqual(sections);
    expect(parsed.integrity.algorithm).toBe('SHA-256');
    for (const product of [V3, V2, V1] as const) expect(parsed.integrity.sections[product]).toBe(await sectionDigest(sections[product]!));
    expect(await readBackup(bytesOf(made.text))).toEqual(made.backup);
  });

  it('holds only learning data: no model, cache or recording, and nothing of another application', async () => {
    await seedExperimental();
    await seedStable();
    seedLegacy();
    window.localStorage.setItem('another.application', 'not ours');
    const other = await openDB('another-database', 1, { upgrade: (db) => void db.createObjectStore('things') });
    await other.put('things', 'not ours either', 'thing');
    other.close();
    const { collectSections, composeBackup } = await load();

    const { text } = await composeBackup((await collectSections()).sections);

    expect(text).not.toContain('not ours');
    expect(text).not.toContain('another');
    expect(text).not.toMatch(/onnx|model-cache|audio|recording/i);
    expect(await databaseNames()).toEqual(['another-database', V2_NAME, V3_NAME]);
  });

  it('makes a file from the products that could be read, when the learner asks for that', async () => {
    await seedExperimental();
    await seedStable(syntheticStores(2), 3);
    const { collectSections, composeBackup, readBackup } = await load();
    const { sections } = await collectSections();

    const made = await composeBackup(sections);

    expect(Object.keys(made.backup.sections)).toEqual([V3]);
    expect(Object.keys(made.backup.integrity.sections)).toEqual([V3]);
    await expect(readBackup(bytesOf(made.text))).resolves.toBeTruthy();
  });

  it('makes no file when no product has saved data, or when a section would not be accepted back', async () => {
    const { collectSections, composeBackup } = await load();
    const nothing = await collectSections();
    expect(nothing.reports.map((report) => report.state)).toEqual(['absent', 'absent', 'absent']);
    await expect(composeBackup(nothing.sections)).rejects.toMatchObject({ code: 'empty' });

    const odd = syntheticStores(3);
    odd.settings.theme = 'purple';
    const section = { database: 'eng-trainer-v3', schemaVersion: 1, stores: asPairs({ ...odd, meta: SYNTHETIC_META }) };
    await expect(composeBackup({ [V3]: section })).rejects.toMatchObject({ code: 'invalid-record' });
    await expect(composeBackup({ [V3]: { ...section, stores: { ...section.stores, settings: [['theme', new Date(0)]] } } })).rejects.toMatchObject({ name: 'BackupError' });
  });
});
