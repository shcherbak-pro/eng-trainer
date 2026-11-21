// Read-only checks against the recorded candidate and its independent v1 copy.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname, basename } from 'node:path';
const root=resolve(process.argv[2]||'.'),out=join(root,'docs/reviews/eng-v2-01-astra');
const candidate=JSON.parse(readFileSync(join(out,'candidate.json'),'utf8'));
const hash=(p,algorithm='sha256')=>createHash(algorithm).update(readFileSync(p)).digest('hex');
const sourceChanged=candidate.inventory.filter(x=>hash(join(root,x.path))!==x.sha256);
const snapshotChanged=candidate.inventory.filter(x=>hash(join(candidate.relocatedCandidate||candidate.candidate,x.path))!==x.sha256);
assert.deepEqual(sourceChanged,[]);assert.deepEqual(snapshotChanged,[]);
const packages=['','v1/'].map(prefix=>{
  const manifest=JSON.parse(readFileSync(join(root,prefix+'package.json')));
  const lock=JSON.parse(readFileSync(join(root,prefix+'package-lock.json')));
  for(const key of ['name','version','dependencies','devDependencies']) assert.deepEqual(lock.packages[''][key],manifest[key]);
  assert.equal(lock.name,manifest.name);assert.equal(lock.version,manifest.version);
  const ignored=spawnSync('git',['check-ignore',prefix+'package-lock.json'],{cwd:root});assert.equal(ignored.status,1);
  return {prefix,name:manifest.name,version:manifest.version,manifestSha256:hash(join(root,prefix+'package.json')),lockSha256:hash(join(root,prefix+'package-lock.json')),lockfileVersion:lock.lockfileVersion,ignored:false};
});
const v1Files=candidate.inventory.filter(x=>x.path.startsWith('v1/src/')&&/\.(ts|svelte)$/.test(x.path));
const externalV1Imports=[];
for(const file of v1Files){const text=readFileSync(join(root,file.path),'utf8');for(const match of text.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g))if(match[1].startsWith('.')){const dest=resolve(root,dirname(file.path),match[1]);if(!dest.startsWith(resolve(root,'v1')+'\\'))externalV1Imports.push({file:file.path,import:match[1],dest});}}
assert.deepEqual(externalV1Imports,[]);
const currentSources=candidate.inventory.filter(x=>x.path.startsWith('src/')&&/\.(ts|svelte)$/.test(x.path)&&!x.path.includes('/test/')&&!x.path.endsWith('.test.ts'));
const io=currentSources.flatMap(x=>{const text=readFileSync(join(root,x.path),'utf8');return /fetch\(|indexedDB|openDB|localStorage|sessionStorage|serviceWorker|caches\./.test(text)?[{path:x.path,terms:[...new Set(text.match(/fetch\(|indexedDB|openDB|localStorage|sessionStorage|serviceWorker|caches\./g))]}]:[];});
const moved=[];let diffs='';
for(const file of currentSources){const matches=v1Files.filter(x=>basename(x.path)===basename(file.path));if(matches.length===1){const old=matches[0].path;const r=spawnSync('git',['-c','core.autocrlf=false','diff','--ignore-space-at-eol','--no-index','--',old,file.path],{cwd:root,maxBuffer:10_000_000});moved.push({before:old,after:file.path,changed:r.status===1});diffs+=r.stdout.toString();}}
writeFileSync(join(out,'moved-source.diff'),diffs);
const testNames=path=>[...readFileSync(join(root,path),'utf8').matchAll(/\bit\(\s*['"](.+?)['"]\s*,/g)].map(x=>x[1]);
const retainedTests=['flashcards','FlashcardsPage'].map(name=>{const before=name==='flashcards'?'v1/src/lib/utils/flashcards.test.ts':'v1/src/lib/pages/FlashcardsPage.test.ts';const after=`src/features/flashcards/${name}.test.ts`;assert.deepEqual(testNames(after),testNames(before));return{name,identicalTestNames:true,count:testNames(after).length};});
const baselineName=JSON.parse(execFileSync('git',['show','45564ca:package.json'],{cwd:root})).name;
const reconstructed=readFileSync(join(root,'v1/package-lock.json'),'utf8').replaceAll('english-assessment-trainer-v1',baselineName);
const reconstructedCRLF=reconstructed.replaceAll('\r\n','\n').replaceAll('\n','\r\n');
const originalLockSHA1=createHash('sha1').update(reconstructedCRLF).digest('hex');
assert.equal(originalLockSHA1,'0f24a6c9a936365b6c28cb0ddc0b80763d068dd8');
const summary={date:new Date().toISOString(),unchangedCandidateFiles:candidate.inventory.length,sourceChanged,snapshotChanged,packages,externalV1Imports,io,moved,retainedTests,reconstructedOriginalLockSHA1:originalLockSHA1,originalLockReconstruction:'Restore original package name and CRLF line endings',trackedChanges:candidate.status.filter(x=>!x.startsWith('??')).length,intendedUntracked:candidate.status.filter(x=>x.startsWith('??')).length};
writeFileSync(join(out,'source-audit.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({...summary,moved:undefined},null,2));
