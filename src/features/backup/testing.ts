import { openDB } from 'idb';
import { STORE_NAMES } from '../../storage/database';

/**
 * Made-up data and storage helpers for the tests of the backup feature (ENG-V3-R1A).
 * Nothing here is part of the application: no build contains this module.
 *
 * Every identity below is invented. The data is complete on purpose: all six learning
 * stores hold something, and an imported collection has a phrase and a word linked to it.
 */
export const V2_NAME = 'eng-trainer-v2';
export const V3_NAME = 'eng-trainer-v3';
export const META = 'meta';
export const V1_STATE_KEY = 'englishAssessmentTrainer.svelteState.v1';
export const V1_THEME_KEY = 'englishAssessmentTrainer.theme.v1';

export type Stores = Record<string, Record<string, unknown>>;
export type Snapshot = { version: number; stores: Stores };

/** `digit` makes the identities of one product differ from those of the other. */
export function syntheticStores(digit: 2 | 3): Stores {
  const collection = `user:${String(digit).repeat(8)}-0000-4000-8000-000000000000`;
  const entry = (number: number): string => `${collection}:entry:0000000${number}-0000-4000-8000-00000000000${digit}`;
  const pass = `pass-synthetic-${digit}`;
  return {
    progress: {
      learnedPhrases: [`phrase-${digit}01`, `phrase-${digit}02`, entry(1)],
      hiddenPhrases: [`phrase-${digit}03`],
      hiddenWords: [`word-${digit}04`],
      hiddenIrregular: [],
      favoriteBlocks: ['block-synthetic'],
      favoritePhrases: [`phrase-${digit}05`, entry(1)],
      favoriteWords: [],
      favoriteIrregular: [`verb-${digit}06`],
      selectedLearnPassId: pass
    },
    learnPasses: {
      [pass]: { id: pass, name: `Synthetic pass ${digit}`, description: 'Made up for a test', blockIds: ['block-a', 'block-b'], createdAt: '2026-01-02T03:04:05.000Z', updatedAt: '2026-01-03T03:04:05.000Z' }
    },
    flashcardSessions: {
      all: { order: [`phrase-${digit}07`, entry(1), `phrase-${digit}08`], index: 1 },
      'topic:Small talk': { order: [], index: 0 }
    },
    settings: {
      activePage: 'phrases',
      collectionFilter: collection,
      flashcardMode: 'topic',
      flashcardTopic: 'Small talk',
      indexPageSize: 'all',
      showHiddenWords: true,
      speechRepeatCount: 20,
      theme: 'dark'
    },
    userCollections: {
      [collection]: {
        id: collection,
        name: `Synthetic collection ${digit}`,
        description: 'Made up for a test',
        version: 1,
        createdAt: '2026-01-04T03:04:05.000Z',
        updatedAt: '2026-01-05T03:04:05.000Z',
        revision: 2,
        lastImport: { fileName: 'synthetic.csv', format: 'csv', importedAt: '2026-01-05T03:04:05.000Z', added: 2, skipped: 0 }
      }
    },
    userEntries: {
      [entry(1)]: { id: entry(1), kind: 'phrase', english: 'a made-up phrase', translation: 'вигадана фраза', topic: 'Synthetic', examples: [{ en: 'This is a made-up phrase.', translation: 'Це вигадана фраза.' }], collectionId: collection, position: 0 },
      [entry(2)]: { id: entry(2), kind: 'word', english: 'made-up', translation: 'вигаданий', topic: '', examples: [], sourcePhraseId: entry(1), collectionId: collection, position: 1 }
    }
  };
}

export const SYNTHETIC_META = { createdAt: '2026-02-03T04:05:06.000Z', schema: 1 };
export const V1_STATE = JSON.stringify({ activePage: 'phrases', learnedPhrases: ['phrase-101', 'phrase-102'], hiddenWords: ['word-103'], favoritePhrases: ['phrase-104'], learnPasses: [{ id: 'pass-v1', name: 'First', blockIds: [] }], flashcardSessions: { all: { order: ['phrase-105'], index: 0 } }, unknownMemberOfAnOlderBuild: 1 });
export const V1_THEME = 'dark';

async function write(name: string, version: number, storeNames: readonly string[], stores: Stores): Promise<void> {
  const database = await openDB(name, version, {
    upgrade(db) {
      for (const store of storeNames) db.createObjectStore(store);
    }
  });
  const transaction = database.transaction([...storeNames], 'readwrite');
  for (const store of storeNames) {
    for (const [key, value] of Object.entries(stores[store] ?? {})) void transaction.objectStore(store).put(value, key);
  }
  await transaction.done;
  database.close();
}

/** The experimental database as an earlier session would have left it: version 1, seven stores. */
export function seedExperimental(stores: Stores = syntheticStores(3), meta: Record<string, unknown> = SYNTHETIC_META, extraStores: string[] = []): Promise<void> {
  return write(V3_NAME, 1, [...STORE_NAMES, META, ...extraStores], { ...stores, [META]: meta });
}

/** The stable database as the stable product creates it: version 2, six stores. */
export function seedStable(stores: Stores = syntheticStores(2), version = 2, storeNames: readonly string[] = STORE_NAMES): Promise<void> {
  return write(V2_NAME, version, storeNames, stores);
}

export function seedLegacy(state: string = V1_STATE, theme: string = V1_THEME): void {
  window.localStorage.setItem(V1_STATE_KEY, state);
  window.localStorage.setItem(V1_THEME_KEY, theme);
}

/** Everything a database holds, read without a version so that nothing is created or upgraded. */
export async function snapshot(name: string): Promise<Snapshot> {
  const database = await openDB(name);
  const stores: Stores = {};
  for (const store of [...database.objectStoreNames].sort()) {
    const keys = await database.getAllKeys(store);
    const values = await database.getAll(store);
    stores[store] = Object.fromEntries(keys.map((key, index) => [String(key), values[index]]));
  }
  const result = { version: database.version, stores };
  database.close();
  return result;
}

export const databaseNames = async (): Promise<string[]> => (await indexedDB.databases()).map((entry) => String(entry.name)).sort();

/** The stores of a snapshot or of made-up data in the form a backup section has: sorted pairs. */
export function asPairs(stores: Stores): Record<string, [string, unknown][]> {
  return Object.fromEntries(Object.entries(stores).map(([name, records]) => [name, Object.keys(records).sort().map((key): [string, unknown] => [key, records[key]])]));
}

/** The bytes of a file with this content, as the file picker hands them over. */
export const bytesOf = (value: unknown): Uint8Array => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
