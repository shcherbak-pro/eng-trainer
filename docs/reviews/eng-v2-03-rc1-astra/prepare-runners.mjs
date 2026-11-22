// Copy existing verification with output-path-only adaptations; preserve historical fixtures.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const out = 'docs/reviews/eng-v2-03-rc1-astra';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const changes = [];
function copy(source, destination, replacements) {
  const original = fs.readFileSync(source, 'utf8');
  let text = original;
  for (const [from, to] of replacements) {
    assert(text.includes(from), from);
    text = text.replaceAll(from, to);
  }
  fs.writeFileSync(out + '/' + destination, text);
  changes.push({ source, destination, originalSha256: sha(original), adaptedSha256: sha(text), replacements });
}
copy('docs/reviews/eng-v2-03-astra/independent.test.ts', 'independent.test.ts', [
  ["from './released-materials.json'", "from '../eng-v2-03-astra/released-materials.json'"],
  ["resolve('docs/reviews/eng-v2-03-astra')", "resolve('docs/reviews/eng-v2-03-rc1-astra/local')"],
]);
copy('docs/reviews/eng-v2-03-astra/vitest.config.ts', 'vitest.config.ts', [
  ['docs/reviews/eng-v2-03-astra/independent.test.ts', 'docs/reviews/eng-v2-03-rc1-astra/independent.test.ts'],
]);
copy('docs/evidence/eng-v2-03-rc1/budget.mjs', 'budget.mjs', [
  ["path.resolve('docs/evidence/eng-v2-03-rc1')", "path.resolve('docs/reviews/eng-v2-03-rc1-astra')"],
  ["path.join(out, 'local/reviewed-site')", "path.join(out, 'local/before-site')"],
]);
fs.writeFileSync(out + '/runner-adaptations.json', JSON.stringify(changes, null, 2) + '\n');
