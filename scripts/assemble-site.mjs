// Assembles the GitHub Pages site from the two application builds:
//
//   dist/      (v2, built by `npm run build`)      -> site-dist/
//   v1/dist/   (v1, built by `npm run build:v1`)   -> site-dist/v1/
//
// The script only copies compiled files. It never builds, and it never touches
// the two build directories.
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const v2Build = join(root, 'dist');
const v1Build = join(root, 'v1', 'dist');
const site = join(root, 'site-dist');

function requireFile(path, hint) {
  if (!existsSync(path)) {
    console.error(`Missing ${path}\n${hint}`);
    process.exit(1);
  }
}

requireFile(join(v2Build, 'index.html'), 'Build v2 first: npm run build');
requireFile(join(v1Build, 'index.html'), 'Build v1 first: npm run build:v1');

if (existsSync(join(v2Build, 'v1'))) {
  console.error('dist/v1 exists. The v2 build must not contain a "v1" folder: that path belongs to the v1 application.');
  process.exit(1);
}

await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });
await cp(v2Build, site, { recursive: true });
await cp(v1Build, join(site, 'v1'), { recursive: true });

console.log('Assembled site-dist/ (v2) and site-dist/v1/ (v1).');
