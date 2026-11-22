import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const out = 'docs/reviews/eng-v2-03-rc1-astra';
const sha = (data) => createHash('sha256').update(data).digest('hex');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const original = read('docs/reviews/eng-v2-03-astra/preservation-before.json');
const sourceChecks = [];
for (const entry of original.candidate.entries.filter((e) => e.changed || e.untracked)) {
  const file = path.join('docs/reviews/eng-v2-03-astra/candidate-snapshot', entry.file);
  assert.equal(sha(fs.readFileSync(file)), entry.sha256, entry.file);
  sourceChecks.push(entry);
}
const originalArtifact = read('docs/reviews/eng-v2-03-astra/artifact-audit.json');
const originalSite = 'docs/evidence/eng-v2-03-rc1/local/reviewed-site';
const beforeSite = path.join(out, 'local/before-site');
assert(!fs.existsSync(beforeSite), 'Refusing to replace authenticated before build');
for (const entry of originalArtifact.files) assert.equal(sha(fs.readFileSync(path.join(originalSite, entry.path))), entry.sha256, entry.path);
fs.cpSync(originalSite, beforeSite, { recursive: true, force: false, errorOnExist: true });
for (const entry of originalArtifact.files) assert.equal(sha(fs.readFileSync(path.join(beforeSite, entry.path))), entry.sha256, entry.path);
const preserved = originalArtifact.files.filter((e) => /^(data\/|v1\/|fonts\/)/.test(e.path) || e.path.endsWith('.woff2'));
for (const entry of preserved) assert.equal(sha(fs.readFileSync(path.join('site-dist', entry.path))), entry.sha256, entry.path);
const manifest = read('site-dist/data/manifest.json');
const result = {
  originalCandidateFingerprint: original.candidate.candidateFingerprint,
  originalSourceSnapshotFilesAuthenticated: sourceChecks.length,
  originalArtifactFilesAuthenticated: originalArtifact.files.length,
  originalArtifactFiles: originalArtifact.files,
  preservedRc1ArtifactFiles: preserved,
  manifest,
};
fs.writeFileSync(path.join(out, 'artifacts.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ originalSources: sourceChecks.length, originalBuild: originalArtifact.files.length,
  rc1PreservedArtifacts: preserved.length }));
