// ENG-V2-02B-RC1 Fable re-review — native Chromium/Firefox verification of F1 and F2
// on the assembled production artifact. Independent of Astra's runner.
//
// F1: for the shared "All Vocabulary" deck and the shared topic deck "Structure", every
// answer is checked against an independent oracle computed from the published content and
// IndexedDB: the exact persisted ID sequence, the persisted cursor ID and the displayed
// card. Shuffle, single-deck reset, Learn again, new imports, reloads and two
// delete/reimport cycles are exercised; absent IDs must keep their slots.
// F2: hidden built-in, collection A, collection B and verb entries, global "Unhide all"
// under filters, deletion, reload and reimport.
//
// Usage: node rc1-browser-review.mjs <candidate site-dist> <playwright-tools> <out-dir> [scenario-prefix,...]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const [siteDir, tools, outDir, only] = process.argv.slice(2);
const site = resolve(siteDir);
const out = resolve(outDir);
await mkdir(out, { recursive: true });
const { chromium, firefox } = await import(pathToFileURL(join(resolve(tools), 'node_modules/playwright/index.mjs')).href);
const FONT_STUB = '.material-symbols-rounded{display:inline-block;width:1em;height:1em;overflow:hidden;line-height:1;white-space:nowrap}';

// ------------------------------------------------------------------ published built-in content
const manifest = JSON.parse(await readFile(join(site, 'data/manifest.json'), 'utf8'));
const BUILT_IN_PHRASES = [], BUILT_IN_WORDS = [];
for (const entry of manifest.packs) {
  const pack = JSON.parse(await readFile(join(site, 'data', entry.url), 'utf8'));
  BUILT_IN_PHRASES.push(...(pack.content.phrases ?? []));
  BUILT_IN_WORDS.push(...(pack.content.wordIndex ?? []));
}
assert.equal(BUILT_IN_PHRASES.length, 566);
const BUILT_IN_IDS = new Set([...BUILT_IN_PHRASES, ...BUILT_IN_WORDS].map((x) => x.id));
const TOPIC = 'Structure';

// ------------------------------------------------------------------ server
const server = await (async () => {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const http = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/_review/blank') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>blank</title>'); return; }
    try {
      assert.ok(path.startsWith('/eng-trainer/'));
      let file = resolve(site, path.slice('/eng-trainer/'.length));
      assert.ok(file === site || file.startsWith(site + sep));
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      res.writeHead(200, { 'Content-Type': (types[extname(file)] ?? 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${http.address().port}`;
  return { origin, base: `${origin}/eng-trainer/`, close: () => new Promise((r) => http.close(r)) };
})();

function instrument() {
  const R = window.__fr = { unhandled: [], readwrite: 0, pending: 0, last: 0 };
  addEventListener('unhandledrejection', (e) => R.unhandled.push(String(e.reason?.message ?? e.reason)));
  const tx = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
    const t = tx.call(this, stores, mode, ...rest);
    if (this.name === 'eng-trainer-v2' && mode === 'readwrite') {
      R.readwrite++; R.pending++;
      const done = () => { R.pending--; R.last = performance.now(); };
      t.addEventListener('complete', done); t.addEventListener('abort', done);
    }
    return t;
  };
}

// ------------------------------------------------------------------ helpers
async function readDb(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('eng-trainer-v2'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const stores = {};
    for (const name of Array.from(db.objectStoreNames)) {
      const t = db.transaction(name, 'readonly'); const s = t.objectStore(name);
      const keys = s.getAllKeys(), values = s.getAll();
      await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
      stores[name] = Object.fromEntries(keys.result.map((k, i) => [k, values.result[i]]));
    }
    db.close();
    return stores;
  });
}
async function putRecords(page, store, records) {
  await page.evaluate(async ({ store, records }) => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('eng-trainer-v2'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const t = db.transaction(store, 'readwrite');
    for (const [k, v] of Object.entries(records)) t.objectStore(store).put(v, k);
    await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
    db.close();
  }, { store, records });
}
const settle = (page) => page.waitForFunction(() => window.__fr && window.__fr.pending === 0 && performance.now() - window.__fr.last > 200, null, { timeout: 15000 });
async function openApp(page, hash = '') { await page.goto(server.base + hash); await page.locator('.app-shell').waitFor(); await settle(page); }
async function reloadApp(page) { await page.reload(); await page.locator('.app-shell').waitFor(); await settle(page); }
async function nav(page, label) {
  await page.locator('.desktop-nav button').filter({ hasText: new RegExp(`^\\s*${label}`) }).first().click();
  await page.locator('.hero h1').filter({ hasText: label }).waitFor();
  await settle(page);
}
async function importNative(page, name, text) {
  await nav(page, 'Collections');
  await page.getByLabel('Import vocabulary file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
  await page.getByRole('heading', { name: 'Review import' }).waitFor();
  const ack = page.getByLabel('I reviewed these possible duplicates');
  if (await ack.count()) await ack.check();
  await page.getByRole('button', { name: 'Confirm import', exact: true }).click();
  await page.locator('.collections-page .notice[role=status]').waitFor();
  await settle(page);
  return page.locator('.collections-page .notice[role=status]').innerText();
}
async function removeCollection(page, name) {
  await nav(page, 'Collections');
  await page.getByRole('button', { name: `Remove ${name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await page.locator('.notice').filter({ hasText: 'Collection removed' }).waitFor();
  await settle(page);
}
async function hero(page) {
  const text = await page.locator('.hero__stats').innerText();
  return Object.fromEntries([...text.matchAll(/(\d+)\s+(phrases|words|verbs|focus|hidden)/g)].map((m) => [m[2], +m[1]]));
}
const term = (page) => page.locator('.flashcard__term').innerText().catch(() => null);
const uuid = (a, n) => `${a.toString(16).padStart(8, '0')}-cafe-4abc-8abc-${n.toString(16).padStart(12, '0')}`;
const cid = (c) => `user:${uuid(0xa11ce000 + c, 0)}`;
const eid = (c, n) => `${cid(c)}:entry:${uuid(0xe11ce000 + c, n)}`;
const nativeDoc = (c, name, entries) => JSON.stringify({ format: 'eng-trainer-vocabulary', version: 1, collection: { id: cid(c), name, description: 'RC1 re-review fixture' }, entries }, null, 2) + '\n';
const e = (c, n, kind, english, translation, topic = TOPIC, extra = {}) => ({ id: eid(c, n), kind, english, translation, topic, examples: [], ...extra });
const A_ENTRIES = [
  e(1, 1, 'word', 'Same text', 'однаковий текст (A, слово)'),
  e(1, 2, 'phrase', 'Same text', 'однаковий текст (A, фраза)'),
  e(1, 3, 'phrase', 'Alpha structure phrase', 'альфа фраза'),
  e(1, 4, 'word', 'alphaword', 'альфа слово', TOPIC, { sourcePhraseId: eid(1, 3) }),
  e(1, 5, 'word', 'alphatwo', 'альфа два'),
  e(1, 6, 'phrase', 'Alpha offtopic phrase', 'поза темою', 'Elsewhere')
];
const B_ENTRIES = [e(2, 1, 'word', 'Same text', 'однаковий текст (B)'), e(2, 2, 'phrase', 'Bravo structure phrase', 'браво фраза'), e(2, 3, 'word', 'bravoword', 'браво слово')];
const C_ENTRIES = [e(3, 1, 'word', 'charlieone', 'чарлі один'), e(3, 2, 'word', 'charlietwo', 'чарлі два')];
const A_DOC = nativeDoc(1, 'Alpha set', A_ENTRIES), B_DOC = nativeDoc(2, 'Bravo set', B_ENTRIES), C_DOC = nativeDoc(3, 'Charlie set', C_ENTRIES);
const A_IDS = A_ENTRIES.map((x) => x.id);

// Independent deck model (mirrors the documented flashcard rules, not the app code).
function model(stores, key) {
  const collections = Object.values(stores.userCollections).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const rank = new Map(collections.map((c, i) => [c.id, i]));
  const entries = Object.values(stores.userEntries).sort((a, b) => rank.get(a.collectionId) - rank.get(b.collectionId) || a.position - b.position);
  const cards = [];
  for (const p of BUILT_IN_PHRASES) cards.push({ id: p.id, text: p.phrase, topics: new Set([p.category, ...BUILT_IN_WORDS.filter((w) => w.sourcePhraseId === p.id).map((w) => w.category)]) });
  for (const x of entries.filter((x) => x.kind === 'phrase')) cards.push({ id: x.id, text: x.english, topics: new Set([x.topic || 'My vocabulary', ...entries.filter((w) => w.sourcePhraseId === x.id).map((w) => w.topic || 'My vocabulary')]) });
  for (const x of entries.filter((x) => x.kind === 'word' && !x.sourcePhraseId)) cards.push({ id: x.id, text: x.english, topics: new Set([x.topic || 'My vocabulary']) });
  const deck = key === 'all' ? cards : cards.filter((c) => c.topics.has(key.slice('topic:'.length)));
  const learned = new Set(stores.progress.learnedPhrases ?? []);
  const available = new Set([...BUILT_IN_IDS, ...entries.map((x) => x.id)]);
  const learning = deck.filter((c) => !learned.has(c.id)).map((c) => c.id);
  return { deck: deck.map((c) => c.id), learning, learningSet: new Set(learning), available, text: new Map(cards.map((c) => [c.id, c.text])), absent: (id) => id.startsWith('user:') && !available.has(id) };
}
function resolve2(saved, learning) {
  const set = new Set(learning), seen = new Set(), order = []; let index = 0;
  const savedIndex = saved && saved.index > 0 ? Math.floor(saved.index) : 0;
  (saved?.order ?? []).forEach((id, position) => { if (!set.has(id) || seen.has(id)) return; if (position < savedIndex) index++; seen.add(id); order.push(id); });
  for (const id of learning) if (!seen.has(id)) { seen.add(id); order.push(id); }
  return { order, index: index < order.length ? index : 0 };
}
const dedup = (order) => [...new Set(order)];
const tally = { answers: 0, shuffles: 0, resets: 0 };

async function writeAndWait(page, run) {
  const n = await page.evaluate(() => window.__fr.readwrite);
  await run();
  await page.waitForFunction((x) => window.__fr.readwrite > x, n);
  await settle(page);
}
async function checkedAnswer(page, key, choice) {
  const s0 = await readDb(page); const P0 = s0.flashcardSessions[key]; const m0 = model(s0, key);
  const V = resolve2(P0, m0.learning); const current = V.order[V.index];
  assert.equal(await term(page), m0.text.get(current), `displayed card before answer (${key})`);
  await writeAndWait(page, () => page.getByRole('button', { name: choice === 'know' ? /^I know it/ : /Keep learning/ }).click());
  const s1 = await readDb(page); const P1 = s1.flashcardSessions[key]; const m1 = model(s1, key);
  const kept = dedup(P0?.order ?? []).filter((id) => m1.absent(id) || m1.learningSet.has(id));
  const expected = [...kept, ...m1.learning.filter((id) => !kept.includes(id))];
  assert.deepEqual(P1.order, expected, `persisted order after ${choice} (${key})`);
  const rest = choice === 'know' ? V.order.filter((id) => id !== current) : V.order;
  const next = choice === 'again' ? V.order[(V.index + 1) % V.order.length] : (rest.length ? rest[V.index < rest.length ? V.index : 0] : undefined);
  if (next) { assert.equal(P1.order[P1.index], next, `persisted cursor after ${choice}`); assert.equal(await term(page), m1.text.get(next), 'displayed next card'); }
  for (const id of A_IDS) if (m1.absent(id) && (P0?.order ?? []).includes(id)) assert.ok(P1.order.includes(id), `absent ${id} kept`);
  tally.answers++;
  return { answered: current, answeredText: m0.text.get(current), next };
}
async function seededShuffle(page, key, seed) {
  const s0 = await readDb(page); const P0 = s0.flashcardSessions[key];
  await page.evaluate((x) => { let s = x; Math.random = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }, seed);
  await writeAndWait(page, () => page.getByRole('button', { name: 'Shuffle remaining cards', exact: true }).click());
  const s1 = await readDb(page); const P1 = s1.flashcardSessions[key]; const m1 = model(s1, key);
  const filteredOld = dedup(P0?.order ?? []).filter((id) => m1.absent(id) || m1.learningSet.has(id));
  filteredOld.forEach((id, i) => { if (m1.absent(id)) assert.equal(P1.order[i], id, 'absent slot index kept by shuffle'); });
  assert.deepEqual(P1.order.filter(m1.absent), filteredOld.filter(m1.absent));
  assert.deepEqual([...P1.order.filter((id) => !m1.absent(id))].sort(), [...m1.learning].sort(), 'shuffle keeps exactly the learning cards');
  assert.equal(resolve2(P1, m1.learning).index, 0); assert.equal(await term(page), m1.text.get(P1.order[P1.index]));
  tally.shuffles++;
}
async function checkedReset(page, key, label) {
  const s0 = await readDb(page); const P0 = s0.flashcardSessions[key];
  await writeAndWait(page, () => page.getByRole('button', { name: `Reset progress for ${label}`, exact: true }).click());
  const s1 = await readDb(page); const P1 = s1.flashcardSessions[key]; const m1 = model(s1, key);
  assert.deepEqual(m1.learning, m1.deck, 'deck has no learned cards after reset');
  const deckSet = new Set(m1.deck);
  const filteredOld = dedup(P0.order).filter((id) => m1.absent(id) || deckSet.has(id));
  filteredOld.forEach((id, i) => { if (m1.absent(id)) assert.equal(P1.order[i], id, 'absent slot index kept by reset'); });
  assert.deepEqual(P1.order.filter((id) => !m1.absent(id)), m1.deck, 'reset refills available slots in deck order');
  assert.equal(await term(page), m1.text.get(m1.deck[0]));
  tally.resets++;
}
async function answerUntil(page, key, text, max = 40) {
  for (let i = 0; i < max && (await term(page)) !== text; i++) await checkedAnswer(page, key, 'again');
  assert.equal(await term(page), text);
}
async function openDeck(page, key) {
  await nav(page, 'Flashcards');
  const filter = page.getByLabel('Collection', { exact: true });
  if (await filter.count()) await filter.selectOption('');
  if (key === 'all') await page.getByRole('button', { name: 'All Vocabulary', exact: true }).click();
  else { await page.getByRole('button', { name: 'By Topic', exact: true }).click(); await page.locator('label').filter({ hasText: /^\s*Topic/ }).locator('select').selectOption(TOPIC); }
  await settle(page);
}

// ------------------------------------------------------------------ scenarios
const scenarios = [];
const scenario = (name, run) => scenarios.push({ name, run });

for (const key of ['all', `topic:${TOPIC}`]) {
  const label = key === 'all' ? 'All Vocabulary' : TOPIC;
  scenario(`F1-${key === 'all' ? 'all' : 'topic'}-shared-deck-lifecycle`, async ({ page, record }) => {
    page.on('dialog', (d) => d.accept());
    await openApp(page, '#collections');
    await importNative(page, 'alpha.json', A_DOC);
    await importNative(page, 'bravo.json', B_DOC);
    // 1. Build the shared deck with A, B and built-in cards interleaved.
    if (key === 'all') {
      const p = BUILT_IN_PHRASES.map((x) => x.id);
      // After two answers from index 2 the current card is A's phrase "Same text" (slot 4), so the
      // deletion happens while the cursor sits on a card that becomes absent.
      const order = [p[0], eid(1, 1), p[1], p[2], eid(1, 2), eid(1, 3), p[3], eid(2, 1), eid(2, 2), eid(1, 5), p[4], eid(2, 3), eid(1, 6), ...p.slice(5)];
      await putRecords(page, 'flashcardSessions', { all: { order, index: 2 } });
      await reloadApp(page);
      await openDeck(page, key);
    } else {
      await openDeck(page, key);
      await seededShuffle(page, key, 7);
    }
    await checkedAnswer(page, key, 'again');
    await checkedAnswer(page, key, 'again');
    // Unrelated collection-specific session for B.
    await page.getByLabel('Collection', { exact: true }).selectOption(cid(2)); await settle(page);
    const bKeyBefore = Object.keys((await readDb(page)).flashcardSessions);
    await writeAndWait(page, () => page.getByRole('button', { name: /Keep learning/ }).click());
    const bKey = Object.keys((await readDb(page)).flashcardSessions).find((k) => !bKeyBefore.includes(k));
    const bSession = (await readDb(page)).flashcardSessions[bKey];
    record.collectionKeyB = bKey;
    await page.getByLabel('Collection', { exact: true }).selectOption(''); await settle(page);
    const P_initial = (await readDb(page)).flashcardSessions[key];
    const aInitial = P_initial.order.filter((id) => A_IDS.includes(id));
    const heroWithA = await hero(page);
    record.initial = { length: P_initial.order.length, index: P_initial.index, aIds: aInitial.length, current: await term(page), head: P_initial.order.slice(0, 14).map((id) => id.replace(/^user:([^:]+):entry:(.+)$/, (_, c, n) => `${c.slice(5, 8)}#${parseInt(n.slice(-4), 16)}`)) };

    // 2. Delete A: no session write; A's cards leave views and counts.
    const beforeDelete = await readDb(page);
    const shownBeforeDelete = await term(page);
    await removeCollection(page, 'Alpha set');
    const afterDelete = await readDb(page);
    assert.deepEqual(afterDelete.flashcardSessions, beforeDelete.flashcardSessions, 'removal writes no session');
    const heroNoA = await hero(page);
    record.heroCounts = { withA: heroWithA, withoutA: heroNoA };
    assert.deepEqual([heroWithA.phrases - heroNoA.phrases, heroWithA.words - heroNoA.words], [3, 3], 'A has 3 phrases and 3 words (one linked)');
    await openDeck(page, key);
    const m = model(afterDelete, key);
    record.cursorAfterDelete = { before: shownBeforeDelete, after: await term(page) };
    assert.equal(await term(page), m.text.get(resolve2(afterDelete.flashcardSessions[key], m.learning).order[resolve2(afterDelete.flashcardSessions[key], m.learning).index]));
    // 3. Answer remaining cards (full cycle for the small topic deck): no ghosts, A slots kept.
    const seen = [];
    if (key === 'all') { for (let i = 0; i < 10 && (await term(page)) !== 'Same text'; i++) seen.push((await checkedAnswer(page, key, 'again')).answeredText); }
    else for (let i = 0; i < m.learning.length; i++) seen.push((await checkedAnswer(page, key, 'again')).answeredText);
    record.cycleWhileAbsent = seen;
    for (const t of ['Alpha structure phrase', 'alphatwo', 'alphaword', 'Alpha offtopic phrase']) assert.ok(!seen.includes(t), `no ghost card ${t}`);
    if (key !== 'all') assert.equal(seen.filter((t) => t === 'Same text').length, 1, 'only B\'s "Same text" while A is absent');
    // 4. "I know it" on B's "Same text" learns only B's identity.
    await answerUntil(page, key, 'Same text');
    await checkedAnswer(page, key, 'know');
    const learned = (await readDb(page)).progress.learnedPhrases;
    assert.ok(learned.includes(eid(2, 1)) && !learned.includes(eid(1, 1)) && !learned.includes(eid(1, 2)), 'same-text identities independent');
    // 5. Learn again, then the next answer appends it (existing rule).
    await page.getByRole('button', { name: 'Review learned vocabulary', exact: true }).click();
    await page.locator('li, article, .card').filter({ hasText: 'Same text' }).getByRole('button', { name: 'Learn again', exact: true }).first().click();
    await settle(page);
    await page.getByRole('button', { name: 'Back to flashcards', exact: true }).first().click();
    await checkedAnswer(page, key, 'again');
    // 6. Shuffle and 7. single-deck reset with A absent.
    await seededShuffle(page, key, 99);
    await checkedAnswer(page, key, 'know');
    await checkedReset(page, key, label);
    await checkedAnswer(page, key, 'again');
    // 8. Reload: nothing written, same card.
    const preReload = await readDb(page); const shownPreReload = await term(page);
    await reloadApp(page); await openDeck(page, key);
    assert.deepEqual((await readDb(page)).flashcardSessions[key], preReload.flashcardSessions[key]);
    assert.equal(await term(page), shownPreReload);
    // 9. A genuinely new collection appends on the next answer.
    await importNative(page, 'charlie.json', C_DOC);
    await openDeck(page, key);
    await checkedAnswer(page, key, 'again');
    const withC = (await readDb(page)).flashcardSessions[key].order;
    assert.deepEqual(withC.slice(-2), [eid(3, 1), eid(3, 2)], 'new IDs append');
    // 10. Reimport A: no session write, no cursor jump, A slots restored in their original relative order.
    const preImport = await readDb(page); const shownPreImport = await term(page);
    record.reimportMessage = await importNative(page, 'alpha.json', A_DOC);
    await openDeck(page, key);
    const postImport = await readDb(page);
    assert.deepEqual(postImport.flashcardSessions, preImport.flashcardSessions, 'reimport writes no session');
    assert.equal(await term(page), shownPreImport, 'cursor stays on the current card after reimport');
    assert.deepEqual(postImport.flashcardSessions[key].order.filter((id) => A_IDS.includes(id)), aInitial, 'A identities restored in their original relative order');
    assert.deepEqual(postImport.flashcardSessions[bKey], bSession, 'B collection-specific session untouched');
    const restoredCycle = [];
    const m2 = model(postImport, key);
    for (let i = 0; i < (key === 'all' ? 8 : m2.learning.length); i++) restoredCycle.push((await checkedAnswer(page, key, 'again')).answeredText);
    record.cycleAfterReimport = restoredCycle;
    if (key !== 'all') for (const t of ['Alpha structure phrase', 'alphatwo']) assert.ok(restoredCycle.includes(t), `restored card ${t} visible again`);
    // 11. Second delete/reimport cycle.
    await removeCollection(page, 'Alpha set');
    await openDeck(page, key);
    await checkedAnswer(page, key, 'again'); await checkedAnswer(page, key, 'know');
    await importNative(page, 'alpha.json', A_DOC);
    await openDeck(page, key);
    const final = await readDb(page);
    assert.deepEqual(final.flashcardSessions[key].order.filter((id) => A_IDS.includes(id)), aInitial, 'A relative order survives a second cycle');
    assert.deepEqual(final.flashcardSessions[bKey], bSession);
    record.final = { length: final.flashcardSessions[key].order.length, aIds: final.flashcardSessions[key].order.filter((id) => A_IDS.includes(id)).length, learned: final.progress.learnedPhrases.length };
    record.unhandled = await page.evaluate(() => window.__fr.unhandled);
    assert.deepEqual(record.unhandled, []);
  });
}

scenario('F1-cursor-on-removed-card-without-answers', async ({ page, record }) => {
  // Documented rule: the cursor is saved on the next visible card only when a session is
  // written. Without any answer while A is absent, reimport resumes at the persisted card.
  await openApp(page, '#collections');
  await importNative(page, 'alpha.json', A_DOC);
  await importNative(page, 'bravo.json', B_DOC);
  const p = BUILT_IN_PHRASES.map((x) => x.id);
  const order = [p[0], eid(1, 1), p[1], p[2], eid(1, 2), eid(1, 3), p[3], eid(2, 1), ...p.slice(4)];
  await putRecords(page, 'flashcardSessions', { all: { order, index: 5 } });
  await reloadApp(page); await openDeck(page, 'all');
  record.before = await term(page);
  assert.equal(record.before, 'Alpha structure phrase');
  await removeCollection(page, 'Alpha set'); await openDeck(page, 'all');
  record.whileAbsent = await term(page);
  assert.equal(record.whileAbsent, BUILT_IN_PHRASES[3].phrase);
  await reloadApp(page);
  await importNative(page, 'alpha.json', A_DOC); await openDeck(page, 'all');
  record.afterReimport = await term(page);
  assert.equal(record.afterReimport, 'Alpha structure phrase');
  assert.deepEqual((await readDb(page)).flashcardSessions.all, { order, index: 5 }, 'nothing written');
});

scenario('F2-hidden-state-mixed-types-filters-delete-reimport', async ({ page, record }) => {
  await openApp(page, '#collections');
  await importNative(page, 'alpha.json', A_DOC);
  await importNative(page, 'bravo.json', B_DOC);
  // A stale verb ID from older content (not in the catalog) must not keep "Unhide all verbs" visible.
  await putRecords(page, 'progress', { hiddenIrregular: ['iv-999-obsolete'] });
  await reloadApp(page);
  await nav(page, 'Verbs');
  record.unhideVerbsShownForStaleIdOnly = await page.getByRole('button', { name: 'Unhide all verbs' }).count() > 0;
  assert.equal(record.unhideVerbsShownForStaleIdOnly, false);
  const hideFirst = async (scope) => { await writeAndWait(page, () => scope.getByRole('button', { name: 'Hide item', exact: true }).first().click()); };
  await hideFirst(page.locator('.cards-list'));
  const searchWords = async (q, collection = '') => { await nav(page, 'Words'); const f = page.getByLabel('Collection', { exact: true }); if (await f.count()) await f.selectOption(collection); await page.getByPlaceholder('run into, lack, estimate…').fill(q); await settle(page); };
  const searchPhrases = async (q, collection = '') => { await nav(page, 'Phrases'); const f = page.getByLabel('Collection', { exact: true }); if (await f.count()) await f.selectOption(collection); await page.getByPlaceholder('AI, otherwise, meeting…').fill(q); await settle(page); };
  const bw = BUILT_IN_WORDS[10], bp = BUILT_IN_PHRASES[10];
  await searchWords(bw.term);
  await page.locator('.index-list button').filter({ hasText: bw.term }).first().click();
  await hideFirst(page);
  await searchWords('alphatwo', cid(1)); await hideFirst(page);
  await searchWords('bravoword', cid(2)); await hideFirst(page);
  await searchPhrases(bp.phrase); await hideFirst(page.locator('.phrase-card').filter({ has: page.getByRole('heading', { name: bp.phrase, exact: true }) }).first());
  await searchPhrases('Alpha offtopic', cid(1)); await hideFirst(page.locator('.phrase-card').first());
  await searchPhrases('Bravo structure', cid(2)); await hideFirst(page.locator('.phrase-card').first());
  const hidden0 = (await readDb(page)).progress;
  const verbId = hidden0.hiddenIrregular[1];
  assert.deepEqual(hidden0.hiddenWords, [bw.id, eid(1, 5), eid(2, 3)]);
  assert.deepEqual(hidden0.hiddenPhrases, [bp.id, eid(1, 6), eid(2, 2)]);
  assert.deepEqual(hidden0.hiddenIrregular, ['iv-999-obsolete', verbId]);
  record.heroHiddenWithA = (await hero(page)).hidden;
  // Delete A: its hidden IDs stay stored; counts show only available entries.
  await removeCollection(page, 'Alpha set');
  const afterDelete = (await readDb(page)).progress;
  assert.deepEqual([afterDelete.hiddenWords, afterDelete.hiddenPhrases, afterDelete.hiddenIrregular], [hidden0.hiddenWords, hidden0.hiddenPhrases, hidden0.hiddenIrregular]);
  record.heroHiddenWithoutA = (await hero(page)).hidden;
  assert.equal(record.heroHiddenWithoutA, 5);
  // Unhide all words while a B-only collection filter and a search hide the built-in word from view:
  // the action stays global for the type (built-in word included) and keeps A's flag.
  await searchWords('bravo', cid(2));
  await writeAndWait(page, () => page.getByRole('button', { name: 'Unhide all words', exact: true }).click());
  let p = (await readDb(page)).progress;
  assert.deepEqual(p.hiddenWords, [eid(1, 5)], 'only the absent A word stays hidden');
  assert.deepEqual([p.hiddenPhrases, p.hiddenIrregular], [hidden0.hiddenPhrases, hidden0.hiddenIrregular], 'other types untouched');
  assert.equal(await page.getByRole('button', { name: 'Unhide all words' }).count(), 0, 'no control for absent-only hidden words');
  await searchWords(bw.term, '');
  record.builtInWordVisibleAgain = (await page.locator('.index-list button').allInnerTexts()).some((t) => t.startsWith(bw.term));
  assert.ok(record.builtInWordVisibleAgain);
  // Unhide all phrases under a category filter and search.
  await searchPhrases('Bravo', '');
  await page.locator('label').filter({ hasText: /^\s*Category/ }).locator('select').selectOption(TOPIC).catch(() => {});
  await writeAndWait(page, () => page.getByRole('button', { name: 'Unhide all phrases', exact: true }).click());
  p = (await readDb(page)).progress;
  assert.deepEqual(p.hiddenPhrases, [eid(1, 6)]);
  assert.deepEqual([p.hiddenWords, p.hiddenIrregular], [[eid(1, 5)], hidden0.hiddenIrregular]);
  assert.equal(await page.getByRole('button', { name: 'Unhide all phrases' }).count(), 0);
  // Verbs: the real verb is unhidden; the stale unknown ID is retained; nothing else changes.
  await nav(page, 'Verbs');
  await writeAndWait(page, () => page.getByRole('button', { name: 'Unhide all verbs', exact: true }).click());
  p = (await readDb(page)).progress;
  assert.deepEqual([p.hiddenIrregular, p.hiddenWords, p.hiddenPhrases], [['iv-999-obsolete'], [eid(1, 5)], [eid(1, 6)]]);
  assert.equal(await page.getByRole('button', { name: 'Unhide all verbs' }).count(), 0);
  assert.equal((await hero(page)).hidden, 0);
  // Reload, then reimport A: its hidden states return and the controls come back.
  await reloadApp(page);
  for (const [page_, label] of [['Words', 'Unhide all words'], ['Phrases', 'Unhide all phrases']]) { await nav(page, page_); assert.equal(await page.getByRole('button', { name: label }).count(), 0); }
  await importNative(page, 'alpha.json', A_DOC);
  p = (await readDb(page)).progress;
  assert.deepEqual([p.hiddenWords, p.hiddenPhrases], [[eid(1, 5)], [eid(1, 6)]]);
  assert.equal((await hero(page)).hidden, 2);
  await searchWords('alphatwo', cid(1));
  assert.equal(await page.locator('.index-list button').count(), 0, 'restored A word is hidden again');
  assert.equal(await page.getByRole('button', { name: 'Unhide all words' }).count(), 1, 'control returns with the restored entry');
  await searchPhrases('Alpha offtopic', cid(1));
  assert.equal(await page.locator('.phrase-card').count(), 0, 'restored A phrase is hidden again');
  await nav(page, 'Words');
  await writeAndWait(page, () => page.getByRole('button', { name: 'Unhide all words', exact: true }).click());
  p = (await readDb(page)).progress;
  assert.deepEqual([p.hiddenWords, p.hiddenPhrases], [[], [eid(1, 6)]]);
  record.unhandled = await page.evaluate(() => window.__fr.unhandled);
  assert.deepEqual(record.unhandled, []);
});

// ------------------------------------------------------------------ runner
const engines = Object.fromEntries(Object.entries({ chromium, firefox }).filter(([name]) => !process.env.FABLE_ENGINES || process.env.FABLE_ENGINES.split(',').includes(name)));
const selected = only ? only.split(',') : null;
let failed = false;
try {
  for (const [engine, type] of Object.entries(engines)) {
    const browser = await type.launch({ headless: true });
    const results = [];
    try {
      for (const { name, run } of scenarios) {
        if (selected && !selected.some((s) => name.startsWith(s))) continue;
        for (const k of Object.keys(tally)) tally[k] = 0;
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
        const blocked = [];
        await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: FONT_STUB }));
        await context.route((url) => /^https?:/.test(url.protocol) && !url.href.startsWith(server.origin) && !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url.href), (r) => { blocked.push(r.request().url()); return r.abort(); });
        await context.addInitScript(instrument);
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        const record = { engine, name, pageErrors: [], consoleErrors: [] };
        page.on('pageerror', (err) => record.pageErrors.push(err.message));
        page.on('console', (msg) => { if (msg.type() === 'error') record.consoleErrors.push(msg.text().slice(0, 200)); });
        const started = Date.now();
        try {
          await run({ page, record });
          assert.deepEqual(record.pageErrors, []); assert.deepEqual(record.consoleErrors, []);
          record.status = 'PASS';
        } catch (error) {
          failed = true; record.status = 'FAIL';
          record.error = String(error.stack ?? error).split('\n').filter((l) => !/^\s+at /.test(l) || /rc1-browser-review\.mjs/.test(l)).slice(0, 30).join(' | ').replaceAll(server.origin, '<local>').replaceAll(resolve('.'), '<cwd>');
          await page.screenshot({ path: join(out, `${engine}-${name}-failure.png`), fullPage: true }).catch(() => {});
        } finally {
          record.checkedOperations = { ...tally };
          record.blockedExternal = blocked;
          record.seconds = +((Date.now() - started) / 1000).toFixed(1);
          results.push(record);
          console.log(`${engine}: ${record.status} ${name} (${record.seconds}s, ${JSON.stringify(record.checkedOperations)})${record.error ? ' :: ' + record.error : ''}`);
          await context.close();
        }
      }
      await writeFile(join(out, `rc1-${engine}.json`), JSON.stringify({ engine, version: browser.version(), results }, null, 2) + '\n');
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
if (failed) process.exitCode = 1;
