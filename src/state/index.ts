import { openStorage, StorageAbortError, type OpenStorageOptions } from '../storage/database';
import { changesHeld, connectStorage, disablePersistence, holdChanges, releaseChanges, type ChangeHold } from './persistence';
import { progress, PROGRESS_KEYS, type ProgressState } from './progress';
import { settings, SETTING_KEYS, type SettingKey } from './settings';
import { viewState } from './viewState';
import { connectCollections, disableCollections, holdCollections, readCollections } from '../collections/service';

/**
 * Opens the database and loads the saved state.
 *
 * Nothing is written before this has finished: the services start persisting
 * only after the saved records have replaced their defaults. If the database
 * cannot be opened or read, this rejects and nothing is written at all, so
 * defaults can never overwrite saved data.
 *
 * `options.onBlocked` keeps waiting while another tab blocks the database
 * upgrade (see openStorage). After `options.signal` is aborted, a late
 * connection is closed and no saved state is applied: a newer start-up attempt
 * or "Continue without saving" stays in charge.
 */
export async function initState(options: OpenStorageOptions = {}): Promise<void> {
  const storage = await openStorage(options);

  try {
    const records = await storage.readAll();
    if (options.signal?.aborted) throw new StorageAbortError();
    const collections = readCollections(records);
    progress.hydrate(records);
    settings.hydrate(records);
    connectCollections(storage, collections);
  } catch (error) {
    storage.close();
    throw error;
  }

  connectStorage(storage);
}

/** Lets the app run with default state when storage is unavailable. Nothing is saved. */
export function initStateWithoutStorage(): void {
  disablePersistence();
  disableCollections();
}

/**
 * The hold on changes for a recovery from a backup (ENG-V3-R1A-RC3, experimental product only;
 * the contract is at `holdChanges` in ./persistence.ts). It covers both ways in which this
 * application writes its database: the state services, and the collections.
 *
 * `holdState` answers `held` only when nothing was waiting to be saved. From then until
 * `releaseState` no change of progress, preferences or collections is accepted, and nothing
 * is written. `stateHeld` is what the shell asks before it changes the screen.
 */
export function holdState(): ChangeHold {
  const hold = holdChanges();
  if (hold === 'held') holdCollections(true);
  return hold;
}

export function releaseState(): void {
  holdCollections(false);
  releaseChanges();
}

export function stateHeld(): boolean {
  return changesHeld();
}

/**
 * "Reset progress": clears the learning state and puts the preferences back to
 * their defaults (the theme is kept). Only records of the v2 database change,
 * and they change in one transaction. Imported collections are not touched.
 */
export function resetAllState(): void {
  progress.reset();
  settings.reset();
  viewState.reset();
}

type ResetItem = { label: string; progressKeys?: (keyof ProgressState)[]; settingKeys?: SettingKey[] };

/**
 * What Reset progress changes, for the confirmation dialog. It is derived from
 * the reset above: every learning-state field and every preference except the
 * theme. A test checks that this list covers exactly what resetAllState() clears.
 */
export const RESET_PROGRESS_SUMMARY: { clears: ResetItem[]; keeps: string[] } = {
  clears: [
    { label: 'Phrases you marked as learned', progressKeys: ['learnedPhrases'] },
    { label: 'Hidden phrases, words and verbs', progressKeys: ['hiddenPhrases', 'hiddenWords', 'hiddenIrregular'] },
    { label: 'Your Focus list', progressKeys: ['favoriteBlocks', 'favoritePhrases', 'favoriteWords', 'favoriteIrregular'] },
    { label: 'Your Learn passes and the selected pass', progressKeys: ['learnPasses', 'selectedLearnPassId'] },
    { label: 'Your place in every flashcard deck', progressKeys: ['flashcardSessions'] },
    {
      label: 'Preferences: filters, list sizes, open panels, deck choice, listening repeats and the last page you opened',
      settingKeys: SETTING_KEYS.filter((key) => key !== 'theme')
    }
  ],
  keeps: ['Your imported vocabulary collections', 'Your theme', 'The built-in study material']
};

/** Every learning-state field and preference named by the summary (used by the tests). */
export function resetSummaryCoverage(): { progressKeys: string[]; settingKeys: string[]; allProgressKeys: string[]; allSettingKeys: string[] } {
  return {
    progressKeys: RESET_PROGRESS_SUMMARY.clears.flatMap((item) => item.progressKeys ?? []),
    settingKeys: RESET_PROGRESS_SUMMARY.clears.flatMap((item) => item.settingKeys ?? []),
    allProgressKeys: [...PROGRESS_KEYS],
    allSettingKeys: [...SETTING_KEYS]
  };
}

export { progress, settings, viewState };
