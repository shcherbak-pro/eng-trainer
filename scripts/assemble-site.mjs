// Assembles the GitHub Pages site from the product builds that are published:
//
//   dist/      (stable-v2, built by `npm run build`)      -> site-dist/
//   v1/dist/   (legacy-v1, built by `npm run build:v1`)   -> site-dist/v1/
//
// Which products are published is the committed `publish` flag of each route in
// site.config.json. This script takes no argument and reads no environment variable,
// so nothing but a reviewed change of that file can add a product to the site.
// A product whose route says `"publish": false` is never copied here.
//
// The script only copies compiled files. It never builds, and it never touches the
// build directories.
import { PRODUCTION_SITE_DIR, assembleRoutes, describeAssembly } from './site-assembly.mjs';
import { loadSiteConfig, publishedRoutes } from './site-config.mjs';

try {
  const site = loadSiteConfig();
  const assembled = await assembleRoutes({ site, routes: publishedRoutes(site), target: PRODUCTION_SITE_DIR });
  console.log(describeAssembly(site, PRODUCTION_SITE_DIR, assembled));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
