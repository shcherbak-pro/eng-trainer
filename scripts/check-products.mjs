// The product gates, run before the Pages artifact is uploaded (ENG-V3-01).
//
//   npm run build:site     stable-v2 and legacy-v1, assembled into site-dist/
//   npm run build:v3       experimental-v3 into dist-v3/
//   npm run check:products
//
// Any failing gate exits with an error, which stops the workflow before the upload.
// The script takes no argument and reads no environment variable.
import { PRODUCTION_SITE_DIR } from './site-assembly.mjs';
import { readLocks, reportGates, runProductGates } from './product-gates.mjs';
import { EXPERIMENTAL_PRODUCT, loadSiteConfig } from './site-config.mjs';

const site = loadSiteConfig();
if (!Object.hasOwn(site.products, EXPERIMENTAL_PRODUCT)) {
  console.error(`site.config.json does not configure "${EXPERIMENTAL_PRODUCT}". The product gates check both application products.`);
  process.exit(1);
}

const results = await runProductGates({
  site,
  siteDir: PRODUCTION_SITE_DIR,
  experimentalDir: site.products[EXPERIMENTAL_PRODUCT].outDir,
  locks: readLocks()
});

if (!reportGates(results)) {
  console.error(`
Product gates failed. The site must not be uploaded.

The released-site lock is not updated to make a change pass. A change of the stable product
is a separate, approved stable release with its own lock.

Two local causes are not source changes. Neither occurs in CI, which builds from LF files on Linux:
- a checkout with CRLF line endings (such files are marked above);
- on Windows, a working directory spelled differently from the file system, for example with a
  lower-case drive letter. Svelte then derives other scoped class names, and the script, the
  stylesheet and the entry page change.`);
  process.exit(1);
}
console.log(`\nProduct gates passed: ${PRODUCTION_SITE_DIR}/ is the released site, and the experimental product is not in it.`);
