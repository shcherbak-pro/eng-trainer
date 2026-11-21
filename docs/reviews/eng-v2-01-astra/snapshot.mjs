// Independent review helper: copies the complete candidate, never its dependencies.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const evidence = join(root, 'docs/reviews/eng-v2-01-astra');
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 20_000_000 }).toString();
const baseline = git('rev-parse', '45564ca').trim();
const files = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0'))]
  .filter(p => p && existsSync(join(root, p)) && !p.startsWith('docs/reviews/'))
  .sort();
const scratch = mkdtempSync(join(tmpdir(), 'eng-v2-01-astra-'));
const candidate = join(scratch, 'candidate');
mkdirSync(evidence, { recursive: true });
const inventory = files.map(path => {
  const bytes = readFileSync(join(root, path));
  const target = join(candidate, path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(root, path), target);
  return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
});
const baselineFiles = git('ls-tree', '-r', '--name-only', baseline).trim().split('\n')
  .filter(p => p.startsWith('src/') || p.startsWith('public/') || /^(index.html|package.json|svelte.config.js|tsconfig.json|tsconfig.node.json|vite.config.ts|vitest.config.ts|.gitignore)$/.test(p));
const v1Comparison = baselineFiles.map(path => {
  const copied = join(root, 'v1', path);
  const expected = git('show', `${baseline}:${path}`).replaceAll('\r\n', '\n');
  return { path, result: !existsSync(copied) ? 'missing' : readFileSync(copied, 'utf8').replaceAll('\r\n', '\n') === expected ? 'identical-text' : 'different' };
});
const summary = {
  capturedAt: new Date().toISOString(), branch: git('branch', '--show-current').trim(), head: git('rev-parse', 'HEAD').trim(),
  baseline, originMain: git('rev-parse', 'origin/main').trim(), defaultBranch: git('symbolic-ref', 'refs/remotes/origin/HEAD').trim(),
  status: git('status', '--porcelain=v1', '--untracked-files=all').split('\n').filter(p => p && !p.includes('docs/reviews/')),
  indexDiff: git('diff', '--cached', '--name-status'), baselineTree: git('rev-parse', `${baseline}^{tree}`).trim(),
  priorFeatureTree: git('rev-parse', '90d7941^{tree}').trim(), scratch, candidate, inventory, v1Comparison
};
writeFileSync(join(evidence, 'candidate.json'), JSON.stringify(summary, null, 2) + '\n');
writeFileSync(join(evidence, 'tracked.diff'), git('-c', 'core.autocrlf=false', 'diff', '--no-ext-diff', '--binary'));
console.log(JSON.stringify({scratch, candidate, files: files.length, v1Files: baselineFiles.length, v1Differences: v1Comparison.filter(p => p.result !== 'identical-text')}, null, 2));
