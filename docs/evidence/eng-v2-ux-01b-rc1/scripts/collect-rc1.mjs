// Collects the ENG-V2-UX-01B-RC1 evidence into docs/evidence/eng-v2-ux-01b-rc1/ (all but its README.md).
// Usage: node collect-rc1.mjs <repo> <rc1-run-dir>
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const [, , repo, run] = process.argv;
const out = join(repo, 'docs', 'evidence', 'eng-v2-ux-01b-rc1');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const posix = (path) => path.split(sep).join('/');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
const git = (...args) => execFileSync('git', ['--no-optional-locks', ...args], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

mkdirSync(out, { recursive: true });
for (const name of readdirSync(out)) if (name !== 'README.md') rmSync(join(out, name), { recursive: true, force: true });

// ------------------------------------------------------------ sanitizing (as in the UX-01B collector)
const userHome = process.env.USERPROFILE ?? 'C:\\Users\\unknown';
const userName = userHome.split(/[\\/]/).pop();
function pathForms(path) {
  const forward = path.replace(/\\/g, '/').replace(/^\/([a-zA-Z])\//, (match, drive) => `${drive}:/`);
  const forms = [];
  for (const letter of [forward[0].toUpperCase(), forward[0].toLowerCase()]) {
    const slash = `${letter}${forward.slice(1)}`;
    const back = slash.replace(/\//g, '\\');
    forms.push(slash, back, back.replace(/\\/g, '\\\\'));
  }
  forms.push(`/${forward[0].toLowerCase()}${forward.slice(2)}`);
  return [...new Set(forms)];
}
const replacements = [
  ...pathForms(run).map((form) => [form, '<run>']),
  ...pathForms(repo).map((form) => [form, '<repo>']),
  ...pathForms(userHome).map((form) => [form, '<user-home>']),
  [userName, '<user>']
].sort((a, b) => b[0].length - a[0].length);
function sanitize(text) {
  let result = text.replace(/\u001b\[[0-9;]*m/g, '');
  result = result.replace(/([\\/]Users[\\/]+)[^\\/\s"']+~\d+/gi, '$1<user>');
  for (const [from, to] of replacements) result = result.split(from).join(to);
  result = result.replace(/[A-Za-z]:[\\/][^\s"']*?[\\/]Temp[\\/]claude[\\/][^\s"']*/g, '<run>');
  return result;
}
const sanitization = [];
function publishText(source, target) {
  const raw = readFileSync(source);
  const published = sanitize(raw.toString('utf8'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, published);
  sanitization.push({ path: posix(relative(out, target)), rawSha256: sha256(raw), publishedSha256: sha256(Buffer.from(published, 'utf8')) });
}
function publishCopy(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

// ------------------------------------------------------------ logs, results, scripts
for (const name of readdirSync(join(run, 'final-logs'))) publishText(join(run, 'final-logs', name), join(out, 'logs', name));
publishText(join(run, 'out-regression', 'results.json'), join(out, 'browser', 'regression-results.json'));
publishText(join(run, 'out-astra', 'results.json'), join(out, 'browser', 'astra-unchanged-results.json'));
publishText(join(run, 'out-astra-font', 'results.json'), join(out, 'browser', 'astra-font-adjusted-results.json'));
publishText(join(run, 'out-rc1', 'results.json'), join(out, 'browser', 'rc1-results.json'));
for (const name of readdirSync(join(run, 'out-rc1')).filter((file) => file.endsWith('.png'))) publishCopy(join(run, 'out-rc1', name), join(out, 'browser', 'rc1-screenshots', name));
for (const name of readdirSync(join(run, 'out-astra')).filter((file) => file.endsWith('.png'))) publishCopy(join(run, 'out-astra', name), join(out, 'browser', 'astra-unchanged-screenshots', name));
for (const name of ['chromium-phone-light-phrases.png', 'firefox-phone-light-wordIndex.png', 'chromium-phone-fonts-failed.png']) {
  if (existsSync(join(run, 'out-regression', 'shots', name))) publishCopy(join(run, 'out-regression', 'shots', name), join(out, 'browser', 'regression-screenshots', name));
}
publishText(join(run, 'astra-adjusted', 'font-adjustment.diff'), join(out, 'browser', 'astra-font-adjustment.diff'));
publishText(join(run, 'font-check.json'), join(out, 'fonts', 'font-check.json'));
for (const script of ['rc1-browser-check.mjs', 'compare-before-after.cjs', 'reconstruct-reviewed.mjs', 'prepare-lf.cjs', 'split-endings.cjs', 'collect-rc1.mjs', 'final-run.sh']) {
  publishText(join(run, script), join(out, 'scripts', script));
}

// ------------------------------------------------------------ before/after regression results
publishText(join(run, 'before-after', 'summary.json'), join(out, 'before-after', 'summary.json'));
publishText(join(run, 'reviewed-reconstruction.json'), join(out, 'before-after', 'reviewed-reconstruction.json'));
for (const name of ['reviewed.json', 'corrected.json', 'astra-independent-reviewed.json', 'astra-independent-corrected.json']) {
  const report = JSON.parse(readFileSync(join(run, 'before-after', name), 'utf8'));
  const compact = report.testResults.map((file) => ({
    file: posix(file.name).replace(/^.*?\/(src|docs)\//, '$1/'),
    status: file.status,
    message: sanitize((file.message || '').split('\n')[0]).slice(0, 300),
    tests: file.assertionResults.map((test) => ({ name: test.fullName, status: test.status, failure: sanitize((test.failureMessages[0] || '').split('\n')[0]).slice(0, 300) }))
  }));
  writeJson(join(out, 'before-after', name), { numPassedTests: report.numPassedTests, numFailedTests: report.numFailedTests, numTotalTests: report.numTotalTests, files: compact });
}
// The inputs that reproduce the reviewed candidate (fingerprint 1df5517c…) besides HEAD and Astra's captured diff.
for (const file of walk(join(run, 'reviewed-originals'))) publishCopy(file, join(out, 'before-after', 'reviewed-originals', posix(relative(join(run, 'reviewed-originals'), file))));

// ------------------------------------------------------------ RC1 delta and preservation
const before = JSON.parse(readFileSync(join(run, 'rc1-before.json'), 'utf8'));
const was = new Map(before.files.map((file) => [file.path, file.sha256]));
const ownEvidence = (path) => path.startsWith('docs/evidence/eng-v2-ux-01b-rc1/');
const paths = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean))].sort();
const now = new Map(paths.map((path) => [path, existsSync(join(repo, path)) ? sha256(readFileSync(join(repo, path))) : null]));
const delta = { changed: [], added: [], removed: [] };
for (const [path, hash] of now) {
  if (ownEvidence(path)) continue;
  if (!was.has(path)) delta.added.push({ path, sha256: hash });
  else if (was.get(path) !== hash) delta[hash === null ? 'removed' : 'changed'].push({ path, before: was.get(path), after: hash });
}
for (const [path, hash] of was) if (hash !== null && (!now.has(path) || now.get(path) === null)) delta.removed.push({ path, before: hash });
const lineEndingNote = ['src/features/flashcards/FlashcardsPage.svelte', 'src/features/home/IndexPage.svelte'];
writeJson(join(out, 'rc1-delta.json'), {
  baseline: 'The candidate as Astra reviewed it (fingerprint 1df5517c9fedb1ef909d74e4788e5f943c40a34ca7f6e8d65f47c9c39b5e0231), plus Astra\'s review files, snapshotted before any RC1 edit.',
  note: `Hashes are of the working-tree bytes. ${lineEndingNote.join(' and ')} mixed CRLF and LF line endings before RC1 and are uniformly CRLF now; with core.autocrlf, git diff shows only their content changes.`,
  staged: git('diff', '--cached', '--name-only').split('\n').filter(Boolean),
  counts: { changed: delta.changed.length, added: delta.added.length, removed: delta.removed.length },
  ...delta
});

const protectedList = readFileSync(join(run, 'protected-101.sha256'), 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
  const match = /^([0-9a-f]{64}) [ *]?(.+)$/.exec(line);
  return { hash: match[1], path: match[2] };
});
const unchangedGroup = (filter) => {
  const files = before.files.filter((file) => filter(file.path));
  const changed = files.filter((file) => now.get(file.path) !== file.sha256 && !(file.sha256 === null && !now.get(file.path))).map((file) => file.path);
  return { files: files.length, unchanged: files.length - changed.length, changed };
};
const intended = new Set(['docs/handoffs/ENG-V2-UX-01B.md', 'docs/architecture/USER-COLLECTIONS.md']);
writeJson(join(out, 'preservation.json'), {
  protectedReleaseAndDesignFiles: (() => {
    const changed = protectedList.filter(({ path, hash }) => !existsSync(join(repo, path)) || sha256(readFileSync(join(repo, path))) !== hash).map(({ path }) => path);
    return { files: protectedList.length, unchanged: protectedList.length - changed.length, changed };
  })(),
  astraReviewReportAndEvidence: unchangedGroup((path) => path === 'docs/reviews/ENG-V2-UX-01B-ASTRA.md' || path.startsWith('docs/reviews/eng-v2-ux-01b-astra/')),
  ux01bImplementationEvidence: unchangedGroup((path) => path.startsWith('docs/evidence/eng-v2-ux-01b/')),
  allOtherDocsExceptIntendedUpdates: unchangedGroup((path) => path.startsWith('docs/') && !intended.has(path) && !ownEvidence(path)),
  intendedDocumentUpdates: [...intended],
  v1SourceDiffLines: git('diff', '--', 'v1').split('\n').filter(Boolean).length,
  contentSourcesChanged: delta.changed.concat(delta.added, delta.removed).filter((item) => item.path.startsWith('content/')).map((item) => item.path)
});

// v1 build compared with the released artifact, as in UX-01B.
const released = join(repo, '.git', 'eng-v2-02b-release', 'artifact', 'v1');
const noCr = (file) => (/\.(js|css|png|woff2)$/.test(file) ? readFileSync(file) : Buffer.from(readFileSync(file, 'utf8').replace(/\r/g, ''), 'utf8'));
const v1 = walk(released).map((file) => posix(relative(released, file))).sort().map((path) => {
  const current = join(repo, 'site-dist', 'v1', path);
  return { path, byteIdentical: existsSync(current) && sha256(readFileSync(current)) === sha256(readFileSync(join(released, path))), identicalIgnoringCarriageReturns: existsSync(current) && sha256(noCr(current)) === sha256(noCr(join(released, path))) };
});
writeJson(join(out, 'v1-preservation.json'), { files: v1, pass: v1.every((item) => item.identicalIgnoringCarriageReturns) && v1.filter((item) => /\.(js|css)$/.test(item.path)).every((item) => item.byteIdentical) });

// The tested site and its fonts.
const site = join(repo, 'site-dist');
writeJson(join(out, 'artifact.json'), walk(site).map((file) => ({ path: posix(relative(site, file)), bytes: statSync(file).size, sha256: sha256(readFileSync(file)) })).sort((a, b) => a.path.localeCompare(b.path)));
writeFileSync(join(out, 'git-status.txt'), `${git('rev-parse', 'HEAD').trim()}\n${git('status', '--porcelain=v1', '--untracked-files=all', '--branch')}`);
writeJson(join(out, 'sanitization.json'), { policy: 'New RC1 logs, results and scripts: local repository, user and temporary paths replaced with <repo>, <user-home>, <user> and <run>; terminal colour codes removed. Screenshots show synthetic or built-in data only.', files: sanitization });
console.log(JSON.stringify({ delta: { changed: delta.changed.length, added: delta.added.length, removed: delta.removed.length }, v1: v1.length }));
