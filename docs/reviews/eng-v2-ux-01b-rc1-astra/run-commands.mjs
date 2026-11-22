import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
const out='docs/reviews/eng-v2-ux-01b-rc1-astra/logs';mkdirSync(out,{recursive:true});
const sanitize=s=>s.replace(/\x1b\[[0-9;]*m/g,'').replaceAll(process.cwd(),'<repo>').replaceAll(process.cwd().replaceAll('\\','/'),'<repo>').replace(/C:[\\/]Users[\\/][^\\/\s]+/gi,'<user-home>');
const results=[],run=Date.now();
for(const command of process.argv.slice(2)){
 const start=Date.now();const r=spawnSync('powershell.exe',['-NoProfile','-Command',command],{encoding:'utf8',maxBuffer:40*1024*1024});
 const file=`${run}-${results.length+1}-${command.replace(/[^\w-]+/g,'-').slice(0,95)}.log`;
 writeFileSync(`${out}/${file}`,sanitize((r.stdout||'')+'\n'+(r.stderr||'')+(r.error?'\n'+r.error:'')));
 const row={command,exitCode:r.status,seconds:(Date.now()-start)/1000,log:file};results.push(row);console.log(row);
}
writeFileSync(`${out}/commands-${run}.json`,JSON.stringify(results,null,2)+'\n');
if(results.some(r=>r.exitCode!==0))process.exitCode=1;
