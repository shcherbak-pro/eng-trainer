import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const root = process.cwd();
const out = 'docs/reviews/eng-v2-ux-01b-astra';
const own = p => p.startsWith(out + '/') || p === 'docs/reviews/ENG-V2-UX-01B-ASTRA.md';
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const sha = b => createHash('sha256').update(b).digest('hex');
const paths = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(p => p && !own(p)))].sort();
const files = paths.map(path => ({path, sha256: existsSync(path) ? sha(readFileSync(path)) : null}));
const snapshot = {branch:git('branch','--show-current').trim(), head:git('rev-parse','HEAD').trim(), indexSha256:sha(git('ls-files','--stage','-z')), treeSha256:sha(JSON.stringify(files)), files};
if (process.argv.includes('--verify')) {
  const before=JSON.parse(readFileSync(out+'/candidate-before.json','utf8'));
  const a=new Map(before.files.map(f=>[f.path,f.sha256])), b=new Map(files.map(f=>[f.path,f.sha256]));
  const differences=[...new Set([...a.keys(),...b.keys()])].filter(p=>a.get(p)!==b.get(p));
  const result={candidateFiles:files.length, differences, headUnchanged:before.head===snapshot.head,indexUnchanged:before.indexSha256===snapshot.indexSha256,treeUnchanged:before.treeSha256===snapshot.treeSha256};
  writeFileSync(out+'/preservation-after.json',JSON.stringify(result,null,2)+'\n');
  console.log(result);
  if(differences.length || !result.headUnchanged || !result.indexUnchanged) process.exitCode=1;
} else {
  writeFileSync(out+'/candidate-before.json',JSON.stringify(snapshot,null,2)+'\n');
  writeFileSync(out+'/status-before.txt',git('status','--short','--branch','--untracked-files=all'));
  writeFileSync(out+'/candidate-tracked.diff',git('-c','core.safecrlf=false','diff','--no-ext-diff'));
  console.log({branch:snapshot.branch,head:snapshot.head,files:files.length,treeSha256:snapshot.treeSha256});
}
