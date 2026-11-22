import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { compile } from 'svelte/compiler';
const root=process.cwd(),out=path.resolve('docs/reviews/eng-v2-03-astra');
const common=path.resolve(execFileSync('git',['rev-parse','--git-common-dir'],{encoding:'utf8'}).trim());
const released=path.join(common,'eng-v2-ux-01b-release/artifact-site');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function walk(dir,prefix='') {return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name),prefix+e.name+'/'):[prefix+e.name]);}
const site=path.resolve('site-dist');
const files=walk(site).sort().map(file=>{const b=fs.readFileSync(path.join(site,file));return{path:file,bytes:b.length,sha256:sha(b)};});
const previous=JSON.parse(fs.readFileSync('docs/evidence/eng-v2-03/artifact.json','utf8'));
assert.deepEqual(files,[...previous].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),'reviewed build reproduces implementer artifact');
const v1=walk(path.join(released,'v1')).sort().map(file=>{
  const a=fs.readFileSync(path.join(released,'v1',file)),b=fs.readFileSync(path.join(site,'v1',file));
  const exact=a.equals(b),sameText=a.toString('utf8').replaceAll('\r','')===b.toString('utf8').replaceAll('\r','');
  assert.ok(exact||sameText,file);
  return{file,exact,identicalIgnoringCarriageReturns:sameText};
});
assert.deepEqual(walk(path.join(released,'v1')).sort(),walk(path.join(site,'v1')).sort());
const icon=fs.readFileSync('src/shared/ui/Icon.svelte','utf8');
const cwd=root.replaceAll('\\','/');
const cases=[['matching Windows root',cwd+'/src/shared/ui/Icon.svelte',cwd],['mismatched drive-letter case',cwd+'/src/shared/ui/Icon.svelte',cwd[0].toLowerCase()+cwd.slice(1)],['synthetic matching POSIX root','/review/src/shared/ui/Icon.svelte','/review']];
const cssHashProbe=cases.map(([name,filename,rootDir])=>({name,hash:compile(icon,{filename,rootDir,generate:'client',css:'external'}).css.code.match(/svelte-[a-z0-9]+/)?.[0]}));
const baselineAssets=walk(path.join(out,'runtime/baseline/dist/assets')).sort().map(file=>{
  const a=fs.readFileSync(path.join(out,'runtime/baseline/dist/assets',file)),b=fs.readFileSync(path.join(released,'assets',file));
  assert.ok(a.equals(b),file);return{file,sha256:sha(a),matchesArchivedRelease:true};
});
fs.writeFileSync(path.join(out,'artifact-audit.json'),JSON.stringify({candidateArtifactReproduced:true,files,v1,baselineAssets,cssHashProbe,scope:'Local Windows builds, archived release files and a compiler-options probe only; no Linux CI execution or live deployment verification.'},null,2)+'\n');
console.log(JSON.stringify({candidateArtifactReproduced:true,baselineAssetsMatchArchivedRelease:true,v1,cssHashProbe}));
