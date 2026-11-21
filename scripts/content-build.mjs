import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assembleMaterials, countContent, parseDescriptor, parseManifest, parsePack } from '../src/content/packFormat.js';

export const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** Validates every source before producing output. File discovery never sets order. */
export async function buildContent(sourceDir) {
  const descriptor = parseDescriptor(JSON.parse(await readFile(join(sourceDir, 'catalog.json'), 'utf8')));
  const names = (await readdir(join(sourceDir, 'packs'))).filter((name) => name.endsWith('.json')).sort();
  const packs = await Promise.all(names.map(async (name) => {
    const pack = parsePack(JSON.parse(await readFile(join(sourceDir, 'packs', name), 'utf8')));
    if (name !== `${pack.id}.json`) throw new Error(`Pack filename ${name} must match its id ${pack.id}`);
    return pack;
  }));
  packs.sort((a, b) => a.order - b.order);
  const materials = assembleMaterials(descriptor, packs);
  const assets = packs.map((pack) => {
    const text = jsonText(pack);
    return { pack, text, url: `packs/${pack.id}.${sha256(text).slice(0, 16)}.json` };
  });
  const manifest = parseManifest({
    ...descriptor,
    counts: countContent(materials),
    packs: assets.map(({ pack, url }) => ({ id: pack.id, title: pack.title, order: pack.order, url, counts: countContent(pack.content) }))
  });
  return { manifest, assets, materials };
}

/** Verify the actual published files, including their content-addressed names. */
export async function readGeneratedContent(dataDir) {
  const manifest = parseManifest(JSON.parse(await readFile(join(dataDir, 'manifest.json'), 'utf8')));
  const packs = await Promise.all(manifest.packs.map(async (entry) => {
    const text = await readFile(join(dataDir, entry.url), 'utf8');
    if (entry.url !== `packs/${entry.id}.${sha256(text).slice(0, 16)}.json`) throw new Error(`Hash mismatch for ${entry.url}`);
    const pack = parsePack(JSON.parse(text));
    if (pack.id !== entry.id || pack.order !== entry.order || pack.title !== entry.title) throw new Error(`Metadata mismatch for ${entry.url}`);
    const actual = countContent(pack.content);
    for (const key of Object.keys(actual)) if (actual[key] !== entry.counts[key]) throw new Error(`Count mismatch for ${entry.url}: ${key}`);
    return pack;
  }));
  const materials = assembleMaterials(manifest, packs);
  return { manifest, packs, materials };
}
