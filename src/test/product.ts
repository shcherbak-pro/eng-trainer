import { describe, it } from 'vitest';

/**
 * The product under test (ENG-V3-01).
 *
 * The shared suite runs once per product: `npm test` for stable-v2 and `npm run test:v3`
 * for experimental-v3. Shared tests take addresses and the database name from here, so
 * they hold for both products. The exact values of each product are pinned separately,
 * as literals, in src/product.contract.test.ts.
 */
export const isStable = __ENG_PRODUCT__ === 'stable-v2';
export const isExperimental = __ENG_PRODUCT__ === 'experimental-v3';

/** This product's own base path: its brand link, assets and content live here. */
export const productBase: string = import.meta.env.BASE_URL;
/** The preserved v1 application, at the base path of the whole site. */
export const v1Url = `${__SITE_BASE__}v1/`;

/** Screens that only the experimental product has, in navigation order. */
export const EXPERIMENTAL_PAGES: string[] = isExperimental ? ['pronunciation'] : [];

/**
 * Tests of the stable database lineage: the upgrade from version 1 to version 2 and a
 * tab that still holds version 1. The experimental database is a new lineage that
 * starts at version 1, so it has no older version to upgrade from or to be blocked by.
 * These tests therefore run for the stable product only and are reported as skipped
 * for the experimental one; src/storage/experimentalDatabase.test.ts covers its schema.
 */
export const describeStableLineage = describe.runIf(isStable);
export const itStableLineage = it.runIf(isStable);

/** Tests that exist for one product only. */
export const describeStable = describe.runIf(isStable);
export const describeExperimental = describe.runIf(isExperimental);
export const itStable = it.runIf(isStable);
export const itExperimental = it.runIf(isExperimental);
