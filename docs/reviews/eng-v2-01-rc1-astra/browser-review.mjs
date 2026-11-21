// Run: node browser-review.mjs <complete-candidate> <playwright-tools-directory> <evidence-directory>
// PLAYWRIGHT_BROWSERS_PATH points at disposable browser binaries.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { serveArtifact, instrumentBrowser, seedDatabase, readDatabase, settle } from './browser-support.mjs';

const [candidateArg, toolsArg, evidenceArg] = process.argv.slice(2);
const candidate=resolve(candidateArg), evidence=resolve(evidenceArg);
const { chromium, firefox } = await import(pathToFileURL(join(resolve(toolsArg),'node_modules/playwright/index.mjs')));
const artifact=join(candidate,'site-dist');
const materials=JSON.parse(readFileSync(join(artifact,'data/materials.json'),'utf8'));
const server=await serveArtifact(artifact);
const base=server.origin+'/eng-trainer/';
const legacyKey='englishAssessmentTrainer.svelteState.v1';
const legacyTheme='englishAssessmentTrainer.theme.v1';
mkdirSync(evidence,{recursive:true});
const walk=(dir,prefix='')=>readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(join(dir,x.name),prefix+x.name+'/'):[prefix+x.name]);
const artifactFiles=walk(artifact);
assert(artifactFiles.every(p=>!/(^|\/)(src|node_modules|\.git|\.github|docs)\//.test(p)));
writeFileSync(join(evidence,'artifact.json'),JSON.stringify(artifactFiles.map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(artifact,path))).digest('hex')})),null,2));
const pages={index:'Index',phrases:'Phrases',wordIndex:'Words',flashcards:'Flashcards',reverse:'Reverse',irregularVerbs:'Verbs',patterns:'Patterns',answers:'Answers',practice:'Practice',favorites:'Focus'};
async function ready(page,url=base) { await page.goto(url,{waitUntil:'domcontentloaded'}); await page.locator('.app-shell').waitFor(); }
async function nav(page,name) { await page.locator('.desktop-nav').getByRole('button',{name:name==='favorites'?/^Focus(?:\s+\d+)?$/:pages[name],exact:true}).click(); await page.locator('.hero h1').filter({hasText:pages[name]}).waitFor(); }
const phrase=(page,text)=>page.locator('.phrase-card').filter({has:page.getByRole('heading',{name:text,exact:true})});
const capture=page=>page.evaluate(()=>({opens:window.__review.opens,transactions:window.__review.transactions,writes:window.__review.writes,storageCalls:window.__review.storageCalls,speech:window.__review.speech}));
const tests=[];
let failed=false;
function test(name,fn){tests.push({name,fn});}

test('artifact-paths-navigation-and-mobile-link',async ({page,context,record,engine})=>{
  for(const version of ['v2','v1']) {
    const appBase=version==='v2'?base:base+'v1/';
    const localRequests=[];
    const listener=r=>{if(r.url().startsWith(server.origin))localRequests.push(r.url());};
    page.on('request',listener);
    await ready(page,appBase);
    assert.equal(await page.locator('.app-footer a').count(),version==='v2'?1:0);
    const links=await page.locator('script[src],link[rel=stylesheet],link[rel=icon]').evaluateAll(els=>els.map(e=>e.src||e.href));
    for(const url of links.filter(u=>u.startsWith(server.origin))) {
      assert(url.startsWith(appBase));
      const response=await context.request.get(url);
      assert.equal(response.status(),200);
      const relative=url.slice(appBase.length),disk=join(artifact,version==='v1'?'v1':'',relative);
      assert.deepEqual(await response.body(),readFileSync(disk));
    }
    const content=await context.request.get(appBase+'data/materials.json');
    assert.equal(content.headers()['content-type'].split(';')[0],'application/json');
    assert.deepEqual(await content.json(),materials);
    for(const name of Object.keys(pages)) {
      await nav(page,name);
      await page.reload({waitUntil:'domcontentloaded'});
      await page.locator('.app-shell').waitFor();
      assert.equal(await page.locator('.hero h1').innerText(),pages[name]);
      if(version==='v2') assert.equal(await page.locator('.app-footer a').getAttribute('href'),'/eng-trainer/v1/');
    }
    assert(localRequests.every(u=>u.startsWith(appBase)),JSON.stringify(localRequests));
    record[version+'Requests']=[...new Set(localRequests)];
    page.off('request',listener);
  }
  assert.equal((await context.request.get(base+'missing-script.js')).status(),404);
  assert.equal((await context.request.get(base+'v1/not-a-route')).status(),404);
  await page.setViewportSize({width:390,height:844});
  await ready(page,base+'#phrases');
  const link=page.locator('.app-footer a');
  await link.scrollIntoViewIfNeeded();
  const visible=await link.evaluate(e=>{const r=e.getBoundingClientRect(), hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {rect:{top:r.top,bottom:r.bottom},unobscured:e===hit||e.contains(hit)};});
  assert(visible.unobscured,JSON.stringify(visible));
  await page.screenshot({path:join(evidence,engine+'-mobile-link.png')});
  await link.click(); await page.locator('.app-shell').waitFor();
  assert.equal(new URL(page.url()).pathname,'/eng-trainer/v1/');
  record.mobileLink=visible;
});

test('fresh-database-legacy-isolation-and-cross-version-reset',async ({page,record})=>{
  await page.goto(server.origin+'/_review/blank');
  const legacy={[legacyKey]:JSON.stringify({learnedPhrases:['phrase-001'],favoritePhrases:['phrase-001'],hiddenPhrases:['phrase-002'],phraseCategory:'All',activePage:'phrases'}),[legacyTheme]:'dark','unrelated.review':'keep'};
  await page.evaluate(data=>window.__review.seedLegacy(data),legacy);
  await ready(page,base+'#phrases');
  const first=phrase(page,materials.phrases[0].phrase);
  assert.equal(await first.getByRole('button',{name:'Mark as learned',exact:true}).count(),1);
  await first.getByRole('button',{name:'Mark as learned',exact:true}).click();
  await first.getByRole('button',{name:'Add to Focus List',exact:true}).click();
  await page.locator('.theme-toggle').click();
  await settle(page);
  assert.deepEqual(await page.evaluate(()=>window.__review.legacySnapshot()),legacy);
  assert.deepEqual((await capture(page)).storageCalls,[]);
  const beforeV1=await readDatabase(page);
  await ready(page,base+'v1/#phrases');
  assert.equal(await phrase(page,materials.phrases[0].phrase).getByRole('button',{name:'Mark as not learned',exact:true}).count(),1);
  assert.equal(await page.locator('html').getAttribute('data-theme-preference'),'dark');
  await nav(page,'index'); await page.getByRole('button',{name:'Reset progress',exact:true}).click();
  assert.deepEqual(await readDatabase(page),beforeV1);
  const afterV1=await page.evaluate(()=>window.__review.legacySnapshot());
  assert.equal(afterV1['unrelated.review'],'keep');
  await ready(page,base+'#index');
  await page.getByRole('button',{name:'Reset progress',exact:true}).click(); await settle(page);
  const reset=await readDatabase(page);
  assert.deepEqual(reset.progress.learnedPhrases,[]);
  assert.deepEqual(reset.progress.favoritePhrases,[]);
  assert.deepEqual(await page.evaluate(()=>window.__review.legacySnapshot()),afterV1);
  assert.deepEqual((await capture(page)).storageCalls,[]);
  record.databases=await page.evaluate(()=>indexedDB.databases());
  record.serviceWorkers=await page.evaluate(async()=>navigator.serviceWorker?(await navigator.serviceWorker.getRegistrations()).map(r=>r.scope):[]);
  record.caches=await page.evaluate(()=>caches.keys());
  assert.equal(record.serviceWorkers.length,0); assert.equal(record.caches.length,0);
  record.reset=reset;
});

test('restore-all-persistent-records-before-effects',async({page,record})=>{
  await page.goto(server.origin+'/_review/blank');
  const settings={theme:'dark',speechRepeatCount:50,activePage:'phrases',phraseCategory:'Start answer',wordCategory:'AI Certification Vocabulary',irregularSet:'ai-certification-verbs-contextual',irregularGroup:'Knowledge, data & security',indexTagFilter:'assessment',showHiddenPhrases:true,showHiddenWords:true,showHiddenIrregular:true,indexPageSize:12,phrasePageSize:10,wordPageSize:20,irregularPageSize:10,indexLearnPassExpanded:false,indexLearningBlocksExpanded:false,indexTagCloudExpanded:false,indexDailyExpanded:false,flashcardMode:'topic',flashcardTopic:'Start answer'};
  const records={settings,progress:{learnedPhrases:['phrase-001'],hiddenPhrases:['phrase-002'],hiddenWords:['word-phrase-003'],hiddenIrregular:['iv-001-be'],favoriteBlocks:['word-index'],favoritePhrases:['phrase-001'],favoriteWords:['word-phrase-004'],favoriteIrregular:['iv-002-have'],selectedLearnPassId:'review-pass'},learnPasses:{'review-pass':{id:'review-pass',name:'Synthetic review pass',description:'review only',blockIds:materials.blocks.map(x=>x.id),createdAt:'2026-01-01',updatedAt:'2026-01-01'}},flashcardSessions:{'topic:Start answer':{order:['phrase-004','phrase-005','phrase-003','phrase-006'],index:1}}};
  await seedDatabase(page,records);
  await ready(page); await settle(page);
  assert.deepEqual(await readDatabase(page),records);
  assert.equal((await capture(page)).writes.length,0,'Startup wrote over saved state');
  assert.equal(await page.locator('.hero h1').innerText(),'Phrases');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert.equal(await page.getByRole('combobox',{name:/^Category\b/}).inputValue(),'Start answer');
  assert.equal(await page.getByRole('combobox',{name:/^Repeats\b/}).inputValue(),'50');
  assert.equal(await page.getByRole('combobox',{name:/^Show\b/}).inputValue(),'10');
  assert.equal(await phrase(page,materials.phrases[0].phrase).getByRole('button',{name:'Mark as not learned',exact:true}).count(),1);
  assert.equal(await phrase(page,materials.phrases[1].phrase).getByRole('button',{name:'Show item',exact:true}).count(),1);
  await nav(page,'wordIndex'); assert.equal(await page.getByRole('combobox',{name:/^Category\b/}).inputValue(),settings.wordCategory); assert.equal(await page.getByRole('combobox',{name:/^Show\b/}).inputValue(),'20');
  await nav(page,'irregularVerbs'); assert.equal(await page.getByRole('combobox',{name:/^Set\b/}).inputValue(),settings.irregularSet); assert.equal(await page.getByRole('combobox',{name:/^Group\b/}).inputValue(),settings.irregularGroup);
  await nav(page,'flashcards'); assert.equal(await page.getByRole('combobox',{name:/^Topic\b/}).inputValue(),'Start answer'); assert.match(await page.locator('.flashcard__term').innerText(),/From my perspective/);
  await nav(page,'favorites'); assert.equal(await page.locator('.phrase-card').count(),1); assert.equal(await page.locator('.word-card').count(),1);
  await nav(page,'index'); assert.equal(await page.locator('[aria-expanded="false"]').count(),4);
  record.initial=records; record.afterNavigation=await readDatabase(page);
});

test('search-entire-corpus-and-transient-state',async({page,record})=>{
  await ready(page,base+'#phrases');
  const examples=[materials.phrases[0],materials.phrases[200],materials.phrases.at(-1)];
  for(const item of examples) { await page.getByLabel('Search',{exact:true}).fill(item.phrase); await phrase(page,item.phrase).waitFor(); }
  await page.getByLabel('Search',{exact:true}).fill('окупність інвестицій'); await phrase(page,materials.phrases[200].phrase).waitFor();
  await page.getByLabel('Search',{exact:true}).fill('');
  await page.getByRole('combobox',{name:/^Category\b/}).selectOption('AI Certification Vocabulary');
  await page.getByRole('combobox',{name:/^Show\b/}).selectOption('10');
  await page.getByRole('button',{name:'Next page',exact:true}).click();
  assert.match(await page.locator('.pagination-control__status').innerText(),/^11-20/);
  await page.getByLabel('Search',{exact:true}).fill('security'); await settle(page);
  await page.reload(); await page.locator('.app-shell').waitFor();
  assert.equal(await page.getByLabel('Search',{exact:true}).inputValue(),'');
  assert.equal(await page.getByRole('combobox',{name:/^Category\b/}).inputValue(),'AI Certification Vocabulary');
  assert.match(await page.locator('.pagination-control__status').innerText(),/^1-10/);
  await nav(page,'wordIndex');
  for(const item of [materials.wordIndex[0],materials.wordIndex[200],materials.wordIndex.at(-1)]) { await page.getByLabel('Search',{exact:true}).fill(item.term); await page.locator('.word-card h3').filter({hasText:item.term}).waitFor(); }
  await nav(page,'irregularVerbs');
  const verbSamples=[materials.irregularVerbs[0],materials.irregularVerbs[130],materials.irregularVerbs.at(-1)];
  for(const item of verbSamples) { await page.getByRole('combobox',{name:/^Set\b/}).selectOption(item.verbSet); await page.getByLabel('Search',{exact:true}).fill(item.base); await page.locator('.verb-card').filter({hasText:item.base}).first().waitFor(); }
  await nav(page,'index'); await page.getByRole('button',{name:'Create new Learn Pass',exact:true}).click();
  await page.getByLabel('Search materials',{exact:true}).fill('ai-certification');
  assert.equal(await page.locator('.learn-pass-block').count(),2);
  await nav(page,'practice'); await page.getByRole('button',{name:'Generate random prompt',exact:true}).click();
  const prompt=await page.locator('.practice-card h3').innerText(); assert(materials.drills.includes(prompt));
  await settle(page); await page.reload(); await page.locator('.app-shell').waitFor();
  assert.match(await page.locator('.practice-card h3').innerText(),/Click/);
  Object.assign(record,{phraseSamples:examples.map(x=>x.id),verbSamples:verbSamples.map(x=>x.id),practicePromptBeforeReload:prompt});
});

test('rapid-updates-pending-navigation-and-reset',async({page,record})=>{
  await ready(page,base+'#phrases');
  await page.evaluate(()=>window.__review.holdUntil=performance.now()+15000);
  const first=phrase(page,materials.phrases[0].phrase);
  for(let i=0;i<7;i++) await first.getByRole('button',{name:i%2?'Mark as not learned':'Mark as learned',exact:true}).click();
  await first.getByRole('button',{name:'Add to Focus List',exact:true}).click();
  await page.getByRole('combobox',{name:/^Show\b/}).selectOption('10');
  await page.getByRole('combobox',{name:/^Repeats\b/}).selectOption('20');
  await page.locator('.theme-toggle').click(); await page.locator('.theme-toggle').click();
  record.pendingBeforeNavigation=await page.evaluate(()=>window.__review.activeWrites);assert(record.pendingBeforeNavigation>0);
  await nav(page,'wordIndex');
  await page.getByRole('combobox',{name:/^Category\b/}).selectOption('AI Certification Vocabulary');
  await page.evaluate(()=>window.__review.holdUntil=0);
  await settle(page);
  const saved=await readDatabase(page);
  assert.deepEqual(saved.progress.learnedPhrases,['phrase-001']);
  assert.deepEqual(saved.progress.favoritePhrases,['phrase-001']);
  assert.equal(saved.settings.phrasePageSize,10);assert.equal(saved.settings.speechRepeatCount,20);assert.equal(saved.settings.theme,'dark');assert.equal(saved.settings.wordCategory,'AI Certification Vocabulary');
  await page.reload(); await page.locator('.app-shell').waitFor(); assert.deepEqual(await readDatabase(page),saved);
  await nav(page,'phrases');
  await page.evaluate(()=>window.__review.holdUntil=performance.now()+15000);
  await first.getByRole('button',{name:'Mark as not learned',exact:true}).click();
  await first.getByRole('button',{name:'Mark as learned',exact:true}).click();
  await nav(page,'index');record.pendingBeforeReset=await page.evaluate(()=>window.__review.activeWrites);assert(record.pendingBeforeReset>0); await page.getByRole('button',{name:'Reset progress',exact:true}).click();await page.evaluate(()=>window.__review.holdUntil=0); await settle(page);
  const reset=await readDatabase(page);assert.deepEqual(reset.progress.learnedPhrases,[]);assert.deepEqual(reset.progress.favoritePhrases,[]);assert.equal(reset.settings.theme,'dark');
  await page.reload();await page.locator('.app-shell').waitFor(); assert.deepEqual(await readDatabase(page),reset);
  assert.deepEqual((await capture(page)).storageCalls,[]);record.saved=saved;record.reset=reset;
});

test('abort-after-request-success-later-edits-retry',async({page,record})=>{
  await ready(page,base+'#phrases');await settle(page);
  const initial=await readDatabase(page);
  await page.evaluate(()=>window.__review.failWrite=true);
  const first=phrase(page,materials.phrases[0].phrase);
  await first.getByRole('button',{name:'Mark as learned',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Your latest changes are not saved.'}).waitFor();
  assert.deepEqual(await readDatabase(page),initial);
  await first.getByRole('button',{name:'Mark as not learned',exact:true}).click();
  await first.getByRole('button',{name:'Add to Focus List',exact:true}).click();
  await page.getByRole('combobox',{name:/^Repeats\b/}).selectOption('50');
  await settle(page);await page.getByRole('alert').filter({hasText:'Your latest changes are not saved.'}).waitFor();
  assert.deepEqual(await readDatabase(page),initial);
  record.failedTransactions=(await capture(page)).transactions.filter(t=>t.outcome==='abort');
  assert(record.failedTransactions.some(t=>t.requestSuccessBeforeAbort));
  await page.evaluate(()=>window.__review.failWrite=false);
  await page.getByRole('button',{name:'Try saving again',exact:true}).click();await settle(page);
  assert.equal(await page.getByRole('alert').count(),0);
  const saved=await readDatabase(page); assert.deepEqual(saved.progress.learnedPhrases,[]);assert.deepEqual(saved.progress.favoritePhrases,['phrase-001']);assert.equal(saved.settings.speechRepeatCount,50);
  await page.reload();await page.locator('.app-shell').waitFor();assert.deepEqual(await readDatabase(page),saved);
  record.saved=saved;
});

test('failed-open-retry-and-unsaved-mode',async({page,context,record})=>{
  await page.goto(base);await page.getByRole('heading',{name:'Unable to open your saved progress',exact:true}).waitFor();
  assert.equal((await capture(page)).writes.length,0);
  await page.evaluate(()=>window.__review.failOpen=false);await page.getByRole('button',{name:'Try again',exact:true}).click();await page.locator('.app-shell').waitFor();
  await page.reload();await page.getByRole('button',{name:'Continue without saving',exact:true}).click();await page.locator('.app-shell').waitFor();
  await nav(page,'phrases');await phrase(page,materials.phrases[0].phrase).getByRole('button',{name:'Mark as learned',exact:true}).click();
  await page.locator('.theme-toggle').click();await nav(page,'index');await page.getByRole('button',{name:'Reset progress',exact:true}).click();
  assert.match(await page.getByRole('alert').innerText(),/Saving is off/);
  record.probe=await capture(page);assert.equal(record.probe.writes.length,0);assert.deepEqual(record.probe.storageCalls,[]);
});

test('failed-initial-read-preserves-populated-database',async({page,context,record})=>{
  await page.goto(server.origin+'/_review/blank');
  const saved={progress:{learnedPhrases:['phrase-001']},settings:{theme:'dark',activePage:'phrases'},learnPasses:{},flashcardSessions:{}};
  await seedDatabase(page,saved);
  await page.goto(base);await page.getByRole('heading',{name:'Unable to open your saved progress',exact:true}).waitFor();
  assert.equal((await capture(page)).writes.length,0);
  await page.evaluate(()=>window.__review.failRead=false);assert.deepEqual(await readDatabase(page),saved);
  await page.getByRole('button',{name:'Try again',exact:true}).click();await page.locator('.app-shell').waitFor();
  assert.equal(await phrase(page,materials.phrases[0].phrase).getByRole('button',{name:'Mark as not learned',exact:true}).count(),1);
  assert.deepEqual(await readDatabase(page),saved);record.saved=saved;
});

test('content-failure-retry',async({page,context})=>{
  await context.route('**/eng-trainer/data/materials.json',route=>route.fulfill({status:503,contentType:'text/plain',body:'ASTRA injected unavailable content'}));
  await page.goto(base);await page.getByRole('heading',{name:'Unable to start the app',exact:true}).waitFor();
  await context.unroute('**/eng-trainer/data/materials.json');await page.getByRole('button',{name:'Try again',exact:true}).click();await page.locator('.app-shell').waitFor();
});

test('learning-flows-and-native-speech-api',async({page,record})=>{
  page.on('dialog',d=>d.accept());
  await ready(page);
  await page.getByRole('button',{name:'Create new Learn Pass',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('ASTRA synthetic pass');
  await page.getByRole('button',{name:'Select visible materials',exact:true}).click();await page.getByRole('button',{name:'Save Learn Pass',exact:true}).click();await settle(page);
  const created=await readDatabase(page),passId=created.progress.selectedLearnPassId;assert(created.learnPasses[passId]);
  await page.getByRole('button',{name:'Edit selected Learn Pass',exact:true}).click();await page.getByLabel('Description',{exact:true}).fill('review edit');await page.getByRole('button',{name:'Save Learn Pass',exact:true}).click();await settle(page);
  await page.reload();await page.locator('.app-shell').waitFor();assert.equal((await readDatabase(page)).learnPasses[passId].description,'review edit');
  await page.getByRole('button',{name:'Delete ASTRA synthetic pass',exact:true}).click();await settle(page);assert.equal(Object.keys((await readDatabase(page)).learnPasses).length,0);
  await nav(page,'phrases');
  const first=phrase(page,materials.phrases[0].phrase);
  await first.getByRole('button',{name:'Add to Focus List',exact:true}).click();await first.getByRole('button',{name:'Mark as learned',exact:true}).click();
  await nav(page,'favorites');assert.equal(await phrase(page,materials.phrases[0].phrase).getByRole('button',{name:'Mark as not learned',exact:true}).count(),1);
  await nav(page,'flashcards');await page.getByRole('button',{name:'Review learned vocabulary',exact:true}).click();
  const reviewRow=page.locator('.flashcards-review li').filter({hasText:materials.phrases[0].phrase});await reviewRow.getByRole('button',{name:'Learn again',exact:true}).click();
  await page.getByRole('button',{name:'Back to flashcards',exact:true}).first().click();
  await page.getByRole('button',{name:'Flip card',exact:true}).click();assert.equal(await page.locator('.flashcard.flipped').count(),1);
  await page.keyboard.press('ArrowLeft');await settle(page);
  const deckBefore=(await readDatabase(page)).flashcardSessions.all;assert(deckBefore.index>0);
  await page.reload();await page.locator('.app-shell').waitFor();assert.deepEqual((await readDatabase(page)).flashcardSessions.all,deckBefore);
  const current=await page.locator('.flashcard__term').innerText();await page.getByRole('button',{name:/^I know it/}).click();
  await nav(page,'phrases');await settle(page);
  const currentId=materials.phrases.find(p=>p.phrase===current).id;assert((await readDatabase(page)).progress.learnedPhrases.includes(currentId));
  await first.getByRole('button',{name:'Hide item',exact:true}).click();assert.equal(await first.count(),0);
  await page.getByRole('button',{name:'Show hidden phrases',exact:true}).click();await first.getByRole('button',{name:'Show item',exact:true}).click();
  await first.getByRole('button',{name:'Speak',exact:true}).click();
  for(const repeats of ['10','20','50']) { await page.getByRole('combobox',{name:/^Repeats\b/}).selectOption(repeats);await page.getByRole('button',{name:'Read listen phrases',exact:true}).click();await page.getByRole('button',{name:'Stop reading',exact:true}).click(); }
  record.speech=(await capture(page)).speech;assert(record.speech.some(s=>s.type==='speak'&&s.text===materials.phrases[0].phrase));assert(record.speech.filter(s=>s.type==='cancel').length>=3);
  await nav(page,'reverse');await page.getByRole('button',{name:'Show answer',exact:true}).click();const answer=await page.locator('.answer-box strong').innerText();await page.getByLabel('Your answer',{exact:true}).fill(answer);await page.getByRole('button',{name:'Check answer',exact:true}).click();assert.match(await page.locator('.practice-card .notice').innerText(),/Good job/);await page.getByRole('button',{name:'Next random item',exact:true}).click();assert.equal(await page.getByLabel('Your answer',{exact:true}).inputValue(),'');
  await nav(page,'patterns');assert.equal(await page.locator('.cards-list article').count(),materials.patterns.length);
  await nav(page,'answers');assert.equal(await page.locator('.cards-list article').count(),materials.answers.length);
});

test('distinct-entry-identities-with-similar-display-text',async({page,context,record})=>{
  const fixture=structuredClone(materials);
  fixture.phrases=[{id:'review-cpp',category:'Languages',phrase:'C++',translation:'Language C++',example:'C++ templates'}, {id:'review-csharp',category:'Languages',phrase:'C#',translation:'Language C#',example:'C# records'}];
  fixture.wordIndex=[];
  fixture.blocks=[{id:'review-languages',title:'Languages',type:'phraseCategory',category:'Languages'}];
  await context.route('**/eng-trainer/data/materials.json',route=>route.fulfill({json:fixture}));
  await ready(page,base+'#phrases');assert.equal(await page.locator('.phrase-card').count(),2);
  await nav(page,'flashcards');record.cardText=await page.locator('.flashcard__term').innerText();record.cardCount=await page.getByRole('progressbar').getAttribute('aria-valuemax');
  // RC1: first observe two distinct IDs; completing only C++ cannot complete this deck.
  assert.equal(record.cardText,'C++');assert.equal(record.cardCount,'2');
  const counts=async()=>({learned:await page.getByRole('progressbar').getAttribute('aria-valuenow'),total:await page.getByRole('progressbar').getAttribute('aria-valuemax')});
  assert.deepEqual(await counts(),{learned:'0',total:'2'});
  await page.getByRole('button',{name:/^I know it/}).click();await page.locator('.flashcard__term').filter({hasText:/^C#$/}).waitFor();await settle(page);
  assert.equal(await page.getByRole('heading',{name:'Deck complete',exact:true}).count(),0);
  record.afterFirstCounts=await counts();assert.deepEqual(record.afterFirstCounts,{learned:'1',total:'2'});
  record.stored=await readDatabase(page);
  assert.deepEqual(record.stored.progress.learnedPhrases,['review-cpp'],'Learning C++ must not mark distinct C# learned');
  assert.deepEqual(record.stored.flashcardSessions.all.order,['review-csharp']);
  await page.reload();await page.locator('.app-shell').waitFor();await nav(page,'phrases');record.learnedCards=await page.locator('.phrase-card.learned h3').allTextContents();
  assert.deepEqual(record.learnedCards,['C++']);
  assert.equal(await phrase(page,'C#').getByRole('button',{name:'Mark as learned',exact:true}).count(),1);
  assert.equal(await phrase(page,'C++').getByRole('button',{name:'Mark as not learned',exact:true}).count(),1);
  await nav(page,'flashcards');assert.equal(await page.locator('.flashcard__term').innerText(),'C#');
  assert.deepEqual(await counts(),{learned:'1',total:'2'});
  await page.getByRole('button',{name:'Review learned vocabulary',exact:true}).click();
  record.firstReview=await page.locator('.flashcards-review__text strong').allTextContents();assert.deepEqual(record.firstReview,['C++']);
  await page.getByRole('button',{name:'Back to flashcards',exact:true}).first().click();
  await page.getByRole('button',{name:/^I know it/}).click();await page.getByRole('heading',{name:'Deck complete',exact:true}).waitFor();await settle(page);
  record.afterSecond=await readDatabase(page);assert.deepEqual(record.afterSecond.progress.learnedPhrases,['review-cpp','review-csharp']);
  assert.deepEqual(await counts(),{learned:'2',total:'2'});
  await page.reload();await page.locator('.app-shell').waitFor();
  await page.getByRole('heading',{name:'Deck complete',exact:true}).waitFor();
  assert.deepEqual(await counts(),{learned:'2',total:'2'});
  await nav(page,'phrases');record.bothLearnedAfterReload=await page.locator('.phrase-card.learned h3').allTextContents();
  assert.deepEqual(record.bothLearnedAfterReload,['C++','C#']);
  await nav(page,'flashcards');await page.getByRole('button',{name:'Review learned vocabulary',exact:true}).first().click();
  record.bothReviewedAfterReload=await page.locator('.flashcards-review__text strong').allTextContents();
  assert.deepEqual(record.bothReviewedAfterReload,['C++','C#']);
});

test('built-in-duplicate-entry-consistency',async({page,record})=>{
  await ready(page,base+'#phrases');
  await page.getByLabel('Search',{exact:true}).fill('consequently');
  const original=phrase(page,'consequently'), other=phrase(page,'Consequently, …');
  await original.getByRole('button',{name:'Mark as learned',exact:true}).click();
  await other.getByRole('button',{name:'Add to Focus List',exact:true}).click();
  await settle(page); await page.reload(); await page.locator('.app-shell').waitFor();
  await nav(page,'favorites');
  record.focusLearned=await other.getByRole('button',{name:'Mark as not learned',exact:true}).count();
  record.focusUnlearned=await other.getByRole('button',{name:'Mark as learned',exact:true}).count();
  assert.equal(record.focusUnlearned,1);
  await nav(page,'flashcards');await page.getByRole('button',{name:'By Topic',exact:true}).click();
  await page.getByRole('combobox',{name:/^Topic\b/}).selectOption('Advanced Linking Words');
  record.topicLearned=await page.getByRole('progressbar').getAttribute('aria-valuenow');
  await page.getByRole('button',{name:'Review learned vocabulary',exact:true}).click();
  record.reviewed=await page.locator('.flashcards-review__text').allTextContents();
  record.database=await readDatabase(page);
  assert.equal(record.topicLearned,'0','An entry still unlearned in Focus is counted learned in its flashcard topic');
});

test('missing-optional-records-do-not-write-defaults',async({page,record})=>{
  await page.goto(server.origin+'/_review/blank');
  const saved={progress:{learnedPhrases:['phrase-001']},settings:{theme:'dark'},learnPasses:{},flashcardSessions:{}};
  await seedDatabase(page,saved);await ready(page);await settle(page);
  assert.equal(await page.locator('.hero h1').innerText(),'Index');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert.deepEqual(await readDatabase(page),saved);
  assert.deepEqual((await capture(page)).writes,[]);record.saved=saved;
});

test('reset-after-failed-write-does-not-revive-progress',async({page,record})=>{
  await ready(page,base+'#phrases');await settle(page);
  await page.evaluate(()=>window.__review.failWrite=true);
  await phrase(page,materials.phrases[0].phrase).getByRole('button',{name:'Mark as learned',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'not saved'}).waitFor();
  await nav(page,'index');await page.getByRole('button',{name:'Reset progress',exact:true}).click();await settle(page);
  await page.evaluate(()=>window.__review.failWrite=false);
  await page.getByRole('button',{name:'Try saving again',exact:true}).click();await settle(page);
  const saved=await readDatabase(page);assert.deepEqual(saved.progress.learnedPhrases,[]);assert.equal(saved.settings.activePage,'index');
  await page.reload();await page.locator('.app-shell').waitFor();assert.deepEqual(await readDatabase(page),saved);record.saved=saved;
});

test('flashcard-swipe-shuffle-and-topic-reset',async({page,record})=>{
  page.on('dialog',d=>d.accept());
  await ready(page,base+'#flashcards');
  const first=await page.locator('.flashcard__term').innerText();
  const box=await page.locator('.flashcard__surface').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+180,box.y+box.height/2,{steps:8});await page.mouse.up();
  await page.waitForFunction(()=>window.__review.writes.some(w=>w.key==='learnedPhrases'));await settle(page);
  assert((await readDatabase(page)).progress.learnedPhrases.includes(materials.phrases.find(x=>x.phrase===first).id));
  await page.getByRole('button',{name:'Shuffle remaining cards',exact:true}).click();await settle(page);
  const shuffled=await readDatabase(page);await page.reload();await page.locator('.app-shell').waitFor();assert.deepEqual((await readDatabase(page)).flashcardSessions,shuffled.flashcardSessions);
  await page.getByRole('button',{name:'By Topic',exact:true}).click();await page.getByRole('combobox',{name:/^Topic\b/}).selectOption('Start answer');
  await page.getByRole('button',{name:'Reset progress for Start answer',exact:true}).click();await settle(page);
  const reset=await readDatabase(page);assert.deepEqual(reset.progress.learnedPhrases,[]);assert.deepEqual(reset.flashcardSessions.all,shuffled.flashcardSessions.all);
  record.shuffledOrderLength=shuffled.flashcardSessions.all.order.length;record.reset=reset;
});

test('word-verb-identities-after-sort-filter-hide-and-reload',async({page,record})=>{
  const word=materials.wordIndex.at(-1),verb=materials.irregularVerbs.at(-1);
  await ready(page,base+'#wordIndex');
  await page.getByLabel('Search',{exact:true}).fill(word.term);
  await page.locator('.word-card').getByRole('button',{name:'Add to Focus List',exact:true}).click();
  await page.locator('.word-card').getByRole('button',{name:'Hide item',exact:true}).click();await settle(page);
  assert.deepEqual((await readDatabase(page)).progress.hiddenWords,[word.id]);assert.deepEqual((await readDatabase(page)).progress.favoriteWords,[]);
  await page.getByRole('button',{name:'Show hidden words',exact:true}).click();
  await page.locator('.word-card').getByRole('button',{name:'Show item',exact:true}).click();await page.locator('.word-card').getByRole('button',{name:'Add to Focus List',exact:true}).click();
  await page.getByLabel('Search',{exact:true}).fill('');await page.getByRole('combobox',{name:/^Show\b/}).selectOption('20');await page.getByRole('button',{name:'Next page',exact:true}).click();
  await nav(page,'irregularVerbs');await page.getByRole('combobox',{name:/^Set\b/}).selectOption(verb.verbSet);await page.getByLabel('Search',{exact:true}).fill(verb.base);
  await page.locator('.verb-card').getByRole('button',{name:'Add to Focus List',exact:true}).click();await page.locator('.verb-card').getByRole('button',{name:'Hide item',exact:true}).click();await settle(page);
  assert.deepEqual((await readDatabase(page)).progress.hiddenIrregular,[verb.id]);assert.deepEqual((await readDatabase(page)).progress.favoriteIrregular,[]);
  await page.getByRole('button',{name:'Show hidden verbs',exact:true}).click();await page.locator('.verb-card').getByRole('button',{name:'Show item',exact:true}).click();await page.locator('.verb-card').getByRole('button',{name:'Add to Focus List',exact:true}).click();
  await page.getByRole('combobox',{name:/^Show\b/}).selectOption('10');
  await nav(page,'index');await page.locator('.tag-cloud').getByRole('button',{name:/^assessment\b/}).click();await page.getByRole('combobox',{name:/^Show\b/}).selectOption('12');
  for(const header of await page.locator('.expansion-panel__header').all()) await header.click();
  await settle(page);await page.reload();await page.locator('.app-shell').waitFor();assert.equal(await page.locator('[aria-expanded="false"]').count(),4);
  await nav(page,'favorites');assert.equal(await page.locator('.word-card h3').innerText(),word.term);assert.match(await page.locator('.verb-card h3').innerText(),new RegExp('^'+verb.base));
  record.saved=await readDatabase(page);assert.equal(record.saved.settings.indexTagFilter,'assessment');assert.equal(record.saved.settings.indexPageSize,12);assert.equal(record.saved.settings.wordPageSize,20);assert.equal(record.saved.settings.irregularPageSize,10);
  assert.deepEqual(record.saved.progress.favoriteWords,[word.id]);assert.deepEqual(record.saved.progress.favoriteIrregular,[verb.id]);
});

test('v1-representative-learning-with-own-storage',async({page,record})=>{
  await ready(page,base+'v1/#phrases');
  await page.getByLabel('Search',{exact:true}).fill(materials.phrases.at(-1).phrase);await phrase(page,materials.phrases.at(-1).phrase).waitFor();
  await page.getByLabel('Search',{exact:true}).fill('');await phrase(page,materials.phrases[0].phrase).getByRole('button',{name:'Mark as learned',exact:true}).click();
  await nav(page,'flashcards');await page.getByRole('button',{name:'Review learned vocabulary',exact:true}).click();await page.locator('.flashcards-review li').filter({hasText:materials.phrases[0].phrase}).getByRole('button',{name:'Learn again',exact:true}).click();
  await page.getByRole('button',{name:'Back to flashcards',exact:true}).first().click();await page.getByRole('button',{name:/^I know it/}).click();
  await page.waitForFunction(()=>JSON.parse(window.__review.legacySnapshot()['englishAssessmentTrainer.svelteState.v1']).learnedPhrases.length>0);
  const saved=JSON.parse(await page.evaluate(k=>window.__review.legacySnapshot()[k],legacyKey));
  await page.reload();await page.locator('.app-shell').waitFor();assert.deepEqual(JSON.parse(await page.evaluate(k=>window.__review.legacySnapshot()[k],legacyKey)).flashcardSessions,saved.flashcardSessions);
  await nav(page,'practice');await page.getByRole('button',{name:'Generate random prompt',exact:true}).click();assert(materials.drills.includes(await page.locator('.practice-card h3').innerText()));
  await nav(page,'wordIndex');await page.getByLabel('Search',{exact:true}).fill(materials.wordIndex.at(-1).term);await page.locator('.word-card').getByRole('button',{name:'Speak',exact:true}).click();
  record.speech=(await capture(page)).speech;assert(record.speech.some(e=>e.type==='speak'));assert.deepEqual((await capture(page)).opens,[]);record.legacy=saved;
});

try {
  for (const [engine,browserType] of Object.entries({chromium,firefox})) {
    if(process.env.REVIEW_ENGINE && engine!==process.env.REVIEW_ENGINE) continue;
    const browser=await browserType.launch({headless:true});
    const version=browser.version();console.log(`${engine} ${version}`);
    const output=join(evidence,`browser-${engine}.json`);
    let results=[];try{results=JSON.parse(readFileSync(output,'utf8')).results;}catch{}
    for(const {name,fn} of tests) {
      if(process.env.REVIEW_CASE && !new RegExp(process.env.REVIEW_CASE).test(name)) continue;
      const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
      await context.addInitScript(instrumentBrowser,{failOpen:name==='failed-open-retry-and-unsaved-mode',failRead:name==='failed-initial-read-preserves-populated-database'});
      const page=await context.newPage();page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(20000);
      const record={name,status:'PASS',errors:[],consoleErrors:[],failedRequests:[]};
      page.on('pageerror',e=>record.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')record.consoleErrors.push(m.text());});page.on('requestfailed',r=>record.failedRequests.push({url:r.url(),error:r.failure()?.errorText}));
      const start=Date.now();
      try { await fn({page,context,record,engine}); assert.deepEqual(record.errors,[],'Unhandled application error'); }
      catch(error) { record.status='FAIL';record.failure=String(error.stack||error);try{await page.screenshot({path:join(evidence,`${engine}-${name}.png`),timeout:5000});}catch{} }
      try{record.probeAtEnd=await capture(page);}catch{}
      record.elapsedMs=Date.now()-start;
      if(record.status==='FAIL') failed=true;
      results=results.filter(r=>r.name!==name);results.push(record);
      writeFileSync(output,JSON.stringify({date:new Date().toISOString(),engine,version,origin:server.origin,candidate,results},null,2));
      console.log(`${record.status} ${engine} ${name}${record.failure?'\n'+record.failure.split('\n').slice(0,7).join('\n'):''}`);
      await context.close();
    }
    await browser.close();
  }
} finally { await server.close(); }
if(failed) process.exitCode=1;
