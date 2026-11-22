import fs from 'node:fs';
import path from 'node:path';
import { homedir, userInfo } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const relative = 'docs/reviews/eng-v2-03-rc1-astra';
const report = 'docs/reviews/ENG-V2-03-RC1-ASTRA.md';
const out = path.resolve(relative);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function files(dir, prefix) {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
    if (e.name === 'local' || e.name === 'final-checks.json') return [];
    return e.isDirectory() ? files(path.join(dir, e.name), prefix + e.name + '/') : [prefix + e.name];
  });
}
const status = execFileSync('git', ['status', '--short', '--untracked-files=all'], { encoding: 'utf8' });
fs.writeFileSync(path.join(out, 'git-status-after.txt'), status);
const publicFiles = [...files(out, relative + '/'), report];
const textFiles = publicFiles.filter((f) => /\.(mjs|ts|json|md|log|txt)$/.test(f) || f.endsWith('.gitignore'));
const whitespace = [], privacy = [];
const sensitive = [process.cwd(), homedir(), userInfo().username].filter((s) => s.length > 3)
  .flatMap((s) => [s, s.replaceAll('\\', '/'), s.replaceAll('\\', '\\\\')]).map((s) => s.toLowerCase());
for (const file of textFiles) {
  const text = fs.readFileSync(file, 'utf8');
  text.split('\n').forEach((line, index) => {
    line = line.replace(/\r$/, '');
    if (/[ \t]$/.test(line) || /^\t* +\t/.test(line) || /^(<<<<<<<|>>>>>>>)( |$)|^=======$/.test(line)) whitespace.push({ file, line: index + 1 });
  });
  if (sensitive.some((s) => text.toLowerCase().includes(s)) || /[A-Za-z]:[\\/]+Users[\\/]+/.test(text)) privacy.push(file);
}
const tracked = spawnSync('git', ['-c', 'core.whitespace=cr-at-eol', 'diff', '--check'], { encoding: 'utf8' });
assert.equal(tracked.status, 0, tracked.stderr);
assert.deepEqual(whitespace, []);
assert.deepEqual(privacy, []);
const preserved = JSON.parse(fs.readFileSync(path.join(out, 'preservation-after.json'), 'utf8'));
assert(preserved.preserved);
const focused = JSON.parse(fs.readFileSync(path.join(out, 'focused.json'), 'utf8'));
const resize = JSON.parse(fs.readFileSync(path.join(out, 'viewport-resize.json'), 'utf8'));
const shared = JSON.parse(fs.readFileSync(path.join(out, 'shared-controls.json'), 'utf8'));
assert(focused.passed && shared.passed);
assert.equal(resize.passed, false);
for (const file of ['focused.mjs', 'viewport-resize.mjs']) {
  const expected = file.startsWith('viewport') ? resize.runnerSha256 : focused.runnerSha256;
  assert.equal(sha(fs.readFileSync(path.join(out, file))), expected, 'Runner changed after measured execution');
}
assert.equal(sha(fs.readFileSync(path.join(out, 'browser-support.mjs'))), focused.geometrySha256);
const gates = JSON.parse(fs.readFileSync(path.join(out, 'commands/commands.json'), 'utf8'));
assert(gates.commands.every((c) => c.exitCode === 0));
const result = {
  verdict: 'CHANGES_REQUIRED', finding: 'F1-RC1 / P2: focused chip obscured after height-only viewport resize',
  trackedWhitespaceExit: tracked.status, publicTextFilesChecked: textFiles.length,
  whitespaceProblems: whitespace, privacyProblems: privacy,
  candidateAndHistoricalEvidencePreserved: true,
  exactExecutedRunnersVerified: true,
  geometry: Object.fromEntries(Object.entries(focused.engines).map(([engine, e]) => [engine, e.summary])),
  resize: Object.fromEntries(Object.entries(resize.engines).map(([engine, e]) => [engine, {
    beforePass: e.before.complete, resizedPass: e.resized.complete, refocusedPass: e.refocused.complete,
    clippedPixels: e.resized.paintedOverflow, errors: e.errors,
  }])),
  artifacts: publicFiles.map((file) => ({ file, sha256: sha(fs.readFileSync(file)) })),
};
fs.writeFileSync(path.join(out, 'final-checks.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ verdict: result.verdict, publicTextFilesChecked: textFiles.length,
  whitespaceProblems: whitespace.length, privacyProblems: privacy.length, exactExecutedRunnersVerified: true }));
