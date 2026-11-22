import {get} from 'svelte/store';
import {it,expect,beforeEach,afterEach,vi} from 'vitest';
import {createCatalog} from '../../../src/content/catalog';
import {resetDatabase,seedDatabase,readDatabase} from '../../../src/test/database';
const clean:(()=>void)[]=[];
beforeEach(()=>{resetDatabase();vi.resetModules();});
afterEach(()=>clean.splice(0).forEach(f=>f()));
const absent='user:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222';
const phrases=[{id:'p1',phrase:'Equal text',translation:'один',category:'Synthetic'},{id:'p2',phrase:'Equal text',translation:'два',category:'Synthetic'},{id:'p3',phrase:'Other card',translation:'три',category:'Other'}];
const materials:any={meta:{title:'Review',subtitle:'',version:'',language:'',updated:'',goal:''},blocks:[],patterns:[],answers:[],drills:[],irregularVerbs:[],phrases,wordIndex:[]};
async function mount(kind:'flash'|'hide'='flash'){
 const s=await import('svelte');const state=await import('../../../src/state');const persistence=await import('../../../src/state/persistence');const toast=await import('../../../src/shared/ui/toast');
 await state.initState();
 const root=document.createElement('main');document.body.appendChild(root);
 const Component=kind==='flash'?(await import('../../../src/features/flashcards/FlashcardsPage.svelte')).default:(await import('../../../src/shared/entries/PhraseCard.svelte')).default;
 const component=s.mount(Component as any,{target:root,props:kind==='flash'?{catalog:createCatalog(materials)}:{phrase:phrases[0]}});s.flushSync();
 clean.push(()=>{s.unmount(component);root.remove();toast.dismissToast();});
 const click=(label:string)=>{const b=[...root.querySelectorAll('button')].find(b=>b.textContent?.trim()===label||b.getAttribute('aria-label')===label);if(!b)throw Error('Missing '+label);b.click();s.flushSync();};
 return {s,state,persistence,toast,root,click};
}
async function learnAgain(){
 const m=await mount();m.click('Review learned vocabulary (1)');m.click('Learn again');
 const callback=get(m.toast.toast)!.onAction!;return {...m,callback};
}
it('ordinary Learn again Undo restores the exact saved state and IDs',async()=>{
 await seedDatabase({progress:{learnedPhrases:['p1'],hiddenWords:[absent],favoritePhrases:['p2']},flashcardSessions:{all:{order:['p2',absent,'p3'],index:2},other:{order:['p3','p2'],index:1}}});
 const before=await readDatabase();const m=await learnAgain();m.callback();await m.persistence.persistenceSettled();expect(await readDatabase()).toEqual(before);
});
it('Learn again, another card answer, Undo preserves the later answer and both deck records',async()=>{
 await seedDatabase({progress:{learnedPhrases:['p1'],hiddenWords:[absent]},flashcardSessions:{all:{order:['p2',absent,'p3'],index:0},other:{order:['p3','p2'],index:1}}});
 const m=await learnAgain();m.state.progress.saveFlashcardSession('all',{order:[absent,'p3','p1'],index:1},['p2']);
 m.callback();await m.persistence.persistenceSettled();const saved=await readDatabase();expect(saved.progress.learnedPhrases).toEqual(['p2','p1']);expect(saved.flashcardSessions).toEqual({all:{order:[absent,'p3','p1'],index:1},other:{order:['p3','p2'],index:1}});expect(saved.progress.hiddenWords).toEqual([absent]);
});
it('old Learn again callback cannot resurrect progress after confirmed Settings Reset',async()=>{
 await seedDatabase({progress:{learnedPhrases:['p1']}});const m=await learnAgain();
 const target=document.createElement('div');document.body.appendChild(target);const Settings=(await import('../../../src/features/settings/SettingsPage.svelte')).default;const c=m.s.mount(Settings,{target});m.s.flushSync();
 clean.push(()=>{m.s.unmount(c);target.remove();});
 [...target.querySelectorAll('button')].find(b=>b.textContent?.includes('Reset learning progress'))!.click();m.s.flushSync();
 target.querySelector<HTMLButtonElement>('.dialog .btn--danger')!.click();m.s.flushSync();await m.persistence.persistenceSettled();expect((await readDatabase()).progress.learnedPhrases).toEqual([]);
 m.callback();await m.persistence.persistenceSettled();expect((await readDatabase()).progress.learnedPhrases).toEqual([]);
});
it('old Learn again callback does not override a later Hide of that same entry',async()=>{
 await seedDatabase({progress:{learnedPhrases:['p1']}});const m=await learnAgain();m.state.progress.hideItem('phrase','p1');m.callback();await m.persistence.persistenceSettled();expect((await readDatabase()).progress.learnedPhrases).not.toContain('p1');
});
it('old Hide callback cannot reapply pre-reset Focus and learned flags after a new Hide',async()=>{
 await seedDatabase({progress:{learnedPhrases:['p1'],favoritePhrases:['p1']}});const m=await mount('hide');m.click('Hide item');const old=get(m.toast.toast)!.onAction!;
 m.state.resetAllState();await m.persistence.persistenceSettled();old();expect(get(m.state.progress).learnedPhrases).toEqual([]);
 m.state.progress.hideItem('phrase','p1');old();await m.persistence.persistenceSettled();expect(get(m.state.progress)).toMatchObject({hiddenPhrases:['p1'],learnedPhrases:[],favoritePhrases:[]});
});
it('Hide Undo does not overwrite later same-entry Focus and learned decisions',async()=>{
 await seedDatabase({progress:{learnedPhrases:['p1'],favoritePhrases:['p1']}});const m=await mount('hide');m.click('Hide item');const old=get(m.toast.toast)!.onAction!;
 m.state.progress.unhideItem('phrase','p1');m.state.progress.toggleFavorite('phrase','p1');m.state.progress.toggleFavorite('phrase','p1');m.state.progress.hideItem('phrase','p1');old();await m.persistence.persistenceSettled();
 expect(get(m.state.progress)).toMatchObject({hiddenPhrases:['p1'],learnedPhrases:[],favoritePhrases:[]});
});
it('failed pre-reset save, followed by Reset and retry, cannot resurrect queued progress',async()=>{
 await seedDatabase({progress:{learnedPhrases:['p1'],favoritePhrases:['p1']},flashcardSessions:{all:{order:['p2',absent],index:1}}});const m=await mount('hide');
 const {openStorage}=await import('../../../src/storage/database');const storage=await openStorage();let fail=true;
 m.persistence.connectStorage({...storage,write:async(ops,conditions)=>{if(fail)throw Error('Synthetic disk failure');await storage.write(ops,conditions);}});
 m.click('Hide item');await m.persistence.persistenceSettled();expect(get(m.persistence.saveStatus).state).toBe('error');m.state.resetAllState();await m.persistence.persistenceSettled();fail=false;await m.persistence.retrySave();
 const saved=await readDatabase();expect(saved.progress.learnedPhrases).toEqual([]);expect(saved.progress.favoritePhrases).toEqual([]);expect(saved.progress.hiddenPhrases).toEqual([]);expect(saved.flashcardSessions).toEqual({});storage.close();
});
