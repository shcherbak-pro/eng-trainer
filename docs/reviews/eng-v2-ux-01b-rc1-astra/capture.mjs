import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
const out = 'docs/reviews/eng-v2-ux-01b-rc1-astra';
const own = p => p.startsWith(out + '/') || p === 'docs/reviews/ENG-V2-UX-01B-RC1-ASTRA.md';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
const sha = b => createHash('sha256').update(b).digest('hex');
const paths = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(p => p && !own(p)))].sort();
const files = paths.map(path => ({path, sha256: existsSync(path) ? sha(readFileSync(path)) : null}));
const snapshot = {branch:git('branch','--show-current').trim(),head:git('rev-parse','HEAD').trim(),indexSha256:sha(git('ls-files','--stage','-z')),treeSha256:sha(JSON.stringify(files)),files};
mkdirSync(out,{recursive:true});
const old = JSON.parse(readFileSync('docs/reviews/eng-v2-ux-01b-astra/candidate-before.json','utf8'));
const groups = {
  protected: p => p.startsWith('docs/design/') || p.startsWith('docs/releases/'),
  originalReview: p => p.startsWith('docs/reviews/eng-v2-ux-01b-astra/') || p === 'docs/reviews/ENG-V2-UX-01B-ASTRA.md',
  priorImplementationEvidence: p => p.startsWith('docs/evidence/eng-v2-ux-01b/'),
  priorRC1Evidence: p => p.startsWith('docs/evidence/eng-v2-ux-01b-rc1/'),
};
const compare = (a,b) => {const aa=new Map(a.map(f=>[f.path,f.sha256])),bb=new Map(b.map(f=>[f.path,f.sha256]));return [...new Set([...aa.keys(),...bb.keys()])].filter(p=>aa.get(p)!==bb.get(p)).map(path=>({path,before:aa.get(path)??null,after:bb.get(path)??null}));};
if (process.argv.includes('--verify')) {
  const before=JSON.parse(readFileSync(out+'/candidate-before.json','utf8'));
  const result={candidateFiles:files.length,differences:compare(before.files,files),headUnchanged:before.head===snapshot.head,indexUnchanged:before.indexSha256===snapshot.indexSha256,treeUnchanged:before.treeSha256===snapshot.treeSha256,groups:Object.fromEntries(Object.entries(groups).map(([k,filter])=>[k,{files:before.files.filter(f=>filter(f.path)).length,changed:compare(before.files.filter(f=>filter(f.path)),files.filter(f=>filter(f.path)))}]))};
  writeFileSync(out+'/preservation-after.json',JSON.stringify(result,null,2)+'\n');console.log(result);
  if(result.differences.length||!result.headUnchanged||!result.indexUnchanged)process.exitCode=1;
} else {
  if(existsSync(out+'/candidate-before.json'))throw Error('Refusing to overwrite review baseline');
  writeFileSync(out+'/candidate-before.json',JSON.stringify(snapshot,null,2)+'\n');
  writeFileSync(out+'/status-before.txt',git('status','--short','--branch','--untracked-files=all'));
  writeFileSync(out+'/candidate-tracked.diff',git('-c','core.safecrlf=false','diff','--no-ext-diff'));
  const delta=JSON.parse(readFileSync('docs/evidence/eng-v2-ux-01b-rc1/rc1-delta.json','utf8'));
  const expected=[...delta.changed,...delta.added.map(f=>({path:f.path,before:null,after:f.sha256})),...delta.removed.map(f=>({...f,after:null}))];
  const actual=compare(old.files,files.filter(f=>!groups.originalReview(f.path)&&!groups.priorRC1Evidence(f.path)));
  const mismatches=expected.filter(e=>!actual.some(a=>a.path===e.path&&a.before===e.before&&a.after===e.after));
  const unexpected=actual.filter(a=>!expected.some(e=>e.path===a.path));
  const report={originalFingerprint:old.treeSha256,rc1Fingerprint:snapshot.treeSha256,counts:{candidate:files.length,changed:actual.filter(a=>a.before&&a.after).length,added:actual.filter(a=>!a.before).length,removed:actual.filter(a=>!a.after).length},mismatches,unexpected,actualDelta:actual,groups:Object.fromEntries(Object.entries(groups).map(([k,filter])=>[k,files.filter(f=>filter(f.path)).length])),protectedAgainstOriginal:compare(old.files.filter(f=>groups.protected(f.path)),files.filter(f=>groups.protected(f.path)))};
  writeFileSync(out+'/delta-verification.json',JSON.stringify(report,null,2)+'\n');
  console.log({branch:snapshot.branch,head:snapshot.head,fingerprint:snapshot.treeSha256,...report.counts,groups:report.groups,mismatches,unexpected});
}
