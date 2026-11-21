// New Astra RC1 cases, kept separate from the original 17 and Fable's supplement.
// node independent-browser.mjs <candidate> <tools> <evidence> <corpus-audit.json>
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serveArtifact, instrumentBrowser, seedDatabase, readDatabase, settle } from './browser-support.mjs';
const [candidateArg, toolsArg, evidenceArg, corpusArg] = process.argv.slice(2);
const candidate=resolve(candidateArg), evidence=resolve(evidenceArg);
mkdirSync(evidence,{recursive:true});
const {chromium,firefox}=await import(pathToFileURL(join(resolve(toolsArg),'node_modules/playwright/index.mjs')));
const materials=JSON.parse(readFileSync(join(candidate,'site-dist/data/materials.json'),'utf8'));
const corpus=JSON.parse(readFileSync(corpusArg,'utf8'));
const server=await serveArtifact(join(candidate,'site-dist')), base=server.origin+'/eng-trainer/';
const ready=async(page,url=base)=>{await page.goto(url,{waitUntil:'domcontentloaded'});await page.locator('.app-shell').waitFor();};
const reload=async page=>{await settle(page);await page.reload();await page.locator('.app-shell').waitFor();};
const nav=async(page,name)=>{await page.locator('.desktop-nav').getByRole('button',{name:name==='Focus'?/^Focus(?:\s+\d+)?$/:name,exact:true}).click();await page.locator('.hero h1').filter({hasText:name}).waitFor();};
const phrase=(page,text)=>page.locator('.phrase-card').filter({has:page.getByRole('heading',{name:text,exact:true})});
const counts=async page=>({learned:Number(await page.getByRole('progressbar').getAttribute('aria-valuenow')),total:Number(await page.getByRole('progressbar').getAttribute('aria-valuemax'))});
const probe=page=>page.evaluate(()=>({transactions:window.__review.transactions,writes:window.__review.writes,extra:window.__rc1}));
const tests=[];
const test=(name,fn)=>tests.push({name,fn});

test('explicit-links-different-text-and-unlinked-equal-text',async({page,context,record})=>{
  const fixture=structuredClone(materials);
  fixture.phrases=[{id:'rc1-alpha',phrase:'Same!',category:'Phrase A',translation:'Alpha'}, {id:'rc1-beta',phrase:'Same',category:'Phrase B',translation:'Beta'}];
  const word=(id,term,category,sourcePhraseId)=>({id,term,category,sourcePhraseId,meaning:id,examples:[],pronunciation:''});
  fixture.wordIndex=[word('rc1-link-one','Different linked wording','Link One','rc1-alpha'),word('rc1-link-two','Same','Link Two','rc1-alpha'),word('rc1-unlinked','Same!','Unlinked'),word('rc1-dangling','Same','Dangling','absent')];
  fixture.blocks=[{id:'rc1-phrases',title:'Review phrases',type:'phraseCategory',category:'Phrase A',description:''},{id:'rc1-words',title:'Review words',type:'wordIndex',description:''}];
  await context.route('**/eng-trainer/data/materials.json',route=>route.fulfill({json:fixture}));
  await ready(page,base+'#phrases');
  await phrase(page,'Same').getByRole('button',{name:'Add to Focus List',exact:true}).click();
  await nav(page,'Flashcards');
  assert.deepEqual(await counts(page),{learned:0,total:4});
  assert.equal(await page.locator('.flashcard__term').innerText(),'Same!');
  await page.getByRole('button',{name:/^I know it/}).click();
  await page.locator('.flashcard__term').filter({hasText:/^Same$/}).waitFor();
  await settle(page);record.afterFirst=await readDatabase(page);
  assert.deepEqual(record.afterFirst.progress.learnedPhrases,['rc1-alpha']);
  assert.deepEqual(record.afterFirst.flashcardSessions.all.order,['rc1-beta','rc1-unlinked','rc1-dangling']);
  await reload(page);
  await nav(page,'Phrases');assert.deepEqual(await page.locator('.phrase-card.learned h3').allTextContents(),['Same!']);
  await nav(page,'Focus');assert.equal(await phrase(page,'Same').getByRole('button',{name:'Mark as learned',exact:true}).count(),1);
  await nav(page,'Flashcards');await page.getByRole('button',{name:'By Topic',exact:true}).click();
  await page.getByRole('button',{name:'Review learned vocabulary',exact:true}).click();
  record.topics={};
  for(const topic of ['Phrase A','Phrase B','Link One','Link Two','Unlinked','Dangling']) {
    await page.getByRole('combobox',{name:/^Topic\b/}).selectOption(topic);
    const learned=['Phrase A','Link One','Link Two'].includes(topic)?1:0;
    record.topics[topic]={...await counts(page),reviewed:await page.locator('.flashcards-review__text strong').allTextContents()};
    assert.deepEqual(record.topics[topic],{learned,total:1,reviewed:learned?['Same!']:[]});
  }
  await page.getByRole('button',{name:'All Vocabulary',exact:true}).click();
  assert.deepEqual(await counts(page),{learned:1,total:4});
  await nav(page,'Words');await page.getByLabel('Search',{exact:true}).fill('Different linked wording');
  await page.locator('.word-card').getByRole('button',{name:'Hide item',exact:true}).click();
  await reload(page);await nav(page,'Flashcards');
  record.afterHide=await counts(page);assert.deepEqual(record.afterHide,{learned:0,total:3});
  record.hiddenDatabase=await readDatabase(page);assert.deepEqual(record.hiddenDatabase.progress.hiddenWords,['rc1-link-one']);
  assert.deepEqual(record.hiddenDatabase.progress.learnedPhrases,['rc1-alpha']);
  await nav(page,'Words');await page.getByRole('button',{name:'Unhide all words',exact:true}).click();
  await nav(page,'Flashcards');assert.deepEqual(await counts(page),{learned:1,total:4});
  // Remaining IDs deliberately have confusing display text. Assert stored identity after every answer.
  const expected=['rc1-alpha'];record.learningSteps=[];
  for(const id of ['rc1-beta','rc1-unlinked','rc1-dangling']) {
    await page.getByRole('button',{name:/^I know it/}).click();expected.push(id);
    await page.waitForFunction(n=>Number(document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow'))===n,expected.length);
    await settle(page);const saved=await readDatabase(page);assert.deepEqual(saved.progress.learnedPhrases,expected);
    record.learningSteps.push([...saved.progress.learnedPhrases]);
  }
  await page.getByRole('heading',{name:'Deck complete',exact:true}).waitFor();
  await reload(page);assert.deepEqual(await counts(page),{learned:4,total:4});
  await nav(page,'Phrases');assert.deepEqual(await page.locator('.phrase-card.learned h3').allTextContents(),['Same!','Same']);
  await nav(page,'Focus');assert.equal(await phrase(page,'Same').getByRole('button',{name:'Mark as not learned',exact:true}).count(),1);
  record.final=await readDatabase(page);assert.deepEqual(record.final.progress.learnedPhrases,expected);
});

// Runs before app code, wraps real browser requests/transactions, never mocks storage.
function installReadFault(mode) {
  window.__rc1={mode,enabled:location.pathname!=='/_review/blank',issued:0,succeeded:0,injected:0,unhandled:[]};
  window.addEventListener('unhandledrejection',event=>window.__rc1.unhandled.push(String(event.reason)));
  for(const method of ['getAllKeys','getAll']) {
    const original=IDBObjectStore.prototype[method];
    IDBObjectStore.prototype[method]=function(...args) {
      const state=window.__rc1,tx=this.transaction;
      const target=state.enabled && tx.db.name==='eng-trainer-v2' && tx.mode==='readonly' && tx.objectStoreNames.length===4;
      if(target && mode==='sync-issue-failure' && method==='getAll' && this.name==='settings') {
        state.injected++;throw new DOMException('ASTRA RC1 synchronous issue failure after pending requests','UnknownError');
      }
      const request=original.apply(this,args);
      if(target) {
        state.issued++;
        request.addEventListener('success',()=>{
          state.succeeded++;
          if(mode==='completion-only-abort' && state.succeeded===8) {state.injected++;tx.abort();}
        });
      }
      return request;
    };
  }
}

for(const mode of ['completion-only-abort','sync-issue-failure']) test(mode,async({page,context,record})=>{
  await context.addInitScript(installReadFault,mode);
  await page.goto(server.origin+'/_review/blank');
  const seeded={progress:{learnedPhrases:['phrase-001'],favoritePhrases:['phrase-002']},settings:{theme:'dark',activePage:'phrases'},learnPasses:{'rc1-pass':{id:'rc1-pass',name:'RC1 stored pass',description:'review only',blockIds:[materials.blocks[0].id],createdAt:'2026-01-01',updatedAt:'2026-01-01'}},flashcardSessions:{all:{order:['phrase-004','phrase-003'],index:1}}};
  await seedDatabase(page,seeded);
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('.error-card').waitFor();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.app-shell').count(),0);
  assert.match(await page.locator('.error-card').innerText(),/Unable to open your saved progress/);
  assert.match(await page.locator('.error-card').innerText(),/IndexedDB read failed/);
  record.failure=await probe(page);
  assert.equal(record.failure.extra.injected,1);
  assert.deepEqual(record.failure.extra.unhandled,[]);
  assert.equal(record.failure.writes.length,0,'Failed read must never write defaults');
  assert(record.failure.transactions.some(t=>t.mode==='readonly'&&t.outcome==='abort'));
  if(mode==='completion-only-abort') {
    assert.equal(record.failure.extra.issued,8);
    assert.equal(record.failure.extra.succeeded,8,'All requests succeeded; transaction completion alone must reject startup');
  } else assert.equal(record.failure.extra.issued,7,'Seven earlier request promises exist when the final getAll throws');
  await page.evaluate(()=>window.__rc1.enabled=false);
  record.afterFailure=await readDatabase(page);assert.deepEqual(record.afterFailure,seeded);
  await page.getByRole('button',{name:'Try again',exact:true}).click();await page.locator('.app-shell').waitFor();await settle(page);
  assert.equal(await page.locator('.hero h1').innerText(),'Phrases');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert.equal(await phrase(page,materials.phrases[0].phrase).getByRole('button',{name:'Mark as not learned',exact:true}).count(),1);
  record.afterRetry=await readDatabase(page);assert.deepEqual(record.afterRetry,seeded);
  record.retry=await probe(page);assert.equal(record.retry.writes.length,0);assert.deepEqual(record.retry.extra.unhandled,[]);
});

test('saved-560-card-order-resumes-and-appends-six-identities',async({page,record})=>{
  const added=new Set(corpus.savedOrder.appendedIds),allIds=materials.phrases.map(p=>p.id);
  const oldOrder=allIds.filter(id=>!added.has(id)),index=80;
  assert.equal(oldOrder.length,560);
  await page.goto(server.origin+'/_review/blank');
  await seedDatabase(page,{settings:{activePage:'flashcards',flashcardMode:'all'},flashcardSessions:{all:{order:oldOrder,index}}});
  await ready(page);
  assert.equal(await page.locator('.flashcard__term').innerText(),materials.phrases.find(p=>p.id===oldOrder[index]).phrase);
  assert.deepEqual(await counts(page),{learned:0,total:566});
  await page.getByRole('button',{name:/Keep learning$/}).click();
  await page.locator('.flashcard__term').filter({hasText:materials.phrases.find(p=>p.id===oldOrder[index+1]).phrase}).waitFor();
  await settle(page);record.saved=await readDatabase(page);
  const expected={order:[...oldOrder,...corpus.savedOrder.appendedIds],index:index+1};
  assert.deepEqual(record.saved.flashcardSessions.all,expected);
  await reload(page);assert.equal(await page.locator('.flashcard__term').innerText(),materials.phrases.find(p=>p.id===oldOrder[index+1]).phrase);
  assert.deepEqual((await readDatabase(page)).flashcardSessions.all,expected);
});

let failed=false;
try {
  for(const [engine,browserType] of Object.entries({chromium,firefox})) {
    if(process.env.REVIEW_ENGINE && process.env.REVIEW_ENGINE!==engine) continue;
    const browser=await browserType.launch({headless:true}),version=browser.version(),results=[];
    console.log(`${engine} ${version}`);
    for(const {name,fn} of tests) {
      if(process.env.REVIEW_CASE && !new RegExp(process.env.REVIEW_CASE).test(name)) continue;
      const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
      await context.addInitScript(instrumentBrowser,{});
      const page=await context.newPage();page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(20000);
      const record={name,status:'PASS',errors:[],consoleErrors:[]};
      page.on('pageerror',e=>record.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')record.consoleErrors.push(m.text());});
      const started=Date.now();
      try {await fn({page,context,record});assert.deepEqual(record.errors,[]);}
      catch(error) {record.status='FAIL';record.error=String(error.stack||error);failed=true;try{await page.screenshot({path:join(evidence,`${engine}-${name}.png`)});}catch{}}
      record.elapsedMs=Date.now()-started;results.push(record);
      writeFileSync(join(evidence,`independent-${engine}.json`),JSON.stringify({date:new Date().toISOString(),candidate,engine,version,results},null,2)+'\n');
      console.log(`${record.status} ${engine} ${name}${record.error?'\n'+record.error:''}`);
      await context.close();
    }
    await browser.close();
  }
} finally {await server.close();}
if(failed)process.exitCode=1;
