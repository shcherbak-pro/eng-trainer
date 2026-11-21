// Capture RC1 independently without rewriting the original Astra/Fable evidence.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
const root=resolve(process.argv[2]||'.'),out=join(root,'docs/reviews/eng-v2-01-rc1-astra');
const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:10_000_000}).toString();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const old=JSON.parse(readFileSync(join(root,'docs/reviews/eng-v2-01-astra/candidate.json')));
const isReviewOutput=p=>p.startsWith('docs/reviews/eng-v2-01-rc1-astra/')||p==='docs/reviews/ENG-V2-01-RC1-ASTRA.md'||p.startsWith('.astra-review-rc1-');
const files=[...new Set(git('ls-files','--cached','--others','--exclude-standard','-z').split('\0'))].filter(p=>p&&existsSync(join(root,p))&&!isReviewOutput(p)).sort();
const scratch=mkdtempSync(join(root,'.astra-review-rc1-')),candidate=join(scratch,'candidate');
const inventory=files.map(path=>{const bytes=readFileSync(join(root,path)),dest=join(candidate,path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(root,path),dest);return{path,bytes:bytes.length,sha256:sha(bytes)};});
const byPath=new Map(inventory.map(x=>[x.path,x]));
const changes=old.inventory.filter(x=>byPath.get(x.path)?.sha256!==x.sha256).map(x=>({path:x.path,before:x.sha256,after:byPath.get(x.path)?.sha256}));
let delta='';
for(const x of changes){const original=join(old.candidate,x.path);assert(existsSync(original),`Original snapshot missing: ${x.path}`);assert.equal(sha(readFileSync(original)),x.before,`Original snapshot hash mismatch: ${x.path}`);const diff=spawnSync('git',['diff','--no-index','--ignore-space-at-eol','--',original,join(root,x.path)],{cwd:root,maxBuffer:20_000_000});assert.equal(diff.status,1);delta+=diff.stdout.toString();}
const implementation=inventory.filter(x=>!x.path.startsWith('docs/reviews/'));
const record={capturedAt:new Date().toISOString(),branch:git('branch','--show-current').trim(),head:git('rev-parse','HEAD').trim(),originMain:git('rev-parse','origin/main').trim(),defaultBranch:git('symbolic-ref','refs/remotes/origin/HEAD').trim(),indexDiff:git('diff','--cached','--name-status'),status:git('status','--porcelain=v1','--untracked-files=all').split('\n').filter(x=>x&&!isReviewOutput(x.slice(3))),scratch,candidate,originalSnapshot:old.candidate,changes,originalImplementationFiles:old.inventory.length,unchangedOriginalImplementationFiles:old.inventory.length-changes.length,implementationFiles:implementation.length,inventory};
mkdirSync(out,{recursive:true});writeFileSync(join(out,'candidate.json'),JSON.stringify(record,null,2)+'\n');writeFileSync(join(out,'candidate-delta.diff'),delta);
copyFileSync(join(root,'docs/reviews/eng-v2-01-astra/browser-review.mjs'),join(out,'browser-review.original.mjs'));
copyFileSync(join(root,'docs/reviews/eng-v2-01-astra/browser-review.mjs'),join(out,'browser-review.mjs'));
copyFileSync(join(root,'docs/reviews/eng-v2-01-astra/browser-support.mjs'),join(out,'browser-support.mjs'));
console.log(JSON.stringify({...record,inventory:undefined,status:undefined},null,2));
