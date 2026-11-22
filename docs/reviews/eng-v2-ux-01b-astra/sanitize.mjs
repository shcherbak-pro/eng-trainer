import {readFileSync,writeFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(),dir='docs/reviews/eng-v2-ux-01b-astra';
const sha=s=>createHash('sha256').update(s).digest('hex');
const variants=(s)=>[JSON.stringify(s).slice(1,-1),s,s.replaceAll('\\','/')].sort((a,b)=>b.length-a.length);
const replacements=[...variants(root).map(s=>[s,'<repo>']),...variants(process.env.USERPROFILE||'NO_USER_PROFILE').map(s=>[s,'<user-home>'])];
const prior=existsSync(dir+'/sanitization.json')?JSON.parse(readFileSync(dir+'/sanitization.json','utf8')).changed:[];
const changed=[...prior];
const escaped=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
for(const rel of readdirSync(dir,{recursive:true})){
 const p=join(dir,rel);if(!statSync(p).isFile()||!(/\.(json|txt|log|diff|yml|md|css)$/.test(rel))||rel==='sanitization.json')continue;
 const before=readFileSync(p),text=before.toString('utf8');let next=text.replace(/\x1b\[[0-9;]*m/g,'');for(const [from,to]of replacements)next=next.replace(new RegExp(escaped(from),'gi'),to);
 if(next!==text){writeFileSync(p,next);const path=rel.replaceAll('\\','/'),record=changed.find(r=>r.path===path);if(record)record.publishedSha256=sha(next);else changed.push({path,originalSha256:sha(before),publishedSha256:sha(next)});}
}
writeFileSync(dir+'/sanitization.json',JSON.stringify({scope:'Only new review evidence; no candidate file sanitized or rewritten.',substitutions:['Repository absolute paths → <repo>','User home absolute paths → <user-home>','ANSI color sequences removed'],changed},null,2)+'\n');
console.log({sanitizedFiles:changed.length});
