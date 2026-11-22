import { it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resetDatabase } from '../../../src/test/database';
const out = path.resolve('docs/reviews/eng-v2-03-astra');
const observations: any[] = [];
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
async function wait(predicate: () => boolean) { for(let i=0;i<600;i++){if(predicate())return;await delay(5);}throw new Error('Review harness timed out'); }
for(const version of ['baseline','candidate']) it(`${version}: reproduce original flushSync-close then same-stack navigation`,async()=>{
  vi.resetModules();resetDatabase();window.location.hash='';
  const data=path.resolve(version==='baseline'?'docs/reviews/eng-v2-03-astra/runtime/baseline/public/data':'public/data');
  vi.stubGlobal('fetch',async(url: any)=>new Response(fs.readFileSync(path.join(data,String(url).split('/data/')[1]),'utf8'),{status:200}));
  const svelte=await import('svelte');
  const {default:App}=version==='baseline'?await import('./runtime/baseline/src/app/App.svelte'):await import('../../../src/app/App.svelte');
  const persistence=version==='baseline'?await import('./runtime/baseline/src/state/persistence'):await import('../../../src/state/persistence');
  const root=document.createElement('div');document.body.append(root);const app=svelte.mount(App,{target:root});
  const go=(route: string)=>{window.location.hash=route;window.dispatchEvent(new HashChangeEvent('hashchange'));svelte.flushSync();};
  const press=(scope:ParentNode,label:string)=>{const button=[...scope.querySelectorAll<HTMLButtonElement>('button')].find(e=>e.textContent?.trim()===label||e.getAttribute('aria-label')===label);if(!button)throw new Error('No button '+label);button.click();svelte.flushSync();};
  const errors:any[]=[];const onError=(reason:any)=>errors.push(String(reason?.stack??reason).replaceAll(process.cwd(),'<worktree>'));
  try {
    await wait(()=>!!root.querySelector('.app-shell'));go('settings');await svelte.tick();
    // Original press()/goTo() sequence: .click() and flushSync(), no browser input task
    // boundaries and no DOM manipulation or explicit focus in this diagnostic.
    press(root,'Reset learning progress…');
    process.on('unhandledRejection',onError);
    press(root.querySelector('dialog.dialog')!,'Reset progress');
    go('index'); // Deliberately no await: original failing schedule, with flushSync.
    await persistence.persistenceSettled();await delay(60);
    expect(errors.some(e=>/contains/.test(e))).toBe(true);
    expect(root.querySelector('main h1')?.textContent).toBe('Home');
    observations.push({version,mode:'original press/open, press/confirm, goTo/Home, each flushSync, no await or focus manipulation',errors,homeRendered:true});
    fs.writeFileSync(path.join(out,'reset-race.json'),JSON.stringify(observations,null,2)+'\n');
  } finally {
    process.off('unhandledRejection',onError);await svelte.unmount(app);root.remove();vi.unstubAllGlobals();
  }
});
