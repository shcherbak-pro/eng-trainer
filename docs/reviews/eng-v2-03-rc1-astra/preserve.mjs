import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const relative = 'docs/reviews/eng-v2-03-rc1-astra';
const out = path.join(root, relative);
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const common = path.resolve(root, git(root, 'rev-parse', '--git-common-dir').trim());
const main = path.dirname(common);
const isNewReview = (f) => f.startsWith(relative + '/') || f === 'docs/reviews/ENG-V2-03-RC1-ASTRA.md';
const isOldReview = (f) => f.startsWith('docs/reviews/eng-v2-03-astra/') || f === 'docs/reviews/ENG-V2-03-ASTRA.md';
const isRcEvidence = (f) => f.startsWith('docs/evidence/eng-v2-03-rc1/');
function inventory(cwd) {
  const list = (...args) => git(cwd, 'ls-files', '-z', ...args).split('\0').filter((f) => f && !isNewReview(f));
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
function tree(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const absolute = path.join(dir, entry.name), file = prefix + entry.name;
    if (entry.isSymbolicLink()) return [{ file, link: true, targetSha256: sha(fs.readlinkSync(absolute)) }];
    if (entry.isDirectory()) return tree(absolute, file + '/');
    return [{ file, sha256: sha(fs.readFileSync(absolute)) }];
  });
}
const current = {
  candidate: inventory(root), main: inventory(main),
  historicalReviewIncludingIgnored: tree(path.join(root, 'docs/reviews/eng-v2-03-astra')),
  implementationRc1IncludingIgnored: tree(path.join(root, 'docs/evidence/eng-v2-03-rc1')),
  excludeSha256: sha(fs.readFileSync(path.join(common, 'info/exclude'))),
};
assert.equal(current.candidate.head, '03f1267f1ef4287580227ce5db67615988c98177');
assert.equal(current.candidate.branch, 'feature/eng-v2-03-learning-topics');
assert.equal(current.candidate.staged, '');
fs.mkdirSync(out, { recursive: true });
if (process.argv[2] === 'before') {
  assert(!fs.existsSync(path.join(out, 'preservation-before.json')), 'Refusing to replace review baseline');
  fs.writeFileSync(path.join(out, 'preservation-before.json'), JSON.stringify(current, null, 2) + '\n');
  fs.mkdirSync(path.join(out, 'local'), { recursive: true });
  fs.writeFileSync(path.join(out, 'local/candidate.patch'), git(root, 'diff', '--binary', 'HEAD'));
  for (const e of current.candidate.entries.filter((e) => e.changed || e.untracked)) {
    const target = path.join(out, 'local/candidate-snapshot', e.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, e.file), target);
  }
  fs.writeFileSync(path.join(out, 'git-status-before.txt'), git(root, 'status', '--short', '--branch', '--untracked-files=all'));
  const original = JSON.parse(fs.readFileSync('docs/reviews/eng-v2-03-astra/preservation-before.json', 'utf8'));
  assert.equal(sha(JSON.stringify(original.candidate.entries.filter((e) => e.changed || e.untracked))),
    'be282772e3b5989941148be9ac7c795dcc2604b943247fe0079c4450d0e66f1a');
  const comparable = current.candidate.entries.filter((e) => !isOldReview(e.file) && !isRcEvidence(e.file));
  const oldMap = new Map(original.candidate.entries.map((e) => [e.file, e]));
  const newMap = new Map(comparable.map((e) => [e.file, e]));
  const changes = [...new Set([...oldMap.keys(), ...newMap.keys()])].sort().filter((f) =>
    JSON.stringify(oldMap.get(f)) !== JSON.stringify(newMap.get(f))).map((file) => ({
    file, before: oldMap.get(file)?.sha256 ?? null, after: newMap.get(file)?.sha256 ?? null,
  }));
  const expected = JSON.parse(fs.readFileSync('docs/evidence/eng-v2-03-rc1/preservation-after.json', 'utf8'));
  assert.deepEqual(changes, expected.changes);
  assert.deepEqual(current.main.entries, original.main.entries);
  assert.equal(current.main.head, original.main.head);
  assert.equal(current.main.branch, original.main.branch);
  assert.equal(current.main.staged, '');
  const rcBase = JSON.parse(fs.readFileSync('docs/evidence/eng-v2-03-rc1/baseline.json', 'utf8'));
  assert.deepEqual(current.historicalReviewIncludingIgnored, rcBase.reviewIncludingIgnored);
  const oldHandoff = fs.readFileSync('docs/evidence/eng-v2-03-rc1/local/sources/docs/handoffs/ENG-V2-03.md');
  assert.equal(sha(oldHandoff), oldMap.get('docs/handoffs/ENG-V2-03.md').sha256);
  assert(fs.readFileSync('docs/handoffs/ENG-V2-03.md').subarray(0, oldHandoff.length).equals(oldHandoff));
  const scope = {
    originalFingerprint: original.candidate.candidateFingerprint,
    correctedFingerprintExcludingHistoricalReviewAndRc1Evidence: sha(JSON.stringify(comparable.filter((e) => e.changed || e.untracked))),
    fullCandidateFingerprint: current.candidate.candidateFingerprint,
    originalEntries: original.candidate.entries.length, currentEntries: current.candidate.entries.length,
    substantiveEntries: comparable.length,
    historicalReviewAdditions: current.candidate.entries.filter((e) => isOldReview(e.file)).length,
    rc1EvidenceAdditions: current.candidate.entries.filter((e) => isRcEvidence(e.file)).length,
    changes, mainFiles: current.main.entries.length, mainUntracked: current.main.entries.filter((e) => e.untracked).length,
    mainAdditionalFiles: 0, historicalReviewIncludingIgnored: current.historicalReviewIncludingIgnored.length,
    originalHandoffBytesPreserved: oldHandoff.length,
  };
  assert.equal(scope.correctedFingerprintExcludingHistoricalReviewAndRc1Evidence, expected.candidateFingerprintExcludingReviewAndRc1Evidence);
  fs.writeFileSync(path.join(out, 'scope.json'), JSON.stringify(scope, null, 2) + '\n');
  console.log(JSON.stringify(scope, null, 2));
} else {
  const before = JSON.parse(fs.readFileSync(path.join(out, 'preservation-before.json'), 'utf8'));
  assert.deepEqual(current, before, 'Candidate, historical evidence, or main changed during review');
  fs.writeFileSync(path.join(out, 'preservation-after.json'), JSON.stringify({ preserved: true, ...current }, null, 2) + '\n');
  console.log(JSON.stringify({ preserved: true, candidateFiles: current.candidate.entries.length,
    mainFiles: current.main.entries.length, mainUntracked: current.main.entries.filter((e) => e.untracked).length }));
}
