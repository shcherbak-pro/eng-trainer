// Run from the candidate worktree: node docs/evidence/eng-v2-03-rc1/preserve.mjs before|after
// Public inventories contain repository-relative names only. Exact local copies are ignored.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const relativeOut = 'docs/evidence/eng-v2-03-rc1';
const out = path.join(root, relativeOut);
const git = (cwd, ...args) => execFileSync('git', ['-c', `safe.directory=${cwd.replaceAll('\\', '/')}`, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const common = path.resolve(root, git(root, 'rev-parse', '--git-common-dir').trim());
const main = path.dirname(common);
const reviewed = JSON.parse(fs.readFileSync('docs/reviews/eng-v2-03-astra/preservation-before.json', 'utf8'));
const isReview = (file) => file.startsWith('docs/reviews/eng-v2-03-astra/') || file === 'docs/reviews/ENG-V2-03-ASTRA.md';
const list = (cwd, ...args) => git(cwd, 'ls-files', '-z', ...args).split('\0').filter(Boolean).filter((f) => !f.startsWith(`${relativeOut}/`));
function inventory(cwd) {
  const tracked = list(cwd);
  const untracked = list(cwd, '--others', '--exclude-standard');
  const changed = git(cwd, 'diff', '--name-only', '-z', 'HEAD').split('\0').filter(Boolean);
  const entries = [...new Set([...tracked, ...untracked])].sort().map((file) => ({
    file, sha256: fs.existsSync(path.join(cwd, file)) ? sha(fs.readFileSync(path.join(cwd, file))) : null,
    untracked: untracked.includes(file), changed: changed.includes(file)
  }));
  return { head: git(cwd, 'rev-parse', 'HEAD').trim(), branch: git(cwd, 'branch', '--show-current').trim(),
    staged: git(cwd, 'diff', '--cached', '--name-only'), entries };
}
function tree(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    const file = prefix + entry.name;
    // Do not follow the historical baseline's node_modules junction into dependencies.
    if (entry.isSymbolicLink()) return [{ file, link: true, targetSha256: sha(fs.readlinkSync(absolute)) }];
    if (entry.isDirectory()) return tree(absolute, file + '/');
    return [{ file, sha256: sha(fs.readFileSync(absolute)) }];
  });
}
const current = {
  candidate: inventory(root), main: inventory(main),
  reviewIncludingIgnored: tree(path.join(root, 'docs/reviews/eng-v2-03-astra')),
  excludeSha256: sha(fs.readFileSync(path.join(common, 'info/exclude')))
};
assert.equal(current.candidate.head, '03f1267f1ef4287580227ce5db67615988c98177');
assert.equal(current.candidate.branch, 'feature/eng-v2-03-learning-topics');
assert.equal(current.candidate.staged, '');
fs.mkdirSync(out, { recursive: true });
if (process.argv[2] === 'before') {
  assert(!fs.existsSync(path.join(out, 'baseline.json')), 'Refusing to overwrite the correction baseline');
  const original = current.candidate.entries.filter((entry) => !isReview(entry.file));
  assert.deepEqual(original, reviewed.candidate.entries, 'Reviewed implementation changed before RC1');
  const fingerprint = sha(JSON.stringify(original.filter((entry) => entry.changed || entry.untracked)));
  assert.equal(fingerprint, 'be282772e3b5989941148be9ac7c795dcc2604b943247fe0079c4450d0e66f1a');
  const mainByFile = new Map(current.main.entries.map((entry) => [entry.file, entry]));
  for (const entry of reviewed.main.entries) assert.deepEqual(mainByFile.get(entry.file), entry, `Existing main work changed: ${entry.file}`);
  current.verifiedReviewedFingerprint = fingerprint;
  current.reviewPublicAdditions = current.candidate.entries.filter((entry) => isReview(entry.file));
  current.mainAdditionalFiles = current.main.entries.filter((entry) => !reviewed.main.entries.some((old) => old.file === entry.file));
  for (const entry of original.filter((entry) => entry.changed || entry.untracked)) {
    const destination = path.join(out, 'local/sources', entry.file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, entry.file), destination);
  }
  assert(fs.existsSync('site-dist/index.html'), 'Reviewed combined build required before correction');
  current.reviewedSite = tree(path.join(root, 'site-dist'));
  fs.cpSync('site-dist', path.join(out, 'local/reviewed-site'), { recursive: true, errorOnExist: true, force: false });
  fs.writeFileSync(path.join(out, 'baseline.json'), JSON.stringify(current, null, 2) + '\n');
  console.log(JSON.stringify({ fingerprint, reviewedFiles: original.filter((e) => e.changed || e.untracked).length,
    reviewPublicAdditions: current.reviewPublicAdditions.length, reviewIncludingIgnored: current.reviewIncludingIgnored.length,
    mainUntracked: current.main.entries.filter((e) => e.untracked).length, mainAdditionalFiles: current.mainAdditionalFiles.length }));
} else {
  const before = JSON.parse(fs.readFileSync(path.join(out, 'baseline.json'), 'utf8'));
  assert.deepEqual(current.main, before.main, 'Main checkout changed');
  assert.deepEqual(current.reviewIncludingIgnored, before.reviewIncludingIgnored, 'Historical review changed');
  assert.equal(current.excludeSha256, before.excludeSha256);
  const allowed = new Set(['src/app.css', 'src/features/topics/TopicPage.svelte', 'src/features/topics/revealFocusedChip.ts',
    'src/features/topics/revealFocusedChip.test.ts', 'docs/handoffs/ENG-V2-03.md']);
  const oldFiles = new Map(before.candidate.entries.map((entry) => [entry.file, entry]));
  const newFiles = new Map(current.candidate.entries.map((entry) => [entry.file, entry]));
  const changes = [...new Set([...oldFiles.keys(), ...newFiles.keys()])].sort().filter((file) =>
    JSON.stringify(oldFiles.get(file)) !== JSON.stringify(newFiles.get(file))).map((file) => ({
    file, before: oldFiles.get(file)?.sha256 ?? null, after: newFiles.get(file)?.sha256 ?? null
  }));
  for (const { file } of changes) assert(allowed.has(file), `Unexpected change outside RC1: ${file}`);
  const handoff = 'docs/handoffs/ENG-V2-03.md';
  const oldHandoff = fs.readFileSync(path.join(out, 'local/sources', handoff));
  assert(fs.readFileSync(handoff).subarray(0, oldHandoff.length).equals(oldHandoff), 'Historical handoff prefix changed');
  assert.deepEqual(tree(path.join(out, 'local/reviewed-site')), before.reviewedSite, 'Reviewed build copy changed');
  const result = { preserved: true, head: current.candidate.head, staged: current.candidate.staged,
    candidateFingerprintExcludingReviewAndRc1Evidence: sha(JSON.stringify(current.candidate.entries.filter((entry) => !isReview(entry.file) && (entry.changed || entry.untracked)))),
    mainUntracked: current.main.entries.filter((e) => e.untracked).length,
    historicalReviewFilesIncludingIgnored: current.reviewIncludingIgnored.length, handoffOriginalBytes: oldHandoff.length,
    changes, rc1Evidence: tree(out).filter((entry) => !entry.file.startsWith('local/') && entry.file !== 'preservation-after.json') };
  fs.writeFileSync(path.join(out, 'preservation-after.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ preserved: true, changes, mainUntracked: result.mainUntracked }));
}
