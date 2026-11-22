// Copies historical runners whose output folders are fixed, changing only paths, build labels and
// output locations. Each substitution must match exactly once; no assertion is touched. The
// originals stay where they are, unchanged. node docs/evidence/eng-v2-03-rc2/prepare-runners.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const out = 'docs/evidence/eng-v2-03-rc2';
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const copies = [
  {
    from: 'docs/reviews/eng-v2-03-rc1-astra/browser-support.mjs', to: `${out}/astra-probe/browser-support.mjs`,
    why: 'Output location only: Astra\'s review folder must not be written.',
    substitutions: [["export const out = path.resolve('docs/reviews/eng-v2-03-rc1-astra');", 'export const out = path.resolve(process.env.RC2_PROBE_OUT);']]
  },
  {
    from: 'docs/reviews/eng-v2-03-rc1-astra/viewport-resize.mjs', to: `${out}/astra-probe/viewport-resize.mjs`,
    why: 'Build location only: the same probe runs against the authenticated RC1 copy and against RC2.',
    substitutions: [["const site = await serve('site-dist');", 'const site = await serve(process.env.RC2_PROBE_SITE);']]
  },
  {
    from: 'docs/evidence/eng-v2-03-rc1/focused-chips.mjs', to: `${out}/rc1-runner/focused-chips.mjs`,
    why: 'Output location only: the RC1 evidence folder must not be written.',
    substitutions: [["const out = path.resolve('docs/evidence/eng-v2-03-rc1');", 'const out = path.resolve(process.env.RC2_FOCUSED_OUT);']]
  },
  {
    from: 'docs/evidence/eng-v2-03-rc1/budget.mjs', to: `${out}/budget.mjs`,
    why: 'Same measurement code; the compared builds become the authenticated RC1 copy and RC2, with matching labels and output.',
    substitutions: [
      ['// Established cold-load response BODY method, applied to the reviewed snapshot and RC1.', '// Established cold-load response BODY method (copied from RC1), applied to the authenticated RC1 copy and RC2.'],
      ['// No rebuild of earlier milestones. node docs/evidence/eng-v2-03-rc1/budget.mjs', '// No rebuild of earlier milestones. node docs/evidence/eng-v2-03-rc2/budget.mjs'],
      ["const out = path.resolve('docs/evidence/eng-v2-03-rc1');", "const out = path.resolve('docs/evidence/eng-v2-03-rc2');"],
      ["Object.entries({ reviewed: path.join(out, 'local/reviewed-site'), rc1: path.resolve('site-dist') })", "Object.entries({ rc1: path.join(out, 'local/rc1-site'), rc2: path.resolve('site-dist') })"],
      ['[key, entry.rc1[key] - entry.reviewed[key]]', '[key, entry.rc2[key] - entry.rc1[key]]'],
      ['{ reviewed: entry.reviewed.total, rc1: entry.rc1.total, code: entry.rc1.code, withinBudget: entry.rc1.withinBudget }', '{ rc1: entry.rc1.total, rc2: entry.rc2.total, code: entry.rc2.code, withinBudget: entry.rc2.withinBudget }'],
      ['route.rc1.withinBudget && route.rc1.errors.length === 0', 'route.rc2.withinBudget && route.rc2.errors.length === 0']
    ]
  }
];

const record = [];
for (const copy of copies) {
  const original = fs.readFileSync(copy.from, 'utf8');
  let text = original;
  for (const [find, replace] of copy.substitutions) {
    assert.equal(text.split(find).length - 1, 1, `${copy.from}: expected exactly one "${find}"`);
    text = text.replace(find, () => replace);
  }
  fs.mkdirSync(path.dirname(copy.to), { recursive: true });
  fs.writeFileSync(copy.to, text);
  record.push({ original: copy.from, originalSha256: sha(original), copy: copy.to, copySha256: sha(text), why: copy.why, substitutions: copy.substitutions.map(([find, replace]) => ({ find, replace })) });
}
fs.writeFileSync(`${out}/runner-adaptations.json`, JSON.stringify({ note: 'Every other byte of each copy equals its original. The originals were not modified.', copies: record }, null, 2) + '\n');
console.log(JSON.stringify(record.map((r) => [r.copy, r.substitutions.length]), null, 1));
