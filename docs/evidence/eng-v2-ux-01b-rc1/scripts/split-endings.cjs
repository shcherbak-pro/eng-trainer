// Finds a single split point K: lines before K use one line ending, lines from K the other.
const fs = require('fs'); const path = require('path'); const { createHash } = require('crypto');
const [repo, work, ...files] = process.argv.slice(2);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const review = JSON.parse(fs.readFileSync(path.join(repo, 'docs/reviews/eng-v2-ux-01b-astra/candidate-before.json'), 'utf8'));
const want = new Map(review.files.map((f) => [f.path, f.sha256]));
for (const file of files) {
  // The reviewed text with LF endings: the current reconstruction attempt (HEAD + captured diff).
  const lf = fs.readFileSync(path.join(work, 'lf', file), 'utf8');
  const lines = lf.split('\n');
  const last = lines.pop();
  let found = null;
  for (const [first, second] of [['\r\n', '\n'], ['\n', '\r\n']]) {
    for (let k = 0; k <= lines.length && !found; k += 1) {
      const text = lines.map((l, i) => l + (i < k ? first : second)).join('') + last;
      if (sha(Buffer.from(text)) === want.get(file)) found = { k, first: JSON.stringify(first), text };
    }
    if (found) break;
  }
  if (found) {
    fs.mkdirSync(path.dirname(path.join(work, 'reviewed-originals', file)), { recursive: true });
    fs.writeFileSync(path.join(work, 'reviewed-originals', file), found.text);
    console.log(`${file}: MATCH, lines before ${found.k} end with ${found.first}, the rest with the other`);
  } else console.log(`${file}: no single split point`);
}
