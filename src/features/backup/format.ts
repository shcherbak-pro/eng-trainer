import { META_STORE_NAME, STORE_NAMES } from '../../storage/database';

/**
 * The full-backup file of Eng Trainer (ENG-V3-R1A).
 *
 * A backup is one JSON file that the learner saves outside the browser. It holds up to
 * three sections, one per product, each with the product's own storage and schema
 * identity and a SHA-256 digest:
 *
 *   experimental-v3   IndexedDB `eng-trainer-v3`, version 1: the six learning stores and `meta`
 *   stable-v2         IndexedDB `eng-trainer-v2`, version 2: the six learning stores
 *   legacy-v1         `localStorage`: the two records of the first version, as raw text
 *
 * A store is a list of `[key, value]` pairs in ascending key order, exactly as the
 * database holds them. Nothing is derived, renamed or renumbered, so every identity in
 * the file is the original one.
 *
 * The file holds no model file, no cache entry and no recording. The member
 * `pronunciation` of the experimental section is reserved for pronunciation records.
 * No database schema has them yet, so this version writes none and refuses a file or a
 * database that holds them, instead of leaving them out.
 *
 * This folder belongs to the experimental product only. The stable build contains
 * neither these modules nor a request for them.
 */
export const BACKUP_FORMAT = 'eng-trainer-backup';
export const BACKUP_VERSION = 1;
export const DIGEST_ALGORITHM = 'SHA-256';

/** A larger file is refused from its size alone, before it is read. */
export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;

export const EXPERIMENTAL_PRODUCT = 'experimental-v3';
export const STABLE_PRODUCT = 'stable-v2';
export const LEGACY_PRODUCT = 'legacy-v1';

/** Every product a backup can hold a section of, in display order. */
export const PRODUCTS = [EXPERIMENTAL_PRODUCT, STABLE_PRODUCT, LEGACY_PRODUCT] as const;
export type ProductId = (typeof PRODUCTS)[number];
export type DatabaseProduct = typeof EXPERIMENTAL_PRODUCT | typeof STABLE_PRODUCT;

/** The only product that writes backup files. */
export const BACKUP_WRITER = EXPERIMENTAL_PRODUCT;

export type DatabaseSchema = { database: string; schemaVersion: number; stores: readonly string[] };

/**
 * The storage identity of each database product: the only database name, schema version
 * and set of stores that a section of that product may have. Another version is another
 * schema, and this version does not guess what it holds.
 */
export const DATABASE_SCHEMAS: Record<DatabaseProduct, DatabaseSchema> = {
  [EXPERIMENTAL_PRODUCT]: { database: 'eng-trainer-v3', schemaVersion: 1, stores: [...STORE_NAMES, META_STORE_NAME] },
  [STABLE_PRODUCT]: { database: 'eng-trainer-v2', schemaVersion: 2, stores: [...STORE_NAMES] }
};

/** The two `localStorage` records of the first version. No other record is ever read. */
export const LEGACY_STATE_KEY = 'englishAssessmentTrainer.svelteState.v1';
export const LEGACY_THEME_KEY = 'englishAssessmentTrainer.theme.v1';
export const LEGACY_KEYS = [LEGACY_STATE_KEY, LEGACY_THEME_KEY] as const;
export type LegacyKey = (typeof LEGACY_KEYS)[number];
export const LEGACY_STORAGE = 'localStorage';
export const LEGACY_THEMES = ['system', 'light', 'dark'];

/** Reserved member of the experimental section. See the comment at the top. */
export const RESERVED_PRONUNCIATION_MEMBER = 'pronunciation';
/** Stores that a later schema may add for pronunciation records. This version has no contract for them. */
export const RESERVED_PRONUNCIATION_STORES = ['pronunciationAttempts', 'pronunciationHints'];

/**
 * The record that guards a writing transaction of a recovery (see restore.ts): an empty
 * list of learned phrases. It is written and then added once more under the same key, so
 * that the second request fails unless the script lived to issue every write.
 *
 * It is a record that both database products write themselves, and it is no learning
 * data. A recovery writes only where no phrase is marked as learned, so the list is
 * absent or empty there. If a script stops exactly between the guard's two requests, this
 * empty list is all that is committed, and nothing is wrong with the destination.
 */
export const GUARD_STORE = 'progress';
export const GUARD_KEY = 'learnedPhrases';

/** The records of one store: `[key, value]`, in ascending key order. */
export type StorePairs = [key: string, value: unknown][];
export type DatabaseSection = { database: string; schemaVersion: number; stores: Record<string, StorePairs> };
export type LegacySection = { storage: typeof LEGACY_STORAGE; records: Partial<Record<LegacyKey, string>> };
export type BackupSections = {
  [EXPERIMENTAL_PRODUCT]?: DatabaseSection;
  [STABLE_PRODUCT]?: DatabaseSection;
  [LEGACY_PRODUCT]?: LegacySection;
};

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  /** When the file was made, as an ISO 8601 time in UTC. */
  exportedAt: string;
  exportedBy: { product: typeof BACKUP_WRITER };
  sections: BackupSections;
  /** One digest per section, over the canonical JSON text of that section. */
  integrity: { algorithm: typeof DIGEST_ALGORITHM; sections: Partial<Record<ProductId, string>> };
};

/**
 * Why a backup operation was refused:
 * - `too-large`, `empty`, `not-utf8`, `not-json`: the file cannot be read at all;
 * - `not-a-backup`: valid JSON, but not a backup of this application;
 * - `unsupported-version`: a backup format or a storage schema this version does not know;
 * - `malformed`: the structure is not the documented one (a missing or unknown member);
 * - `integrity`: a section does not match its digest;
 * - `invalid-record`: a record is not what its store holds;
 * - `not-empty`: the destination already holds learning data;
 * - `unavailable`: the browser cannot do this here (no storage, no digest function);
 * - `write-failed`: the write was rolled back, and nothing was changed;
 * - `partial`: the first of the two records of the first version was written and checked,
 *   the second was not. Only the recovery of that product can end so: its storage has no
 *   transaction. It is never reported as a success;
 * - `verification`: the writing transaction completed, so the data was written. It could
 *   not be read back, or it read back differently, or the application could not load it.
 *   This is never "nothing was recovered".
 */
export type BackupErrorCode =
  | 'too-large'
  | 'empty'
  | 'not-utf8'
  | 'not-json'
  | 'not-a-backup'
  | 'unsupported-version'
  | 'malformed'
  | 'integrity'
  | 'invalid-record'
  | 'not-empty'
  | 'unavailable'
  | 'write-failed'
  | 'partial'
  | 'verification';

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  /** The section the problem belongs to, when it belongs to one. */
  readonly product: ProductId | undefined;
  readonly cause: unknown;

  constructor(code: BackupErrorCode, message: string, details: { product?: ProductId; cause?: unknown } = {}) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
    this.product = details.product;
    this.cause = details.cause;
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

/**
 * The one text form of a JSON value: object keys in ascending order, list items in their
 * order, no white space. Two values have the same text exactly when they are the same
 * JSON value, so the text can be compared and hashed.
 *
 * Anything JSON cannot hold exactly is an error, not a silent change: `undefined`, a hole
 * in a list, a number that is not finite, negative zero, a date, a map or binary data.
 */
export function canonicalJson(value: unknown, where = 'value'): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new BackupError('malformed', `${where} is a number that JSON cannot hold exactly.`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new BackupError('malformed', `${where} is a list with a missing item.`);
      items.push(canonicalJson(value[index], `${where}[${index}]`));
    }
    return `[${items.join(',')}]`;
  }
  if (isPlainObject(value)) {
    if (Object.getOwnPropertySymbols(value).length) throw new BackupError('malformed', `${where} has a member that JSON cannot hold.`);
    const members = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], `${where}.${key}`)}`);
    return `{${members.join(',')}}`;
  }
  throw new BackupError('malformed', `${where} is a value that JSON cannot hold (${value === undefined ? 'undefined' : Object.prototype.toString.call(value)}).`);
}

/** True when both are the same JSON value. A value JSON cannot hold is never the same as anything. */
export function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

/** Lower-case hexadecimal SHA-256 of a text, computed by the browser. */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new BackupError('unavailable', 'This page cannot compute a SHA-256 digest. A backup needs it to prove that the file is intact. Open the application over HTTPS.');
  }
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The digest of one section: SHA-256 of its canonical JSON text. */
export function sectionDigest(section: DatabaseSection | LegacySection): Promise<string> {
  return sha256Hex(canonicalJson(section, 'section'));
}

/** True when the section has this digest. A section with a value that JSON cannot hold has no digest, so it never has this one. */
export async function hasDigest(section: DatabaseSection | LegacySection, digest: string): Promise<boolean> {
  try {
    return (await sectionDigest(section)) === digest;
  } catch {
    return false;
  }
}

/** `2026-11-25T14:03:22.123Z`: the form `Date.prototype.toISOString` writes. */
export function isIsoTime(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

/** The name of a backup file made at the given time, for example `eng-trainer-backup-20261125-140322.json`. */
export function backupFileName(exportedAt: string): string {
  const [date, time] = exportedAt.split('T');
  return `${BACKUP_FORMAT}-${date.replace(/-/g, '')}-${time.slice(0, 8).replace(/:/g, '')}.json`;
}
