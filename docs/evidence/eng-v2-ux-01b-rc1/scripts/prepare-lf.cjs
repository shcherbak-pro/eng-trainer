// Writes HEAD + Astra's captured diff, with LF line endings, for the given paths into <work>/lf/.
// Usage: node prepare-lf.cjs <repo> <rc1-work-dir> <path>...
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const [repo, work, ...files] = process.argv.slice(2);
const diffText = fs.readFileSync(path.join(repo, 'docs/reviews/eng-v2-ux-01b-astra/candidate-tracked.diff'), 'utf8').replace(/\r\n/g, '\n');
const HUNK_LINE = /^[ +\-\\]/;

for (const file of files) {
  const start = diffText.indexOf(`diff --git a/${file} b/${file}\n`);
  const end = diffText.indexOf('\ndiff --git ', start + 1);
  const hunks = [];
  for (const line of diffText.slice(start, end === -1 ? undefined : end + 1).split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
    if (header) { hunks.push({ start: Number(header[1]), lines: [] }); continue; }
    if (hunks.length && HUNK_LINE.test(line)) hunks[hunks.length - 1].lines.push(line);
  }
  const head = execFileSync('git', ['show', `HEAD:${file}`], { cwd: repo }).toString('utf8').split('\n');
  const out = [];
  let cursor = 0;
  for (const hunk of hunks) {
    while (cursor < hunk.start - 1) out.push(head[cursor++]);
    for (const line of hunk.lines) {
      if (line[0] === '\\') continue;
      if (line[0] === ' ') { out.push(line.slice(1)); cursor += 1; }
      else if (line[0] === '-') cursor += 1;
      else out.push(line.slice(1));
    }
  }
  while (cursor < head.length) out.push(head[cursor++]);
  fs.mkdirSync(path.dirname(path.join(work, 'lf', file)), { recursive: true });
  fs.writeFileSync(path.join(work, 'lf', file), out.join('\n'));
  console.log(`${file}: ${out.length} lines`);
}
