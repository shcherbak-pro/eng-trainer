import {get} from 'svelte/store';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createCatalog} from '../../../src/content/catalog';
import {buildFlashcards} from '../../../src/features/flashcards/flashcards';
import {readDatabase,resetDatabase,seedDatabase} from '../../../src/test/database';
const clean:(()=>void)[]=[];
const materials:any={meta:{},blocks:[],patterns:[],answers:[],drills:[],irregularVerbs:[],phrases:[
 {id:'p1',phrase:'Equal text',translation:'один',category:'A'},
 {id:'p2',phrase:'Equal text',translation:'два',category:'C'}
],wordIndex:[
 {id:'w-linked',sourcePhraseId:'p1',term:'Explicit link text',meaning:'один',category:'B',examples:[]},
 {id:'w-equal',term:'Equal text',meaning:'три',category:'D',examples:[]}
]};
beforeEach(()=>{resetDatabase();vi.resetModules();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});});
afterEach(()=>{clean.splice(0).forEach(f=>f());vi.useRealTimers();vi.restoreAllMocks();});
async function open(kind:'flash'|'phrase'|'word'='flash'){
 const s=await import('svelte'),state=await import('../../../src/state'),p=await import('../../../src/state/persistence'),toast=await import('../../../src/shared/ui/toast');
 await state.initState();
 const storage=await (await import('../../../src/storage/database')).openStorage();
 const write=vi.fn(storage.write.bind(storage));p.connectStorage({...storage,write});
 const root=document.createElement('main');document.body.append(root);
 const C=kind==='flash'?(await import('../../../src/features/flashcards/FlashcardsPage.svelte')).default:(await import('../../../src/shared/entries/HideButton.svelte')).default;
 const component=s.mount(C as any,{target:root,props:kind==='flash'?{catalog:createCatalog(materials)}:{kind,id:kind==='phrase'?'p1':'w-linked',name:'Equal text'}});s.flushSync();
 clean.push(()=>{s.unmount(component);root.remove();toast.dismissToast();storage.close();});
 async function settle(){for(let i=0;i<20;i++)await Promise.resolve();s.flushSync();await p.persistenceSettled();}
 async function click(label:string){const b=[...root.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent?.trim()===label);if(!b)throw Error('Missing '+label);b.click();s.flushSync();await settle();}
 async function callback(){if(kind==='flash'){await click('Review learned vocabulary (1)');await click('Learn again');}else await click('Hide item');await settle();return get(toast.toast)!.onAction!;}
 return {s,state,p,toast,root,write,settle,click,callback,async topic(name:string){await click('Back to flashcards');await click('By Topic');const select=root.querySelector<HTMLSelectElement>('select[aria-label="Topic"]')!;select.value=name;select.dispatchEvent(new Event('change',{bubbles:true}));s.flushSync();await settle();},async answer(label:string){await click(label);vi.advanceTimersByTime(250);await settle();}};
}
async function noOp(m:Awaited<ReturnType<typeof open>>,callback:()=>unknown){await m.settle();const before=get(m.state.progress),disk=await readDatabase();m.write.mockClear();await callback();await m.settle();expect(get(m.state.progress)).toBe(before);expect(await readDatabase()).toEqual(disk);expect(m.write).not.toHaveBeenCalled();}
it('another deck reached through an explicit phrase/word link invalidates learned Undo on the same canonical key',async()=>{
 await seedDatabase({progress:{learnedPhrases:['p1']}});const m=await open(),undo=await m.callback();
 expect(buildFlashcards(materials).map(c=>[c.id,c.wordIds])).toEqual([['p1',['w-linked']],['p2',[]],['w-equal',['w-equal']]]);
 await m.topic('B');expect(m.root.querySelector('.flashcard__term')!.textContent).toBe('Equal text');
 await m.answer('Keep learning');await noOp(m,undo);expect((await readDatabase()).progress.learnedPhrases).toEqual([]);
 await m.state.initState();expect(get(m.state.progress).learnedPhrases).toEqual([]);
});
it('an equal-text different identity in another deck survives valid Undo, with only learnedPhrases written by Undo',async()=>{
 await seedDatabase({progress:{learnedPhrases:['p1'],hiddenWords:['unavailable']},flashcardSessions:{all:{order:['p2','unavailable','p1'],index:0},other:{order:['unavailable','p2'],index:1}}});
 const m=await open(),undo=await m.callback();await m.topic('C');await m.answer('I know it');const before=await readDatabase();m.write.mockClear();
 await undo();await m.settle();const after=await readDatabase();expect(after.progress.learnedPhrases).toEqual(['p2','p1']);expect(after.flashcardSessions).toEqual(before.flashcardSessions);expect(after.progress.hiddenWords).toEqual(['unavailable']);
 expect(m.write.mock.calls.flatMap(([ops])=>ops).map(o=>[o.type,o.store,o.key])).toEqual([['put','progress','learnedPhrases']]);await noOp(m,undo);
});
it('learned Undo is not expired by Focus or linked-word hidden fields its inverse cannot touch',async()=>{
 await seedDatabase({progress:{learnedPhrases:['p1']}});const m=await open(),undo=await m.callback();
 m.state.progress.toggleFavorite('phrase','p1');m.state.progress.hideItem('word','w-linked');await m.settle();await undo();await m.settle();
 expect(get(m.state.progress)).toMatchObject({learnedPhrases:['p1'],favoritePhrases:['p1'],hiddenWords:['w-linked']});
});
it('hydration refuses an actual earlier learned callback with zero state changes or persistence writes',async()=>{
 await seedDatabase({progress:{learnedPhrases:['p1']}});const m=await open(),undo=await m.callback();
 const storage=await (await import('../../../src/storage/database')).openStorage();m.state.progress.hydrate(await storage.readAll());storage.close();await noOp(m,undo);
});
it.each(['reset','hydrate','new-focus','new-learned'] as const)('retained Hide callback is a write-free no-op after %s, including a recreated hidden state',async(mode)=>{
 await seedDatabase({progress:{learnedPhrases:['p1'],favoritePhrases:['p1']}});const m=await open('phrase'),undo=await m.callback();
 if(mode==='reset'){m.state.resetAllState();m.state.progress.hideItem('phrase','p1');}
 if(mode==='hydrate'){const storage=await (await import('../../../src/storage/database')).openStorage();m.state.progress.hydrate(await storage.readAll());storage.close();}
 if(mode==='new-focus'){m.state.progress.toggleFavorite('phrase','p1');m.state.progress.toggleFavorite('phrase','p1');}
 if(mode==='new-learned'){m.state.progress.toggleLearnedPhrase('p1');m.state.progress.relearnFlashcards(['p1']);}
 await noOp(m,undo);
});
it('word Hide Undo restores only word hidden/Focus fields after a new answer to its linked phrase',async()=>{
 await seedDatabase({progress:{learnedPhrases:['p1'],favoriteWords:['w-linked'],hiddenPhrases:['unavailable']}});const m=await open('word'),undo=await m.callback();
 m.state.progress.relearnFlashcards(['p1']);m.state.progress.saveFlashcardSession('topic:B',{order:['p1','unavailable'],index:0});await m.settle();const before=await readDatabase();m.write.mockClear();
 await undo();await m.settle();const after=await readDatabase();expect(after.progress).toMatchObject({learnedPhrases:[],favoriteWords:['w-linked'],hiddenWords:[],hiddenPhrases:['unavailable']});expect(after.flashcardSessions).toEqual(before.flashcardSessions);
 expect(m.write.mock.calls.flatMap(([ops])=>ops).map(o=>o.key).sort()).toEqual(['favoriteWords','hiddenWords']);await noOp(m,undo);
});
