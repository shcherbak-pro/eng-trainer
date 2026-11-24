// Cheap structural checks of an assembled site.
// It does not start a browser and does not test application behavior.
//
//   node scripts/check-site.mjs          site-dist/: the published routes (the Pages artifact)
//   node scripts/check-site.mjs --test   .site-test/: every route, for local checks only
//
// The released-site lock and the product gates are a separate step: scripts/check-products.mjs.
import { PRODUCTION_SITE_DIR, TEST_SITE_DIR } from './site-assembly.mjs';
import { checkAssembledSite } from './site-checks.mjs';
import { loadSiteConfig, publishedRoutes } from './site-config.mjs';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--test')) {
  console.error('Usage: node scripts/check-site.mjs [--test]');
  process.exit(1);
}
const testAssembly = args.includes('--test');
const site = loadSiteConfig();
const siteDir = testAssembly ? TEST_SITE_DIR : PRODUCTION_SITE_DIR;
const routes = testAssembly ? site.routes : publishedRoutes(site);

const { problems, notes } = await checkAssembledSite({ site, routes, siteDir });
if (problems.length) {
  console.error(`${siteDir} check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
for (const note of notes) console.log(note);
console.log(`${siteDir} check passed: ${routes.map((route) => route.product).join(', ')}: entry pages, their assets and data are in place.`);
