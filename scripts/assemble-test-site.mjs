// Test-only assembly of every product, published or not, into .site-test/:
//
//   dist/      (stable-v2)        -> .site-test/
//   v1/dist/   (legacy-v1)        -> .site-test/v1/
//   dist-v3/   (experimental-v3)  -> .site-test/v3/
//
// It exists for local browser checks with synthetic data. The folder is ignored by Git
// and is never uploaded: the workflow uploads site-dist/ only, and this script cannot
// write there. It does not change what is published.
import { TEST_SITE_DIR, assembleRoutes, describeAssembly } from './site-assembly.mjs';
import { loadSiteConfig } from './site-config.mjs';

try {
  const site = loadSiteConfig();
  const assembled = await assembleRoutes({ site, routes: site.routes, target: TEST_SITE_DIR });
  console.log(`${describeAssembly(site, TEST_SITE_DIR, assembled)} Test only: not for publication.`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
