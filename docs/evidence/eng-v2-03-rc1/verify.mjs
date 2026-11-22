// Reuse historical runners unchanged, with new output paths; never write their original evidence.
// node docs/evidence/eng-v2-03-rc1/verify.mjs commands|browser|artifacts
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { sanitize } from '../eng-v2-03/sanitize.mjs';

const out = path.resolve('docs/evidence/eng-v2-03-rc1');
const common = path.resolve(execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim());
const mode = process.argv[2];
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
if (mode === 'artifacts') {
  const before = JSON.parse(fs.readFileSync(path.join(out, 'baseline.json'), 'utf8'));
  const groups = {};
  for (const prefix of ['data/', 'v1/', 'fonts/']) {
    const files = before.reviewedSite.filter((entry) => entry.file.startsWith(prefix));
    assert(files.length > 0, `Expected reviewed ${prefix} files`);
    for (const entry of files) assert.equal(sha(fs.readFileSync(path.join('site-dist', entry.file))), entry.sha256, `Changed built artifact ${entry.file}`);
    groups[prefix] = { unchanged: true, files: files.length, entries: files };
  }
  const fontFiles = before.reviewedSite.filter((entry) => entry.file.startsWith('assets/') && entry.file.endsWith('.woff2'));
  assert.equal(fontFiles.length, 6);
  for (const entry of fontFiles) assert.equal(sha(fs.readFileSync(path.join('site-dist', entry.file))), entry.sha256, entry.file);
  groups['font-assets'] = { unchanged: true, files: fontFiles.length, entries: fontFiles };
  const reviewAudit = JSON.parse(fs.readFileSync('docs/reviews/eng-v2-03-astra/artifact-audit.json', 'utf8'));
  for (const entry of reviewAudit.files) assert.equal(sha(fs.readFileSync(path.join(out, 'local/reviewed-site', entry.path))), entry.sha256, `Preserved build differs from Astra: ${entry.path}`);
  const manifest = JSON.parse(fs.readFileSync('site-dist/data/manifest.json', 'utf8'));
  const files = ['docs/evidence/eng-v2-03/id-mapping.json', 'docs/evidence/eng-v2-03/content-totals.json',
    'src/features/home/homeStats.ts', 'src/features/home/homeStats.test.ts', 'src/app/App.home.test.ts',
    'package.json', 'package-lock.json', 'v1/package.json', 'v1/package-lock.json'];
  const protectedFiles = files.map((file) => {
    const hash = sha(fs.readFileSync(file));
    assert.equal(hash, before.candidate.entries.find((entry) => entry.file === file)?.sha256, file);
    return { file, sha256: hash, unchanged: true };
  });
  fs.writeFileSync(path.join(out, 'artifacts.json'), JSON.stringify({ reviewedBuildMatchesAstra: true, reviewedBuildFilesVerified: reviewAudit.files.length, groups, manifest, protectedFiles }, null, 2) + '\n');
  console.log('Built data, v1, fonts, mappings, Home selectors/tests and dependency manifests unchanged.');
} else {
  const args = mode === 'commands' ? ['docs/evidence/eng-v2-03/run-commands.mjs', path.join(out, 'commands')]
    : mode === 'browser' ? ['docs/evidence/eng-v2-03/browser-check.mjs', path.join(common, 'eng-v2-02b-release/tools/node_modules'), path.resolve('site-dist'), path.join(out, 'implementation-browser')]
      : null;
  assert(args, 'Choose commands, browser or artifacts');
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(common, 'eng-v2-02b-release/browsers'), FORCE_COLOR: '0', NO_COLOR: '1' } });
  const log = sanitize(`${result.stdout ?? ''}${result.stderr ?? ''}`).replace(/\u001b\[[0-9;]*m/g, '');
  fs.writeFileSync(path.join(out, `${mode}.log`), log + `\n[exit ${result.status}]\n`);
  console.log(log);
  assert.equal(result.status, 0, `${mode} runner exited unsuccessfully`);
  if (mode === 'commands') {
    const report = JSON.parse(fs.readFileSync(path.join(out, 'commands/commands.json'), 'utf8'));
    assert(report.commands.every((command) => command.exitCode === 0), 'A documented command failed');
  } else {
    const report = JSON.parse(fs.readFileSync(path.join(out, 'implementation-browser/results.json'), 'utf8'));
    assert(Object.values(report.summary).every((engine) => engine.passed === 12 && engine.total === 12), 'An implementation browser scenario failed');
  }
}
