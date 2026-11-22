// Legacy projection (ENG-V2-03): the content released before this milestone, read back
// out of the larger catalog. Preservation checks compare it with the frozen baseline
// fingerprints and the released source, which are never regenerated.
import { CONTENT_KEYS } from '../content/packFormat.js';

/** @typedef {import('../content/types').Materials} Materials */
/** @typedef {import('../content/packTypes').BuiltInPack} BuiltInPack */

/** Everything ENG-V2-03 added: three thematic packs and the three blocks that open them. */
export const ENG_V2_03_ADDITIONS = Object.freeze({
  packs: Object.freeze(['conditionals', 'small-talk', 'interview-english']),
  blocks: Object.freeze(['topic-conditionals', 'topic-small-talk', 'topic-interview-english'])
});

/** The collections of the released catalog. `topics` did not exist before ENG-V2-03. */
export const LEGACY_KEYS = Object.freeze(CONTENT_KEYS.filter((key) => key !== 'topics'));

/**
 * The catalog without the ENG-V2-03 additions, in catalog order. Records are removed by
 * identity (the very objects the added packs contributed), never by equal text, so a
 * legacy record that was changed, moved into a new pack or removed changes the result.
 * @param {Materials} materials the assembled catalog
 * @param {BuiltInPack[]} packs the packs it was assembled from
 * @returns {Materials}
 */
export function legacyProjection(materials, packs) {
  const addedPacks = packs.filter((pack) => ENG_V2_03_ADDITIONS.packs.includes(pack.id));
  /** @type {Record<string, unknown>} */
  const projection = { meta: materials.meta, blocks: materials.blocks.filter((block) => !ENG_V2_03_ADDITIONS.blocks.includes(block.id)) };
  for (const key of LEGACY_KEYS) {
    /** @type {Map<unknown, number>} */
    const remaining = new Map();
    for (const item of addedPacks.flatMap((pack) => /** @type {unknown[]} */ (pack.content[key] ?? []))) remaining.set(item, (remaining.get(item) ?? 0) + 1);
    projection[key] = /** @type {unknown[]} */ (materials[key]).filter((item) => {
      const left = remaining.get(item) ?? 0;
      if (left === 0) return true;
      remaining.set(item, left - 1);
      return false;
    });
  }
  return /** @type {Materials} */ (/** @type {unknown} */ (projection));
}

/**
 * Topics that do not come from the ENG-V2-03 packs. The released catalog had none, so
 * this must stay empty for the projection to equal it.
 * @param {BuiltInPack[]} packs
 */
export function topicsOutsideAdditions(packs) {
  return packs.filter((pack) => !ENG_V2_03_ADDITIONS.packs.includes(pack.id)).flatMap((pack) => pack.content.topics ?? []);
}
