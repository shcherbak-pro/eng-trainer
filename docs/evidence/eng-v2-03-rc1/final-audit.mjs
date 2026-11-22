// Final documentation/evidence audit. Does not rebuild or rerun already-passing tests.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = process.cwd(), out = 'docs/evidence/eng-v2-03-rc1';
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { encoding: 'utf8' });
git('-c', 'core.whitespace=cr-at-eol', 'diff', '--check');
assert.equal(git('diff', '--cached', '--name-only'), '');
assert.equal(git('rev-parse', 'HEAD').trim(), '03f1267f1ef4287580227ce5db67615988c98177');
assert.equal(git('branch', '--show-current').trim(), 'feature/eng-v2-03-learning-topics');
const files = git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
const textFiles = files.filter((file) => /\.(svelte|ts|js|mjs|cjs|json|md|css|html|txt|log)$/.test(file) || file.endsWith('/.gitignore'));
const whitespace = [], privacy = [];
const publicText = textFiles.filter((file) => file.startsWith(out + '/'));
for (const file of textFiles) {
  const contents = fs.readFileSync(file, 'utf8');
  for (const [index, raw] of contents.split('\n').entries()) {
    const line = raw.replace(/\r$/, '');
    if (/[ \t]$/.test(line) || /^\t* +\t/.test(line) || /^(<<<<<<<|>>>>>>>)( |$)|^=======$/.test(line)) whitespace.push({ file, line: index + 1 });
  }
  if (publicText.includes(file)) {
    const normalized = contents.toLowerCase().replaceAll('\\', '/');
    const home = os.homedir().toLowerCase().replaceAll('\\', '/');
    if (normalized.includes(home) || normalized.includes(root.toLowerCase().replaceAll('\\', '/')) ||
        /[a-z]:\/+users\//i.test(normalized) || /sk-proj-[a-z0-9]{12,}/i.test(contents)) privacy.push(file);
  }
}
assert.deepEqual(whitespace, []);
assert.deepEqual(privacy, []);
const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
assert.equal(summary.allRequiredChecksPassed, true);
for (const entry of summary.changes) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(entry.file)).digest('hex'), entry.after, `Source changed after verification: ${entry.file}`);
const result = { trackedWhitespace: 'passed', untrackedTextFilesChecked: textFiles.length, untrackedWhitespace: whitespace,
  publicRc1TextFilesChecked: publicText.length, machinePathOrCredentialFindings: privacy,
  testedSourceHashesStillMatch: true, staged: false, head: git('rev-parse', 'HEAD').trim() };
fs.writeFileSync(path.join(out, 'final-checks.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
