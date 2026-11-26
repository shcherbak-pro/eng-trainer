import { BackupError, LEGACY_KEYS, LEGACY_STORAGE, type LegacySection } from './format';

/**
 * Reads the two records of the first version (ENG-V3-R1A).
 *
 * The first version keeps its learning state in the browser's key-value storage, under
 * two names. This module reads those two names and nothing else, and it only ever reads:
 * it has no call that writes, removes or clears a record. Everything in the Backup
 * screen's file that looks at that storage goes through here. The one module that writes
 * it is recoveryWriter.ts, a file of its own.
 *
 * It runs when the learner asks for a backup, and for the preview of a recovery of a file
 * that the learner selected. It never runs at start-up or while learning.
 */
export type LegacyRead = { state: 'absent' } | { state: 'ok'; section: LegacySection };

/** The reading half of the browser's key-value storage: all this module is given. */
export type LegacyReader = { getItem(key: string): string | null };

function browserStorage(): LegacyReader {
  const storage = globalThis.localStorage;
  // A reader with one method, so the rest of the storage interface is out of reach here.
  return { getItem: (key) => storage.getItem(key) };
}

export function readLegacyRecords(reader?: LegacyReader): LegacyRead {
  const section: LegacySection = { storage: LEGACY_STORAGE, records: {} };
  try {
    const source = reader ?? browserStorage();
    for (const key of LEGACY_KEYS) {
      const value = source.getItem(key);
      if (value !== null) section.records[key] = value;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new BackupError('unavailable', `The storage of the previous version could not be read: ${detail}`, { cause: error });
  }
  return Object.keys(section.records).length ? { state: 'ok', section } : { state: 'absent' };
}
