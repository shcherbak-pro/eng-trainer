// Built-in content per product (ENG-V3-01).
//
//   stable-v2        content/catalog.json + content/packs/*   -> public/data/
//   experimental-v3  the same released baseline + content/v3/  -> its own staged public folder
//
// The released sources are the baseline of every product and are never edited for the
// experimental one. Its changes belong to content/v3/overlay.json. In ENG-V3-01 that
// overlay must be empty, so the experimental catalog equals the released one byte for
// byte; the entry ledger that applies changes is a later milestone.
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildContent, jsonText, sha256 } from './content-build.mjs';
import { EXPERIMENTAL_PUBLIC_DIR, removeGeneratedDir } from './generated-dirs.mjs';
import { EXPERIMENTAL_PRODUCT, STABLE_PRODUCT, isAppProduct, repoRoot } from './site-config.mjs';

export const OVERLAY_FILE = 'overlay.json';

/**
 * The staged public folder of each product that has one. These are constants of the code
 * (scripts/generated-dirs.mjs). The configuration must name the same folder, but the
 * folder that is deleted is always taken from here, never from the configuration.
 */
const STAGED_PUBLIC_DIRS = { [EXPERIMENTAL_PRODUCT]: EXPERIMENTAL_PUBLIC_DIR };
const OVERLAY_KEYS = ['baseline', 'blocks', 'changes', 'schemaVersion', 'variant'];
const BASELINE_KEYS = ['commit', 'manifestSha256'];

const sameKeys = (value, expected) => {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
};

/**
 * Reads a product's overlay folder strictly. Unknown files, unknown keys and any
 * content change are errors: nothing here is applied silently or skipped.
 */
export async function readOverlay(overlayDir, productId) {
  const where = `content overlay of ${productId}`;
  if (!existsSync(join(overlayDir, OVERLAY_FILE))) throw new Error(`${where}: ${OVERLAY_FILE} is missing`);
  const unexpected = (await readdir(overlayDir)).filter((name) => name !== OVERLAY_FILE);
  if (unexpected.length) {
    throw new Error(`${where}: unexpected ${unexpected.join(', ')}. ENG-V3-01 supports only an empty ${OVERLAY_FILE}; new packs and entry changes need the entry ledger.`);
  }

  const overlay = JSON.parse(await readFile(join(overlayDir, OVERLAY_FILE), 'utf8'));
  if (typeof overlay !== 'object' || overlay === null || Array.isArray(overlay) || !sameKeys(overlay, OVERLAY_KEYS)) {
    throw new Error(`${where}: must have exactly the keys ${OVERLAY_KEYS.join(', ')}`);
  }
  if (overlay.schemaVersion !== 1) throw new Error(`${where}: unsupported schemaVersion ${JSON.stringify(overlay.schemaVersion)}`);
  if (overlay.variant !== productId) throw new Error(`${where}: variant ${JSON.stringify(overlay.variant)} does not name this product`);
  const { baseline } = overlay;
  if (typeof baseline !== 'object' || baseline === null || !sameKeys(baseline, BASELINE_KEYS)) {
    throw new Error(`${where}: baseline must have exactly the keys ${BASELINE_KEYS.join(', ')}`);
  }
  if (!/^[0-9a-f]{40}$/.test(String(baseline.commit))) throw new Error(`${where}: baseline.commit must be a full commit id`);
  if (!/^[0-9a-f]{64}$/.test(String(baseline.manifestSha256))) throw new Error(`${where}: baseline.manifestSha256 must be a SHA-256`);
  for (const key of ['blocks', 'changes']) {
    if (!Array.isArray(overlay[key])) throw new Error(`${where}: ${key} must be a list`);
    if (overlay[key].length) {
      throw new Error(`${where}: ${key} is not empty. ENG-V3-01 supports only an empty overlay; the entry ledger is not implemented yet.`);
    }
  }
  return overlay;
}

/**
 * The effective catalog of a product: the released baseline plus that product's overlay.
 * The stable product ignores content/v3/ entirely.
 */
export async function buildProductContent(productId, contentDir = join(repoRoot, 'content')) {
  if (!isAppProduct(productId)) throw new Error(`No built-in content is generated for "${productId}"`);
  const baseline = await buildContent(contentDir);
  if (productId === STABLE_PRODUCT) return baseline;
  if (productId !== EXPERIMENTAL_PRODUCT) throw new Error(`No content rules for the product "${productId}"`);

  const overlay = await readOverlay(join(contentDir, 'v3'), productId);
  const manifestSha256 = sha256(jsonText(baseline.manifest));
  if (overlay.baseline.manifestSha256 !== manifestSha256) {
    throw new Error(`content overlay of ${productId}: its baseline is ${overlay.baseline.manifestSha256}, but the released sources now build ${manifestSha256}. The released content must not change under an overlay.`);
  }
  // An empty overlay changes nothing: the effective catalog is the baseline itself.
  return baseline;
}

/**
 * Writes a product's staged public folder: the static files of public/ and the product's
 * own generated data. The folder is rebuilt from nothing on every run, so a file of an
 * earlier run or of another product cannot stay in it. The stable folder public/ is
 * only read here; scripts/generate-content.mjs keeps writing public/data/ as before.
 *
 * This function deletes a folder, so it does not trust its caller. Whatever `site` says,
 * validated or not, the only folder it can remove is the product's own staged folder,
 * and only while that is a real folder inside the repository (see removeGeneratedDir).
 * A refusal happens before anything is removed or written.
 */
export async function stageProductPublic(site, productId) {
  const product = site.products[productId];
  if (!product || !isAppProduct(productId)) throw new Error(`"${productId}" has no staged public folder`);
  if (productId === STABLE_PRODUCT) throw new Error('The stable product uses public/ directly and is never staged');
  if (!Object.hasOwn(STAGED_PUBLIC_DIRS, productId)) throw new Error(`"${productId}" has no staged public folder`);
  const stagedDir = STAGED_PUBLIC_DIRS[productId];
  if (product.publicDir !== stagedDir) {
    throw new Error(`"${productId}" is staged in "${stagedDir}" and nowhere else, but its publicDir is ${JSON.stringify(product.publicDir)}. Nothing was removed or written.`);
  }

  const { manifest, assets } = await buildProductContent(productId);
  const stablePublic = join(repoRoot, site.products[STABLE_PRODUCT].publicDir);

  // The one removal of this module, checked on disk immediately before it happens.
  const target = await removeGeneratedDir(repoRoot, stagedDir, ['staged-public']);
  await mkdir(join(target, 'data', 'packs'), { recursive: true });
  for (const name of await readdir(stablePublic)) {
    // public/data/ holds the stable product's generated catalog. It never enters another product.
    if (name !== 'data') await cp(join(stablePublic, name), join(target, name), { recursive: true });
  }
  for (const asset of assets) await writeFile(join(target, 'data', asset.url), asset.text);
  await writeFile(join(target, 'data', 'manifest.json'), jsonText(manifest));
  return { manifest, assets, target };
}
