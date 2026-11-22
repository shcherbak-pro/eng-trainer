import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const dir='docs/reviews/eng-v2-ux-01b-astra/logs'; mkdirSync(dir,{recursive:true});
const sanitize=s=>s.replace(/\x1b\[[0-9;]*m/g,'').replaceAll(process.cwd(),'<repo>').replaceAll(process.cwd().replaceAll('\\','/'),'<repo>').replace(/C:[\\/]Users[\\/][^\\/\s]+/gi,'<user-home>');
const commands=process.argv.slice(2);
const results=[];
const run=Date.now();
for(const command of commands){
 const start=Date.now();
 const r=spawnSync('powershell.exe',['-NoProfile','-Command',command],{encoding:'utf8',maxBuffer:30*1024*1024});
 const name=command.replace(/[^\w-]+/g,'-');
 writeFileSync(`${dir}/${run}-${name}.log`,sanitize((r.stdout||'')+'\n'+(r.stderr||'')));
 const row={command,exitCode:r.status,seconds:(Date.now()-start)/1000};results.push(row);console.log(row);
}
writeFileSync(`${dir}/commands-${Date.now()}.json`,JSON.stringify(results,null,2)+'\n');
if(results.some(r=>r.exitCode!==0))process.exitCode=1;
