// Final whitespace and privacy audit of the RC2 change and its public evidence. Run last, after
// preserve.mjs after: node docs/evidence/eng-v2-03-rc2/final-audit.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { homedir, userInfo } from 'node:os';
import { spawnSync } from 'node:child_process';

const dir = 'docs/evidence/eng-v2-03-rc2';
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = (...args) => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// 1. Tracked changes: the documented whitespace check.
const diffCheck = git('-c', 'core.whitespace=cr-at-eol', 'diff', '--check');

// 2. Every new text file in the worktree, with the same rules as the documented new-file check.
const untracked = git('ls-files', '--others', '--exclude-standard').stdout.split('\n').filter(Boolean);
const textFiles = untracked.filter((file) => /\.(svelte|ts|js|mjs|cjs|json|md|css|html|txt)$/.test(file));
const whitespace = [];
for (const file of textFiles) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    const text = line.replace(/\r$/, '');
    if (/[ \t]$/.test(text)) whitespace.push(`${file}:${index + 1}: trailing whitespace`);
    if (/^\t* +\t/.test(text)) whitespace.push(`${file}:${index + 1}: space before tab in indent`);
    if (/^(<<<<<<<|>>>>>>>)( |$)|^=======$/.test(text)) whitespace.push(`${file}:${index + 1}: conflict marker`);
  });
}

// 3. Privacy: no account name, home or temporary paths, or e-mail addresses in what RC2 publishes.
const publicEvidence = git('ls-files', '--others', '--exclude-standard', '--', dir).stdout.split('\n').filter(Boolean).sort();
// final-checks.json is this script's own output, rewritten on every run.
const scanned = [...publicEvidence.filter((file) => !file.endsWith('.png') && file !== `${dir}/final-checks.json`), 'docs/handoffs/ENG-V2-03.md', 'src/features/topics/revealFocusedChip.ts', 'src/features/topics/revealFocusedChip.test.ts'];
const home = homedir();
const needles = [userInfo().username, home, home.replace(/\\/g, '/'), home.replace(/\\/g, '\\\\')].filter((value) => value.length > 2);
// The profile-data folder name is assembled so that this script does not match its own pattern.
const patterns = [/[A-Za-z]:[\\/]+Users[\\/]/, /\/[a-z]\/Users\//, new RegExp(['App', 'Data'].join(''), 'i'), /~\d[\\/]/, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i];
const privacy = [];
for (const file of scanned) {
  const text = fs.readFileSync(file, 'utf8');
  for (const needle of needles) if (text.toLowerCase().includes(needle.toLowerCase())) privacy.push(`${file}: machine-specific value`);
  for (const pattern of patterns) if (pattern.test(text)) privacy.push(`${file}: matches ${pattern}`);
}

const result = {
  trackedDiffCheck: diffCheck.status === 0 && !diffCheck.stdout.trim() ? 'clean' : diffCheck.stdout.trim(),
  newTextFilesChecked: textFiles.length,
  whitespaceProblems: whitespace,
  privacyFilesScanned: scanned.length,
  privacyFindings: privacy,
  publicEvidence: publicEvidence.filter((file) => file !== `${dir}/final-checks.json`).map((file) => ({ file, sha256: sha(file) })),
};
fs.writeFileSync(path.join(dir, 'final-checks.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, publicEvidence: result.publicEvidence.length }, null, 2));
assert.equal(result.trackedDiffCheck, 'clean');
assert.deepEqual(whitespace, []);
assert.deepEqual(privacy, []);
