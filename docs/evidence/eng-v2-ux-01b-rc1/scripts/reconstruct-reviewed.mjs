// Rebuilds the exact candidate Astra reviewed (696 paths, fingerprint 1df5517c…) in a separate folder,
// so that the RC1 regressions can be run against the reviewed implementation.
// Usage: node reconstruct-reviewed.mjs <repo> <rc1-work-dir>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [, , repo, work, targetArg] = process.argv;
const target = targetArg ?? join(work, 'reviewed');
const sha = (data) => createHash('sha256').update(data).digest('hex');
const git = (...args) => execFileSync('git', ['--no-optional-locks', ...args], { cwd: repo, maxBuffer: 1 << 28 });
const review = JSON.parse(readFileSync(join(repo, 'docs/reviews/eng-v2-ux-01b-astra/candidate-before.json'), 'utf8'));
const expected = new Map(review.files.map((file) => [file.path, file.sha256]));

// --- Astra's captured tracked diff (HEAD -> reviewed working tree), parsed per file.
function parseDiff(text) {
  const files = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) { current = { path: header[2], hunks: [], deleted: false }; files.set(current.path, current); continue; }
    if (!current) continue;
    if (line.startsWith('deleted file')) current.deleted = true;
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) { current.hunks.push({ oldStart: Number(hunk[1]), lines: [] }); continue; }
    const last = current.hunks[current.hunks.length - 1];
    if (last && /^[ +\-\\]/.test(line)) last.lines.push(line);
  }
  return files;
}

function applyHunks(original, hunks) {
  const source = original.split('\n');
  const output = [];
  let cursor = 0;
  let noNewline = false;
  for (const hunk of hunks) {
    const start = hunk.oldStart - 1;
    while (cursor < start) output.push(source[cursor++]);
    let previous = '';
    for (const line of hunk.lines) {
      const kind = line[0];
      const body = line.slice(1);
      if (kind === '\\') { if (previous === '+') noNewline = true; continue; }
      if (kind === ' ' || kind === '-') {
        if (source[cursor] !== body) throw new Error(`context mismatch at line ${cursor + 1}: ${JSON.stringify(source[cursor])} vs ${JSON.stringify(body)}`);
        if (kind === ' ') output.push(body);
        cursor += 1;
      } else if (kind === '+') output.push(body);
      previous = kind;
    }
  }
  while (cursor < source.length) output.push(source[cursor++]);
  let result = output.join('\n');
  if (noNewline && result.endsWith('\n')) result = result.slice(0, -1);
  return result;
}

const diff = parseDiff(readFileSync(join(repo, 'docs/reviews/eng-v2-ux-01b-astra/candidate-tracked.diff'), 'utf8').replace(/\r\n/g, '\n'));
const headFiles = new Set(git('ls-tree', '-r', '--name-only', 'HEAD').toString('utf8').split('\n').filter(Boolean));
const crlf = (text) => text.replace(/\r?\n/g, '\r\n');

/** The candidates for one path's reviewed bytes, tried until one has the recorded hash. */
function candidates(path) {
  const options = [];
  const current = join(repo, path);
  if (existsSync(current)) options.push(['current tree', readFileSync(current)]);
  const original = join(work, 'reviewed-originals', path);
  if (existsSync(original)) options.push(['recorded pre-RC1 text', readFileSync(original)]);
  if (path.startsWith('src/assets/fonts/source-sans-3-')) options.push(['verified original font', readFileSync(join(work, 'fonts/originals', path.split('/').pop()))]);
  if (path === 'public/fonts/OFL-SourceSans3.txt') options.push(['renamed licence file', readFileSync(join(repo, 'public/fonts/OFL-EngTrainerSans.txt'))]);
  if (headFiles.has(path)) {
    const head = git('show', `HEAD:${path}`).toString('utf8');
    const patched = diff.has(path) ? applyHunks(head, diff.get(path).hunks) : head;
    options.push([diff.has(path) ? 'HEAD + captured diff' : 'HEAD', Buffer.from(patched)], [diff.has(path) ? 'HEAD + captured diff (CRLF)' : 'HEAD (CRLF)', Buffer.from(crlf(patched))]);
  }
  // Text changes made by RC1 that are pure replacements, reversed.
  const reverse = {
    'src/styles/tokens.css': [["--font-ui: 'Eng Trainer Sans', 'Segoe UI',", "--font-ui: 'Source Sans 3', 'Segoe UI',"]],
    'src/styles/fonts.css': [
      [" * Eng Trainer Sans: a renamed derivative of the Source Sans 3 web subsets (Copyright 2010-2020 Adobe, with\n * Reserved Font Name \"Source\"), also under the SIL Open Font License 1.1. Only the font names differ.\n * The licence texts and the derivative's FONTLOG are published with the site in fonts/.\n * Files, subsets and provenance: src/assets/fonts/README.md and public/fonts/FONTLOG-EngTrainerSans.txt.",
       " * Source Sans 3: Copyright 2010-2020 Adobe, with Reserved Font Name \"Source\". SIL Open Font License 1.1.\n * The licence texts are published with the site as fonts/OFL-Literata.txt and fonts/OFL-SourceSans3.txt.\n * Files, subsets and provenance: src/assets/fonts/README.md."],
      ["font-family: 'Eng Trainer Sans';", "font-family: 'Source Sans 3';"],
      ['../assets/fonts/eng-trainer-sans-', '../assets/fonts/source-sans-3-']
    ],
    'src/features/collections/CollectionsPage.test.ts': [
      ["import { collection, entry, native } from '../../test/collections';\nimport { realMaterials } from '../../test/content';\nimport { readDatabase, resetDatabase, seedDatabase } from '../../test/database';", "import { realMaterials } from '../../test/content';\nimport { readDatabase, resetDatabase } from '../../test/database';"]
    ]
  }[path];
  if (reverse && existsSync(current)) {
    let text = readFileSync(current, 'utf8');
    const lineEnding = text.includes('\r\n') ? '\r\n' : '\n';
    text = text.replace(/\r\n/g, '\n');
    for (const [from, to] of reverse) text = text.split(from).join(to);
    if (path.endsWith('CollectionsPage.test.ts')) text = text.slice(0, text.indexOf("\ndescribe('focus once the final import plan is ready (RC1, F3)'") + 1).replace(/\n+$/, '\n');
    options.push(['RC1 replacements reversed', Buffer.from(lineEnding === '\r\n' ? text.replace(/\n/g, '\r\n') : text)]);
  }
  return options;
}

rmSync(target, { recursive: true, force: true });
const report = { files: review.files.length, reconstructed: [], mismatches: [] };
for (const [path, hash] of expected) {
  if (hash === null) continue; // deleted in the reviewed candidate
  const match = candidates(path).find(([, bytes]) => sha(bytes) === hash);
  if (!match) { report.mismatches.push(path); continue; }
  if (match[0] !== 'current tree') report.reconstructed.push({ path, from: match[0] });
  mkdirSync(dirname(join(target, path)), { recursive: true });
  writeFileSync(join(target, path), match[1]);
}

// The fingerprint exactly as docs/reviews/eng-v2-ux-01b-astra/capture.mjs computes it.
const files = [...expected.keys()].sort().map((path) => ({ path, sha256: existsSync(join(target, path)) ? sha(readFileSync(join(target, path))) : null }));
report.treeSha256 = sha(JSON.stringify(files));
report.reviewTreeSha256 = review.treeSha256;
report.identical = report.treeSha256 === review.treeSha256 && report.mismatches.length === 0;

// Ignored inputs the tests need (generated content and dependencies) come from the working repository.
cpSync(join(repo, 'public/data'), join(target, 'public/data'), { recursive: true });
// Inside the repository, Node finds the repository's node_modules by walking up; elsewhere a junction is needed.
if (!target.replace(/\\/g, '/').startsWith(repo.replace(/\\/g, '/'))) {
  execFileSync('cmd', ['/c', 'mklink', '/J', join(target, 'node_modules'), join(repo, 'node_modules')]);
}
writeFileSync(join(work, 'reviewed-reconstruction.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ identical: report.identical, treeSha256: report.treeSha256, reconstructed: report.reconstructed.length, mismatches: report.mismatches }, null, 1));
