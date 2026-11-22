// Reuse historical runners without editing them or their output.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { sanitize } from '../../evidence/eng-v2-03/sanitize.mjs';

const out = path.resolve('docs/reviews/eng-v2-03-rc2-astra');
const common = path.resolve(execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim());
const modules = path.join(common, 'eng-v2-02b-release/tools/node_modules');
const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(common, 'eng-v2-02b-release/browsers'),
  FORCE_COLOR: '0', NO_COLOR: '1' };
const mode = process.argv[2];
const args = {
  gates: ['docs/evidence/eng-v2-03/run-commands.mjs', path.join(out, 'commands')],
  independent: ['node_modules/vitest/vitest.mjs', 'run', '--config', 'docs/reviews/eng-v2-03-rc2-astra/vitest.config.ts',
    '--reporter=default', '--reporter=json', '--outputFile=' + path.join(out, 'independent.json')],
  browser: ['docs/evidence/eng-v2-03/browser-check.mjs', modules, path.resolve('site-dist'), path.join(out, 'implementation-browser')],
  budget: [path.join(out, 'budget.mjs')],
  focused: [path.join(out, 'focused.mjs')],
}[mode];
assert(args, 'Specify gates, independent, browser, budget or focused');
const require = createRequire(import.meta.url);
fs.writeFileSync(path.join(out, 'tools.json'), JSON.stringify({
  platform: process.platform, node: process.version,
  npm: execFileSync('npm.cmd', ['--version'], { shell: true, encoding: 'utf8' }).trim(),
  git: execFileSync('git', ['--version'], { encoding: 'utf8' }).trim(),
  playwright: require(path.join(modules, 'playwright/package.json')).version,
  vite: require(path.resolve('node_modules/vite/package.json')).version,
  svelte: require(path.resolve('node_modules/svelte/package.json')).version,
  vitest: require(path.resolve('node_modules/vitest/package.json')).version,
  browserTooling: '<git-common-dir>/eng-v2-02b-release',
}, null, 2) + '\n');
const result = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
const log = sanitize((result.stdout ?? '') + (result.stderr ?? '')).replace(/\u001b\[[0-9;]*m/g, '');
fs.writeFileSync(path.join(out, mode + '.log'), log + '\n[exit ' + result.status + ']\n');
console.log(log);
if (mode === 'independent' && fs.existsSync(path.join(out, 'independent.json'))) {
  fs.writeFileSync(path.join(out, 'independent.json'), sanitize(fs.readFileSync(path.join(out, 'independent.json'), 'utf8')));
}
assert.equal(result.status, 0, mode + ' unsuccessful');
if (mode === 'gates') {
  const report = JSON.parse(fs.readFileSync(path.join(out, 'commands/commands.json'), 'utf8'));
  assert(report.commands.every((c) => c.exitCode === 0), 'A gate failed');
}
if (mode === 'independent') {
  const report = JSON.parse(fs.readFileSync(path.join(out, 'independent.json'), 'utf8'));
  assert.equal(report.numPassedTests, 24);
  assert.equal(report.numFailedTests, 0);
}
if (mode === 'browser') {
  const report = JSON.parse(fs.readFileSync(path.join(out, 'implementation-browser/results.json'), 'utf8'));
  assert(Object.values(report.summary).every((s) => s.passed === 12 && s.total === 12));
}
