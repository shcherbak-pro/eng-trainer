import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildContent, jsonText, sha256 } from './content-build.mjs';
import { buildProductContent, readOverlay, stageProductPublic } from './product-content.mjs';
import { CATALOG_LOCK_FILE } from './product-gates.mjs';
import { EXPERIMENTAL_PRODUCT, LEGACY_PRODUCT, STABLE_PRODUCT, loadSiteConfig, repoRoot } from './site-config.mjs';

const site = loadSiteConfig();
const lock = JSON.parse(await readFile(join(repoRoot, CATALOG_LOCK_FILE), 'utf8'));
const committedOverlay = JSON.parse(await readFile(join(repoRoot, 'content', 'v3', 'overlay.json'), 'utf8'));

/** The catalog a content build would publish: manifest hash and size, and every pack. */
const published = ({ manifest, assets }) => ({
  manifestSha256: sha256(jsonText(manifest)),
  manifestBytes: Buffer.byteLength(jsonText(manifest)),
  packs: manifest.packs.map((entry) => {
    const text = assets.find((asset) => asset.url === entry.url).text;
    return { id: entry.id, order: entry.order, url: entry.url, bytes: Buffer.byteLength(text), sha256: sha256(text) };
  })
});
const released = { manifestSha256: lock.manifestSha256, manifestBytes: lock.manifestBytes, packs: lock.packs };

/** A disposable content folder with the released sources and a chosen overlay folder. */
async function contentCopy(t, overlay, extra = () => {}) {
  const dir = await mkdtemp(join(tmpdir(), 'eng-trainer-overlay-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(join(repoRoot, 'content', 'catalog.json'), join(dir, 'catalog.json'));
  await cp(join(repoRoot, 'content', 'packs'), join(dir, 'packs'), { recursive: true });
  if (overlay !== undefined) {
    await mkdir(join(dir, 'v3'));
    await writeFile(join(dir, 'v3', 'overlay.json'), typeof overlay === 'string' ? overlay : jsonText(overlay));
  }
  await extra(dir);
  return dir;
}

test('the released-catalog lock is the catalog of ENG-V2-03: 14 packs, written from the released artifact', () => {
  assert.equal(lock.commit, '498705a075e6f71b04e22e4437c50ec587de38dd');
  assert.equal(lock.manifestSha256, 'db99f2172b7c30c9ada8299ab2c3f463c4fe600b39878b150e321b3e5e57776b');
  assert.equal(lock.packs.length, 14);
  // A digest of the pack list, so that an edit of the lock is a deliberate, visible act.
  assert.equal(sha256(JSON.stringify(lock.packs)), '307fdd776a112d525a95579ae409156b03dadc9b891568dd707d865410c1efb5');
  for (const pack of lock.packs) assert.equal(pack.url, `packs/${pack.id}.${pack.sha256.slice(0, 16)}.json`);
});

test('the stable product generates exactly the released catalog', async () => {
  assert.deepEqual(published(await buildProductContent(STABLE_PRODUCT)), released);
  // The stable product is the plain content build: content/v3/ plays no part in it.
  assert.deepEqual(published(await buildContent(join(repoRoot, 'content'))), released);
});

test('the experimental product with its empty overlay generates exactly the released catalog', async () => {
  assert.deepEqual(committedOverlay, {
    schemaVersion: 1,
    variant: EXPERIMENTAL_PRODUCT,
    baseline: { commit: lock.commit, manifestSha256: lock.manifestSha256 },
    blocks: [],
    changes: []
  });
  assert.deepEqual(published(await buildProductContent(EXPERIMENTAL_PRODUCT)), released);
});

test('the stable product ignores the overlay folder entirely, whatever it contains', async (t) => {
  const dir = await contentCopy(t, 'this is not JSON', async (root) => {
    await mkdir(join(root, 'v3', 'packs'));
    await writeFile(join(root, 'v3', 'packs', 'new-pack.json'), '{}');
  });
  assert.deepEqual(published(await buildProductContent(STABLE_PRODUCT, dir)), released);
  await assert.rejects(buildProductContent(EXPERIMENTAL_PRODUCT, dir), /unexpected packs/);
});

test('only an empty overlay is accepted: the entry ledger is not implemented in ENG-V3-01', async (t) => {
  const overlay = (edit) => {
    const value = structuredClone(committedOverlay);
    edit(value);
    return value;
  };
  const cases = [
    [undefined, /overlay\.json is missing/],
    [overlay((value) => { value.changes.push({ op: 'update-entry', id: 'phrase-002', class: 'translation', set: { translation: 'x' }, reason: 'test' }); }), /changes is not empty\. ENG-V3-01 supports only an empty overlay/],
    [overlay((value) => { value.blocks.push({ id: 'new-block' }); }), /blocks is not empty/],
    [overlay((value) => { value.packs = []; }), /must have exactly the keys/],
    [overlay((value) => { delete value.baseline; }), /must have exactly the keys/],
    [overlay((value) => { value.schemaVersion = 2; }), /unsupported schemaVersion 2/],
    [overlay((value) => { value.variant = STABLE_PRODUCT; }), /does not name this product/],
    [overlay((value) => { value.baseline.commit = 'main'; }), /must be a full commit id/],
    [overlay((value) => { value.baseline.manifestSha256 = 'db99f217'; }), /must be a SHA-256/],
    [overlay((value) => { value.baseline.extra = true; }), /baseline must have exactly the keys/],
    [overlay((value) => { value.changes = {}; }), /changes must be a list/],
    ['[]', /must have exactly the keys/]
  ];
  for (const [value, pattern] of cases) {
    await assert.rejects(buildProductContent(EXPERIMENTAL_PRODUCT, await contentCopy(t, value)), pattern);
  }
  // Anything beside overlay.json would be content that nothing reviews or applies yet.
  const withFile = await contentCopy(t, committedOverlay, (root) => writeFile(join(root, 'v3', 'notes.md'), 'x'));
  await assert.rejects(readOverlay(join(withFile, 'v3'), EXPERIMENTAL_PRODUCT), /unexpected notes\.md/);
});

test('an overlay whose baseline is not the released catalog fails: released content must not change under it', async (t) => {
  const other = structuredClone(committedOverlay);
  other.baseline.manifestSha256 = 'a'.repeat(64);
  await assert.rejects(buildProductContent(EXPERIMENTAL_PRODUCT, await contentCopy(t, other)), /its baseline is a{64}, but the released sources now build db99f217/);

  // The same check from the other side: a changed released pack no longer matches the committed overlay.
  const edited = await contentCopy(t, committedOverlay, async (root) => {
    const file = join(root, 'packs', 'small-talk.json');
    const pack = JSON.parse(await readFile(file, 'utf8'));
    pack.title += ' (edited)';
    await writeFile(file, jsonText(pack));
  });
  await assert.rejects(buildProductContent(EXPERIMENTAL_PRODUCT, edited), /the released sources now build/);
});

test('no content is generated for the frozen v1 project or an unknown product', async () => {
  await assert.rejects(buildProductContent(LEGACY_PRODUCT), /No built-in content is generated/);
  await assert.rejects(buildProductContent('experimental-v4'), /No built-in content is generated/);
  await assert.rejects(stageProductPublic(site, STABLE_PRODUCT), /never staged/);
  await assert.rejects(stageProductPublic(site, LEGACY_PRODUCT), /no staged public folder/);
});

// Staging itself is tested in safe-destinations.test.mjs, in a disposable copy of the
// repository: the staged folder is fixed (ENG-V3-01-RC1), so a test can no longer point it
// at a folder of its own, and it must not replace the folder that a build may be using.
