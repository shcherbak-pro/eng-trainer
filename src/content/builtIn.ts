import { createCatalog, type ContentCatalog } from './catalog';
import type { Materials } from './types';

/**
 * Loads the learning material that ships with the application.
 *
 * The JSON file is a static asset of this application, so its URL is resolved
 * against the application's own base path.
 */
export async function loadBuiltInCatalog(): Promise<ContentCatalog> {
  const url = `${import.meta.env.BASE_URL}data/materials.json`;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load ${url} (HTTP ${response.status})`);

  const materials = (await response.json()) as Materials;
  if (!materials || typeof materials !== 'object' || !materials.meta) {
    throw new Error(`Unexpected content in ${url}`);
  }

  return createCatalog(materials);
}
