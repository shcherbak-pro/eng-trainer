import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = process.cwd(), relative = 'docs/reviews/eng-v2-03-rc2-astra', out = path.join(root, relative);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const common = path.resolve(root, git(root, 'rev-parse', '--git-common-dir').trim()), main = path.dirname(common);
const own = (f) => f.startsWith(relative + '/') || f === 'docs/reviews/ENG-V2-03-RC2-ASTRA.md';
const rc1Review = (f) => f.startsWith('docs/reviews/eng-v2-03-rc1-astra/') || f === 'docs/reviews/ENG-V2-03-RC1-ASTRA.md';
const rc2Evidence = (f) => f.startsWith('docs/evidence/eng-v2-03-rc2/');
const substantive = (f) => !rc1Review(f) && !rc2Evidence(f) && !f.startsWith('docs/reviews/eng-v2-03-astra/') &&
  f !== 'docs/reviews/ENG-V2-03-ASTRA.md' && !f.startsWith('docs/evidence/eng-v2-03-rc1/');
function inventory(cwd) {
  const list = (...args) => git(cwd, 'ls-files', '-z', ...args).split('\0').filter((f) => f && !own(f));
  const tracked = list(), untracked = list('--others', '--exclude-standard');
  const changed = git(cwd, 'diff', '--name-only', '-z', 'HEAD').split('\0');
  const entries = [...new Set([...tracked, ...untracked])].sort().map((file) => ({
    file, sha256: fs.existsSync(path.join(cwd, file)) ? sha(fs.readFileSync(path.join(cwd, file))) : null,
    untracked: untracked.includes(file), changed: changed.includes(file),
  }));
  return { branch: git(cwd, 'branch', '--show-current').trim(), head: git(cwd, 'rev-parse', 'HEAD').trim(),
    staged: git(cwd, 'diff', '--cached', '--name-only'), entries,
    candidateFingerprint: sha(JSON.stringify(entries.filter((e) => e.changed || e.untracked))) };
}
function tree(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
    const absolute = path.join(dir, e.name), file = prefix + e.name;
    if (e.isSymbolicLink()) return [{ file, link: true, targetSha256: sha(fs.readlinkSync(absolute)) }];
    return e.isDirectory() ? tree(absolute, file + '/') : [{ file, sha256: sha(fs.readFileSync(absolute)) }];
  });
}
const historicalRoots = ['docs/reviews/eng-v2-03-astra', 'docs/reviews/eng-v2-03-rc1-astra',
  'docs/evidence/eng-v2-03', 'docs/evidence/eng-v2-03-rc1', 'docs/evidence/eng-v2-03-rc2'];
const current = { candidate: inventory(root), main: inventory(main),
  history: Object.fromEntries(historicalRoots.map((dir) => [dir, tree(path.join(root, dir))])),
  excludeSha256: sha(fs.readFileSync(path.join(common, 'info/exclude'))) };
assert.equal(current.candidate.branch, 'feature/eng-v2-03-learning-topics');
assert.equal(current.candidate.head, '03f1267f1ef4287580227ce5db67615988c98177');
assert.equal(current.candidate.staged, '');
fs.mkdirSync(out, { recursive: true });
if (process.argv[2] === 'before') {
  assert(!fs.existsSync(path.join(out, 'preservation-before.json')), 'Refusing to replace capture');
  fs.writeFileSync(path.join(out, 'preservation-before.json'), JSON.stringify(current, null, 2) + '\n');
  fs.mkdirSync(path.join(out, 'local'), { recursive: true });
  fs.writeFileSync(path.join(out, 'local/candidate.patch'), git(root, 'diff', '--binary', 'HEAD'));
  fs.writeFileSync(path.join(out, 'git-status-before.txt'), git(root, 'status', '--short', '--branch', '--untracked-files=all'));
  for (const e of current.candidate.entries.filter((e) => e.changed || e.untracked)) {
    const target = path.join(out, 'local/candidate-snapshot', e.file);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(root, e.file), target);
  }
  const prior = JSON.parse(fs.readFileSync('docs/reviews/eng-v2-03-rc1-astra/preservation-after.json', 'utf8'));
  const implementationBefore = JSON.parse(fs.readFileSync('docs/evidence/eng-v2-03-rc2/local/preservation-before.json', 'utf8'));
  const expected = JSON.parse(fs.readFileSync('docs/evidence/eng-v2-03-rc2/preservation-after.json', 'utf8'));
  assert.deepEqual(current.main.entries, prior.main.entries);
  assert.equal(current.main.head, prior.main.head); assert.equal(current.main.branch, prior.main.branch); assert.equal(current.main.staged, '');
  assert.equal(current.excludeSha256, prior.excludeSha256);
  assert.deepEqual(current.history[historicalRoots[0]], prior.historicalReviewIncludingIgnored);
  assert.deepEqual(current.history[historicalRoots[1]], implementationBefore.rc1ReviewIncludingIgnored);
  assert.deepEqual(current.history[historicalRoots[3]], prior.implementationRc1IncludingIgnored);
  const comparable = current.candidate.entries.filter((e) => !rc1Review(e.file) && !rc2Evidence(e.file));
  const a = new Map(prior.candidate.entries.map((e) => [e.file, e])), b = new Map(comparable.map((e) => [e.file, e]));
  const changes = [...new Set([...a.keys(), ...b.keys()])].sort().filter((f) => JSON.stringify(a.get(f)) !== JSON.stringify(b.get(f)))
    .map((file) => ({ file, before: a.get(file)?.sha256 ?? null, after: b.get(file)?.sha256 ?? null }));
  assert.deepEqual(changes, expected.changes);
  const oldHandoff = fs.readFileSync('docs/reviews/eng-v2-03-rc1-astra/local/candidate-snapshot/docs/handoffs/ENG-V2-03.md');
  assert.equal(sha(oldHandoff), a.get('docs/handoffs/ENG-V2-03.md').sha256);
  assert(fs.readFileSync('docs/handoffs/ENG-V2-03.md').subarray(0, oldHandoff.length).equals(oldHandoff));
  const fingerprint = (entries) => sha(JSON.stringify(entries.filter((e) => substantive(e.file) && (e.changed || e.untracked))));
  assert.equal(fingerprint(prior.candidate.entries), '01c6ec10666ed943fbb3804101637cd00458ed60a8caaf319586e84e44e7039c');
  assert.equal(fingerprint(current.candidate.entries), expected.substantiveFingerprintAfter);
  const scope = { rc1Fingerprint: fingerprint(prior.candidate.entries), rc2Fingerprint: fingerprint(current.candidate.entries),
    fullCandidateFingerprint: current.candidate.candidateFingerprint, changes,
    candidateFiles: current.candidate.entries.length, modified: current.candidate.entries.filter((e) => e.changed).length,
    untracked: current.candidate.entries.filter((e) => e.untracked).length,
    priorComparableEntries: prior.candidate.entries.length, currentComparableEntries: comparable.length,
    rc1ReviewPublicAdditions: current.candidate.entries.filter((e) => rc1Review(e.file)).length,
    rc2EvidencePublicAdditions: current.candidate.entries.filter((e) => rc2Evidence(e.file)).length,
    handoffPrefixBytes: oldHandoff.length, mainFiles: current.main.entries.length,
    mainUntracked: current.main.entries.filter((e) => e.untracked).length,
    historicalTrees: Object.fromEntries(Object.entries(current.history).map(([dir, entries]) => [dir, entries.length])) };
  fs.writeFileSync(path.join(out, 'scope.json'), JSON.stringify(scope, null, 2) + '\n');
  console.log(JSON.stringify(scope, null, 2));
} else {
  const before = JSON.parse(fs.readFileSync(path.join(out, 'preservation-before.json'), 'utf8'));
  assert.deepEqual(current, before, 'Candidate, historical evidence or main changed');
  fs.writeFileSync(path.join(out, 'preservation-after.json'), JSON.stringify({ preserved: true, ...current }, null, 2) + '\n');
  console.log(JSON.stringify({ preserved: true, candidateFiles: current.candidate.entries.length, mainFiles: current.main.entries.length }));
}
