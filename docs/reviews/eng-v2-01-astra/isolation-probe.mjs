// Negative control in the DISPOSABLE snapshot only. Never run against the active checkout.
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
const root=resolve(process.argv[2]),out=resolve(process.argv[3]);
assert(root.includes('.astra-review-')||root.includes('eng-v2-01-astra-'));
const probe=join(root,'v1/src/astra-scope-probe.test.ts');
assert(!existsSync(probe));
const results=[];
try {
  writeFileSync(probe,"import { it } from 'vitest';\nconst sentinel: number = 'ASTRA deliberately invalid v1-only fixture';\nit('ASTRA v1-only sentinel must never run in root suite', () => { throw new Error(String(sentinel)); });\n");
  for(const command of [['run','check'],['test'],['run','check:v1']]) {
    const result=spawnSync('cmd.exe',['/d','/c','npm',...command],{cwd:root,encoding:'utf8',maxBuffer:5_000_000});
    results.push({command:'npm '+command.join(' '),exitCode:result.status,output:result.stdout+result.stderr});
  }
  writeFileSync(join(out,'scope-probe.json'),JSON.stringify(results,null,2));
  assert.deepEqual(results.map(x=>x.exitCode),[0,0,1]);
  assert.match(results[2].output,/astra-scope-probe/);
  console.log('PASS: root checks/tests ignore deliberately broken nested v1 source; v1 check detects it.');
} finally { unlinkSync(probe); }
