import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root=process.cwd(),review=path.resolve('docs/reviews/eng-v2-03-astra');
const common=path.resolve(execFileSync('git',['rev-parse','--git-common-dir'],{encoding:'utf8'}).trim());
const ownerRoot=root.match(/^[a-z]:\\Users\\[^\\]+/i)?.[0];
const rules=[[root,'<worktree>'],[path.dirname(common),'<main-checkout>'],...(ownerRoot?[[ownerRoot,'<user-home>']]:[])];
const skip=new Set(['runtime','candidate-snapshot']);
function walk(dir,prefix=''){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>skip.has(e.name)?[]:e.isDirectory()?walk(path.join(dir,e.name),prefix+e.name+'/'):[prefix+e.name]);}
const changed=[];
for(const file of walk(review)) {
  if(!/\.(json|log|txt)$/.test(file)||file==='hygiene.json')continue;
  const full=path.join(review,file),before=fs.readFileSync(full,'utf8');let after=before;
  for(const [absolute,replacement]of rules)for(const spelling of [absolute,absolute.replaceAll('\\','/'),JSON.stringify(absolute).slice(1,-1)]) {
    after=after.split(spelling).join(replacement);
    after=after.split(spelling[0].toLowerCase()+spelling.slice(1)).join(replacement);
  }
  after=after.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'');
  if(file.endsWith('.json'))JSON.parse(after);
  if(after!==before){fs.writeFileSync(full,after);changed.push(file);}
}
const files=walk(review).filter(f=>f!=='hygiene.json'&&f!=='candidate.patch').sort().map(file=>{
  const data=fs.readFileSync(path.join(review,file));return{file,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};
});
fs.writeFileSync(path.join(review,'hygiene.json'),JSON.stringify({sanitized:true,scope:'Public reviewer JSON/text logs only; exact local candidate backups and disposable runtime are excluded.',files},null,2)+'\n');
console.log(JSON.stringify({sanitizedFiles:changed.length,publicEvidenceFiles:files.length}));
