// Cheap structural checks of an assembled site, product by product (ENG-V3-01).
// They do not start a browser and do not test application behavior.
//
// Every address is derived from the route list: an application's scripts, stylesheets
// and fonts must live under that product's own base path, wherever it is published.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readGeneratedContent } from './content-build.mjs';
import { isAppProduct, repoRoot, routeUrl } from './site-config.mjs';

const FONT_LICENCES = ['OFL-Literata.txt', 'OFL-EngTrainerSans.txt', 'FONTLOG-EngTrainerSans.txt'];

/** Scripts and stylesheets that an entry page names, without absolute http(s) addresses. */
export function entryAssetUrls(html) {
  return [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1]).filter((url) => !/^https?:/.test(url));
}

/**
 * Checks the products assembled at `routes` inside `siteDir`.
 * Returns the problems found and the lines to print when there are none.
 */
export async function checkAssembledSite({ site, routes, siteDir, root = repoRoot }) {
  const problems = [];
  const notes = [];
  const base = join(root, siteDir);

  for (const route of routes) {
    const name = route.product;
    const dir = join(base, route.path);
    const address = routeUrl(site, route);
    const app = isAppProduct(name);
    const indexPath = join(dir, 'index.html');
    const assetsDir = join(dir, 'assets');
    const dataPath = join(dir, 'data', app ? 'manifest.json' : 'materials.json');

    for (const path of [indexPath, assetsDir, dataPath, join(dir, 'favicon.svg')]) {
      if (!existsSync(path)) problems.push(`${name}: missing ${path}`);
    }
    if (!existsSync(indexPath) || !existsSync(assetsDir)) continue;

    // Every script and stylesheet of the entry page must point into this
    // application's own assets folder, and the file must exist.
    const html = readFileSync(indexPath, 'utf8');
    const assetUrls = entryAssetUrls(html);
    if (!assetUrls.length) problems.push(`${name}: index.html references no script or stylesheet`);
    const assetNames = readdirSync(assetsDir);
    const prefix = `${address}assets/`;
    for (const url of assetUrls) {
      if (!url.startsWith(prefix)) problems.push(`${name}: ${url} is outside ${prefix}`);
      else if (!assetNames.includes(url.slice(prefix.length))) problems.push(`${name}: ${url} is referenced but not in the build`);
    }
    if (!app) continue;

    // The application serves its own fonts (ENG-V2-UX-01B): no third-party font or stylesheet
    // requests, every font file named by its stylesheets is in the build, and the font
    // licences are published. v1 is a separate, unchanged application.
    const texts = [html, ...assetNames.filter((file) => /\.(css|js)$/.test(file)).map((file) => readFileSync(join(assetsDir, file), 'utf8'))];
    if (texts.some((text) => /fonts\.(googleapis|gstatic)\.com/.test(text))) problems.push(`${name}: still references Google Fonts`);
    const stylesheets = assetNames.filter((file) => file.endsWith('.css')).map((file) => readFileSync(join(assetsDir, file), 'utf8'));
    const fontUrls = stylesheets.flatMap((css) => [...css.matchAll(/url\(\s*["']?([^"')]+\.woff2)["']?\s*\)/g)].map((match) => match[1]));
    if (!fontUrls.length) problems.push(`${name}: the stylesheet declares no self-hosted fonts`);
    for (const url of new Set(fontUrls)) {
      if (!url.startsWith(prefix)) problems.push(`${name}: font ${url} is outside ${prefix}`);
      else if (!assetNames.includes(url.slice(prefix.length))) problems.push(`${name}: font ${url} is referenced but not in the build`);
    }
    // The interface font is the renamed derivative "Eng Trainer Sans" (ENG-V2-UX-01B-RC1): its licence and
    // FONTLOG travel with it, and nothing of the replaced, reserved-name subsets may remain in the site.
    for (const licence of FONT_LICENCES) {
      if (!existsSync(join(dir, 'fonts', licence))) problems.push(`${name}: missing font licence fonts/${licence}`);
    }
    const css = stylesheets.join('\n');
    if (!/font-family:\s*["']?Eng Trainer Sans/.test(css)) problems.push(`${name}: the stylesheet does not declare Eng Trainer Sans`);
    if (/font-family:\s*["']?Source Sans 3/.test(css)) problems.push(`${name}: a stylesheet still declares the reserved family name Source Sans 3`);
    const stale = [
      ...assetNames.filter((file) => /^source-sans-3/i.test(file)).map((file) => `assets/${file}`),
      ...(existsSync(join(dir, 'fonts')) ? readdirSync(join(dir, 'fonts')).filter((file) => /SourceSans3/i.test(file)).map((file) => `fonts/${file}`) : [])
    ];
    if (stale.length) problems.push(`${name}: replaced font files are still published: ${stale.join(', ')}`);
    notes.push(`${name} fonts: ${new Set(fontUrls).size} self-hosted font files under ${prefix}, licences and FONTLOG published, no Google Fonts references, no replaced subsets.`);

    try {
      const { manifest } = await readGeneratedContent(join(dir, 'data'));
      if (existsSync(join(dir, 'data', 'materials.json'))) problems.push(`${name}: obsolete monolithic materials.json is still published`);
      notes.push(`${name} content: verified manifest and all ${manifest.packs.length} pack hashes, identities, counts and links.`);
    } catch (error) {
      problems.push(`${name} content: ${error.message}`);
    }
  }

  return { problems, notes };
}
