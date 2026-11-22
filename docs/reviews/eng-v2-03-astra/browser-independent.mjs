import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const root = process.cwd(), out = path.resolve('docs/reviews/eng-v2-03-astra');
const common = path.resolve(execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim());
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(common, 'eng-v2-02b-release/browsers');
const pw = createRequire(import.meta.url)(path.join(common, 'eng-v2-02b-release/tools/node_modules/playwright'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const roots = { candidate: path.resolve('site-dist'), baseline: path.join(out, 'runtime/baseline/dist') };
const servers = {}, urls = {};
for (const [name, dir] of Object.entries(roots)) {
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith('/eng-trainer/')) { response.writeHead(404).end(); return; }
    let file = path.resolve(dir, '.' + decodeURIComponent(url.pathname.slice('/eng-trainer'.length)));
    if (!file.startsWith(dir + path.sep) && file !== dir) { response.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  servers[name] = server;
  urls[name] = `http://127.0.0.1:${server.address().port}/eng-trainer/`;
}
const report = { syntheticProfiles: true, speech: 'Invocation only; no audible speech', engines: {} };
const only = new Set(process.argv.slice(2));
const outputName = only.size ? 'browser-additional' : 'browser-independent';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = async locator => (await locator.textContent()).replace(/\s+/g, ' ').trim();
async function ready(page) { await page.locator('.app-shell').waitFor(); await page.evaluate(() => document.fonts.ready); }
async function go(page, route) { await page.evaluate(route => { location.hash = route; }, route); await page.waitForFunction(route => document.querySelector('main h1') && location.hash === '#' + route, route); await pause(80); }
async function stores(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('eng-trainer-v2');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result, result = {}, names = [...db.objectStoreNames];
      if (!names.length) { db.close(); resolve(result); return; }
      const tx = db.transaction(names);
      for (const name of names) { const s = tx.objectStore(name), keys = s.getAllKeys(), values = s.getAll(); values.onsuccess = () => { result[name] = Object.fromEntries(keys.result.map((k,i) => [k,values.result[i]])); }; }
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = () => reject(tx.error);
    };
  }));
}
async function seed(page, records) {
  await page.evaluate(records => new Promise((resolve, reject) => {
    const req = indexedDB.open('eng-trainer-v2');
    req.onsuccess = () => { const db = req.result, tx = db.transaction(Object.keys(records), 'readwrite'); for (const [name, entries] of Object.entries(records)) for (const [key, value] of Object.entries(entries)) tx.objectStore(name).put(value, key); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
  }), records);
}
async function home(page) {
  await go(page, 'index');
  return page.evaluate(() => ({ vocabulary: document.querySelector('.home-meter__value').textContent.replace(/\s+/g,' ').trim(), stats: Object.fromEntries([...document.querySelectorAll('.home-stat')].map(el => [el.querySelector('dt').textContent, el.querySelector('dd').textContent])), topicCards: [...document.querySelectorAll('.topic-card')].map(el => ({ title: el.querySelector('.topic-card__title').textContent, counts: el.querySelector('.topic-card__meta').textContent })) }));
}
function expectHome(value, learned, available, completed) {
  assert.match(value.vocabulary, new RegExp(`^${learned} / ${available}`));
  assert.equal(value.stats['Topics'], '34');
  assert.equal(value.stats['Topics completed'], `${completed} / 34`);
}
async function upload(page, data) {
  await page.locator('input[type=file]').setInputFiles({ name: 'independent-synthetic.json', mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)) });
  await page.locator('.review__title').waitFor();
}
async function importOne(page, data) { await go(page,'collections'); await upload(page,data); await page.getByRole('button',{ name:'Import 1 entry',exact:true }).click(); await page.getByText('Import complete',{exact:true}).waitFor(); }
async function shot(page, engine, name) { await page.screenshot({ path: path.join(out, `${engine}-${name}.png`) }); }

const cid = 'user:11111111-1111-4111-8111-111111111111';
const eid = `${cid}:entry:11111111-1111-4111-8111-111111111112`;
const synthetic = { format:'eng-trainer-vocabulary',version:1,collection:{id:cid,name:'Independent Conditionals',description:'Synthetic reviewer data'},entries:[{id:eid,kind:'word',english:'Review independent conditional',translation:'Незалежне умовне речення',topic:'Conditionals',examples:[]}] };

for (const engine of ['chromium','firefox']) {
  const browser = await pw[engine].launch({ headless:true });
  const scenarios = [];
  report.engines[engine] = { version: browser.version(), scenarios };
  async function scenario(name, run, version = 'candidate') {
    if (only.size && !only.has(name)) return;
    const context = await browser.newContext({viewport:{width:390,height:844}, reducedMotion:'reduce',acceptDownloads:true});
    await context.route(url => !Object.values(urls).some(base => url.href.startsWith(base)), route => route.abort());
    await context.addInitScript(() => {
      window.__writes = []; window.__spoken = []; window.__errors = []; window.__fail = null;
      for (const method of ['put','add','delete','clear']) {
        const original = IDBObjectStore.prototype[method];
        IDBObjectStore.prototype[method] = function (...args) {
          window.__writes.push({type:method,store:this.name,key:String(method === 'put' || method === 'add' ? args[1] : args[0])});
          if (window.__fail?.store === this.name && window.__fail?.method === method) throw new DOMException('Deliberate reviewer transaction failure','QuotaExceededError');
          return original.apply(this,args);
        };
      }
      const originalTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) { if (args[1] === 'readwrite') window.__writes.push({type:'transaction',stores:args[0]}); return originalTransaction.apply(this,args); };
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (...args) { window.__writes.push({type:'storage.setItem',key:args[0]}); return originalSet.apply(this,args); };
      window.addEventListener('unhandledrejection',e => window.__errors.push(String(e.reason?.stack ?? e.reason)));
      Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices(){return[];},speak(u){window.__spoken.push({text:u.text,lang:u.lang});setTimeout(()=>u.onend?.(),1);},cancel(){},pause(){},resume(){},addEventListener(){},removeEventListener(){}}});
      if (!window.SpeechSynthesisUtterance) window.SpeechSynthesisUtterance = class { constructor(text){this.text=text;} };
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Reviewer prohibits clipboard use');}}});
    });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror',e=>errors.push(e.stack ?? String(e)));
    const result = {name,version,pass:false,errors};
    scenarios.push(result);
    try { await page.goto(urls[version]+'#index'); await ready(page); await run(page,result,context); assert.equal(errors.length,0,'unexpected browser errors'); result.pass=true; }
    catch (error) { result.failure=String(error.stack ?? error).replaceAll(root,'<worktree>'); await shot(page,engine,name+'-failure').catch(()=>{}); }
    finally { await context.close(); fs.writeFileSync(path.join(out,outputName+'.json'),JSON.stringify(report,null,2)+'\n'); console.log(engine,name,result.pass?'PASS':result.failure); }
  }

  await scenario('same-name-topic-and-persistence',async(page,result)=>{
    await go(page,'topic/conditionals');
    for (let i=0;i<18;i++) await page.locator('.phrase-card').nth(i).getByRole('button',{name:'Mark as learned',exact:true}).click();
    const initial=await home(page); expectHome(initial,18,638,1);
    await go(page,'collections'); await upload(page,synthetic);
    await page.getByRole('button',{name:'Cancel import',exact:true}).click();
    expectHome(await home(page),18,638,1);
    await go(page,'collections'); await upload(page,synthetic);
    await page.evaluate(()=>{window.__fail={store:'userEntries',method:'put'};});
    await page.getByRole('button',{name:'Import 1 entry',exact:true}).click();
    await page.getByText(/The import was not saved:/).waitFor();
    await page.evaluate(()=>{window.__fail=null;});
    expectHome(await home(page),18,638,1);
    await importOne(page,synthetic);
    const imported=await home(page); expectHome(imported,18,639,0);
    assert.equal(imported.topicCards[0].counts,'18 of 19 practice cards learned');
    await shot(page,engine,'same-name-home');
    await go(page,'topic/conditionals');
    assert.equal(await text(page.locator('.list-header__count')),'18 practice phrases');
    assert.equal(await page.locator('.phrase-card.learned').count(),18);
    await shot(page,engine,'same-name-authored-topic');
    const deckChecks=[];
    for (const selected of ['', 'built-in', cid]) {
      await go(page,'wordIndex'); await page.getByLabel('Collection',{exact:true}).selectOption(selected);
      await go(page,'topic/conditionals'); const savedBefore=(await stores(page)).flashcardSessions;
      await page.getByRole('button',{name:'Practice this topic',exact:true}).click();
      await page.waitForFunction(()=>location.hash==='#flashcards'); await pause(80);
      const current=await page.getByLabel('Collection',{exact:true}).inputValue();
      assert.equal(current,selected==='built-in'?'built-in':'');
      assert.equal(await page.getByLabel('Topic',{exact:true}).inputValue(),'Conditionals');
      const progress=await text(page.locator('.flashcards-progress__stats'));
      assert.match(progress,/18 learned/);
      assert.match(progress,selected==='built-in'?/0 remaining/:/1 remaining/);
      assert.deepEqual((await stores(page)).flashcardSessions,savedBefore);
      expectHome(await home(page),18,639,0);
      deckChecks.push({selected,current,progress,savedDecksUnchanged:true});
    }
    await go(page,'wordIndex'); await page.getByLabel('Collection',{exact:true}).selectOption(cid);
    await page.getByRole('button',{name:'Hide item',exact:true}).click();
    expectHome(await home(page),18,639,0);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await go(page,'topic/conditionals'); await page.getByRole('button',{name:'Practice this topic',exact:true}).click();
    await page.getByRole('button',{name:'I know it',exact:true}).click();
    await pause(100); expectHome(await home(page),19,639,1);
    await go(page,'wordIndex'); await page.getByLabel('Collection',{exact:true}).selectOption(cid);
    await page.getByRole('button',{name:'Add to Focus List',exact:true}).click();
    await go(page,'irregularVerbs'); await page.locator('.entry').first().getByRole('button',{name:'Add to Focus List',exact:true}).click();
    assert.equal((await home(page)).stats['In Focus'],'2');
    await go(page,'collections');
    const downloadPromise=page.waitForEvent('download');
    await page.getByRole('button',{name:'Export JSON: Independent Conditionals',exact:true}).click();
    const download=await downloadPromise, exportPath=path.join(out,`${engine}-synthetic-export.json`);
    await download.saveAs(exportPath); const exported=fs.readFileSync(exportPath,'utf8');
    await page.getByRole('button',{name:'Remove Independent Conditionals',exact:true}).click();
    await page.locator('dialog[open]').getByRole('button',{name:'Cancel',exact:true}).click();
    expectHome(await home(page),19,639,1);
    await go(page,'collections');
    await page.getByRole('button',{name:'Remove Independent Conditionals',exact:true}).click();
    await page.evaluate(()=>{window.__fail={store:'userEntries',method:'delete'};});
    await page.locator('dialog[open]').getByRole('button',{name:'Remove collection',exact:true}).click();
    await page.getByText(/The removal was not saved:/).waitFor();
    await page.evaluate(()=>{window.__fail=null;});
    expectHome(await home(page),19,639,1);
    await go(page,'collections'); await page.getByRole('button',{name:'Remove Independent Conditionals',exact:true}).click();
    await page.locator('dialog[open]').getByRole('button',{name:'Remove collection',exact:true}).click();
    await page.locator('.collection-card').waitFor({state:'detached'});
    const removed=await home(page); expectHome(removed,18,638,1); assert.equal(removed.stats['In Focus'],'1');
    const retained=(await stores(page)).progress; assert.ok(retained.learnedPhrases.includes(eid)); assert.ok(retained.favoriteWords.includes(eid));
    await importOne(page,exported);
    const restored=await home(page); expectHome(restored,19,639,1); assert.equal(restored.stats['In Focus'],'2');
    await page.reload(); await ready(page); expectHome(await home(page),19,639,1);
    // Observe operations after all fixture/navigation writes have settled, not just database equality.
    await pause(150); await page.evaluate(()=>{window.__writes=[];});
    await page.getByText('View details',{exact:true}).click(); await page.getByText('View details',{exact:true}).click(); await pause(100);
    const detailsWrites=await page.evaluate(()=>window.__writes); assert.deepEqual(detailsWrites,[]);
    await go(page,'patterns'); await pause(100); await page.evaluate(()=>{window.__writes=[];}); await go(page,'index'); await pause(100);
    const renderWrites=await page.evaluate(()=>window.__writes);
    assert.ok(renderWrites.filter(w=>w.type!=='transaction').every(w=>w.type==='put'&&w.store==='settings'&&w.key==='activePage'));
    result.data={initial,imported,removed,restored,deckChecks,detailsWrites,renderWrites,retainedLearnedAndFavorite:true};
  });

  await scenario('routing-chips-language-and-rows',async(page,result)=>{
    await page.goto(urls.candidate+'#topic/small-talk'); await ready(page);
    const chips=page.locator('.chip-row button'), keyboard=[];
    await chips.first().focus();
    for(let i=0;i<7;i++) {
      if(i) await page.keyboard.press('Tab');
      await pause(200);
      const facts=await page.evaluate(()=>{const e=document.activeElement,r=e.getBoundingClientRect(),bar=document.querySelector('.tab-bar').getBoundingClientRect();return{text:e.textContent,visible:e.matches(':focus-visible'),left:r.left,right:r.right,bottom:r.bottom,limit:bar.top,width:innerWidth,outline:getComputedStyle(e).outlineStyle};});
      keyboard.push(facts);result.keyboard=keyboard;
      assert.ok(facts.visible); assert.ok(facts.bottom<=facts.limit);
      if(facts.left<0||facts.right>facts.width+1)await shot(page,engine,`chip-${i}-partly-visible`);
    }
    await page.keyboard.press('Enter'); assert.equal(await page.locator('.phrase-card').count(),6);
    await page.getByLabel('Search Small Talk phrases',{exact:true}).fill('have you'); assert.equal(await page.locator('.phrase-card').count(),2);
    const before=(await stores(page)).progress;
    await go(page,'index'); await go(page,'topic/small-talk'); assert.equal(await page.locator('.phrase-card').count(),2); assert.deepEqual((await stores(page)).progress,before);
    await page.reload();await ready(page);assert.equal(await page.locator('.phrase-card').count(),36);
    await page.getByRole('button',{name:'Traveling',exact:true}).click();
    const row=page.locator('.phrase-card').last();
    await row.getByRole('button',{name:'Mark as learned',exact:true}).click(); await row.getByRole('button',{name:'Add to Focus List',exact:true}).click();
    await row.getByRole('button',{name:'Hide item',exact:true}).click(); assert.equal(await page.locator('.phrase-card').count(),5);
    await page.getByRole('button',{name:'Undo',exact:true}).click(); assert.equal(await page.locator('.phrase-card.learned').count(),1);
    await go(page,'favorites'); assert.equal(await page.locator('.phrase-card.learned').count(),1);
    await go(page,'phrases');await page.getByLabel('Search phrases',{exact:true}).fill('I hope you enjoy the rest of your trip.');assert.equal(await page.locator('.phrase-card.learned').count(),1);
    await go(page,'topic/small-talk'); await page.getByRole('button',{name:'Practice this topic',exact:true}).click(); assert.match(await text(page.locator('.flashcards-progress__stats')),/1 learned/);
    await page.goBack(); await page.waitForURL(/#topic\/small-talk$/); await page.goForward(); await page.waitForURL(/#flashcards$/);
    for(const route of ['topic/missing','topic/','topic/%ZZ','topic/conditionals/extra']) {await go(page,route);assert.equal(await text(page.locator('main h1')),'Home');}
    await go(page,'topic/interview-english');
    const language=await page.locator('.topic-question__english,.reading-card__english,.entry__term,.reading-card__translation,.entry__translation').evaluateAll(els=>els.map(e=>({text:e.textContent,lang:e.getAttribute('lang'),translate:e.getAttribute('translate')})));
    assert.ok(language.every(e=>/[Ѐ-ӿ]/.test(e.text)?e.lang==='uk':e.lang==='en'&&e.translate==='no'));
    assert.equal(await page.getByText('Fictional practice example',{exact:true}).count(),1);
    assert.equal(await page.getByText('Hypothetical server-backed application',{exact:true}).count(),1);
    await page.getByRole('button',{name:'Listen to the model answer',exact:true}).last().click();
    assert.ok((await page.evaluate(()=>window.__spoken)).some(s=>s.text.startsWith('In a practice project')&&s.lang==='en-US'));
    await go(page,'answers'); assert.equal(await page.getByText('Fictional practice example',{exact:true}).count(),1);assert.equal(await page.getByText('Hypothetical server-backed application',{exact:true}).count(),1);
    await page.getByRole('button',{name:'Listen to the answer',exact:true}).first().click();
    await go(page,'patterns'); await page.getByRole('button',{name:'Listen to example',exact:true}).first().click();
    const oldLanguage=await page.locator('.reading-card__formula,.reading-card__english').evaluateAll(els=>els.map(e=>({lang:e.getAttribute('lang'),translate:e.getAttribute('translate')})));
    assert.ok(oldLanguage.every(e=>e.lang==='en'&&e.translate==='no'));
    result.data={keyboard,languageSamples:language.length,sharedComponentsListening:await page.evaluate(()=>window.__spoken),samePhraseIdentity:true};
  });

  await scenario('malformed-pack-retry-and-loading',async(page,result,context)=>{
    await seed(page,{progress:{learnedPhrases:['conditionals-zero-01'],favoritePhrases:['small-talk-travel-06']}});
    const before=await stores(page); let blocked=true;
    await context.route('**/data/packs/interview-english.*.json',async route=>{
      const response=await route.fetch(),data=await response.json();
      if(blocked) data.content.topics[0].sections[0].answerId='conditionals-zero-01';
      await pause(200);await route.fulfill({response,json:data});
    });
    await page.reload();await page.locator('.startup-shell').waitFor();assert.equal(await page.locator('.app-header').count(),1);assert.equal(await page.locator('.home-meter').count(),0);
    await page.locator('.error-card').waitFor();assert.equal(await page.locator('.app-shell').count(),0);assert.deepEqual(await stores(page),before);
    await page.evaluate(()=>{window.__writes=[];});await shot(page,engine,'malformed-startup');
    blocked=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await ready(page);assert.deepEqual(await stores(page),before);
    assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
    result.data={noPartialCatalog:true,noLearningWrites:true,recovery:true};
  });

  await scenario('learn-pass-filter-independence',async(page,result)=>{
    const stamp='2026-11-22T00:00:00.000Z';
    await seed(page,{learnPasses:{'review-pass':{id:'review-pass',name:'Review pass',blockIds:['topic-small-talk'],createdAt:stamp,updatedAt:stamp}},progress:{selectedLearnPassId:'review-pass',learnedPhrases:['phrase-001','conditionals-zero-01']},settings:{activePage:'index',showLearnedPhrases:false,phraseCategory:'Conditionals',phrasePageSize:5,flashcardMode:'topic',flashcardTopic:'Conditionals'}});
    await page.reload();await ready(page);const limited=await home(page);expectHome(limited,2,638,0);assert.equal(limited.topicCards.length,1);assert.equal(limited.topicCards[0].title,'Small Talk');
    await go(page,'topic/conditionals');assert.equal(await text(page.locator('main h1')),'Home');
    await go(page,'topic/small-talk');await page.getByRole('button',{name:'Traveling',exact:true}).click();await page.getByLabel('Search Small Talk phrases',{exact:true}).fill('have');
    assert.deepEqual(await home(page),limited);
    await go(page,'phrases');await page.getByLabel('Search phrases',{exact:true}).fill('impossible reviewer search');assert.deepEqual(await home(page),limited);
    result.data={limited,filtersDoNotChangeTotals:true};
  });

  await scenario('learn-again-reset-reload',async(page,result)=>{
    await go(page,'topic/conditionals');
    let row=page.locator('.phrase-card').first();
    await row.getByRole('button',{name:'Mark as learned',exact:true}).click();
    expectHome(await home(page),1,638,0);
    await go(page,'topic/conditionals');await page.getByRole('button',{name:'Practice this topic',exact:true}).click();
    await page.getByRole('button',{name:'Review learned vocabulary (1)',exact:true}).click();
    await page.getByRole('button',{name:'Learn again',exact:true}).click();
    expectHome(await home(page),0,638,0);
    await page.getByRole('button',{name:'Undo',exact:true}).click();expectHome(await home(page),1,638,0);
    await page.reload();await ready(page);expectHome(await home(page),1,638,0);
    await go(page,'topic/conditionals');row=page.locator('.phrase-card').first();await row.getByRole('button',{name:'Hide item',exact:true}).click();
    expectHome(await home(page),0,638,0);
    await page.getByRole('button',{name:'Undo',exact:true}).click();expectHome(await home(page),1,638,0);
    await go(page,'settings');await page.getByRole('button',{name:'Reset learning progress…',exact:true}).click();
    await page.locator('dialog[open]').getByRole('button',{name:'Reset progress',exact:true}).click();
    assert.equal(await text(page.locator('main h1')),'Settings');
    expectHome(await home(page),0,638,0);await page.reload();await ready(page);expectHome(await home(page),0,638,0);
    result.data={learnAgainUndo:true,hideLearnedUndo:true,reload:true,resetDoesNotUnmountSettings:true,resetReload:true};
  });

  await scenario('chip-focus-reflow',async(page,result)=>{
    const measurements=[];
    for(const [width,font] of [[390,16],[320,16],[390,32]]) {
      await page.setViewportSize({width,height:844});await page.goto(urls.candidate+'#topic/small-talk');await ready(page);
      if(font===32)await page.addStyleTag({content:'html { font-size: 32px !important; }'});
      const chips=page.locator('.chip-row button');await chips.first().focus();
      for(let i=0;i<7;i++) {
        if(i)await page.keyboard.press('Tab');await pause(250);
        const facts=await page.evaluate(()=>{const e=document.activeElement,r=e.getBoundingClientRect(),p=e.parentElement;return{text:e.textContent,tag:e.tagName,left:r.left,right:r.right,width:innerWidth,scrollLeft:p.scrollLeft,scrollerClient:p.clientWidth,scrollerWidth:p.scrollWidth,focused:e.matches(':focus-visible'),pageOverflow:document.documentElement.scrollWidth-innerWidth};});
        assert.equal(facts.tag,'BUTTON');assert.equal(facts.pageOverflow,0);assert.ok(facts.focused);
        await page.keyboard.press('Enter');await pause(50);assert.equal(await chips.nth(i).getAttribute('aria-pressed'),'true');
        measurements.push({viewport:width,font,...facts,selected:true,fullyVisible:facts.left>=0&&facts.right<=width});
        if(width===390&&font===16&&i===2) {
          await shot(page,engine,'chip-focused-selected-clipped');
          await page.keyboard.press('ArrowRight');await pause(500);
          result.arrowKeyRecovery=await chips.nth(i).evaluate(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,scrollLeft:e.parentElement.scrollLeft}));
          // Reestablish the natural next-tab sequence after recording arrow-key recovery.
          await page.goto(urls.candidate+'#topic/small-talk');await ready(page);await page.locator('.chip-row button').first().focus();await page.keyboard.press('Tab');await page.keyboard.press('Tab');
        }
      }
    }
    result.data={measurements,clippedAtOrdinary390:measurements.filter(m=>m.viewport===390&&m.font===16&&!m.fullyVisible),allChipsKeyboardActivatable:true};
  });

  for(const version of ['baseline','candidate']) await scenario(`ordinary-dialog-paths-${version}`,async(page,result)=>{
    const outcomes=[];
    for(const action of ['confirm','cancel','escape']) for(const navigation of ['home','history']) {
      await go(page,'index');await go(page,'settings');await page.getByRole('button',{name:'Reset learning progress…',exact:true}).click();
      if(action==='escape')await page.keyboard.press('Escape');else await page.locator('dialog[open]').getByRole('button',{name:action==='confirm'?'Reset progress':'Cancel',exact:true}).click();
      if(navigation==='home')await page.locator('.tab-bar a[href="#index"]').click();else await page.goBack();
      await page.waitForFunction(()=>document.querySelector('main h1')?.textContent==='Home');
      outcomes.push({action,navigation,errors:await page.evaluate(()=>window.__errors)});
    }
    result.data={outcomes};
  },version);
  await browser.close();
}
for(const server of Object.values(servers))server.close();
report.pass=Object.values(report.engines).every(e=>e.scenarios.every(s=>s.pass));
fs.writeFileSync(path.join(out,outputName+'.json'),JSON.stringify(report,null,2)+'\n');
process.exitCode=report.pass?0:1;
