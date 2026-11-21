import { openStorage } from '../storage/database';
import { connectStorage, disablePersistence } from './persistence';
import { progress } from './progress';
import { settings } from './settings';
import { viewState } from './viewState';

/**
 * Opens the database and loads the saved state.
 *
 * Nothing is written before this has finished: the services start persisting
 * only after the saved records have replaced their defaults. If the database
 * cannot be opened or read, this rejects and nothing is written at all, so
 * defaults can never overwrite saved data.
 */
export async function initState(): Promise<void> {
  const storage = await openStorage();

  try {
    const records = await storage.readAll();
    progress.hydrate(records);
    settings.hydrate(records);
  } catch (error) {
    storage.close();
    throw error;
  }

  connectStorage(storage);
}

/** Lets the app run with default state when storage is unavailable. Nothing is saved. */
export function initStateWithoutStorage(): void {
  disablePersistence();
}

/**
 * "Reset progress": clears the learning state and puts the preferences back to
 * their defaults (the theme is kept). Only records of the v2 database change,
 * and they change in one transaction.
 */
export function resetAllState(): void {
  progress.reset();
  settings.reset();
  viewState.reset();
}

export { progress, settings, viewState };
