// Cheap structural checks of the assembled site in site-dist/.
// It does not start a browser and does not test application behavior.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGeneratedContent } from './content-build.mjs';

const site = join(dirname(fileURLToPath(import.meta.url)), '..', 'site-dist');

const apps = [
  { name: 'v2', dir: site, base: '/eng-trainer/' },
  { name: 'v1', dir: join(site, 'v1'), base: '/eng-trainer/v1/' }
];

const problems = [];

for (const app of apps) {
  const indexPath = join(app.dir, 'index.html');
  const assetsDir = join(app.dir, 'assets');
  const dataPath = join(app.dir, 'data', app.name === 'v2' ? 'manifest.json' : 'materials.json');

  for (const path of [indexPath, assetsDir, dataPath, join(app.dir, 'favicon.svg')]) {
    if (!existsSync(path)) problems.push(`${app.name}: missing ${path}`);
  }
  if (!existsSync(indexPath) || !existsSync(assetsDir)) continue;

  // Every script and stylesheet of the entry page must point into this
  // application's own assets folder, and the file must exist.
  const html = readFileSync(indexPath, 'utf8');
  const assetUrls = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
    .map((match) => match[1])
    .filter((url) => !/^https?:/.test(url));
  if (!assetUrls.length) problems.push(`${app.name}: index.html references no script or stylesheet`);

  const assetFiles = new Set(readdirSync(assetsDir));
  for (const url of assetUrls) {
    const prefix = `${app.base}assets/`;
    if (!url.startsWith(prefix)) {
      problems.push(`${app.name}: ${url} is outside ${prefix}`);
    } else if (!assetFiles.has(url.slice(prefix.length))) {
      problems.push(`${app.name}: ${url} is referenced but not in the build`);
    }
  }
}

try {
  const { manifest } = await readGeneratedContent(join(site, 'data'));
  if (existsSync(join(site, 'data', 'materials.json'))) problems.push('v2: obsolete monolithic materials.json is still published');
  console.log(`v2 content: verified manifest and all ${manifest.packs.length} pack hashes, identities, counts and links.`);
} catch (error) {
  problems.push(`v2 content: ${error.message}`);
}

if (problems.length) {
  console.error(`site-dist check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

console.log('site-dist check passed: both entry pages, their assets and data are in place.');
