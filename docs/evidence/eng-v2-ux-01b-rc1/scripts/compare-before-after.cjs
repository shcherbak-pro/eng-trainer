// Compares Vitest JSON reports of the same tests run against the reviewed and the corrected candidate.
// Usage: node compare-before-after.cjs <dir-with-reports> [<output.json>]
const fs = require('fs');
const path = require('path');

const [dir, output] = process.argv.slice(2);
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const relative = (file) => file.replace(/\\/g, '/').replace(/^.*?\/(src|docs)\//, '$1/');

function flatten(report) {
  return report.testResults.flatMap((file) =>
    file.assertionResults.length
      ? file.assertionResults.map((test) => ({ file: relative(file.name), test: test.fullName, status: test.status }))
      : [{ file: relative(file.name), test: '(the test file could not run)', status: 'failed', reason: (file.message || '').split('\n')[0].slice(0, 160) }]
  );
}

const summary = {};
for (const [label, before, after] of [
  ['rc1Regressions', 'reviewed.json', 'corrected.json'],
  ['astraIndependent', 'astra-independent-reviewed.json', 'astra-independent-corrected.json']
]) {
  const reviewed = flatten(load(before));
  const corrected = flatten(load(after));
  const key = (row) => `${row.file} > ${row.test}`;
  const reviewedByKey = new Map(reviewed.map((row) => [key(row), row]));
  const rows = corrected.map((row) => ({ file: row.file, test: row.test, reviewed: reviewedByKey.get(key(row))?.status ?? 'not run', corrected: row.status }));
  const unrunnable = reviewed.filter((row) => row.test === '(the test file could not run)').map((row) => ({ file: row.file, reason: row.reason }));
  summary[label] = {
    reviewed: { passed: reviewed.filter((row) => row.status === 'passed').length, failed: reviewed.filter((row) => row.status !== 'passed').length },
    corrected: { passed: corrected.filter((row) => row.status === 'passed').length, failed: corrected.filter((row) => row.status !== 'passed').length },
    unrunnableOnReviewed: unrunnable,
    failingOnReviewedOnly: rows.filter((row) => row.reviewed !== 'passed' && row.corrected === 'passed'),
    failingOnCorrected: rows.filter((row) => row.corrected !== 'passed'),
    passingOnBoth: rows.filter((row) => row.reviewed === 'passed' && row.corrected === 'passed').length
  };
  console.log(`== ${label}: reviewed ${summary[label].reviewed.passed} passed / ${summary[label].reviewed.failed} failed; corrected ${summary[label].corrected.passed} passed / ${summary[label].corrected.failed} failed; passing on both ${summary[label].passingOnBoth}`);
  for (const row of summary[label].failingOnReviewedOnly) console.log(`  ${row.reviewed} -> ${row.corrected} | ${row.file} > ${row.test.slice(0, 150)}`);
  for (const row of unrunnable) console.log(`  could not run on reviewed: ${row.file}: ${row.reason}`);
  for (const row of summary[label].failingOnCorrected) console.log(`  FAILING ON CORRECTED: ${row.file} > ${row.test}`);
}
if (output) fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
