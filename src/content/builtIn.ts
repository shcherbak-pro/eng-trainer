import { createCatalog, type ContentCatalog } from './catalog';
import { assembleMaterials, assertCounts, countContent, parseManifest, parsePack } from './packFormat.js';

/**
 * Loads the learning material that ships with the application.
 *
 * The manifest and every pack belong to this application's own base path.
 * All packs finish loading and validate before any screen receives a catalog.
 */
export async function loadBuiltInCatalog(): Promise<ContentCatalog> {
  const base = `${import.meta.env.BASE_URL}data/`;
  const manifest = parseManifest(await fetchJson(`${base}manifest.json`));
  const packs = await Promise.all(manifest.packs.map(async (entry) => {
    const pack = parsePack(await fetchJson(`${base}${entry.url}`));
    if (pack.id !== entry.id || pack.order !== entry.order || pack.title !== entry.title) {
      throw new Error(`Unexpected pack metadata in ${entry.url}`);
    }
    assertCounts(countContent(pack.content), entry.counts, entry.id);
    return pack;
  }));
  const materials = assembleMaterials(manifest, packs);
  assertCounts(countContent(materials), manifest.counts, 'catalog');
  return createCatalog(materials);
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load ${url} (HTTP ${response.status})`);
  try {
    return await response.json();
  } catch {
    throw new Error(`Invalid JSON in ${url}`);
  }
}
