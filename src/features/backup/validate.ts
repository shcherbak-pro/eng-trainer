import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BACKUP_WRITER,
  BackupError,
  DATABASE_SCHEMAS,
  DIGEST_ALGORITHM,
  LEGACY_KEYS,
  LEGACY_PRODUCT,
  LEGACY_STORAGE,
  MAX_BACKUP_BYTES,
  PRODUCTS,
  RESERVED_PRONUNCIATION_MEMBER,
  isIsoTime,
  isPlainObject,
  sectionDigest,
  type BackupFile,
  type DatabaseProduct,
  type DatabaseSection,
  type LegacySection,
  type ProductId
} from './format';
import { checkDatabaseRecords, checkLegacyRecords } from './records';

/**
 * Reads and validates a backup file (ENG-V3-R1A).
 *
 * A file is accepted as a whole or refused as a whole, with the reason. The checks use
 * nothing but the file: no record of an earlier export, no key and no setting has to
 * survive in the browser. That is the point of a backup: it must still work after the
 * browser lost everything.
 *
 * Order of the checks: size, UTF-8, JSON, the documented structure with no unknown
 * member, the digest of each section, then every record.
 */
const fail: (message: string, product?: ProductId) => never = (message, product) => {
  throw new BackupError('malformed', message, { product });
};

function requireMembers(value: unknown, members: string[], what: string, product?: ProductId): Record<string, unknown> {
  if (!isPlainObject(value)) return fail(`${what} is not an object.`, product);
  const found = Object.keys(value).sort();
  const wanted = [...members].sort();
  if (found.join('\n') !== wanted.join('\n')) {
    const unknown = found.filter((key) => !wanted.includes(key));
    const missing = wanted.filter((key) => !found.includes(key));
    const detail = [unknown.length ? `unknown: ${unknown.join(', ')}` : '', missing.length ? `missing: ${missing.join(', ')}` : ''].filter(Boolean).join('; ');
    return fail(`${what} must have exactly the members ${wanted.join(', ')} (${detail}).`, product);
  }
  return value;
}

/** A database section with the identity, the stores and the pair lists of its product. Records are not judged here. */
export function checkDatabaseStructure(product: DatabaseProduct, value: unknown): DatabaseSection {
  const schema = DATABASE_SCHEMAS[product];
  const what = `The section "${product}"`;
  if (isPlainObject(value) && RESERVED_PRONUNCIATION_MEMBER in value) {
    throw new BackupError('unsupported-version', `${what} holds pronunciation records. This version of the application cannot read them, and it does not leave them out.`, { product });
  }
  const section = requireMembers(value, ['database', 'schemaVersion', 'stores'], what, product);
  if (section.database !== schema.database) fail(`${what} names the storage ${JSON.stringify(section.database)}, not "${schema.database}".`, product);
  if (section.schemaVersion !== schema.schemaVersion) {
    throw new BackupError('unsupported-version', `${what} has the storage schema ${JSON.stringify(section.schemaVersion)}. This version of the application reads schema ${schema.schemaVersion} only.`, { product });
  }
  const stores = requireMembers(section.stores, [...schema.stores], `${what}: stores`, product);
  for (const name of schema.stores) {
    const pairs = stores[name];
    if (!Array.isArray(pairs)) return fail(`${what}: the store "${name}" is not a list.`, product);
    let previous: string | undefined;
    for (const pair of pairs) {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !pair[0]) return fail(`${what}: the store "${name}" has an item that is not a pair of a key and a value.`, product);
      // Ascending order makes every record have one place, and a key appear once.
      if (previous !== undefined && !(previous < pair[0])) return fail(`${what}: the keys of the store "${name}" are not in ascending order, or one is repeated.`, product);
      previous = pair[0];
    }
  }
  return section as DatabaseSection;
}

/** The section of the first version: the name of its storage and one or both of its two records, as text. */
export function checkLegacyStructure(value: unknown): LegacySection {
  const what = `The section "${LEGACY_PRODUCT}"`;
  const section = requireMembers(value, ['records', 'storage'], what, LEGACY_PRODUCT);
  if (section.storage !== LEGACY_STORAGE) fail(`${what} names the storage ${JSON.stringify(section.storage)}, not "${LEGACY_STORAGE}".`, LEGACY_PRODUCT);
  if (!isPlainObject(section.records)) return fail(`${what}: records is not an object.`, LEGACY_PRODUCT);
  const keys = Object.keys(section.records);
  if (!keys.length) fail(`${what} holds no record.`, LEGACY_PRODUCT);
  for (const key of keys) {
    if (!(LEGACY_KEYS as readonly string[]).includes(key)) fail(`${what}: "${key}" is not a record of the previous version.`, LEGACY_PRODUCT);
    if (typeof section.records[key] !== 'string') fail(`${what}: the record "${key}" is not text.`, LEGACY_PRODUCT);
  }
  return section as LegacySection;
}

/** Structure and records of one section. The same check runs when a backup is made and when it is read. */
export function checkSection(product: ProductId, value: unknown): DatabaseSection | LegacySection {
  if (product === LEGACY_PRODUCT) {
    const section = checkLegacyStructure(value);
    checkLegacyRecords(product, section);
    return section;
  }
  const section = checkDatabaseStructure(product, value);
  checkDatabaseRecords(product, section);
  return section;
}

/** The parts of the file around its sections: format, version, writer, the list of sections and their digests. */
function checkEnvelope(value: unknown): BackupFile {
  if (!isPlainObject(value)) throw new BackupError('not-a-backup', 'The file holds JSON, but not a backup of this application.');
  if (value.format !== BACKUP_FORMAT) {
    const hint = value.format === 'eng-trainer-vocabulary' ? ' It is a vocabulary export: import it on the Collections screen.' : '';
    throw new BackupError('not-a-backup', `The file is not a backup of this application.${hint}`);
  }
  if (value.version !== BACKUP_VERSION) {
    const newer = typeof value.version === 'number' && value.version > BACKUP_VERSION;
    throw new BackupError('unsupported-version', `The file is a backup of format version ${JSON.stringify(value.version)}. This version of the application reads version ${BACKUP_VERSION} only.${newer ? ' The file was made by a newer version of the application.' : ''}`);
  }
  const file = requireMembers(value, ['exportedAt', 'exportedBy', 'format', 'integrity', 'sections', 'version'], 'The file');
  if (!isIsoTime(file.exportedAt)) fail('The file: exportedAt is not a time.');
  const writer = requireMembers(file.exportedBy, ['product'], 'The file: exportedBy');
  if (writer.product !== BACKUP_WRITER) fail(`The file names ${JSON.stringify(writer.product)} as its writer. Only "${BACKUP_WRITER}" writes backups.`);

  if (!isPlainObject(file.sections)) return fail('The file: sections is not an object.');
  const sections = Object.keys(file.sections);
  if (!sections.length) fail('The file holds no section, so it holds no data.');
  for (const product of sections) {
    if (!(PRODUCTS as readonly string[]).includes(product)) fail(`The file has a section for "${product}", which is not a product of this application.`);
  }

  const integrity = requireMembers(file.integrity, ['algorithm', 'sections'], 'The file: integrity');
  if (integrity.algorithm !== DIGEST_ALGORITHM) fail(`The file: the digest algorithm is ${JSON.stringify(integrity.algorithm)}, not "${DIGEST_ALGORITHM}".`);
  const digests = requireMembers(integrity.sections, sections, 'The file: integrity.sections');
  for (const product of sections) {
    if (typeof digests[product] !== 'string' || !/^[0-9a-f]{64}$/.test(digests[product] as string)) fail(`The file: the digest of the section "${product}" is not a SHA-256 value.`);
  }
  return file as BackupFile;
}

/**
 * Validates a parsed file completely: structure, digests, records.
 * Resolves with the file, typed, or rejects with a `BackupError`.
 */
export async function validateBackup(value: unknown): Promise<BackupFile> {
  const file = checkEnvelope(value);
  const products = PRODUCTS.filter((product) => product in file.sections);

  // Structure first: a digest is only meaningful over a section of the documented form.
  for (const product of products) {
    if (product === LEGACY_PRODUCT) checkLegacyStructure(file.sections[product]);
    else checkDatabaseStructure(product, file.sections[product]);
  }
  for (const product of products) {
    const section = file.sections[product] as DatabaseSection | LegacySection;
    if ((await sectionDigest(section)) !== file.integrity.sections[product]) {
      throw new BackupError('integrity', `The section "${product}" does not match its digest. The file is damaged, or it was changed after it was made.`, { product });
    }
  }
  for (const product of products) {
    if (product === LEGACY_PRODUCT) checkLegacyRecords(product, file.sections[product] as LegacySection);
    else checkDatabaseRecords(product, file.sections[product] as DatabaseSection);
  }
  return file;
}

/** Reads the bytes of a file that the learner selected. Nothing is stored and nothing is sent. */
export async function readBackup(bytes: ArrayBuffer | Uint8Array): Promise<BackupFile> {
  if (bytes.byteLength > MAX_BACKUP_BYTES) {
    throw new BackupError('too-large', `The file is larger than ${MAX_BACKUP_BYTES / 1024 / 1024} MiB. A backup of this application is much smaller.`);
  }
  if (bytes.byteLength === 0) throw new BackupError('empty', 'The file is empty.');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new BackupError('not-utf8', 'The file is not UTF-8 text, so it is not a backup of this application.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError('not-json', 'The file is not complete JSON. It may be cut short or damaged.');
  }
  return validateBackup(parsed);
}
