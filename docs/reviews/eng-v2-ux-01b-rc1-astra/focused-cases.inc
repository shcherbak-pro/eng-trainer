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
