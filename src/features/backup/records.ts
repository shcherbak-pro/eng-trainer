import { collectionInfo, validateEntry } from '../../collections/format';
import { readCollections } from '../../collections/service';
import { PROGRESS_KEYS, readProgress } from '../../state/progress';
import { SETTING_KEYS, readSettings, type SettingKey } from '../../state/settings';
import { META_CREATED_AT_KEY, META_SCHEMA_KEY, META_STORE_NAME, STORE_NAMES, type StoreName, type StoredRecords } from '../../storage/database';
import {
  BackupError,
  DATABASE_SCHEMAS,
  EXPERIMENTAL_PRODUCT,
  LEGACY_STATE_KEY,
  LEGACY_THEMES,
  LEGACY_THEME_KEY,
  isIsoTime,
  isPlainObject,
  sameJson,
  type DatabaseProduct,
  type DatabaseSection,
  type LegacySection,
  type ProductId,
  type StorePairs
} from './format';

/**
 * Strict checks of the records in a backup section (ENG-V3-R1A).
 *
 * The application reads four of its six stores leniently: a record it does not understand
 * is repaired in memory or skipped. A backup must not depend on that, or a file could
 * look complete and restore less than it shows. So every record here must be one that
 * the product's own reader returns unchanged: the readers themselves are the reference,
 * and nothing is repaired or skipped.
 *
 * The same checks run when a backup is made and when it is read, so a file that this
 * version writes is one that this version accepts.
 */
const LIST_KEYS = PROGRESS_KEYS.filter((key) => key !== 'learnPasses' && key !== 'flashcardSessions' && key !== 'selectedLearnPassId') as string[];
const SELECTED_PASS_KEY = 'selectedLearnPassId';
const COLLECTION_MEMBERS = ['createdAt', 'description', 'id', 'lastImport', 'name', 'revision', 'updatedAt', 'version'];
const LAST_IMPORT_MEMBERS = ['added', 'fileName', 'format', 'importedAt', 'skipped'];

function emptyRecords(): StoredRecords {
  return Object.fromEntries(STORE_NAMES.map((name) => [name, new Map<string, unknown>()])) as StoredRecords;
}

/** The six learning stores of a section as the maps that the application's readers take. */
export function toStoredRecords(stores: Record<string, StorePairs>): StoredRecords {
  const records = emptyRecords();
  for (const name of STORE_NAMES) records[name] = new Map(stores[name]);
  return records;
}

function only(store: StoreName, key: string, value: unknown): StoredRecords {
  const records = emptyRecords();
  records[store].set(key, value);
  return records;
}

function hasExactly(value: unknown, members: string[]): boolean {
  return isPlainObject(value) && Object.keys(value).sort().join('\n') === members.join('\n');
}

function checkProgress(pairs: StorePairs, fail: (message: string) => never): void {
  for (const [key, value] of pairs) {
    if (key === SELECTED_PASS_KEY) {
      // The reader falls back to the default pass when the selected one no longer exists. That
      // is a fact about another record, so it is not checked here: the text is kept as it is.
      if (typeof value !== 'string' || !value) fail('progress: the selected Learn pass is not a name.');
    } else if (LIST_KEYS.includes(key)) {
      const read = readProgress(only('progress', key, value)) as unknown as Record<string, unknown>;
      if (!sameJson(read[key], value)) fail(`progress: "${key}" is not a list of distinct entry identities.`);
    } else {
      fail(`progress: "${key}" is not a record of this store.`);
    }
  }
}

function checkLearnPasses(pairs: StorePairs, fail: (message: string) => never): void {
  for (const [key, value] of pairs) {
    const read = readProgress(only('learnPasses', key, value)).learnPasses;
    if (read.length !== 1 || read[0].id !== key || !sameJson(read[0], value)) fail(`learnPasses: the Learn pass "${key}" is incomplete or has another form.`);
  }
}

function checkFlashcardSessions(pairs: StorePairs, fail: (message: string) => never): void {
  for (const [key, value] of pairs) {
    const read = readProgress(only('flashcardSessions', key, value)).flashcardSessions[key];
    if (!read || !sameJson(read, value)) fail(`flashcardSessions: the deck "${key}" is not a review sequence with a valid position.`);
  }
}

function checkSettings(pairs: StorePairs, fail: (message: string) => never): void {
  for (const [key, value] of pairs) {
    if (!(SETTING_KEYS as string[]).includes(key)) fail(`settings: "${key}" is not a preference of this application.`);
    // A value the reader does not accept is replaced by the default. An accepted one is returned as it is.
    if (readSettings(only('settings', key, value))[key as SettingKey] !== value) fail(`settings: "${key}" has a value that the application does not accept.`);
  }
}

function checkCollections(records: StoredRecords, fail: (message: string) => never): void {
  try {
    // The application's own strict reader: with a record it refuses, the product does not start.
    readCollections(records);
  } catch (error) {
    fail(`collections: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const [key, value] of records.userCollections) {
    const collection = value as { id: string; name: string; description: string; lastImport: unknown };
    if (!hasExactly(collection, COLLECTION_MEMBERS) || !hasExactly(collection.lastImport, LAST_IMPORT_MEMBERS)) fail(`userCollections: the collection "${key}" has a missing or unknown member.`);
    const info = collectionInfo({ id: collection.id, name: collection.name, description: collection.description });
    if (info.name !== collection.name || info.description !== collection.description) fail(`userCollections: the collection "${key}" has a name or description that reading would change.`);
  }
  for (const [key, value] of records.userEntries) {
    const { collectionId, position, ...entry } = value as { collectionId: string; position: number };
    if (!sameJson({ ...validateEntry(entry, collectionId), collectionId, position }, value)) fail(`userEntries: the entry "${key}" has a form that reading would change.`);
  }
}

function checkMeta(pairs: StorePairs, schemaVersion: number, fail: (message: string) => never): void {
  const meta = new Map(pairs);
  if (pairs.map(([key]) => key).join('\n') !== [META_CREATED_AT_KEY, META_SCHEMA_KEY].join('\n')) fail('meta: expected exactly the records "createdAt" and "schema".');
  if (meta.get(META_SCHEMA_KEY) !== schemaVersion) fail('meta: the recorded schema is not the schema of the section.');
  if (!isIsoTime(meta.get(META_CREATED_AT_KEY))) fail('meta: the creation time is not a time.');
}

/**
 * Checks every record of a database section. The section must already have the structure
 * of its product: the right database, schema version and stores (see validate.ts).
 */
export function checkDatabaseRecords(product: DatabaseProduct, section: DatabaseSection): void {
  const fail = (message: string): never => {
    throw new BackupError('invalid-record', message, { product });
  };
  checkProgress(section.stores.progress, fail);
  checkLearnPasses(section.stores.learnPasses, fail);
  checkFlashcardSessions(section.stores.flashcardSessions, fail);
  checkSettings(section.stores.settings, fail);
  checkCollections(toStoredRecords(section.stores), fail);
  if (product === EXPERIMENTAL_PRODUCT) checkMeta(section.stores[META_STORE_NAME], DATABASE_SCHEMAS[product].schemaVersion, fail);
}

/**
 * Checks the records of the first version. They are kept as raw text, because that
 * application keeps members it does not know when it rewrites its state. The state must
 * be the text of a JSON object; the theme must be one of the three values it writes.
 */
export function checkLegacyRecords(product: ProductId, section: LegacySection): void {
  const fail = (message: string): never => {
    throw new BackupError('invalid-record', message, { product });
  };
  const state = section.records[LEGACY_STATE_KEY];
  if (state !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(state);
    } catch {
      fail('The saved state of the previous version is not JSON text.');
    }
    if (!isPlainObject(parsed)) fail('The saved state of the previous version is not a JSON object.');
  }
  const theme = section.records[LEGACY_THEME_KEY];
  if (theme !== undefined && !LEGACY_THEMES.includes(theme)) fail('The saved theme of the previous version is not one of its three themes.');
}
