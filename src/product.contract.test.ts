import { openDB } from 'idb';
import { beforeEach, expect, it } from 'vitest';
import { DATABASE_NAME, DATABASE_VERSION, META_STORE_NAME, STATE_STORE_NAMES, STORE_NAMES, openStorage } from './storage/database';
import { contentBase } from './test/content';
import { resetDatabase } from './test/database';
import { EXPERIMENTAL_PAGES, describeExperimental, describeStable, productBase, v1Url } from './test/product';

/**
 * The literal contract of each product (ENG-V3-01).
 *
 * The shared suite takes addresses and the database name from the product under test,
 * so that it holds for both products. This file pins the actual values. The stable
 * values are the released ones: a change here is a change of the released product.
 */
const SHARED_STORES = ['progress', 'learnPasses', 'flashcardSessions', 'settings', 'userCollections', 'userEntries'];

beforeEach(() => {
  resetDatabase();
});

async function schemaOf(name: string): Promise<{ version: number; stores: string[] }> {
  const db = await openDB(name);
  const schema = { version: db.version, stores: [...db.objectStoreNames].sort() };
  db.close();
  return schema;
}

describeStable('stable-v2: the released contract, as literals', () => {
  it('is the stable product at the site root, without the pronunciation capability', () => {
    expect(__ENG_PRODUCT__).toBe('stable-v2');
    expect(__ENG_PRONUNCIATION__).toBe(false);
    expect(__SITE_BASE__).toBe('/eng-trainer/');
    expect(import.meta.env.BASE_URL).toBe('/eng-trainer/');
    expect(productBase).toBe('/eng-trainer/');
    expect(EXPERIMENTAL_PAGES).toEqual([]);
  });

  it('loads content from /eng-trainer/data/, and links to Home and to v1 at the released addresses', () => {
    expect(contentBase).toBe('/eng-trainer/data/');
    expect(`${productBase}#index`).toBe('/eng-trainer/#index');
    expect(v1Url).toBe('/eng-trainer/v1/');
  });

  it('uses the database eng-trainer-v2 at version 2 with exactly the six released stores', async () => {
    expect(__ENG_DATABASE__).toBe('eng-trainer-v2');
    expect(DATABASE_NAME).toBe('eng-trainer-v2');
    expect(DATABASE_VERSION).toBe(2);
    expect([...STATE_STORE_NAMES]).toEqual(['progress', 'learnPasses', 'flashcardSessions', 'settings']);
    expect([...STORE_NAMES]).toEqual(SHARED_STORES);

    (await openStorage()).close();
    expect(await schemaOf('eng-trainer-v2')).toEqual({ version: 2, stores: [...SHARED_STORES].sort() });
    expect((await schemaOf('eng-trainer-v2')).stores).not.toContain(META_STORE_NAME);
    expect((await indexedDB.databases()).map((db) => db.name)).toEqual(['eng-trainer-v2']);
  });
});

describeExperimental('experimental-v3: its own contract, as literals', () => {
  it('is the experimental product, built with the pronunciation capability', () => {
    expect(__ENG_PRODUCT__).toBe('experimental-v3');
    expect(__ENG_PRONUNCIATION__).toBe(true);
    expect(EXPERIMENTAL_PAGES).toEqual(['pronunciation']);
  });

  it('has its own base path below the site base, and links to v1 at the site base', () => {
    expect(__SITE_BASE__).toBe('/eng-trainer/');
    expect(import.meta.env.BASE_URL).toBe('/eng-trainer/v3/');
    expect(contentBase).toBe('/eng-trainer/v3/data/');
    expect(`${productBase}#index`).toBe('/eng-trainer/v3/#index');
    expect(v1Url).toBe('/eng-trainer/v1/');
  });

  it('uses the database eng-trainer-v3 at version 1: the six shared stores plus meta', async () => {
    expect(__ENG_DATABASE__).toBe('eng-trainer-v3');
    expect(DATABASE_NAME).toBe('eng-trainer-v3');
    expect(DATABASE_VERSION).toBe(1);
    expect([...STORE_NAMES]).toEqual(SHARED_STORES);
    expect(META_STORE_NAME).toBe('meta');

    (await openStorage()).close();
    expect(await schemaOf('eng-trainer-v3')).toEqual({ version: 1, stores: [...SHARED_STORES, 'meta'].sort() });
    expect((await indexedDB.databases()).map((db) => db.name)).toEqual(['eng-trainer-v3']);
  });

  it('lists the other published versions from the route list: the stable version and v1', () => {
    expect(__ENG_VERSION_LINKS__).toEqual([
      { product: 'stable-v2', href: '/eng-trainer/' },
      { product: 'legacy-v1', href: '/eng-trainer/v1/' }
    ]);
  });
});
