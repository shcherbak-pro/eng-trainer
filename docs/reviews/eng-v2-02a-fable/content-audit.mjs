// ENG-V2-02A independent content-preservation audit (Fable review).
//
// Deliberately independent of the candidate's own code: it does NOT import
// src/content/packFormat.js, scripts/content-build.mjs or the frozen fixture.
// It reads the released monolith straight from the pinned Git object and the
// authored/generated JSON straight from disk, assembles them with its own
// reading of the documented rule (ascending pack `order`, array order kept),
// and compares every record — including object key order — with the release.
//
// Usage:
//   node content-audit.mjs <candidate-root> [generated-data-dir ...] [--out file.json]
// Every generated-data-dir (e.g. <root>/public/data, <root>/site-dist/data) is
// audited as a published artifact: manifest + content-addressed packs.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const BASELINE = 'c84ef30d80ffbaae4ac0f3aa0fb7fe6090b8067b';
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outFile = outIndex >= 0 ? resolve(args.splice(outIndex, 2)[1]) : null;
const root = resolve(args[0]);
const dataDirs = args.slice(1).map((dir) => resolve(dir));

const sha = (value) => createHash('sha256').update(value).digest('hex');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); return condition; };

const rawOriginal = git('show', `${BASELINE}:public/data/materials.json`);
const original = JSON.parse(rawOriginal);
const topKeys = Object.keys(original);
const collections = topKeys.filter((key) => Array.isArray(original[key]));

/** Strict comparison of one assembled catalog against the release. */
function compare(label, assembled) {
  const result = { label, collections: {} };
  check(isDeepStrictEqual(Object.keys(assembled).sort(), [...topKeys].sort()), `${label}: top-level keys differ: ${Object.keys(assembled)}`);
  result.metaExact = check(JSON.stringify(assembled.meta) === JSON.stringify(original.meta), `${label}: meta differs (values or key order)`);
  for (const key of collections) {
    const before = original[key];
    const after = assembled[key] ?? [];
    const stats = { before: before.length, after: after.length, exactSerialized: 0, keyOrderOnly: 0, valueDiffs: 0, firstDiffs: [] };
    check(before.length === after.length, `${label}.${key}: count ${after.length} != ${before.length}`);
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      if (JSON.stringify(before[i]) === JSON.stringify(after[i])) stats.exactSerialized++;
      else if (isDeepStrictEqual(before[i], after[i])) stats.keyOrderOnly++;
      else {
        stats.valueDiffs++;
        if (stats.firstDiffs.length < 5) stats.firstDiffs.push({ index: i, before: before[i], after: after[i] });
      }
    }
    check(stats.valueDiffs === 0, `${label}.${key}: ${stats.valueDiffs} records differ in value or position`);
    check(stats.keyOrderOnly === 0, `${label}.${key}: ${stats.keyOrderOnly} records differ only in key order`);
    const ids = (list) => list.filter((item) => item && typeof item === 'object' && 'id' in item).map((item) => item.id);
    stats.withId = ids(after).length;
    stats.withoutId = after.length - stats.withId;
    stats.withoutIdBefore = before.length - ids(before).length;
    stats.orderedIdsEqual = check(isDeepStrictEqual(ids(before), ids(after)), `${label}.${key}: ordered IDs differ`);
    stats.uniqueIds = new Set(ids(after)).size === ids(after).length;
    stats.sha256Before = sha(JSON.stringify(before));
    stats.sha256After = sha(JSON.stringify(after));
    result.collections[key] = stats;
  }
  result.wholeCatalogDeepEqual = check(isDeepStrictEqual(assembled, original), `${label}: catalog is not deep-equal to the release`);
  return result;
}

/** Field inventory: how many records carry each field, and how many strings contain Cyrillic. */
function inventory(catalog) {
  const fields = {};
  let cyrillicStrings = 0;
  let nonNfcStrings = 0;
  const visit = (value) => {
    if (typeof value === 'string') {
      if (/[Ѐ-ӿ]/.test(value)) cyrillicStrings++;
      if (value !== value.normalize('NFC')) nonNfcStrings++;
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  for (const key of collections) {
    fields[key] = {};
    for (const item of catalog[key]) {
      if (item && typeof item === 'object') for (const field of Object.keys(item)) fields[key][field] = (fields[key][field] ?? 0) + 1;
    }
    catalog[key].forEach(visit);
  }
  visit(catalog.meta);
  return { fields, cyrillicStrings, nonNfcStrings };
}

// ---------------------------------------------------------------- authored source
const sourceDir = join(root, 'content');
const descriptor = JSON.parse(readFileSync(join(sourceDir, 'catalog.json'), 'utf8'));
const packFiles = readdirSync(join(sourceDir, 'packs')).sort();
const packs = packFiles.map((name) => ({ name, pack: JSON.parse(readFileSync(join(sourceDir, 'packs', name), 'utf8')) }));
const sorted = [...packs].sort((a, b) => a.pack.order - b.pack.order);
check(new Set(packs.map((p) => p.pack.order)).size === packs.length, 'source pack orders are not unique');
check(packs.every(({ name, pack }) => name === `${pack.id}.json`), 'a source pack filename does not equal its id');
const assembleFrom = (meta, blocks, packList) => {
  const result = { meta, blocks };
  for (const key of collections) if (key !== 'blocks') result[key] = packList.flatMap((pack) => pack.content[key] ?? []);
  // Match the release's top-level key order for a readable comparison; values are compared independently.
  return Object.fromEntries(topKeys.map((key) => [key, result[key]]));
};
const sourceCatalog = assembleFrom(descriptor.meta, descriptor.blocks, sorted.map((p) => p.pack));
const report = {
  baseline: BASELINE,
  originalBytes: Buffer.byteLength(rawOriginal),
  originalSha256: sha(rawOriginal),
  topLevelKeys: topKeys,
  sourcePacks: sorted.map(({ name, pack }) => ({
    file: name, id: pack.id, order: pack.order, title: pack.title, envelopeKeys: Object.keys(pack),
    counts: Object.fromEntries(Object.entries(pack.content).map(([key, list]) => [key, list.length]))
  })),
  source: compare('source', sourceCatalog),
  inventoryOriginal: inventory(original),
  inventorySource: inventory(sourceCatalog)
};
check(isDeepStrictEqual(report.inventoryOriginal, report.inventorySource), 'field inventory differs');

// Pack membership of every identity, used for relationship and duplicate analysis.
const packOf = new Map();
for (const { pack } of sorted) for (const key of ['phrases', 'wordIndex', 'irregularVerbs']) for (const item of pack.content[key] ?? []) packOf.set(`${key}:${item.id}`, pack.id);

// ------------------------------------------------- explicit phrase/word relationships
const phraseIds = new Set(original.phrases.map((p) => p.id));
const linksBefore = original.wordIndex.filter((w) => w.sourcePhraseId !== undefined).map((w) => [w.id, w.sourcePhraseId]);
const linksAfter = sourceCatalog.wordIndex.filter((w) => w.sourcePhraseId !== undefined).map((w) => [w.id, w.sourcePhraseId]);
const linkedPhraseCounts = new Map();
for (const [, target] of linksAfter) linkedPhraseCounts.set(target, (linkedPhraseCounts.get(target) ?? 0) + 1);
report.relationships = {
  linksBefore: linksBefore.length,
  linksAfter: linksAfter.length,
  identical: check(isDeepStrictEqual(linksBefore, linksAfter), 'word→phrase links differ'),
  allTargetsExist: check(linksAfter.every(([, target]) => phraseIds.has(target)), 'a link targets a missing phrase'),
  phrasesWithExactlyOneLinkedWord: [...phraseIds].filter((id) => linkedPhraseCounts.get(id) === 1).length,
  crossPackLinks: linksAfter.filter(([word, target]) => packOf.get(`wordIndex:${word}`) !== packOf.get(`phrases:${target}`)).length,
  linksWhoseTextDiffers: sourceCatalog.wordIndex.filter((w) => w.sourcePhraseId && sourceCatalog.phrases.find((p) => p.id === w.sourcePhraseId)?.phrase !== w.term).length
};

// ------------------------------------------- RC1 duplicate-text pairs (ENG-V2-01-RC1 §3)
const RC1_PAIRS = [
  ['phrase-005', 'hedging-005-from-my-perspective'],
  ['phrase-013', 'advanced-linking-008-that-being-said'],
  ['phrase-084', 'advanced-linking-004-consequently'],
  ['presentation-phrase-085', 'advanced-linking-009-as-a-result'],
  ['presentation-phrase-087', 'advanced-linking-012-more-importantly'],
  ['presentation-phrase-088', 'hedging-008-to-some-extent']
];
const phraseById = new Map(sourceCatalog.phrases.map((p, index) => [p.id, { ...p, index }]));
const originalIndex = new Map(original.phrases.map((p, index) => [p.id, index]));
report.rc1DuplicatePairs = RC1_PAIRS.map(([a, b]) => {
  const left = phraseById.get(a);
  const right = phraseById.get(b);
  const wordFor = (id) => sourceCatalog.wordIndex.filter((w) => w.sourcePhraseId === id).map((w) => w.id);
  const entry = {
    ids: [a, b],
    texts: [left?.phrase, right?.phrase],
    categories: [left?.category, right?.category],
    packs: [packOf.get(`phrases:${a}`), packOf.get(`phrases:${b}`)],
    positionsKept: left?.index === originalIndex.get(a) && right?.index === originalIndex.get(b),
    linkedWords: [wordFor(a), wordFor(b)]
  };
  check(left && right && entry.positionsKept && entry.linkedWords.every((w) => w.length === 1), `RC1 pair ${a}/${b} not preserved`);
  return entry;
});
const textGroups = new Map();
for (const p of sourceCatalog.phrases) {
  const key = p.phrase.toLowerCase().replace(/[.…,\s]+$/u, '').trim();
  textGroups.set(key, [...(textGroups.get(key) ?? []), p.id]);
}
report.equalDisplayTextPhraseGroups = [...textGroups.values()].filter((ids) => ids.length > 1);

// ----------------------------------------------------------- blocks and their targets
report.blocks = sourceCatalog.blocks.map((block) => {
  let targets = 0;
  if (block.type === 'phraseCategory') targets = sourceCatalog.phrases.filter((p) => p.category === block.category).length;
  else if (block.type === 'irregularVerbs') targets = sourceCatalog.irregularVerbs.filter((v) => !block.verbSet || v.verbSet === block.verbSet).length;
  else if (block.type === 'wordIndex') targets = sourceCatalog.wordIndex.length;
  else if (block.type === 'reversePractice') targets = sourceCatalog.wordIndex.length + sourceCatalog.phrases.length;
  else targets = sourceCatalog[{ patterns: 'patterns', answers: 'answers', practice: 'drills' }[block.type]]?.length ?? 0;
  return { id: block.id, type: block.type, category: block.category, verbSet: block.verbSet, itemsCount: block.itemsCount, targets };
});
report.blocksWithoutTargets = report.blocks.filter((b) => b.targets === 0).map((b) => b.id);
report.phraseCategories = [...new Set(sourceCatalog.phrases.map((p) => p.category))].length;
report.wordCategories = [...new Set(sourceCatalog.wordIndex.map((w) => w.category))].length;

// ------------------------------------------------------------ published artifacts
report.generated = dataDirs.map((dir) => {
  const result = { dir: dir.replace(root, '<root>'), materialsJsonPresent: existsSync(join(dir, 'materials.json')) };
  check(!result.materialsJsonPresent, `${dir}: obsolete materials.json present`);
  const manifestText = readFileSync(join(dir, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestText);
  result.manifestBytes = Buffer.byteLength(manifestText);
  result.manifestSha256 = sha(manifestText);
  const onDisk = readdirSync(join(dir, 'packs')).sort();
  result.packFilesOnDisk = onDisk.length;
  check(onDisk.length === manifest.packs.length, `${dir}: ${onDisk.length} pack files for ${manifest.packs.length} manifest entries (stale files?)`);
  let lastOrder = -Infinity;
  result.packs = manifest.packs.map((entry) => {
    check(/^packs\/[a-z0-9-]+\.[a-f0-9]{16}\.json$/.test(entry.url), `${entry.url}: unexpected URL shape`);
    check(entry.order > lastOrder, `${entry.id}: manifest order not ascending`);
    lastOrder = entry.order;
    const bytes = readFileSync(join(dir, entry.url));
    const hash = sha(bytes);
    check(entry.url === `packs/${entry.id}.${hash.slice(0, 16)}.json`, `${entry.url}: content hash mismatch (${hash.slice(0, 16)})`);
    check(!bytes.includes(13), `${entry.url}: contains CR bytes`);
    const pack = JSON.parse(bytes.toString('utf8'));
    const source = sorted.find((p) => p.pack.id === entry.id)?.pack;
    check(isDeepStrictEqual(pack, source), `${entry.url}: differs from its authored source`);
    return { id: entry.id, order: entry.order, url: entry.url, bytes: bytes.length, sha256: hash, pack };
  });
  check(isDeepStrictEqual(manifest.blocks, original.blocks) && isDeepStrictEqual(manifest.meta, original.meta), `${dir}: manifest meta/blocks differ`);
  result.published = compare(`published:${result.dir}`, assembleFrom(manifest.meta, manifest.blocks, result.packs.map((p) => p.pack)));
  result.totalBytes = result.manifestBytes + result.packs.reduce((sum, p) => sum + p.bytes, 0);
  result.packs = result.packs.map(({ pack, ...rest }) => rest);
  return result;
});

// ------------------------------------------- frozen test fixture provenance
// The fixture is NOT used as an oracle above. Here it is checked to derive from
// the release Git object (not from the new packs), so `npm test` pins the release.
{
  const fixture = JSON.parse(readFileSync(join(root, 'src/test/fixtures/content-baseline.json'), 'utf8'));
  const h = (value) => sha(JSON.stringify(value));
  const checks = { commit: fixture.commit === BASELINE, meta: h(original.meta) === fixture.metaSha256 };
  for (const [key, expected] of Object.entries(fixture.collections)) {
    checks[key] = original[key].length === expected.count && h(original[key]) === expected.sha256
      && (!expected.idsSha256 || h(original[key].map((item) => item.id)) === expected.idsSha256);
  }
  checks.sourcePhraseLinks = original.wordIndex.filter((w) => w.sourcePhraseId).length === fixture.sourcePhraseLinks.count
    && h(original.wordIndex.map((w) => [w.id, w.sourcePhraseId ?? null])) === fixture.sourcePhraseLinks.sha256;
  report.frozenFixtureDerivedFromRelease = checks;
  check(Object.values(checks).every(Boolean), `frozen fixture does not match the release: ${JSON.stringify(checks)}`);
}

// ------------------------------------------------------------------------- v1
const v1Diff = git('diff', '--stat', BASELINE, '--', 'v1').trim();
const v1Untracked = git('ls-files', '--others', '--exclude-standard', '--', 'v1').trim();
const v1Blob = git('show', `${BASELINE}:v1/public/data/materials.json`);
const v1Tree = readFileSync(join(root, 'v1/public/data/materials.json'), 'utf8');
report.v1 = {
  trackedDiffAgainstBaseline: v1Diff || '(none)',
  untrackedSourceFiles: v1Untracked || '(none)',
  // A Windows checkout with core.autocrlf=true may hold CRLF copies of LF blobs.
  monolithEolNormalizedEqual: v1Tree.replace(/\r\n/g, '\n') === v1Blob,
  monolithJsonEqual: isDeepStrictEqual(JSON.parse(v1Tree), JSON.parse(v1Blob)),
  monolithWorkingTreeHasCrlf: v1Tree.includes('\r\n')
};
check(!v1Diff && !v1Untracked && report.v1.monolithEolNormalizedEqual && report.v1.monolithJsonEqual, 'v1 differs from the release');

report.failures = failures;
report.verdict = failures.length ? 'FAIL' : 'PASS';
const text = `${JSON.stringify(report, null, 2)}\n`;
if (outFile) writeFileSync(outFile, text);
console.log(JSON.stringify({ verdict: report.verdict, failures, source: Object.fromEntries(Object.entries(report.source.collections).map(([k, v]) => [k, `${v.after}/${v.before} exact=${v.exactSerialized} keyOrderOnly=${v.keyOrderOnly} diffs=${v.valueDiffs}`])), relationships: report.relationships, generated: report.generated.map((g) => ({ dir: g.dir, files: g.packFilesOnDisk, bytes: g.totalBytes, deepEqual: g.published.wholeCatalogDeepEqual })) }, null, 2));
process.exit(failures.length ? 1 : 0);
