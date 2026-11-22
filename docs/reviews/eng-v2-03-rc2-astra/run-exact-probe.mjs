import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { sanitize } from '../../evidence/eng-v2-03/sanitize.mjs';
const out = path.resolve('docs/reviews/eng-v2-03-rc2-astra');
const summary = [];
for (const build of ['rc1', 'rc2']) {
  const destination = path.join(out, 'exact-' + build);
  fs.mkdirSync(path.join(destination, 'shots'), { recursive: true });
  const result = spawnSync(process.execPath, [path.join(out, 'exact-probe/viewport-resize.mjs')], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env,
      REVIEW_PROBE_OUT: destination, REVIEW_PROBE_SITE: build === 'rc1' ? path.join(out, 'local/rc1-site') : path.resolve('site-dist') },
  });
  fs.writeFileSync(path.join(destination, 'run.log'), sanitize((result.stdout ?? '') + (result.stderr ?? '')) + '\n[exit ' + result.status + ']\n');
  assert.equal(result.status, build === 'rc1' ? 1 : 0);
  const recorded = JSON.parse(fs.readFileSync(path.join(destination, 'viewport-resize.json'), 'utf8'));
  for (const [engine, e] of Object.entries(recorded.engines)) {
    assert.equal(e.before.complete, true); assert.equal(e.errors.length, 0);
    assert.equal(e.resized.complete, build === 'rc2');
    if (build === 'rc1') assert(Math.abs(e.resized.paintedOverflow - (engine === 'chromium' ? 36.890625 : 36.499969482421875)) < 0.01);
    summary.push({ build, engine, version: e.version, exit: result.status, resizedComplete: e.resized.complete, clippedPixels: e.resized.paintedOverflow });
  }
}
fs.writeFileSync(path.join(out, 'exact-probe-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary));
