// Validate the final evidence together, without rerunning browsers or changing historical files.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const out = 'docs/evidence/eng-v2-03-rc1';
const read = (file) => JSON.parse(fs.readFileSync(path.join(out, file), 'utf8'));
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const before = read('reviewed.json'), after = read('rc1.json'), commands = read('commands/commands.json');
const browser = read('implementation-browser/results.json'), budget = read('budget.json'), artifacts = read('artifacts.json');
assert.equal(before.passed, false);
assert.equal(after.passed, true);
assert.equal(before.runnerSha256, after.runnerSha256, 'Same assertions must fail before and pass after');
assert.equal(after.runnerSha256, sha(fs.readFileSync(path.join(out, 'focused-chips.mjs'))));
assert.equal(after.buildIndexSha256, sha(fs.readFileSync('site-dist/index.html')));
assert(commands.commands.every((command) => command.exitCode === 0));
assert.equal(budget.passed, true);
const engines = {};
for (const engine of ['chromium', 'firefox']) {
  const old = before.engines[engine], current = after.engines[engine];
  assert.equal(old.scenarios.length, 7); assert.equal(current.scenarios.length, 7);
  assert(old.scenarios.every((scenario) => scenario.failures.length > 0 && scenario.failures.every((failure) => failure.endsWith(': label/outline clipped'))));
  assert(current.scenarios.every((scenario) => scenario.passed && scenario.failures.length === 0 && scenario.errors.length === 0 && scenario.rejections.length === 0));
  assert.equal(browser.summary[engine].passed, 12); assert.equal(browser.summary[engine].total, 12);
  const sample = (report, id, step) => report.engines[engine].scenarios.find((scenario) => scenario.id === id).measurements.find((measurement) => measurement.step === step);
  const sizes = before.engines[engine].scenarios.find((scenario) => scenario.id === 'matrix-320-200').initialDimensions;
  engines[engine] = { version: current.version, beforeFailingScenarios: old.scenarios.length,
    afterPassingScenarios: current.scenarios.length, visibilityMeasurements: current.scenarios.reduce((count, scenario) => count + scenario.measurements.length, 0),
    implementationScenarios: browser.summary[engine], errors: 0, unhandledRejections: 0,
    originallyOversizedAt320And200Percent: sizes.chips.filter((chip) => chip.width + 8 > sizes.available),
    representativeMeasurements: ['Tab 2', 'Enter 2', 'Space 2', 'Tab 4', 'Enter 4', 'Space 4'].map((step) => ({
      step, reviewed: sample(before, 'matrix-390-100', step), rc1: sample(after, 'matrix-390-100', step)
    })), worstBudget: Object.entries(budget.engines[engine].routes).sort((a, b) => b[1].rc1.total - a[1].rc1.total)[0] };
}
const baseline = read('baseline.json');
const changes = ['src/app.css', 'src/features/topics/TopicPage.svelte', 'src/features/topics/revealFocusedChip.ts', 'src/features/topics/revealFocusedChip.test.ts'].map((file) => ({
  file, before: baseline.candidate.entries.find((entry) => entry.file === file)?.sha256 ?? null, after: sha(fs.readFileSync(file))
}));
const result = { runnerSha256: after.runnerSha256, allRequiredChecksPassed: true, engines, changes,
  unchangedBuiltFiles: Object.fromEntries(Object.entries(artifacts.groups).map(([key, group]) => [key, group.files])),
  documentedCommands: commands.commands.map(({ command, exitCode }) => ({ command, exitCode })) };
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ allRequiredChecksPassed: true, measurementsPerEngine: engines.chromium.visibilityMeasurements,
  implementationPerEngine: 12, changedFiles: changes.map(({ file }) => file) }));
