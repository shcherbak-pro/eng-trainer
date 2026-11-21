import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

// Real static-file serving, with no SPA fallback. The blank page is only for
// seeding synthetic browser storage before the production application starts.
export async function serveArtifact(artifact) {
  const root = resolve(artifact);
  const requests = [];
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/_review/blank') { res.writeHead(200, {'Content-Type':'text/html'}); res.end('<!doctype html><title>Isolated review seed</title>'); return; }
    let status = 404;
    try {
      if (!pathname.startsWith('/eng-trainer/')) throw new Error('outside mount');
      let file = resolve(root, pathname.slice('/eng-trainer/'.length));
      if (file !== root && !file.startsWith(root + sep)) throw new Error('outside root');
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      const body = await readFile(file);
      status = 200;
      res.writeHead(status, { 'Content-Type': `${types[extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404, {'Content-Type':'text/plain'}); res.end('Not found'); }
    requests.push({pathname,status});
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise(r => server.close(r)) };
}

// Instrumentation wraps native browser APIs; no fake IndexedDB or app modules.
// Faults are controlled injection, never described as natural quota failures.
export function instrumentBrowser(options = {}) {
  const R = window.__review = { opens: [], transactions: [], writes: [], storageCalls: [], speech: [], failOpen: !!options.failOpen, failRead: !!options.failRead && location.pathname !== '/_review/blank', failWrite: false, holdUntil: 0, lastWrite: 0, activeWrites: 0 };
  const nativeStorage = window.localStorage;
  const methods = Object.fromEntries(['getItem','setItem','removeItem','clear','key'].map(k => [k, Storage.prototype[k]]));
  R.seedLegacy = (data) => Object.entries(data).forEach(([k,v]) => methods.setItem.call(nativeStorage,k,v));
  R.legacySnapshot = () => Object.fromEntries(Array.from({length:nativeStorage.length}, (_,i) => { const k = methods.key.call(nativeStorage,i); return [k,methods.getItem.call(nativeStorage,k)]; }));
  Object.defineProperty(window, 'localStorage', {configurable:true, get() { R.storageCalls.push('get localStorage'); return nativeStorage; }});
  for (const k of Object.keys(methods)) Storage.prototype[k] = function(...args) { if(this === nativeStorage) R.storageCalls.push(k); return methods[k].apply(this,args); };
  const open = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function(name,...args) {
    R.opens.push(name);
    if(name === 'eng-trainer-v2' && R.failOpen) throw new DOMException('ASTRA injected open failure','SecurityError');
    return open.call(this,name,...args);
  };
  const transaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function(stores,mode,...args) {
    const tx = transaction.call(this,stores,mode,...args);
    if (this.name !== 'eng-trainer-v2') return tx;
    const record = { mode:mode || 'readonly', stores: Array.from(tx.objectStoreNames), outcome:'pending', requestSuccessBeforeAbort:false };
    R.transactions.push(record);
    if(mode === 'readwrite') { R.activeWrites++; R.lastWrite = performance.now(); }
    tx.addEventListener('complete', () => { record.outcome='complete'; if(mode==='readwrite') { R.activeWrites--; R.lastWrite=performance.now(); } });
    tx.addEventListener('abort', () => { record.outcome='abort'; if(mode==='readwrite') { R.activeWrites--; R.lastWrite=performance.now(); } });
    tx.__reviewRecord = record;
    if(mode === 'readwrite' && performance.now() < R.holdUntil) {
      const keepAlive = () => { if(performance.now() < R.holdUntil) { try { tx.objectStore(tx.objectStoreNames[0]).get('__review_keepalive__').onsuccess=keepAlive; } catch {} } };
      keepAlive();
    }
    return tx;
  };
  for (const method of ['put','delete']) {
    const original = IDBObjectStore.prototype[method];
    IDBObjectStore.prototype[method] = function(...args) {
      const request = original.apply(this,args);
      if(this.transaction.db.name !== 'eng-trainer-v2') return request;
      R.writes.push({method,store:this.name,key:method==='put'?args[1]:args[0],value:method==='put'?args[0]:undefined});
      const tx=this.transaction;
      request.addEventListener('success', () => {
        if(R.failWrite && tx.__reviewRecord?.outcome==='pending') {
          tx.__reviewRecord.requestSuccessBeforeAbort=true;
          try { tx.abort(); } catch {}
        }
      });
      return request;
    };
  }
  const getAll = IDBObjectStore.prototype.getAll;
  IDBObjectStore.prototype.getAll = function(...args) {
    const request=getAll.apply(this,args);
    if(R.failRead && this.transaction.db.name==='eng-trainer-v2') {
      const tx=this.transaction;
      request.addEventListener('success', () => { try {tx.abort();} catch {} });
    }
    return request;
  };
  if(window.speechSynthesis) {
    const speak=window.speechSynthesis.speak.bind(window.speechSynthesis);
    const cancel=window.speechSynthesis.cancel.bind(window.speechSynthesis);
    window.speechSynthesis.speak = u => { R.speech.push({type:'speak',text:u.text,lang:u.lang,rate:u.rate}); u.addEventListener('start',()=>R.speech.push({type:'start'})); u.addEventListener('end',()=>R.speech.push({type:'end'})); u.addEventListener('error',e=>R.speech.push({type:'error',error:e.error})); return speak(u); };
    window.speechSynthesis.cancel = () => { R.speech.push({type:'cancel'}); return cancel(); };
  }
}

export async function seedDatabase(page, records) {
  await page.evaluate(async (records) => {
    const db = await new Promise((resolve,reject) => { const r=indexedDB.open('eng-trainer-v2',1); r.onupgradeneeded=()=>['progress','settings','learnPasses','flashcardSessions'].forEach(s=>r.result.createObjectStore(s)); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
    await new Promise((resolve,reject)=>{const tx=db.transaction(['progress','settings','learnPasses','flashcardSessions'],'readwrite'); for(const [store,entries] of Object.entries(records)) for(const [key,value] of Object.entries(entries)) tx.objectStore(store).put(value,key); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);});
    db.close();
  }, records);
}

export async function readDatabase(page) {
  return page.evaluate(async () => {
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('eng-trainer-v2');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const result={};
    await Promise.all(Array.from(db.objectStoreNames).map(async name=>{
      const tx=db.transaction(name,'readonly'), store=tx.objectStore(name);
      const values=store.getAll(), keys=store.getAllKeys();
      await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
      result[name]=Object.fromEntries(keys.result.map((k,i)=>[k,values.result[i]]));
    }));
    db.close(); return result;
  });
}

export async function settle(page) {
  await page.waitForFunction(() => window.__review && window.__review.activeWrites===0 && performance.now()-window.__review.lastWrite > 120);
}
