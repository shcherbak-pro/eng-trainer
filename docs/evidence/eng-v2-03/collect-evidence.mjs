// ENG-V2-03 evidence collector. Run from the repository (worktree) root after run-commands.mjs,
// browser-check.mjs and compare-builds.mjs:
//   node docs/evidence/eng-v2-03/collect-evidence.mjs <evidence-dir> <browser-run-dir> <compare.json>
//        <main-checkout> <untracked-before.sha256> <released-artifact-dir>
// Writes only into <evidence-dir>. Reads the main checkout and the released artifact read-only.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { sanitize } from './sanitize.mjs';

const [outDir, browserDir, compareFile, mainRepo, untrackedBefore, releasedArtifact] = process.argv.slice(2);
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const posix = (path) => path.split(sep).join('/');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const writeJson = (path, value) => writeFileSync(join(outDir, path), `${sanitize(JSON.stringify(value, null, 2))}\n`);
const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
mkdirSync(join(outDir, 'browser'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });

// ------------------------------------------------------------ browser results and screenshots
const browser = JSON.parse(readFileSync(join(browserDir, 'results.json'), 'utf8'));
writeJson('browser/results.json', browser);
const PUBLISHED = [
  'chromium-phone-index', 'chromium-phone-home-details', 'chromium-phone-topic-conditionals', 'chromium-phone-topic-small-talk',
  'chromium-phone-topic-interview-english', 'chromium-phone-small-talk-traveling', 'chromium-phone-conditionals-final-subsection',
  'chromium-phone-interview-final-category', 'chromium-phone-phrases', 'chromium-phone-irregularVerbs', 'chromium-phone-flashcards',
  'chromium-phone-collections', 'chromium-phone-settings', 'chromium-phone-content-error', 'chromium-phone-enlarged-topic-small-talk',
  'chromium-narrow-index', 'chromium-narrow-topic-small-talk', 'chromium-desktop-index', 'chromium-desktop-topic-interview-english',
  'firefox-phone-index', 'firefox-phone-topic-small-talk', 'firefox-phone-home-details', 'firefox-desktop-index'
];
const shots = readdirSync(join(browserDir, 'shots')).filter((name) => name.endsWith('.png')).sort();
for (const name of PUBLISHED) {
  if (shots.includes(`${name}.png`)) copyFileSync(join(browserDir, 'shots', `${name}.png`), join(outDir, 'screenshots', `${name}.png`));
}
writeJson('browser/screenshots.json', {
  note: 'Every screenshot of the final run. Files marked published are in screenshots/; rerun browser-check.mjs to recreate the others.',
  files: shots.map((file) => ({ file, published: PUBLISHED.includes(file.replace(/\.png$/, '')), sha256: sha256(readFileSync(join(browserDir, 'shots', file))) }))
});

// ------------------------------------------------------------ budgets and released markup
writeJson('budget-and-markup.json', JSON.parse(readFileSync(compareFile, 'utf8')));

// ------------------------------------------------------------ tested artifact
const site = 'site-dist';
const siteFiles = walk(site).map((file) => ({ path: posix(relative(site, file)), file })).sort((a, b) => a.path.localeCompare(b.path));
writeJson('artifact.json', siteFiles.map(({ path, file }) => ({ path, bytes: statSync(file).size, sha256: sha256(readFileSync(file)) })));

// ------------------------------------------------------------ v1 preservation
const v1Built = siteFiles.filter(({ path }) => path.startsWith('v1/'));
const v1 = {
  sourceDiffAgainstRelease: git('.', 'diff', '03f1267f1ef4287580227ce5db67615988c98177', '--', 'v1').length === 0 ? 'none' : 'CHANGED',
  newUntrackedV1Files: git('.', 'ls-files', '--others', '--exclude-standard', '--', 'v1').trim().split('\n').filter(Boolean),
  builtAgainstReleasedArtifact: v1Built.map(({ path, file }) => {
    const released = join(releasedArtifact, path);
    if (!existsSync(released)) return { path, released: false };
    const a = readFileSync(file), b = readFileSync(released);
    return { path, byteIdentical: a.equals(b), identicalIgnoringCarriageReturns: a.toString('latin1').replace(/\r/g, '') === b.toString('latin1').replace(/\r/g, '') };
  })
};
v1.releasedOnly = walk(join(releasedArtifact, 'v1')).map((file) => posix(relative(releasedArtifact, file))).filter((path) => !v1Built.some((item) => item.path === path));
v1.pass = v1.sourceDiffAgainstRelease === 'none' && v1.newUntrackedV1Files.length === 0 && v1.releasedOnly.length === 0 && v1.builtAgainstReleasedArtifact.every((item) => item.identicalIgnoringCarriageReturns);
writeJson('v1-preservation.json', v1);

// ------------------------------------------------------------ main checkout and released packs
const before = readFileSync(untrackedBefore, 'utf8').trim().split('\n').map((line) => { const [hash, ...rest] = line.trim().split(/\s+/); return { hash, path: rest.join(' ').replace(/^\*/, '') }; });
const untrackedNow = git(mainRepo, 'ls-files', '--others', '--exclude-standard').trim().split('\n').filter(Boolean).sort();
const checked = before.map(({ hash, path }) => ({ path, unchanged: existsSync(join(mainRepo, path)) && sha256(readFileSync(join(mainRepo, path))) === hash }));
const legacyUrls = JSON.parse(readFileSync('src/test/fixtures/legacy-pack-urls.json', 'utf8'));
const manifest = JSON.parse(readFileSync('public/data/manifest.json', 'utf8'));
const preservation = {
  mainCheckout: {
    branch: git(mainRepo, 'branch', '--show-current').trim(),
    head: git(mainRepo, 'rev-parse', 'HEAD').trim(),
    trackedChanges: git(mainRepo, 'status', '--porcelain', '--untracked-files=no').trim().split('\n').filter(Boolean),
    staged: git(mainRepo, 'diff', '--cached', '--name-only').trim().split('\n').filter(Boolean),
    untrackedBefore: before.length,
    untrackedNow: untrackedNow.length,
    sameUntrackedSet: JSON.stringify(untrackedNow) === JSON.stringify(before.map((item) => item.path).sort()),
    allUnchanged: checked.every((item) => item.unchanged),
    changed: checked.filter((item) => !item.unchanged).map((item) => item.path)
  },
  releasedPacks: legacyUrls.packs.map((entry) => ({ id: entry.id, url: entry.url, unchanged: manifest.packs.some((item) => item.id === entry.id && item.url === entry.url) })),
  worktree: {
    branch: git('.', 'branch', '--show-current').trim(),
    base: git('.', 'merge-base', 'HEAD', 'main').trim(),
    head: git('.', 'rev-parse', 'HEAD').trim(),
    staged: git('.', 'diff', '--cached', '--name-only').trim().split('\n').filter(Boolean)
  }
};
preservation.pass = preservation.mainCheckout.trackedChanges.length === 0 && preservation.mainCheckout.staged.length === 0 && preservation.mainCheckout.sameUntrackedSet && preservation.mainCheckout.allUnchanged && preservation.releasedPacks.every((item) => item.unchanged) && preservation.worktree.staged.length === 0;
writeJson('preservation.json', preservation);
writeFileSync(join(outDir, 'git-status.txt'), sanitize(git('.', 'status', '--short', '--untracked-files=all')));

// ------------------------------------------------------------ ID mapping and totals
const editorial = JSON.parse(readFileSync('src/test/fixtures/eng-v2-03-editorial.json', 'utf8'));
const topicsByPack = Object.fromEntries(manifest.packs.filter((entry) => entry.counts.topics).map((entry) => [entry.id, JSON.parse(readFileSync(join('public/data', entry.url), 'utf8')).content.topics[0]]));
writeJson('id-mapping.json', {
  rule: editorial.idRule,
  items: editorial.topics.flatMap((topic) => topic.groups.flatMap((group, index) => group.items.map((item) => ({
    topic: topic.label,
    subsection: group.heading,
    subsectionKey: topicsByPack[topic.pack].sections[index].id,
    sourceId: item.sourceId,
    catalogId: item.catalogId
  })))),
  answers: topicsByPack['interview-english'].sections.map((section) => ({ subsection: section.title, answerId: section.answerId })),
  blocks: Object.values(topicsByPack).map((topic) => ({ topic: topic.title, blockId: topic.blockId, address: `#topic/${topic.id}` })),
  reuse: 'No editorial item equals released vocabulary text, so every item is a new phrase record. Near matches (for example "The main difference is that …", "For example,…", "As a result, …") stay separate. One typical question equals a released speaking prompt; neither is a card.'
});
const baseline = JSON.parse(readFileSync('src/test/fixtures/content-baseline.json', 'utf8'));
const released = Object.fromEntries(Object.entries(baseline.collections).map(([key, value]) => [key, value.count]));
const current = { ...manifest.counts, blocks: manifest.blocks.length };
writeJson('content-totals.json', {
  released: { ...released, packs: legacyUrls.packs.length, records: Object.values(released).reduce((sum, value) => sum + value, 0) },
  current: { ...current, packs: manifest.packs.length, records: Object.values(current).reduce((sum, value) => sum + value, 0) },
  delta: Object.fromEntries(Object.keys(current).map((key) => [key, current[key] - (released[key] ?? 0)])),
  note: 'Counts come from the generated manifest. "records" sums every collection, as the released figure of 1,538 did; it is not a learning-vocabulary count.'
});

// ------------------------------------------------------------ hashes of the published evidence
const published = walk(outDir).map((file) => posix(relative(outDir, file))).filter((path) => path !== 'sanitization.json').sort();
writeFileSync(join(outDir, 'sanitization.json'), `${JSON.stringify({
  rule: 'Machine paths are replaced with <repo> and <user-home>, the account name with <user>; ANSI color codes are removed from logs.',
  files: published.map((path) => ({ path, sha256: sha256(readFileSync(join(outDir, path))) }))
}, null, 2)}\n`);
console.log(JSON.stringify({ v1: v1.pass, preservation: preservation.pass, budget: JSON.parse(readFileSync(compareFile, 'utf8')).pass, browser: browser.summary }));
