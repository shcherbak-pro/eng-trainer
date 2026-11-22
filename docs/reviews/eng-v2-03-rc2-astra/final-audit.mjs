import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { homedir, userInfo } from 'node:os';
const relative = 'docs/reviews/eng-v2-03-rc2-astra', out = path.resolve(relative);
const reportFile = 'docs/reviews/ENG-V2-03-RC2-ASTRA.md';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const read = (f) => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'));
const oldAction = fs.readFileSync('docs/reviews/eng-v2-03-rc1-astra/local/candidate-snapshot/src/features/topics/revealFocusedChip.ts', 'utf8');
const newAction = fs.readFileSync('src/features/topics/revealFocusedChip.ts', 'utf8');
const tokens = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
assert.equal(tokens(newAction.replace(/^.*window\.(add|remove)EventListener\('resize', schedule\);.*$/gm, '')), tokens(oldAction));
assert.equal((newAction.match(/window.addEventListener\('resize', schedule\)/g) ?? []).length, 1);
assert.equal((newAction.match(/window.removeEventListener\('resize', schedule\)/g) ?? []).length, 1);
const oldTests = fs.readFileSync('docs/reviews/eng-v2-03-rc1-astra/local/candidate-snapshot/src/features/topics/revealFocusedChip.test.ts', 'utf8');
const newTests = fs.readFileSync('src/features/topics/revealFocusedChip.test.ts', 'utf8');
assert(newTests.replaceAll('\r\n', '\n').startsWith(oldTests.replaceAll('\r\n', '\n').trimEnd()));
assert.equal((oldTests.match(/\bit\(/g) ?? []).length, 3);
assert.equal((newTests.match(/\bit\(/g) ?? []).length, 10);
for (const record of read('runner-adaptations.json').records) {
  const original = fs.readFileSync(record.source, 'utf8'); let copy = original;
  assert.equal(sha(original), record.sourceSha256);
  for (const [from, to] of record.substitutions) copy = copy.replaceAll(from, to);
  assert.equal(copy, fs.readFileSync(record.destination, 'utf8'));
  assert.equal(sha(copy), record.copySha256);
}
for (const e of read('artifacts.json').rc2Artifacts) assert.equal(sha(fs.readFileSync(path.join('site-dist', e.file))), e.sha256);
assert(read('preservation-after.json').preserved);
assert(read('commands/commands.json').commands.every((c) => c.exitCode === 0));
assert.equal(read('independent.json').numPassedTests, 24);
assert(read('focused.json').passed && read('height-sequence.json').passed && read('event-lifecycle.json').passed && read('budget.json').passed);
assert(Object.values(read('implementation-browser/results.json').summary).every((s) => s.passed === 12 && s.total === 12));
assert(read('exact-probe-summary.json').every((r) => r.resizedComplete === (r.build === 'rc2') && r.exit === (r.build === 'rc2' ? 0 : 1)));
const status = execFileSync('git', ['status', '--short', '--untracked-files=all'], { encoding: 'utf8' });
fs.writeFileSync(path.join(out, 'git-status-after.txt'), status);
function walk(dir, prefix) {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
    if (e.name === 'local' || e.name === 'final-checks.json') return [];
    return e.isDirectory() ? walk(path.join(dir, e.name), prefix + e.name + '/') : [prefix + e.name];
  });
}
const files = [...walk(out, relative + '/'), reportFile];
const publicText = files.filter((f) => /\.(mjs|ts|json|md|log|txt)$/.test(f) || f.endsWith('.gitignore'));
const sensitive = [process.cwd(), homedir(), userInfo().username].filter((s) => s.length > 3)
  .flatMap((s) => [s, s.replaceAll('\\', '/'), s.replaceAll('\\', '\\\\')]).map((s) => s.toLowerCase());
const privacy = [], whitespace = [], missingLinks = [];
for (const file of publicText) {
  const text = fs.readFileSync(file, 'utf8');
  if (sensitive.some((s) => text.toLowerCase().includes(s)) || /[A-Za-z]:[\\/]+Users[\\/]+/.test(text)) privacy.push(file);
}
const untrackedText = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0')
  .filter((f) => /\.(svelte|ts|js|mjs|cjs|json|md|css|html|txt)$/.test(f));
for (const file of new Set([...untrackedText, ...publicText])) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    line = line.replace(/\r$/, '');
    if (/[ \t]$/.test(line) || /^\t* +\t/.test(line) || /^(<<<<<<<|>>>>>>>)( |$)|^=======$/.test(line)) whitespace.push({ file, line: i + 1 });
  });
}
for (const file of [reportFile, relative + '/README.md']) {
  for (const [, target] of fs.readFileSync(file, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
    const resolved = path.resolve(path.dirname(file), target);
    // This audit's own output is created below; validate its link after writing it.
    if (!target.startsWith('http') && resolved !== path.join(out, 'final-checks.json') && !fs.existsSync(resolved)) missingLinks.push({ file, target });
  }
}
const tracked = spawnSync('git', ['-c', 'core.whitespace=cr-at-eol', 'diff', '--check'], { encoding: 'utf8' });
assert.equal(tracked.status, 0); assert.deepEqual(privacy, []); assert.deepEqual(whitespace, []); assert.deepEqual(missingLinks, []);
const summary = {
  verdict: 'READY_FOR_PR', F1_RC1: 'CLOSED',
  staticDelta: { onlyResizeListenerRegistrationRemovalAndComments: true, previousTestsPreserved: 3, newTests: 7,
    callbackTargetAndCaptureMatch: true, calculationsAndGuardsUnchanged: true },
  preservation: true, allRunnerAdaptationsVerified: true, builtArtifactHashesVerified: true,
  projectGateExitCodes: read('commands/commands.json').commands.map(({ name, exitCode }) => ({ name, exitCode })),
  independentTests: 24, implementationBrowser: read('implementation-browser/results.json').summary,
  focused: Object.fromEntries(Object.entries(read('focused.json').engines).map(([engine, e]) => [engine, e.summary])),
  exactProbe: read('exact-probe-summary.json'),
  heightSequence: Object.fromEntries(Object.entries(read('height-sequence.json').engines).map(([engine, e]) => [engine,
    e.cases.map((c) => ({ build: c.build, width: c.width, textPercent: c.percent, targetHeight: c.targetHeight,
      failures: c.failures, visibilityFailures: c.visibilityFailures, observations: c.measurements.length }))])),
  lifecycle: Object.fromEntries(Object.entries(read('event-lifecycle.json').engines).map(([engine, e]) => [engine, {
    passed: e.passed, assertions: e.checks.length, listenerRecords: e.listenerRecords,
    nativeCorrectiveScrolls: e.cases.nativeBurst.scrollCountAfterSettle,
    correctiveScrollsOneSecondLater: e.cases.nativeBurst.scrollCountOneSecondLater,
  }])),
  worstBudget: Object.entries(read('budget.json').engines).flatMap(([engine, e]) =>
    Object.entries(e.routes).map(([route, r]) => ({ engine, route, code: r.rc2.code, fonts: r.rc2.fonts, content: r.rc2.content,
      other: r.rc2.other, total: r.rc2.total }))).sort((a, b) => b.total - a.total)[0],
  publicTextFiles: publicText.length, untrackedTextFilesChecked: untrackedText.length,
  trackedWhitespaceExit: tracked.status, whitespace, privacy, missingLinks,
  artifacts: files.map((file) => ({ file, sha256: sha(fs.readFileSync(file)) })),
};
fs.writeFileSync(path.join(out, 'final-checks.json'), JSON.stringify(summary, null, 2) + '\n');
assert(fs.existsSync(path.join(out, 'final-checks.json')));
console.log(JSON.stringify({ verdict: summary.verdict, publicTextFiles: publicText.length, untrackedTextFilesChecked: untrackedText.length,
  whitespace: whitespace.length, privacy: privacy.length, missingLinks: missingLinks.length, worstTotal: summary.worstBudget.total }));
