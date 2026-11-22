// Supplement prior recorded artifact hashes with a build from authenticated RC1 inputs.
// The earlier review recorded 29 protected output hashes and retained an HTML hash, but
// did not retain full SHA-256 hashes of RC1's changed JS/CSS. Sizes alone are insufficient.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { sanitize } from '../../evidence/eng-v2-03/sanitize.mjs';
const out = path.resolve('docs/reviews/eng-v2-03-rc2-astra');
const originalSite = path.resolve('docs/evidence/eng-v2-03-rc2/local/rc1-site');
const sha = (data) => createHash('sha256').update(data).digest('hex');
const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
function tree(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) =>
    e.isDirectory() ? tree(path.join(dir, e.name), prefix + e.name + '/') : [{ file: prefix + e.name, sha256: sha(fs.readFileSync(path.join(dir, e.name))) }]);
}
if (process.argv[2] === 'before') {
  const prior = json('docs/reviews/eng-v2-03-rc1-astra/preservation-after.json');
  const priorArtifacts = json('docs/reviews/eng-v2-03-rc1-astra/artifacts.json');
  for (const e of priorArtifacts.preservedRc1ArtifactFiles) assert.equal(sha(fs.readFileSync(path.join(originalSite, e.path))), e.sha256, e.path);
  const indexRecord = 'docs/evidence/eng-v2-03-rc1/rc1.json';
  assert.equal(sha(fs.readFileSync(indexRecord)), prior.candidate.entries.find((e) => e.file === indexRecord).sha256);
  assert.equal(sha(fs.readFileSync(path.join(originalSite, 'index.html'))), json(indexRecord).buildIndexSha256);
  const buildRoot = path.join(out, 'local/rc1-source-build');
  assert(!fs.existsSync(buildRoot), 'Refusing to replace authentication build');
  fs.mkdirSync(buildRoot, { recursive: true });
  const inputs = prior.candidate.entries.filter((e) => /^(src|scripts|content|public)\//.test(e.file) || !e.file.includes('/'));
  for (const entry of inputs) {
    let source = path.resolve(entry.file);
    if (!fs.existsSync(source) || sha(fs.readFileSync(source)) !== entry.sha256) source = path.resolve('docs/reviews/eng-v2-03-rc1-astra/local/candidate-snapshot', entry.file);
    assert.equal(sha(fs.readFileSync(source)), entry.sha256, 'Unauthenticated build input ' + entry.file);
    const destination = path.join(buildRoot, entry.file);
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(source, destination);
  }
  fs.symlinkSync(path.resolve('node_modules'), path.join(buildRoot, 'node_modules'), 'junction');
  const built = spawnSync('npm run build', { cwd: buildRoot, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
  fs.writeFileSync(path.join(out, 'rc1-authentication-build.log'), sanitize((built.stdout ?? '') + (built.stderr ?? '')).replace(/\u001b\[[0-9;]*m/g, '') + '\n[exit ' + built.status + ']\n');
  assert.equal(built.status, 0, 'Isolated RC1 build failed');
  const rebuilt = tree(path.join(buildRoot, 'dist')), retained = tree(originalSite);
  assert.deepEqual(rebuilt, retained.filter((e) => !e.file.startsWith('v1/')), 'Retained RC1 differs from authenticated source build');
  for (const entry of priorArtifacts.preservedRc1ArtifactFiles.filter((e) => e.path.startsWith('v1/'))) {
    assert.equal(sha(fs.readFileSync(path.join(originalSite, entry.path))), entry.sha256);
  }
  fs.cpSync(originalSite, path.join(out, 'local/rc1-site'), { recursive: true, force: false, errorOnExist: true });
  const result = { authenticated: true,
    note: 'Prior independent records lacked full RC1 JS/CSS hashes. Their gap is closed with an isolated rebuild from SHA-256-verified RC1 inputs; all retained non-v1 bytes match. All retained v1 bytes match prior recorded hashes.',
    priorProtectedArtifactHashesVerified: priorArtifacts.preservedRc1ArtifactFiles.length,
    priorRecordedHtmlHashVerified: true, authenticatedBuildInputs: inputs,
    rebuiltNonV1Files: rebuilt.length, rc1Artifacts: retained };
  fs.writeFileSync(path.join(out, 'rc1-authentication.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ authenticated: true, inputs: inputs.length, rebuiltNonV1: rebuilt.length, rc1Artifacts: retained.length }));
} else {
  const before = json(path.join(out, 'rc1-authentication.json')).rc1Artifacts;
  const after = tree(path.resolve('site-dist'));
  const a = new Map(before.map((e) => [e.file, e.sha256])), b = new Map(after.map((e) => [e.file, e.sha256]));
  const unchanged = before.filter((e) => b.get(e.file) === e.sha256);
  const delta = [...new Set([...a.keys(), ...b.keys()])].sort().filter((file) => a.get(file) !== b.get(file))
    .map((file) => ({ file, before: a.get(file) ?? null, after: b.get(file) ?? null }));
  assert.equal(before.length, 33); assert.equal(after.length, 33); assert.equal(unchanged.length, 31);
  assert(delta.every((e) => e.file === 'index.html' || /^assets\/index-[\w-]+\.js$/.test(e.file)));
  const result = { beforeFiles: before.length, afterFiles: after.length, identical: unchanged.length, delta, unchanged, rc2Artifacts: after };
  fs.writeFileSync(path.join(out, 'artifacts.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ before: before.length, after: after.length, identical: unchanged.length, delta }));
}
