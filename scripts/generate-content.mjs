// Generates the built-in content of one product.
//
//   node scripts/generate-content.mjs                    stable-v2 (the default): public/data/
//   node scripts/generate-content.mjs experimental-v3    that product's own staged public folder
//
// Two products never share a generated folder (ENG-V3-01).
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContent, jsonText } from './content-build.mjs';
import { stageProductPublic } from './product-content.mjs';
import { STABLE_PRODUCT, loadSiteConfig } from './site-config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const productId = process.argv[2] ?? STABLE_PRODUCT;

if (productId !== STABLE_PRODUCT) {
  const site = loadSiteConfig();
  if (!Object.hasOwn(site.products, productId)) {
    console.error(`Unknown product "${productId}". Configured products: ${Object.keys(site.products).join(', ')}`);
    process.exit(1);
  }
  const { manifest, assets } = await stageProductPublic(site, productId);
  console.log(`Generated ${assets.length} built-in packs for ${productId} in ${site.products[productId].publicDir}/data: ${JSON.stringify(manifest.counts)}`);
} else {
  const output = join(root, 'public', 'data');
  const { manifest, assets } = await buildContent(join(root, 'content'));
  await mkdir(join(output, 'packs'), { recursive: true });
  for (const asset of assets) await writeFile(join(output, asset.url), asset.text);
  await writeFile(join(output, 'manifest.json'), jsonText(manifest));

  // Only generated, content-addressed files belong to this output directory.
  // Never remove source packs, v1 files, or arbitrary files in public/data/.
  const current = new Set(assets.map((asset) => asset.url.slice('packs/'.length)));
  for (const name of await readdir(join(output, 'packs'))) {
    if (/^[a-z0-9-]+\.[a-f0-9]{16}\.json$/.test(name) && !current.has(name)) await unlink(join(output, 'packs', name));
  }
  console.log(`Generated ${assets.length} built-in packs: ${JSON.stringify(manifest.counts)}`);
}
