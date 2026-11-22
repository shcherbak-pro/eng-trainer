import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const out = path.join(root, 'docs/reviews/eng-v2-03-astra');
const git = (cwd, ...args) => execFileSync('git', ['-c', `safe.directory=${cwd.replaceAll('\\', '/')}`, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const common = path.resolve(root, git(root, 'rev-parse', '--git-common-dir').trim());
const main = path.dirname(common);
const reviewer = (file) => file.startsWith('docs/reviews/eng-v2-03-astra/') || file === 'docs/reviews/ENG-V2-03-ASTRA.md';
const files = (cwd, ...args) => git(cwd, 'ls-files', '-z', ...args).split('\0').filter(Boolean).filter((f) => !reviewer(f));
function inventory(cwd) {
  const tracked = files(cwd);
  const untracked = files(cwd, '--others', '--exclude-standard');
  const changed = git(cwd, 'diff', '--name-only', '-z', 'HEAD').split('\0').filter(Boolean);
  const entries = [...new Set([...tracked, ...untracked])].sort().map((file) => ({
    file, sha256: fs.existsSync(path.join(cwd, file)) ? sha(fs.readFileSync(path.join(cwd, file))) : null,
    untracked: untracked.includes(file), changed: changed.includes(file)
  }));
  return { head: git(cwd, 'rev-parse', 'HEAD').trim(), branch: git(cwd, 'branch', '--show-current').trim(),
    staged: git(cwd, 'diff', '--cached', '--name-only'), entries,
    fingerprint: sha(JSON.stringify(entries)),
    candidateFingerprint: sha(JSON.stringify(entries.filter((e) => e.untracked || e.changed))) };
}
fs.mkdirSync(out, { recursive: true });
const current = { candidate: inventory(root), main: inventory(main), excludeSha256: sha(fs.readFileSync(path.join(common, 'info/exclude'))) };
if (process.argv[2] === 'before') {
  if (fs.existsSync(path.join(out, 'preservation-before.json'))) throw new Error('Refusing to replace initial snapshot');
  fs.writeFileSync(path.join(out, 'preservation-before.json'), JSON.stringify(current, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'candidate.patch'), git(root, 'diff', '--binary', 'HEAD'));
  for (const e of current.candidate.entries.filter((e) => e.changed || e.untracked)) {
    if (!e.sha256) continue;
    const target = path.join(out, 'candidate-snapshot', e.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, e.file), target);
  }
  fs.writeFileSync(path.join(out, 'git-status-before.txt'), git(root, 'status', '--short', '--branch', '--untracked-files=all'));
} else {
  const before = JSON.parse(fs.readFileSync(path.join(out, 'preservation-before.json'), 'utf8'));
  current.unchanged = JSON.stringify(before) === JSON.stringify(current);
  fs.writeFileSync(path.join(out, 'preservation-after.json'), JSON.stringify(current, null, 2) + '\n');
  if (!current.unchanged) process.exitCode = 1;
}
console.log(JSON.stringify({candidate: current.candidate.candidateFingerprint, candidateFiles: current.candidate.entries.filter((e) => e.changed || e.untracked).length, mainUntracked: current.main.entries.filter((e) => e.untracked).length, unchanged: current.unchanged}));
