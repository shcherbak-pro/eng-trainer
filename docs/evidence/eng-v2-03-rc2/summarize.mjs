// Collects the RC1/RC2 results into summary.json. node docs/evidence/eng-v2-03-rc2/summarize.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const dir = 'docs/evidence/eng-v2-03-rc2';
const read = (file) => JSON.parse(fs.readFileSync(`${dir}/${file}`, 'utf8'));
const engines = ['chromium', 'firefox'];
const point = (m) => ({ complete: m.complete, coveredOrClippedPx: Number(m.paintedOverflow.toFixed(3)), clippedCharacters: m.clippedCharacters,
  outlineBottom: Number(m.footprint.bottom.toFixed(3)), navigationTop: Number(m.navTop.toFixed(3)), pageScrollY: m.scrollY,
  chipFontPx: m.fontSize, lines: m.lineCount, viewport: `${m.viewport.width}x${m.viewport.height}` });

const resize = Object.fromEntries(['rc1', 'rc2'].map((build) => {
  const report = read(`height-resize/${build}.json`);
  return [build, {
    runnerSha256: report.runnerSha256, oracleSha256: report.oracleSha256, buildIndexSha256: report.buildIndexSha256, summary: report.summary,
    engines: Object.fromEntries(engines.map((engine) => {
      const s = report.engines[engine].scenarios;
      const d = s['decisive-320-200'];
      return [engine, {
        decisive: {
          pass: d.pass, failures: d.failures, tabsToAllSituations: d.tabsToAllSituations,
          before: point(d.before), at480: point(d.resized), restored844: point(d.restored), at480Again: point(d.shrunkAgain),
          elementSizesUnchangedByResize: d.sizesUnchangedByResize, strip: d.layoutBefore.strip, button: d.layoutBefore.button,
          focusOwnerKept: d.layoutResized.activeIsMarked && d.layoutShrunkAgain.activeIsMarked,
          selectionAfter: d.layoutShrunkAgain.selected
        },
        scenarios: Object.fromEntries(Object.entries(s).map(([id, value]) => [id, { pass: value.pass, failures: value.failures, height: value.height ?? null }]))
      }];
    }))
  }];
}));

const probe = Object.fromEntries(['rc1', 'rc2'].map((build) => {
  const report = read(`astra-probe/${build}/viewport-resize.json`);
  return [build, { passed: report.passed, runnerSha256: report.runnerSha256, engines: Object.fromEntries(engines.map((engine) => {
    const e = report.engines[engine];
    return [engine, { before: e.before.complete, resized: e.resized.complete, coveredPx: Number(e.resized.paintedOverflow.toFixed(3)), refocused: e.refocused.complete, errors: e.errors.length }];
  })) }];
}));

const focused = read('rc1-runner/rc2.json');
const implementation = read('implementation-browser/results.json');
const budget = read('budget.json');
const commands = read('commands/commands.json');
const artifacts = read('artifacts.json');
const unit = (file) => {
  const text = fs.readFileSync(`${dir}/unit/${file}`, 'utf8');
  return { passed: (text.match(/^ ✓ /gm) ?? []).length, failed: (text.match(/^ × /gm) ?? []).length };
};
const summary = {
  decisiveRequirement: 'RC1 fails and RC2 passes in both engines, without test-side refocusing or scrolling',
  decisiveResult: {
    rc1FailsInBothEngines: engines.every((engine) => !resize.rc1.engines[engine].decisive.pass && !probe.rc1.engines[engine].resized),
    rc2PassesInBothEngines: engines.every((engine) => resize.rc2.engines[engine].decisive.pass && probe.rc2.engines[engine].resized)
  },
  astraProbe: probe,
  heightResize: resize,
  unitTests: { rc1BeforeFix: unit('rc1-before-fix.log'), rc2AfterFix: unit('rc2-after-fix.log') },
  existingFocusedRunnerOnRc2: Object.fromEntries(engines.map((engine) => {
    const value = focused.engines[engine];
    return [engine, { scenarios: `${value.scenarios.filter((x) => x.passed).length}/${value.scenarios.length}`, visibilityMeasurements: value.scenarios.reduce((n, x) => n + x.measurements.length, 0) }];
  })),
  implementationRunnerOnRc2: implementation.summary,
  budgets: Object.fromEntries(engines.map((engine) => [engine, Object.fromEntries(Object.entries(budget.engines[engine].routes).map(([route, value]) => [route, { rc1: value.rc1.total, rc2: value.rc2.total, rc2Code: value.rc2.code, rc2Fonts: value.rc2.fonts, rc2Content: value.rc2.content, delta: value.delta }]))])),
  largestRc2Total: Math.max(...engines.flatMap((engine) => Object.values(budget.engines[engine].routes).map((value) => value.rc2.total))),
  budgetLimits: budget.budget,
  commands: commands.commands.map((c) => ({ name: c.name, exitCode: c.exitCode, highlights: c.highlights })),
  artifacts: { identicalFiles: artifacts.identicalFiles, of: artifacts.rc2Files, changed: artifacts.changed.map((c) => c.file) }
};
assert.equal(summary.decisiveResult.rc1FailsInBothEngines, true);
assert.equal(summary.decisiveResult.rc2PassesInBothEngines, true);
assert(engines.every((engine) => resize.rc2.engines[engine].decisive.elementSizesUnchangedByResize && resize.rc1.engines[engine].decisive.elementSizesUnchangedByResize));
assert(commands.commands.every((c) => c.exitCode === 0));
fs.writeFileSync(`${dir}/summary.json`, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ decisive: summary.decisiveResult, unit: summary.unitTests, focused: summary.existingFocusedRunnerOnRc2, implementation: summary.implementationRunnerOnRc2, largestRc2Total: summary.largestRc2Total, artifacts: summary.artifacts }, null, 2));
