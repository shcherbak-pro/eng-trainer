import { get } from 'svelte/store';
import { persistenceSettled, saveStatus } from '../../state/persistence';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BACKUP_WRITER,
  BackupError,
  DATABASE_SCHEMAS,
  DIGEST_ALGORITHM,
  EXPERIMENTAL_PRODUCT,
  LEGACY_PRODUCT,
  PRODUCTS,
  RESERVED_PRONUNCIATION_STORES,
  STABLE_PRODUCT,
  backupFileName,
  canonicalJson,
  sectionDigest,
  type BackupFile,
  type BackupSections,
  type DatabaseProduct,
  type DatabaseSection,
  type LegacySection,
  type ProductId
} from './format';
import { readLegacyRecords } from './legacyStorage';
import { readDatabaseSnapshot } from './snapshot';
import { summarizeDatabaseSection, summarizeLegacySection, type SectionSummary } from './summary';
import { checkSection, readBackup } from './validate';

/**
 * Makes a backup file (ENG-V3-R1A).
 *
 * Making a backup reads the saved data of all three products and writes nothing: no
 * database, no record of the first version and no note that a backup was made. The
 * application cannot know whether the learner kept the file, so it keeps no such claim.
 *
 * The reads of the other two products happen here, after the learner asked for a backup,
 * and nowhere else in the experimental product.
 *
 * Each section is checked with the same strict checks that a recovery applies, and the
 * finished text is read back once before it is offered. A file that this version would
 * later refuse is therefore never handed out.
 */
export type SourceReport =
  /** The product has saved data here, and it is in the backup. */
  | { product: ProductId; state: 'included'; summary: SectionSummary }
  /** The product has saved nothing in this browser. */
  | { product: ProductId; state: 'absent' }
  /** The product has saved data here that could not be read or checked. Nothing of it is in the backup. */
  | { product: ProductId; state: 'failed'; reason: string };

export type CollectedSections = { reports: SourceReport[]; sections: BackupSections };
export type ComposedBackup = { fileName: string; text: string; backup: BackupFile };

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function readDatabaseSource(product: DatabaseProduct): Promise<DatabaseSection | null> {
  const schema = DATABASE_SCHEMAS[product];
  const snapshot = await readDatabaseSnapshot(schema);
  if (snapshot.state === 'absent') return null;
  if (snapshot.state === 'unsupported') {
    if (snapshot.storeNames.some((name) => RESERVED_PRONUNCIATION_STORES.includes(name))) {
      throw new BackupError('unsupported-version', 'The saved data holds pronunciation records. This version of the application cannot back them up, and it does not leave them out.', { product });
    }
    if (snapshot.version < schema.schemaVersion) {
      throw new BackupError('unsupported-version', `The saved data has the older storage schema ${snapshot.version}. Open that version of the application once, so that it can bring its data up to date, then make the backup again.`, { product });
    }
    if (snapshot.version > schema.schemaVersion) {
      throw new BackupError('unsupported-version', `The saved data has the newer storage schema ${snapshot.version}. This version of the application reads schema ${schema.schemaVersion} only and cannot back it up.`, { product });
    }
    throw new BackupError('unsupported-version', `The saved data does not have the stores of storage schema ${schema.schemaVersion}.`, { product });
  }
  const section: DatabaseSection = { database: schema.database, schemaVersion: schema.schemaVersion, stores: snapshot.stores };
  checkSection(product, section);
  return section;
}

async function ownSource(): Promise<DatabaseSection | null> {
  // Changes that are on their way to the database belong to the backup. Wait for them.
  await persistenceSettled();
  if (get(saveStatus).state === 'error') {
    throw new BackupError('unavailable', 'Some of your latest changes are not saved yet. Use "Try again" in the message about saving, then make the backup again.', { product: EXPERIMENTAL_PRODUCT });
  }
  return readDatabaseSource(EXPERIMENTAL_PRODUCT);
}

async function legacySource(): Promise<LegacySection | null> {
  const read = readLegacyRecords();
  if (read.state === 'absent') return null;
  checkSection(LEGACY_PRODUCT, read.section);
  return read.section;
}

/**
 * Reads what each product has saved in this browser. One product that cannot be read
 * does not stop the others; it is reported, and the caller decides.
 */
export async function collectSections(): Promise<CollectedSections> {
  const reports: SourceReport[] = [];
  const sections: BackupSections = {};

  const collect = async <T extends DatabaseSection | LegacySection>(product: ProductId, read: () => Promise<T | null>, keep: (section: T) => SectionSummary): Promise<void> => {
    try {
      const section = await read();
      reports.push(section ? { product, state: 'included', summary: keep(section) } : { product, state: 'absent' });
    } catch (error) {
      reports.push({ product, state: 'failed', reason: reasonOf(error) });
    }
  };

  await collect(EXPERIMENTAL_PRODUCT, ownSource, (section) => {
    sections[EXPERIMENTAL_PRODUCT] = section;
    return summarizeDatabaseSection(section);
  });
  await collect(STABLE_PRODUCT, () => readDatabaseSource(STABLE_PRODUCT), (section) => {
    sections[STABLE_PRODUCT] = section;
    return summarizeDatabaseSection(section);
  });
  await collect(LEGACY_PRODUCT, legacySource, (section) => {
    sections[LEGACY_PRODUCT] = section;
    return summarizeLegacySection(section);
  });
  return { reports, sections };
}

/** Builds the file from the collected sections and proves that it can be read back. */
export async function composeBackup(sections: BackupSections, now: Date = new Date()): Promise<ComposedBackup> {
  const products = PRODUCTS.filter((product) => sections[product]);
  if (!products.length) throw new BackupError('empty', 'No version of the application has saved data in this browser, so there is nothing to back up.');

  const exportedAt = now.toISOString();
  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    exportedBy: { product: BACKUP_WRITER },
    sections: {},
    integrity: { algorithm: DIGEST_ALGORITHM, sections: {} }
  };
  for (const product of products) {
    const section = sections[product] as DatabaseSection & LegacySection;
    backup.sections[product] = section;
    backup.integrity.sections[product] = await sectionDigest(section);
  }

  const text = `${JSON.stringify(backup, null, 2)}\n`;
  // The file is judged by the reader that a recovery uses, from its bytes, before anyone gets it.
  const readBack = await readBackup(new TextEncoder().encode(text));
  if (canonicalJson(readBack) !== canonicalJson(backup)) {
    throw new BackupError('verification', 'The backup file did not read back as it was written. No file was made.');
  }
  return { fileName: backupFileName(exportedAt), text, backup };
}
