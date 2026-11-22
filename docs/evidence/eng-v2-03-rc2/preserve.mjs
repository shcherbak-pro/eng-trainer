// ENG-V2-03-RC2 preservation, from the worktree root:
//   node docs/evidence/eng-v2-03-rc2/preserve.mjs before   (once, before any application edit)
//   node docs/evidence/eng-v2-03-rc2/preserve.mjs after
// `before` authenticates the RC1 candidate with Astra's RC1-review definitions and final record,
// then captures exact ignored copies of the RC1 build and of the files RC2 may change.
// `after` proves the exact RC2 delta and that everything else is byte-identical.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const relative = 'docs/evidence/eng-v2-03-rc2';
const out = path.join(root, relative);
const local = path.join(out, 'local');
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const common = path.resolve(root, git(root, 'rev-parse', '--git-common-dir').trim());
const main = path.dirname(common);
const RC1_REVIEW = 'docs/reviews/eng-v2-03-rc1-astra';
const isRc1Review = (f) => f.startsWith(RC1_REVIEW + '/') || f === 'docs/reviews/ENG-V2-03-RC1-ASTRA.md';
const isOldReview = (f) => f.startsWith('docs/reviews/eng-v2-03-astra/') || f === 'docs/reviews/ENG-V2-03-ASTRA.md';
const isRc1Evidence = (f) => f.startsWith('docs/evidence/eng-v2-03-rc1/');
const isRc2Evidence = (f) => f.startsWith(relative + '/');
/** Files RC2 may change. Everything else must stay byte-identical. */
const RC2_SCOPE = ['src/features/topics/revealFocusedChip.ts', 'src/features/topics/revealFocusedChip.test.ts', 'docs/handoffs/ENG-V2-03.md'];
const RC1_BUILD_INDEX = 'cb488245caca76d340d370107870a12bf32f21941eb57415cb7d2e5aef733b92';
const RC1_FINGERPRINT = '01c6ec10666ed943fbb3804101637cd00458ed60a8caaf319586e84e44e7039c';

/** Astra's inventory definition; the RC1 review files and this RC2 evidence are inventoried separately. */
function inventory(cwd, exclude) {
  const list = (...args) => git(cwd, 'ls-files', '-z', ...args).split('\0').filter((f) => f && !exclude(f));
  const tracked = list();
  const untracked = list('--others', '--exclude-standard');
  const changed = git(cwd, 'diff', '--name-only', '-z', 'HEAD').split('\0').filter(Boolean);
  const entries = [...new Set([...tracked, ...untracked])].sort().map((file) => ({
    file, sha256: fs.existsSync(path.join(cwd, file)) ? sha(fs.readFileSync(path.join(cwd, file))) : null,
    untracked: untracked.includes(file), changed: changed.includes(file),
  }));
  return {
    head: git(cwd, 'rev-parse', 'HEAD').trim(), branch: git(cwd, 'branch', '--show-current').trim(),
    staged: git(cwd, 'diff', '--cached', '--name-only'), entries,
    fingerprint: sha(JSON.stringify(entries)),
    candidateFingerprint: sha(JSON.stringify(entries.filter((e) => e.changed || e.untracked))),
  };
}
/** Astra's tree definition: every file including ignored ones; links are recorded, never followed. */
function tree(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const absolute = path.join(dir, entry.name), file = prefix + entry.name;
    if (entry.isSymbolicLink()) return [{ file, link: true, targetSha256: sha(fs.readlinkSync(absolute)) }];
    if (entry.isDirectory()) return tree(absolute, file + '/');
    return [{ file, sha256: sha(fs.readFileSync(absolute)) }];
  });
}
const substantiveFingerprint = (entries) => sha(JSON.stringify(entries.filter((e) => !isOldReview(e.file) && !isRc1Evidence(e.file) && (e.changed || e.untracked))));
const snapshot = () => ({
  candidate: inventory(root, (f) => isRc1Review(f) || isRc2Evidence(f)),
  main: inventory(main, () => false),
  rc1ReviewIncludingIgnored: tree(path.join(root, RC1_REVIEW)),
  rc1ReviewReport: sha(fs.readFileSync(path.join(root, 'docs/reviews/ENG-V2-03-RC1-ASTRA.md'))),
  historicalReviewIncludingIgnored: tree(path.join(root, 'docs/reviews/eng-v2-03-astra')),
  implementationRc1IncludingIgnored: tree(path.join(root, 'docs/evidence/eng-v2-03-rc1')),
  excludeSha256: sha(fs.readFileSync(path.join(common, 'info/exclude'))),
});
const digest = (value) => sha(JSON.stringify(value));
const mode = process.argv[2];
const current = snapshot();
assert.equal(current.candidate.head, '03f1267f1ef4287580227ce5db67615988c98177');
assert.equal(current.candidate.branch, 'feature/eng-v2-03-learning-topics');
assert.equal(current.candidate.staged, '');
assert.equal(current.main.staged, '');

if (mode === 'before') {
  assert(!fs.existsSync(path.join(local, 'preservation-before.json')), 'Refusing to replace the RC2 baseline');
  // 1. The candidate is exactly the state Astra recorded at the end of the RC1 review.
  const astra = JSON.parse(fs.readFileSync(path.join(root, RC1_REVIEW, 'preservation-after.json'), 'utf8'));
  assert.equal(astra.preserved, true);
  assert.deepEqual(current.candidate.entries, astra.candidate.entries, 'Candidate differs from Astra\'s final RC1 record');
  assert.deepEqual(current.main.entries, astra.main.entries, 'Main checkout differs from Astra\'s final RC1 record');
  assert.equal(current.main.head, astra.main.head);
  assert.equal(current.main.branch, astra.main.branch);
  assert.deepEqual(current.historicalReviewIncludingIgnored, astra.historicalReviewIncludingIgnored);
  assert.deepEqual(current.implementationRc1IncludingIgnored, astra.implementationRc1IncludingIgnored);
  assert.equal(current.excludeSha256, astra.excludeSha256);
  // 2. The substantive RC1 fingerprint (without both review generations' additions and RC1 evidence).
  assert.equal(substantiveFingerprint(current.candidate.entries), RC1_FINGERPRINT);
  // 3. The active build is RC1's recorded build; keep an exact ignored copy as the before-candidate.
  assert.equal(sha(fs.readFileSync(path.join(root, 'site-dist/index.html'))), RC1_BUILD_INDEX);
  const astraBudget = JSON.parse(fs.readFileSync(path.join(root, RC1_REVIEW, 'budget.json'), 'utf8'));
  const measured = new Map();
  (function collect(value) {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') {
      for (const item of Object.values(value)) collect(item);
      if (typeof value.url === 'string' && /\/assets\/index-[\w-]+\.(js|css)$/.test(value.url) && Number.isInteger(value.bodyBytes ?? value.encodedBodyBytes)) {
        measured.set(value.url.replace(/^.*\/assets\//, 'assets/'), value.bodyBytes ?? value.encodedBodyBytes);
      }
    }
  })(astraBudget.engines ?? astraBudget);
  const site = tree(path.join(root, 'site-dist'));
  const bundles = site.filter((e) => /^assets\/index-[\w-]+\.(js|css)$/.test(e.file));
  const rc1Bundles = bundles.map((e) => ({ file: e.file, sha256: e.sha256, gzip9Bytes: gzipSync(fs.readFileSync(path.join(root, 'site-dist', e.file)), { level: 9 }).length, measuredByAstra: measured.get(e.file) ?? null }));
  for (const bundle of rc1Bundles) assert.equal(bundle.gzip9Bytes, bundle.measuredByAstra, `RC1 bundle ${bundle.file} differs from Astra's RC1 measurement`);
  fs.mkdirSync(local, { recursive: true });
  fs.cpSync(path.join(root, 'site-dist'), path.join(local, 'rc1-site'), { recursive: true });
  assert.deepEqual(tree(path.join(local, 'rc1-site')), site);
  for (const file of RC2_SCOPE) {
    fs.mkdirSync(path.dirname(path.join(local, 'rc1-sources', file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(local, 'rc1-sources', file));
  }
  fs.writeFileSync(path.join(local, 'preservation-before.json'), JSON.stringify({ ...current, rc1Site: site }, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'git-status-before.txt'), git(root, 'status', '--short', '--branch', '--untracked-files=all'));
  const baseline = {
    capturedBeforeApplicationEdits: true,
    head: current.candidate.head, branch: current.candidate.branch, staged: current.candidate.staged,
    candidateEntries: current.candidate.entries.length,
    candidateEqualsAstraFinalRc1Record: true,
    substantiveRc1Fingerprint: RC1_FINGERPRINT,
    fullCandidateFingerprintExcludingRc1Review: current.candidate.candidateFingerprint,
    rc1ReviewAdditions: { files: current.rc1ReviewIncludingIgnored.length, treeDigest: digest(current.rc1ReviewIncludingIgnored), reportSha256: current.rc1ReviewReport },
    historicalReviewIncludingIgnored: { files: current.historicalReviewIncludingIgnored.length, treeDigest: digest(current.historicalReviewIncludingIgnored) },
    implementationRc1IncludingIgnored: { files: current.implementationRc1IncludingIgnored.length, treeDigest: digest(current.implementationRc1IncludingIgnored) },
    main: { head: current.main.head, branch: current.main.branch, files: current.main.entries.length, untracked: current.main.entries.filter((e) => e.untracked).length, equalsAstraFinalRc1Record: true },
    rc1Build: { indexSha256: RC1_BUILD_INDEX, files: site.length, treeDigest: digest(site), bundles: rc1Bundles, copiedTo: relative + '/local/rc1-site' },
    rc1Sources: RC2_SCOPE.map((file) => ({ file, sha256: sha(fs.readFileSync(path.join(root, file))) })),
  };
  fs.writeFileSync(path.join(out, 'baseline.json'), JSON.stringify(baseline, null, 2) + '\n');
  console.log(JSON.stringify(baseline, null, 2));
} else if (mode === 'after') {
  const before = JSON.parse(fs.readFileSync(path.join(local, 'preservation-before.json'), 'utf8'));
  const oldMap = new Map(before.candidate.entries.map((e) => [e.file, e]));
  const newMap = new Map(current.candidate.entries.map((e) => [e.file, e]));
  const changes = [...new Set([...oldMap.keys(), ...newMap.keys()])].sort()
    .filter((file) => JSON.stringify(oldMap.get(file)) !== JSON.stringify(newMap.get(file)))
    .map((file) => ({ file, before: oldMap.get(file)?.sha256 ?? null, after: newMap.get(file)?.sha256 ?? null }));
  assert.deepEqual(changes.map((c) => c.file).filter((file) => !RC2_SCOPE.includes(file)), [], 'Files outside the RC2 scope changed');
  const oldHandoff = fs.readFileSync(path.join(local, 'rc1-sources/docs/handoffs/ENG-V2-03.md'));
  assert(fs.readFileSync(path.join(root, 'docs/handoffs/ENG-V2-03.md')).subarray(0, oldHandoff.length).equals(oldHandoff), 'The RC1 handoff is not an exact prefix');
  assert.deepEqual(current.main, before.main, 'Main checkout changed');
  assert.deepEqual(current.rc1ReviewIncludingIgnored, before.rc1ReviewIncludingIgnored, 'RC1 review changed');
  assert.equal(current.rc1ReviewReport, before.rc1ReviewReport);
  assert.deepEqual(current.historicalReviewIncludingIgnored, before.historicalReviewIncludingIgnored, 'Original review changed');
  assert.deepEqual(current.implementationRc1IncludingIgnored, before.implementationRc1IncludingIgnored, 'RC1 evidence changed');
  assert.equal(current.excludeSha256, before.excludeSha256);
  assert.deepEqual(tree(path.join(local, 'rc1-site')), before.rc1Site, 'RC1 build copy changed');
  // Written first, so the inventory below holds its current hash.
  fs.writeFileSync(path.join(out, 'git-status-after.txt'), git(root, 'status', '--short', '--branch', '--untracked-files=all'));
  // This record and the final audit (written last, which hashes this record) are excluded.
  const rc2Evidence = git(root, 'ls-files', '-z', '--others', '--exclude-standard', '--', relative).split('\0').filter(Boolean).sort()
    .filter((file) => file !== relative + '/preservation-after.json' && file !== relative + '/final-checks.json')
    .map((file) => ({ file, sha256: sha(fs.readFileSync(path.join(root, file))) }));
  const result = {
    preserved: true,
    changes,
    rc1HandoffBytesPreservedAsPrefix: oldHandoff.length,
    unchangedCandidateEntries: current.candidate.entries.length - changes.length,
    candidateEntries: current.candidate.entries.length,
    substantiveFingerprintAfter: substantiveFingerprint(current.candidate.entries),
    main: { head: current.main.head, branch: current.main.branch, files: current.main.entries.length, untracked: current.main.entries.filter((e) => e.untracked).length, unchanged: true },
    rc1Review: { files: current.rc1ReviewIncludingIgnored.length, unchanged: true },
    historicalReview: { files: current.historicalReviewIncludingIgnored.length, unchanged: true },
    implementationRc1Evidence: { files: current.implementationRc1IncludingIgnored.length, unchanged: true },
    gitExcludeUnchanged: true,
    rc2PublicEvidence: rc2Evidence,
  };
  fs.writeFileSync(path.join(out, 'preservation-after.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, rc2PublicEvidence: rc2Evidence.length }, null, 2));
} else {
  throw new Error('Use before or after');
}
