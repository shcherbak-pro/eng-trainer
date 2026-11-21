// Verify all pre-existing deliverables/evidence and the full tested snapshot.
// node verify-preservation.mjs <repo> [--after-cleanup]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root=resolve(process.argv[2]||'.'),afterCleanup=process.argv.includes('--after-cleanup');
const out=join(root,'docs/reviews/eng-v2-01-rc1-astra');
const initial=JSON.parse(readFileSync(join(out,'candidate.json'),'utf8'));
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:20_000_000}).toString();
const own=p=>p.startsWith('docs/reviews/eng-v2-01-rc1-astra/')||p==='docs/reviews/ENG-V2-01-RC1-ASTRA.md'||p.startsWith('.astra-review-rc1-');
const mismatches=initial.inventory.filter(f=>!existsSync(join(root,f.path))||hash(join(root,f.path))!==f.sha256).map(f=>f.path);
const snapshotMismatches=afterCleanup?null:initial.inventory.filter(f=>!existsSync(join(initial.candidate,f.path))||hash(join(initial.candidate,f.path))!==f.sha256).map(f=>f.path);
const status=git('status','--porcelain=v1','--untracked-files=all').split('\n').filter(s=>s&&!own(s.slice(3)));
const originalScript=hash(join(root,'docs/reviews/eng-v2-01-astra/browser-review.mjs'));
assert.equal(hash(join(out,'browser-review.original.mjs')),originalScript);
assert.equal(hash(join(out,'browser-support.mjs')),hash(join(root,'docs/reviews/eng-v2-01-astra/browser-support.mjs')));
// Prove the only adjustment to the full 17-case runner is the C++/C# body.
const stripCase=source=>source.replace(/test\('distinct-entry-identities-with-similar-display-text',[\s\S]*?(?=test\('built-in-duplicate-entry-consistency')/,'<RC1 CASE B>\n');
assert.equal(stripCase(readFileSync(join(out,'browser-review.original.mjs'),'utf8')),stripCase(readFileSync(join(out,'browser-review.mjs'),'utf8')));
assert.deepEqual(mismatches,[]);
if(!afterCleanup)assert.deepEqual(snapshotMismatches,[]);
assert.deepEqual(status,initial.status);
assert.equal(git('diff','--cached','--name-status'),initial.indexDiff);
assert.equal(git('rev-parse','HEAD').trim(),initial.head);
assert.equal(git('branch','--show-current').trim(),initial.branch);
if(afterCleanup)assert.equal(existsSync(initial.scratch),false);
const report={date:new Date().toISOString(),status:'PASS',preexistingFiles:initial.inventory.length,originalImplementationFiles:initial.originalImplementationFiles,v1Files:initial.inventory.filter(f=>f.path.startsWith('v1/')).length,activeMismatches:mismatches,snapshotMismatches,indexDiff:git('diff','--cached','--name-status'),branch:initial.branch,head:initial.head,implementationStatusUnchanged:true,originalScriptSHA256:originalScript,correctedScriptSHA256:hash(join(out,'browser-review.mjs')),onlyOriginalCaseChanged:'distinct-entry-identities-with-similar-display-text',scratchRemoved:!existsSync(initial.scratch),candidateInventorySHA256:hash(join(out,'candidate.json')),statusLines:status};
writeFileSync(join(out,afterCleanup?'final-preservation.json':'source-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,statusLines:undefined},null,2));
