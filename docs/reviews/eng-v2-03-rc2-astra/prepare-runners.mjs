import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const out = 'docs/reviews/eng-v2-03-rc2-astra', prior = 'docs/reviews/eng-v2-03-rc1-astra';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const records = [];
function copy(source, target, substitutions = []) {
  const original = fs.readFileSync(source, 'utf8'); let content = original;
  for (const [from, to] of substitutions) { assert(content.includes(from), from); content = content.replaceAll(from, to); }
  const destination = path.join(out, target); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, content);
  records.push({ source, destination: destination.replaceAll('\\', '/'), sourceSha256: sha(original), copySha256: sha(content), substitutions });
}
copy(prior + '/run.mjs', 'run.mjs', [[prior, out]]);
copy(prior + '/independent.test.ts', 'independent.test.ts', [[prior + '/local', out + '/local']]);
copy(prior + '/vitest.config.ts', 'vitest.config.ts', [[prior, out]]);
copy(prior + '/browser-support.mjs', 'browser-support.mjs', [[prior, out]]);
copy(prior + '/focused.mjs', 'focused.mjs', [
  ["before: await serve(path.join(out, 'local/before-site'))", "before: await serve('docs/reviews/eng-v2-03-rc1-astra/local/before-site')"],
  ["'rc1'", "'rc2'"], ['rc1:', 'rc2:'],
  ['rc1Scenarios', 'rc2Scenarios'], ['rc1Passed', 'rc2Passed'], ['rc1Measurements', 'rc2Measurements'],
  ['rc1Clipped', 'rc2Clipped'], ['rc1OtherFailures', 'rc2OtherFailures'],
]);
copy('docs/evidence/eng-v2-03-rc2/budget.mjs', 'budget.mjs', [
  ["const out = path.resolve('docs/evidence/eng-v2-03-rc2');", "const out = path.resolve('docs/reviews/eng-v2-03-rc2-astra');"],
]);
// The exact historical probe and oracle: only output/build paths change.
copy(prior + '/browser-support.mjs', 'exact-probe/browser-support.mjs', [
  ["export const out = path.resolve('docs/reviews/eng-v2-03-rc1-astra');", "export const out = path.resolve(process.env.REVIEW_PROBE_OUT);"],
]);
copy(prior + '/viewport-resize.mjs', 'exact-probe/viewport-resize.mjs', [
  ["const site = await serve('site-dist');", "const site = await serve(process.env.REVIEW_PROBE_SITE);"],
]);
fs.writeFileSync(out + '/runner-adaptations.json', JSON.stringify({ note: 'Assertions and geometry unchanged; path/served-build labels only.', records }, null, 2) + '\n');
