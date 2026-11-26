import { DATABASE_SCHEMAS, LEGACY_KEYS, LEGACY_STATE_KEY, STABLE_PRODUCT, hasDigest, type LegacyKey, type LegacySection } from './format';
import { readLegacyRecords } from './legacyStorage';
import { readDatabaseSnapshot } from './snapshot';
import { learningDataIn, legacyLearningDataIn } from './summary';

/**
 * What the storage of the other two products holds now, for the preview of a recovery
 * into them (ENG-V3-R1A-RC1).
 *
 * This module only reads. It runs after the learner selected a backup file that holds a
 * section of that product, and it answers one question: may that section be written
 * here? The answer is for the preview. The writer (recoveryWriter.ts) asks again at the
 * moment it writes.
 */
export const STABLE_SCHEMA = DATABASE_SCHEMAS[STABLE_PRODUCT];

export type StableDestination =
  /** The database exists with the released schema and holds no learning data: a recovery is possible. */
  | { state: 'empty' }
  /**
   * The database does not exist. The stable product creates it when it is opened. Nothing
   * else may: a recovery waits until the learner has opened the stable product once.
   */
  | { state: 'absent' }
  /** The database holds exactly the section it was compared with: there is nothing to recover. */
  | { state: 'identical' }
  /** Learning data exists, and it is not that of the section. `holds` describes it. */
  | { state: 'occupied'; holds: string[] }
  /** The database cannot be used for a recovery. */
  | { state: 'unavailable'; reason: string };

/**
 * The stable product's database: empty, absent, occupied or of a schema that is left alone.
 *
 * With `expectedDigest`, the digest of the section that would be recovered, a database
 * that holds exactly that section is reported as `identical`. That is how a recovery
 * that was written but could not be checked is checked later, from the file alone, and
 * why data that is the backup's is never shown as data to be reset.
 */
export async function inspectStableDestination(expectedDigest?: string): Promise<StableDestination> {
  try {
    const snapshot = await readDatabaseSnapshot(STABLE_SCHEMA);
    if (snapshot.state === 'absent') return { state: 'absent' };
    if (snapshot.state === 'unsupported') {
      return { state: 'unavailable', reason: `The saved data of the stable version has a storage schema (version ${snapshot.version}) that this version of the application does not know. It is never changed or upgraded from here.` };
    }
    const holds = learningDataIn(snapshot.stores);
    if (!holds.length) return { state: 'empty' };
    const held = { database: STABLE_SCHEMA.database, schemaVersion: STABLE_SCHEMA.schemaVersion, stores: snapshot.stores };
    if (expectedDigest !== undefined && (await hasDigest(held, expectedDigest))) return { state: 'identical' };
    return { state: 'occupied', holds };
  } catch (error) {
    return { state: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
  }
}

/** The two records of the first version, as far as they exist. */
export type LegacyRecords = Partial<Record<LegacyKey, string>>;

/**
 * What a recovery of the first version's section would do in a given storage.
 *
 * The first version keeps two records, and its storage has no transaction. So a recovery
 * can stop between them, and this plan is what makes the rest safe:
 *
 * - `empty`: no learning data here. The listed records are written, the state first.
 * - `partial`: the state record here is the text of the backup, character for character.
 *   That proves it was not changed since it was recovered, so only what is still missing
 *   (the theme) is written. The state is not written again.
 * - `identical`: both records are those of the backup. Nothing is written.
 * - `occupied`: learning data that is not the backup's. Nothing is written.
 * - `unavailable`: the state record cannot be read, so nothing can be said about it.
 */
export type LegacyPlan =
  | { state: 'empty'; writes: LegacyKey[] }
  | { state: 'partial'; writes: LegacyKey[] }
  | { state: 'identical' }
  | { state: 'occupied'; holds: string[] }
  | { state: 'unavailable'; reason: string };

export function planLegacyRecovery(current: LegacyRecords, section: LegacySection): LegacyPlan {
  const wanted = section.records;
  // In the order of the keys: the state, then the theme.
  const writes = LEGACY_KEYS.filter((key) => wanted[key] !== undefined && current[key] !== wanted[key]);
  if (!writes.length) return { state: 'identical' };
  if (wanted[LEGACY_STATE_KEY] !== undefined && current[LEGACY_STATE_KEY] === wanted[LEGACY_STATE_KEY]) return { state: 'partial', writes };

  const holds = legacyLearningDataIn(current[LEGACY_STATE_KEY] ?? null);
  if (holds === null) {
    return { state: 'unavailable', reason: 'The saved state of the previous version (v1) in this browser cannot be read, so it is unknown whether it holds learning data.' };
  }
  if (holds.length) return { state: 'occupied', holds };
  return { state: 'empty', writes };
}

/** The first version's storage, judged against the section that would be recovered. */
export function inspectLegacyDestination(section: LegacySection): LegacyPlan {
  try {
    const read = readLegacyRecords();
    return planLegacyRecovery(read.state === 'ok' ? read.section.records : {}, section);
  } catch (error) {
    return { state: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
  }
}
