import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,statSync,existsSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const pw=require(resolve('.git/eng-v2-02b-release/tools/node_modules/playwright'));
const out=process.env.REVIEW_OUT||'docs/reviews/eng-v2-ux-01b-rc1-astra/browser-focused';mkdirSync(out,{recursive:true});
const site=resolve('site-dist'),base='http://127.0.0.1:4184/eng-trainer/';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.svg':'image/svg+xml','.txt':'text/plain'};
const server=createServer((req,res)=>{
 const u=new URL(req.url,base);if(u.pathname==='/eng-trainer/seed'){res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><title>synthetic seed</title>');return;}
 let f=resolve(site,decodeURIComponent(u.pathname.replace(/^\/eng-trainer\//,'')));if(!f.startsWith(site)||!existsSync(f)){res.writeHead(404);res.end();return;}
 if(statSync(f).isDirectory())f=join(f,'index.html');let b=readFileSync(f);const gzip=extname(f)!=='.woff2';if(gzip)b=gzipSync(b,{level:9});res.writeHead(200,{'content-type':types[extname(f)]||'application/octet-stream','cache-control':'no-store',...(gzip?{'content-encoding':'gzip'}:{}),'content-length':b.length});res.end(b);
});await new Promise(r=>server.listen(4184,'127.0.0.1',r));
const packs=readdirSync(join(site,'data/packs')).map(f=>JSON.parse(readFileSync(join(site,'data/packs',f),'utf8')));
const phrases=packs.flatMap(p=>p.content.phrases||[]);const words=packs.flatMap(p=>p.content.wordIndex||[]);const verbs=packs.flatMap(p=>p.content.irregularVerbs||[]);
const p1=phrases[0],p2=phrases[1],p3=phrases[2];
const cid='user:11111111-1111-4111-8111-111111111111',eid=n=>cid+':entry:'+String(n).padStart(8,'0')+'-2222-4222-8222-222222222222';
const absent='user:99999999-9999-4999-8999-999999999999:entry:99999999-9999-4999-8999-999999999999';
const native=(name='Мої слова',entries=[{id:eid(1),kind:'phrase',english:'Astra equal',translation:'один',topic:'Astra',examples:[]},{id:eid(2),kind:'word',english:'Astra equal',translation:'два',topic:'Astra',examples:[]},{id:eid(3),kind:'word',english:'linked word',translation:'три',topic:'Astra',examples:[],sourcePhraseId:eid(1)}])=>JSON.stringify({format:'eng-trainer-vocabulary',version:1,collection:{id:cid,name,description:''},entries});
const valid='english,translation,kind\nAstra alpha,альфа,phrase\nAstra beta,бета,word';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const results={engines:{},definition:'Fresh nonpersistent native contexts; synthetic data; clipboard calls stubbed; localhost gzip response BODY bytes, headers excluded. No owner profiles.'};
async function db(page,updates){return page.evaluate(updates=>new Promise((resolve,reject)=>{
 const r=indexedDB.open('eng-trainer-v2',2);r.onupgradeneeded=()=>{for(const n of ['progress','settings','learnPasses','flashcardSessions','userCollections','userEntries'])if(!r.result.objectStoreNames.contains(n))r.result.createObjectStore(n);};
 r.onerror=()=>reject(String(r.error));r.onsuccess=()=>{const d=r.result,names=[...d.objectStoreNames],tx=d.transaction(names,updates?'readwrite':'readonly'),out={};
 for(const n of names){const s=tx.objectStore(n);if(updates)for(const [k,v]of Object.entries(updates[n]||{}))v===null?s.delete(k):s.put(v,k);const keys=s.getAllKeys(),values=s.getAll();values.onsuccess=()=>out[n]=Object.fromEntries(keys.result.map((k,i)=>[k,values.result[i]]));}
 tx.oncomplete=()=>{d.close();resolve(out);};tx.onerror=()=>reject(String(tx.error));};
}),updates);}
async function ready(page){await page.locator('.app-shell').waitFor();await page.evaluate(()=>document.fonts.ready);await delay(70);}
async function go(page,hash){await page.evaluate(h=>location.hash=h,hash);await delay(80);await ready(page);}
async function select(page,text,name='fixture.csv'){await page.locator('#import-file').setInputFiles({name,mimeType:name.endsWith('.json')?'application/json':'text/csv',buffer:Buffer.isBuffer(text)?text:Buffer.from(text)});await delay(80);}
async function accept(page){const dup=page.getByRole('checkbox',{name:'I’ve checked the possible duplicates'});if(await dup.count())await dup.check();await page.locator('.review__actions button').first().click();await page.locator('.notice--success').first().waitFor();await delay(70);}
const learning=s=>({progress:s.progress,learnPasses:s.learnPasses,flashcardSessions:s.flashcardSessions,userCollections:s.userCollections,userEntries:s.userEntries});
const focus=p=>p.evaluate(()=>({tag:document.activeElement?.tagName,id:document.activeElement?.id,text:document.activeElement?.textContent?.trim().slice(0,100),cls:document.activeElement?.className}));
for(const engine of ['chromium','firefox']){
 const browser=await pw[engine].launch({headless:true});const data=results.engines[engine]={version:browser.version(),cases:{}};
 async function run(name,fn,{seed={},route='collections',viewport={width:390,height:844}}={}){
  if(process.env.ONLY&&!process.env.ONLY.split(',').includes(name))return;
  const ctx=await browser.newContext({viewport,reducedMotion:'reduce',acceptDownloads:true});const errors=[];
  await ctx.route(u=>u.host!=='127.0.0.1:4184',r=>r.abort());
  await ctx.addInitScript(()=>{window.__copied=[];window.__rejections=[];window.__writes=[];window.__failWrites=false;Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.__copied.push(text)}});addEventListener('unhandledrejection',e=>window.__rejections.push(String(e.reason)));const put=IDBObjectStore.prototype.put,del=IDBObjectStore.prototype.delete;IDBObjectStore.prototype.put=function(v,k){if(this.transaction.mode==='readwrite'){window.__writes.push({store:this.name,key:k});if(window.__failWrites)throw new DOMException('Synthetic review quota','QuotaExceededError');}return put.call(this,v,k);};IDBObjectStore.prototype.delete=function(k){if(window.__failWrites)throw new DOMException('Synthetic review quota','QuotaExceededError');return del.call(this,k);};});
  const page=await ctx.newPage();page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push({type:'pageerror',message:String(e)}));page.on('console',m=>{if(m.type()==='error')errors.push({type:'console',message:m.text()});});
  const detail={};try{await page.goto(base+'seed');await db(page,seed);await page.goto(base+'#'+route);await ready(page);await fn(page,detail,ctx);assert.deepEqual(errors,[],'unexpected browser errors');assert.deepEqual(await page.evaluate(()=>window.__rejections),[],'unhandled rejections');data.cases[name]={status:'PASS',...detail};console.log(engine+' PASS '+name);}catch(e){data.cases[name]={status:'FAIL',failure:String(e.stack||e).replaceAll(process.cwd(),'<repo>').replaceAll(process.cwd().replaceAll('\\','/'),'<repo>'),...detail};await page.screenshot({path:join(out,engine+'-'+name+'.png'),fullPage:true}).catch(()=>{});console.log(engine+' FAIL '+name+': '+String(e).slice(0,180));}finally{data.cases[name].errors=errors;data.cases[name].unhandledRejections=await page.evaluate(()=>window.__rejections).catch(()=>[]);await ctx.close();writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2)+'\n');}
 }
 for(const same of [true,false]) await run('cross-deck-'+(same?'same-canonical-key':'different-key'),async(page,d)=>{
  await page.getByRole('button',{name:'Review learned vocabulary (1)',exact:true}).click();
  await page.getByRole('button',{name:'Learn again',exact:true}).click();
  await page.getByRole('button',{name:'Back to flashcards',exact:true}).first().click();
  await page.getByRole('button',{name:'By Topic',exact:true}).click();await page.getByLabel('Topic',{exact:true}).selectOption(p1.category);await delay(60);
  assert.equal(await page.locator('.flashcard__term').innerText(),same?p1.phrase:p2.phrase);
  await page.getByRole('button',{name:same?'Keep learning':'I know it',exact:true}).click();await delay(90);
  const before=await db(page);await page.evaluate(()=>window.__writes=[]);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await delay(90);
  d.writes=await page.evaluate(()=>window.__writes);d.after=await db(page);assert.deepEqual(d.after.flashcardSessions,before.flashcardSessions);
  if(same){assert(!d.after.progress.learnedPhrases.includes(p1.id));assert.deepEqual(d.writes,[]);}else{assert(d.after.progress.learnedPhrases.includes(p1.id)&&d.after.progress.learnedPhrases.includes(p2.id));assert.deepEqual(d.writes,[{store:'progress',key:'learnedPhrases'}]);}
  await page.reload();await ready(page);assert.deepEqual(learning(await db(page)),learning(d.after));
 },{route:'flashcards',seed:{progress:{learnedPhrases:[p1.id],hiddenWords:[absent]},flashcardSessions:{all:{order:[p1.id,absent,p2.id],index:0},['topic:'+p1.category]:{order:same?[p1.id,absent,p2.id]:[p2.id,absent,p1.id],index:0}}}});

 await run('focus-ownership-learn-again-and-toast',async(page,d)=>{
  await page.getByRole('button',{name:'Review learned vocabulary (2)',exact:true}).click();
  d.action=await page.evaluate(id=>{const self=document.querySelector(`.learn-again[data-card-id="${id}"]`),elsewhere=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Back to flashcards');self.focus();self.click();elsewhere.focus();return {selfFocusedBefore:true,elsewhere:elsewhere.textContent.trim()};},p1.id);
  await delay(80);d.afterAction=await focus(page);assert.equal(d.afterAction.text,'Back to flashcards');assert.equal(await page.locator(`.learn-again[data-card-id="${p1.id}"]`).count(),0);
  await page.evaluate(()=>{const undo=document.querySelector('.toast__action'),elsewhere=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Back to flashcards');undo.focus();undo.click();elsewhere.focus();});
  await delay(80);d.afterUndo=await focus(page);assert.equal(d.afterUndo.text,'Back to flashcards');assert.equal(await page.locator(`.learn-again[data-card-id="${p1.id}"]`).count(),1);assert(await page.evaluate(()=>document.activeElement.isConnected));
 },{route:'flashcards',seed:{progress:{learnedPhrases:[p1.id,p2.id]}}});

 await run('focus-ownership-dialog-close-after-render',async(page,d)=>{
  await page.getByRole('button',{name:'Delete Alpha pass',exact:true}).focus();await page.keyboard.press('Enter');await page.locator('dialog[open]').waitFor();
  await page.evaluate(()=>{window.__focusMove={};const dialog=document.querySelector('dialog[open]'),target=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Create a Learn Pass');const observer=new MutationObserver(()=>{if(dialog.open)return;observer.disconnect();target.focus();window.__focusMove={duringClose:true,connected:target.isConnected,text:target.textContent.trim()};});observer.observe(dialog,{attributes:true,attributeFilter:['open']});});
  await page.getByRole('button',{name:'Delete Learn Pass',exact:true}).focus();await page.keyboard.press('Enter');await delay(100);
  d.move=await page.evaluate(()=>window.__focusMove);d.focus=await focus(page);assert(d.move.duringClose);assert.equal(d.focus.text,'Create a Learn Pass');assert.equal(await page.getByRole('button',{name:'Delete Beta pass',exact:true}).count(),1);assert(!(await db(page)).learnPasses.alpha);
 },{route:'index',seed:{learnPasses:{alpha:{id:'alpha',name:'Alpha pass',blockIds:['start-answer'],createdAt:'2026-01-01',updatedAt:'2026-01-01'},beta:{id:'beta',name:'Beta pass',blockIds:['start-answer'],createdAt:'2026-01-02',updatedAt:'2026-01-02'}}}});

 await run('collection-removal-focus-and-retention',async(page,d)=>{
  await select(page,native(),'removal.json');await accept(page);const before=await db(page);
  await db(page,{progress:{learnedPhrases:[eid(1)],hiddenWords:[eid(2)],favoriteWords:[eid(3)]},flashcardSessions:{all:{order:[eid(1),eid(2),absent],index:1}}});await page.reload();await ready(page);const seeded=await db(page);
  for(const method of ['cancel','escape']){await page.locator('.collection-action--remove').focus();await page.keyboard.press('Enter');await page.locator('dialog[open]').waitFor();if(method==='cancel'){await page.getByRole('button',{name:'Cancel',exact:true}).click();}else await page.keyboard.press('Escape');await delay(60);assert((await focus(page)).cls.includes('collection-action--remove'));assert.deepEqual(learning(await db(page)),learning(seeded));}
  await page.locator('.collection-action--remove').focus();await page.keyboard.press('Enter');await page.locator('dialog[open] .btn--danger').focus();await page.keyboard.press('Enter');await delay(150);d.focus=await focus(page);d.after=await db(page);assert.equal(d.focus.id,'collections-title');assert(await page.evaluate(()=>document.activeElement.isConnected));assert.deepEqual(d.after.userEntries,{});assert.deepEqual(d.after.userCollections,{});assert.deepEqual(d.after.progress,seeded.progress);assert.deepEqual(d.after.flashcardSessions,seeded.flashcardSessions);assert.equal(Object.keys(before.userEntries).length,3);
 });

 await run('returned-issue-names-file-context-and-writes',async(page,d)=>{
  await select(page,native(),'seed.json');await accept(page);const before=learning(await db(page));d.cases=[];
  const conflict=JSON.parse(native());conflict.entries[0].translation='changed translation';
  for(const [name,content,expected]of [['missing.csv','english,translation\ninvalid,','Translation is required'],['kind.csv','english,translation,kind\nitem,value,noun','kind'],['conflict.json',JSON.stringify(conflict),'ID conflict']]){
   await page.evaluate(()=>window.__writes=[]);await select(page,content,name);
   const item=await page.evaluate(()=>{const e=document.activeElement,section=e.closest('section'),label=e.getAttribute('aria-labelledby');return {connected:e.isConnected,cls:e.className,role:e.getAttribute('role'),tabindex:e.getAttribute('tabindex'),name:document.getElementById(label)?.textContent,fileContext:document.getElementById(section.getAttribute('aria-labelledby'))?.textContent,text:e.textContent,writes:window.__writes};});
   assert(item.connected&&item.cls.includes('review__problems'));assert.equal(item.role,'alert');assert.equal(item.tabindex,'-1');assert(item.name.startsWith('Nothing can be imported'));assert(item.fileContext.includes(name));assert(item.text.includes(expected));assert.deepEqual(item.writes,[]);assert.deepEqual(learning(await db(page)),before);assert(await page.locator('.review__actions button').first().isDisabled());d.cases.push({file:name,...item});
  }
  await select(page,'english,translation\nreview unique,one\nreview unique,two','duplicate.csv');assert.equal((await focus(page)).id,'review-title');assert(await page.locator('.review__actions button').first().isDisabled());await page.getByRole('checkbox',{name:'I’ve checked the possible duplicates'}).check();assert(await page.locator('.review__actions button').first().isEnabled());assert.deepEqual(learning(await db(page)),before);
 });

 for(const mode of ['cancel','supersede'])await run('returned-issue-post-render-'+mode,async(page,d)=>{
  const before=learning(await db(page));await page.evaluate(mode=>{
   window.__renderRace={observed:false,focus:[]};const focus=HTMLElement.prototype.focus;HTMLElement.prototype.focus=function(...args){if(this.classList.contains('review__problems')||this.id==='review-title')window.__renderRace.focus.push({cls:this.className,text:this.textContent,file:document.querySelector('#review-title')?.textContent,connected:this.isConnected});return focus.apply(this,args);};
   const observer=new MutationObserver(()=>{if(!document.querySelector('.review__problems'))return;observer.disconnect();window.__renderRace.observed=true;
    if(mode==='cancel'){[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Cancel import').click();return;}
    const input=document.querySelector('#import-file'),file=new File(['english,translation\nreplacement,нове'],'newest.csv',{type:'text/csv'});const bytes=new TextEncoder().encode('english,translation\nreplacement,нове').buffer;file.arrayBuffer=()=>new Promise(resolve=>window.__finishNew=()=>resolve(bytes));Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new Event('change',{bubbles:true}));
   });observer.observe(document.querySelector('main'),{childList:true,subtree:true});
  },mode);
  await select(page,'english,translation\nobsolete,','obsolete.csv');await delay(70);d.beforeRelease=await page.evaluate(()=>window.__renderRace);assert(d.beforeRelease.observed);assert.deepEqual(d.beforeRelease.focus,[]);assert.equal(await page.locator('.review').count(),0);
  if(mode==='supersede'){await page.evaluate(()=>window.__finishNew());await delay(90);assert.equal((await focus(page)).id,'review-title');assert((await page.locator('#review-title').innerText()).includes('newest.csv'));}else assert.equal((await focus(page)).id,'import-file');
  d.after=await page.evaluate(()=>window.__renderRace);assert.deepEqual(learning(await db(page)),before);
 });

 await run('renamed-font-faces-assets-and-raster-glyphs',async(page,d)=>{
  d.rendering=await page.evaluate(async()=>{
   const chars='English іїєґІЇЄҐʼɪəˈːʊðɑæʃɔɜʌɡˌŋʒθ';await document.fonts.load('400 40px "Eng Trainer Sans"',chars);await document.fonts.ready;
   const faces=[...document.fonts].filter(f=>/Trainer|Source/.test(f.family)).map(f=>({family:f.family,status:f.status,weight:f.weight,style:f.style,unicodeRange:f.unicodeRange}));
   const c=document.createElement('canvas');c.width=128;c.height=96;const x=c.getContext('2d',{willReadFrequently:true});const digest=(ch,font)=>{x.clearRect(0,0,128,96);x.font=font;x.fillText(ch,5,65);let hash=2166136261;for(const b of x.getImageData(0,0,128,96).data)hash=Math.imul(hash^b,16777619);return hash>>>0;};
   const glyphs=[...new Set(chars)].filter(ch=>ch!==' ').map(ch=>({ch,renamed:['monospace','serif','cursive'].map(f=>digest(ch,`40px "Eng Trainer Sans", ${f}`)),fallback:['monospace','serif','cursive'].map(f=>digest(ch,`40px ${f}`))}));
   const rules=[...document.styleSheets].flatMap(sheet=>[...sheet.cssRules]).filter(r=>r.type===CSSRule.FONT_FACE_RULE).map(r=>r.cssText).filter(r=>/Trainer|Source/.test(r));
   const probe=document.createElement('p');probe.id='review-font-sample';probe.textContent=chars;probe.style.cssText='font:400 30px "Eng Trainer Sans";padding:20px;background:white;color:black';document.querySelector('main').prepend(probe);
   return {faces,rules,glyphs,requests:performance.getEntriesByType('resource').filter(e=>e.name.endsWith('.woff2')).map(e=>({url:e.name.split('/').pop(),bytes:e.encodedBodySize})),computed:getComputedStyle(probe).fontFamily};
  });
  assert.equal(d.rendering.faces.length,4);assert(d.rendering.faces.every(f=>f.family.replaceAll('"','')==='Eng Trainer Sans'&&f.status==='loaded'));assert.equal(d.rendering.rules.length,4);assert(d.rendering.rules.every(r=>r.includes('eng-trainer-sans-')));
  assert(d.rendering.glyphs.every(g=>new Set(g.renamed).size===1));assert(d.rendering.glyphs.some(g=>g.renamed[0]!==g.fallback[0]));
  for(const subset of ['latin','latin-ext','cyrillic','greek'])assert(d.rendering.requests.some(r=>r.url.startsWith('eng-trainer-sans-'+subset+'-')));
  assert(d.rendering.requests.every(r=>/^(eng-trainer-sans|literata)-/.test(r.url)));await page.locator('#review-font-sample').screenshot({path:join(out,engine+'-raster-font-sample.png')});
 },{route:'wordIndex'});

 await run('description-language-on-home-focus-and-every-verb-set',async(page,d)=>{
  const blocks=JSON.parse(readFileSync(join(site,'data/manifest.json'))).blocks;d.rows=[];
  for(const route of ['index','favorites']){await go(page,route);for(const id of ['start-answer','irregular-verbs-100']){const b=blocks.find(b=>b.id===id),row=page.locator('.block-row__meta').filter({hasText:b.description});assert.equal(await row.count(),1);const v=await row.evaluate(e=>({text:e.textContent,lang:e.closest('[lang]')?.getAttribute('lang')}));assert.equal(v.lang,id==='start-answer'?'uk':'en');d.rows.push({route,id,...v});}}
  for(const b of blocks.filter(b=>b.type==='irregularVerbs')){await db(page,{settings:{irregularSet:b.verbSet}});await page.reload();await ready(page);await go(page,'irregularVerbs');const select=page.locator('select').filter({has:page.locator(`option[value="${b.verbSet}"]`)});if(await select.count())await select.selectOption(b.verbSet);await delay(80);const v=await page.locator('.list-note span').evaluate(e=>({text:e.textContent,lang:e.closest('[lang]')?.getAttribute('lang')}));assert.equal(v.text,b.description);assert.equal(v.lang,'en');d.rows.push({route:'irregularVerbs',id:b.id,...v});}
 },{route:'index',seed:{progress:{favoriteBlocks:['start-answer','irregular-verbs-100']}}});
 await browser.close();
}
server.close();writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2)+'\n');
