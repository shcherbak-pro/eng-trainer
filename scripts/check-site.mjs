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

// v2 serves its own fonts (ENG-V2-UX-01B): no third-party font or stylesheet
// requests, every font file named by its stylesheets is in the build, and the
// font licences are published. v1 is a separate, unchanged application.
const v2Assets = join(site, 'assets');
if (existsSync(v2Assets)) {
  const assetNames = readdirSync(v2Assets);
  const texts = [
    readFileSync(join(site, 'index.html'), 'utf8'),
    ...assetNames.filter((name) => /\.(css|js)$/.test(name)).map((name) => readFileSync(join(v2Assets, name), 'utf8'))
  ];
  if (texts.some((text) => /fonts\.(googleapis|gstatic)\.com/.test(text))) problems.push('v2: still references Google Fonts');
  const fontUrls = assetNames
    .filter((name) => name.endsWith('.css'))
    .flatMap((name) => [...readFileSync(join(v2Assets, name), 'utf8').matchAll(/url\(\s*["']?([^"')]+\.woff2)["']?\s*\)/g)].map((match) => match[1]));
  if (!fontUrls.length) problems.push('v2: the stylesheet declares no self-hosted fonts');
  for (const url of new Set(fontUrls)) {
    if (!url.startsWith('/eng-trainer/assets/')) problems.push(`v2: font ${url} is outside /eng-trainer/assets/`);
    else if (!assetNames.includes(url.slice('/eng-trainer/assets/'.length))) problems.push(`v2: font ${url} is referenced but not in the build`);
  }
  // The interface font is the renamed derivative "Eng Trainer Sans" (ENG-V2-UX-01B-RC1): its licence and
  // FONTLOG travel with it, and nothing of the replaced, reserved-name subsets may remain in the site.
  for (const licence of ['OFL-Literata.txt', 'OFL-EngTrainerSans.txt', 'FONTLOG-EngTrainerSans.txt']) {
    if (!existsSync(join(site, 'fonts', licence))) problems.push(`v2: missing font licence fonts/${licence}`);
  }
  const css = assetNames.filter((name) => name.endsWith('.css')).map((name) => readFileSync(join(v2Assets, name), 'utf8')).join('\n');
  if (!/font-family:\s*["']?Eng Trainer Sans/.test(css)) problems.push('v2: the stylesheet does not declare Eng Trainer Sans');
  if (/font-family:\s*["']?Source Sans 3/.test(css)) problems.push('v2: a stylesheet still declares the reserved family name Source Sans 3');
  const stale = [
    ...assetNames.filter((name) => /^source-sans-3/i.test(name)).map((name) => `assets/${name}`),
    ...(existsSync(join(site, 'fonts')) ? readdirSync(join(site, 'fonts')).filter((name) => /SourceSans3/i.test(name)).map((name) => `fonts/${name}`) : [])
  ];
  if (stale.length) problems.push(`v2: replaced font files are still published: ${stale.join(', ')}`);
  console.log(`v2 fonts: ${new Set(fontUrls).size} self-hosted font files, licences and FONTLOG published, no Google Fonts references, no replaced subsets.`);
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
