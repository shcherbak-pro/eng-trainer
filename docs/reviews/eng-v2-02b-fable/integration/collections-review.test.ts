// ENG-V2-02B Fable review — catalog differential and collection-service probes.
// Copied into <disposable-copy>/src/review-fable/ and run with Vitest there.
// It never runs in the developer workspace. The oracle below is written from
// raw records and the documented contract, not from the catalog's own strings.
import { get } from 'svelte/store';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCatalog, type ContentCatalog } from '../content/catalog';
import { combineCatalog, inCollection, resolvedCollection } from '../content/userCatalog';
import { buildFlashcards } from '../features/flashcards/flashcards';
import { realMaterials } from '../test/content';
import { readDatabase, resetDatabase } from '../test/database';
import { openStorage, type AppStorage } from '../storage/database';
import { parseImport } from '../collections/format';
import {
  acceptImport, connectCollections, disableCollections, exportCollection, prepareImport,
  readCollections, removeCollection, renameCollection, userVocabulary
} from '../collections/service';

const results: Record<string, unknown> = {};
afterAll(async () => {
  const { writeFile } = await import('node:fs/promises');
  const target = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.FABLE_RESULT;
  if (target) await writeFile(target, JSON.stringify(results, null, 2) + '\n');
});

const snapshot = JSON.stringify(realMaterials);
const builtIn = createCatalog(realMaterials);
const uuid = (prefix: number, n: number) => `${prefix.toString(16).padStart(8, '0')}-abcd-4abc-8abc-${n.toString(16).padStart(12, '0')}`;
const cid = (c: number) => `user:${uuid(0xc0ffee00 + c, 0)}`;
const eid = (c: number, n: number) => `${cid(c)}:entry:${uuid(0xe0000000 + c, n)}`;
type Entry = { id: string; kind: 'word' | 'phrase'; english: string; translation: string; topic?: string; examples?: { en: string; translation?: string }[]; sourcePhraseId?: string };
const doc = (c: number, name: string, entries: Entry[], description = '') => JSON.stringify({ format: 'eng-trainer-vocabulary', version: 1, collection: { id: cid(c), name, description }, entries });

let storage: AppStorage;
async function connect(): Promise<void> {
  storage = await openStorage();
  connectCollections(storage, readCollections(await storage.readAll()));
}
const catalog = () => combineCatalog(builtIn, get(userVocabulary));
const planOf = (text: string, file = 'review.json') => prepareImport(parseImport(text, file), catalog());

/** Collection 1: 1,000 entries whose text deliberately reuses built-in text and categories. */
function overlapping(): Entry[] {
  const entries: Entry[] = [];
  const categories = builtIn.phraseCategories;
  for (let i = 0; i < 1000; i++) {
    const source = i % 2 ? realMaterials.phrases[i % realMaterials.phrases.length] : undefined;
    const word = realMaterials.wordIndex[(i * 7) % realMaterials.wordIndex.length];
    const kind = i % 3 === 0 ? 'phrase' : 'word';
    const english = source ? (i % 4 === 1 ? source.phrase.toUpperCase() : source.phrase) : `${word.term} (user ${i})`;
    entries.push({
      id: eid(1, i), kind, english, translation: `переклад ${i} ${word.meaning ?? ''}`.slice(0, 2000),
      topic: i % 5 === 0 ? categories[i % categories.length] : i % 5 === 1 ? '' : `Тема ${i % 9}`,
      examples: i % 4 === 0 ? [{ en: `Example ${i} with ${word.term}.`, translation: `Приклад ${i}.` }, { en: `Only English ${i}.` }] : []
    });
  }
  // Explicit links: some words point to phrases in the same collection, never inferred from text.
  for (let i = 1; i < 1000; i += 10) if (entries[i].kind === 'word') entries[i].sourcePhraseId = entries[i - 1 - ((i - 1) % 3)].id;
  return entries;
}
function ukrainian(): Entry[] {
  return Array.from({ length: 200 }, (_, i) => ({ id: eid(2, i), kind: i % 2 ? 'word' : 'phrase', english: `Ukrainian set ${i}`, translation: `Ґанок їжак ЄВРО ${i} — ще раз`, topic: 'Українська тема', examples: [{ en: `e ${i}`, translation: `Речення ${i} з апострофом’` }] }));
}
function htmlish(): Entry[] {
  return ['<script>window.__x=1</script>', '<img src=x onerror=alert(1)>', '{{constructor}}', '__proto__', 'C++', 'C#', 'consequently', 'Consequently,'].map((english, i) => ({ id: eid(3, i), kind: i % 2 ? 'phrase' : 'word', english, translation: `<b>${i}</b>`, topic: '<i>topic</i>' }));
}

beforeEach(async () => { resetDatabase(); await connect(); });
afterEach(() => { storage.close(); disableCollections(); });

describe('built-in catalog is unchanged by user collections', () => {
  it('keeps every built-in record, order and search result while three collections are loaded', async () => {
    const sources = { 1: overlapping(), 2: ukrainian(), 3: htmlish() } as Record<number, Entry[]>;
    const names = { 1: 'Overlap collection', 2: 'Українська колекція', 3: '<em>Markup</em> collection' } as Record<number, string>;
    for (const c of [1, 2, 3]) {
      const plan = planOf(doc(c, names[c], sources[c]));
      expect(plan.issues).toEqual([]);
      await acceptImport(plan, true);
    }
    const combined = catalog();
    expect(JSON.stringify(realMaterials)).toBe(snapshot);
    const n = { phrases: builtIn.phrases.length, words: builtIn.wordIndex.length };
    expect(n).toEqual({ phrases: 566, words: 566 });
    combined.phrases.slice(0, n.phrases).forEach((item, i) => expect(item).toBe(builtIn.phrases[i]));
    combined.wordIndex.slice(0, n.words).forEach((item, i) => expect(item).toBe(builtIn.wordIndex[i]));
    for (const key of ['irregularVerbs', 'patterns', 'answers', 'drills', 'verbSets'] as const) expect(combined[key]).toEqual(builtIn[key]);
    expect(combined.blocks.map((b) => b.id)).toEqual(builtIn.blocks.map((b) => b.id));
    for (const category of builtIn.phraseCategories) expect(combined.phraseCategories).toContain(category);

    // Raw-record oracle for user entries, in saved order.
    const vocab = get(userVocabulary);
    const nameOf = new Map(vocab.collections.map((c) => [c.id, c.name]));
    const userPhrases = vocab.entries.filter((e) => e.kind === 'phrase');
    const userWords = vocab.entries.filter((e) => e.kind === 'word');
    expect(combined.phrases.slice(n.phrases).map((p) => p.id)).toEqual(userPhrases.map((e) => e.id));
    expect(combined.wordIndex.slice(n.words).map((w) => w.id)).toEqual(userWords.map((e) => e.id));
    const fields = (e: (typeof vocab.entries)[number]) => [e.english, ...e.examples.flatMap((x) => [x.en, x.translation ?? '']), e.translation, e.topic || 'My vocabulary', nameOf.get(e.collectionId)].map((v) => String(v ?? '').toLowerCase().trim());
    const oracle = (rows: typeof vocab.entries) => rows.map((e) => ({ id: e.id, fields: fields(e) }));
    const op = oracle(userPhrases), ow = oracle(userWords);
    const match = (rows: { id: string; fields: string[] }[], q: string) => { const t = q.toLowerCase().trim(); return rows.filter((r) => !t || r.fields.some((f) => f.includes(t))).map((r) => r.id); };

    const queries = new Set<string>(['', '  ', 'zzz-no-match', 'ПЕРЕКЛАД', 'ґанок', 'Ґ', 'їжак', '’', 'my vocabulary', '<script>', 'c++', 'C#', 'Українська', 'overlap']);
    const addTokens = (v: unknown) => { if (typeof v !== 'string' || !v) return; queries.add(v); for (const t of v.split(/\s+/)) if (t) queries.add(t); };
    for (const p of realMaterials.phrases) [p.phrase, p.translation, p.category, p.section, p.example].forEach(addTokens);
    for (const w of realMaterials.wordIndex) [w.term, w.meaning, w.category].forEach(addTokens);
    for (const e of vocab.entries) [e.english, e.translation, e.topic].forEach(addTokens);
    let comparisons = 0, mismatches = 0, i = 0;
    for (const q of queries) {
      for (const variant of [q, q.toUpperCase()]) {
        const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
        const checks: [string[], string[]][] = [
          [ids(combined.searchPhrases(variant)), [...ids(builtIn.searchPhrases(variant)), ...match(op, variant)]],
          [ids(combined.searchWords(variant)), [...ids(builtIn.searchWords(variant)), ...match(ow, variant)]],
          [ids(combined.searchVerbs(variant)), ids(builtIn.searchVerbs(variant))],
          [ids(combined.searchBlocks(variant)), ids(builtIn.searchBlocks(variant))]
        ];
        for (const [actual, expected] of checks) { comparisons++; if (JSON.stringify(actual) !== JSON.stringify(expected)) { mismatches++; if (mismatches < 4) expect(actual, variant).toEqual(expected); } }
      }
      if (++i % 1500 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    expect(mismatches).toBe(0);

    // Flashcards: built-in cards are identical; user cards follow only explicit links.
    const cards = buildFlashcards(combined);
    expect(cards.filter((card) => inCollection(card, 'built-in'))).toEqual(buildFlashcards(builtIn));
    const userCards = cards.filter((card) => card.collectionId);
    const linked = new Map<string, string[]>();
    for (const w of userWords) if (w.sourcePhraseId) linked.set(w.sourcePhraseId, [...(linked.get(w.sourcePhraseId) ?? []), w.id]);
    const expectedCards = [...userPhrases.map((p) => ({ id: p.id, wordIds: linked.get(p.id) ?? [] })), ...userWords.filter((w) => !w.sourcePhraseId).map((w) => ({ id: w.id, wordIds: [w.id] }))];
    expect(userCards.map((c) => ({ id: c.id, wordIds: c.wordIds }))).toEqual(expectedCards);
    for (const card of userCards) expect(new Set([card.id, ...card.wordIds].map((id) => id.split(':entry:')[0])).size).toBe(1);
    // RC1 duplicate-text pairs stay separate cards even with equal user text loaded.
    const pairs = [['phrase-005', 'hedging-005-from-my-perspective'], ['phrase-013', 'advanced-linking-008-that-being-said'], ['phrase-084', 'advanced-linking-004-consequently'], ['presentation-phrase-085', 'advanced-linking-009-as-a-result'], ['presentation-phrase-087', 'advanced-linking-012-more-importantly'], ['presentation-phrase-088', 'hedging-008-to-some-extent']];
    for (const pair of pairs) for (const id of pair) expect(cards.filter((c) => c.id === id)).toHaveLength(1);
    // Filters partition the catalog exactly.
    for (const c of [1, 2, 3]) expect(combined.phrases.filter((p) => inCollection(p, cid(c))).length + combined.wordIndex.filter((w) => inCollection(w, cid(c))).length).toBe(sources[c].length);
    expect(combined.phrases.filter((p) => inCollection(p, 'built-in'))).toHaveLength(566);
    expect(resolvedCollection(combined, cid(9))).toBe('');
    Object.assign(results, { differential: { queries: queries.size, variants: queries.size * 2, comparisons, mismatches, userEntries: vocab.entries.length, userCards: userCards.length, builtInCardsIdentical: true } });
  }, 240_000);
});

describe('collection service probes', () => {
  const base = (count: number, c = 1) => Array.from({ length: count }, (_, i): Entry => ({ id: eid(c, i), kind: i % 2 ? 'word' : 'phrase', english: `entry ${c}-${i}`, translation: `запис ${i}` }));

  it('appends new native IDs, skips identical ones, keeps metadata and continues positions', async () => {
    await acceptImport(planOf(doc(1, 'Original', base(3))));
    const first = get(userVocabulary).collections[0];
    const plan = planOf(doc(1, 'Renamed in file', [...base(3).slice(0, 2), { id: eid(1, 50), kind: 'word', english: 'new', translation: 'нове' }, { id: eid(1, 51), kind: 'word', english: 'newer', translation: 'новіше' }], 'other description'));
    expect(plan).toMatchObject({ skipped: 2, issues: [] });
    expect(plan.additions.map((e) => e.id)).toEqual([eid(1, 50), eid(1, 51)]);
    expect(plan.target).toEqual({ id: cid(1), name: 'Original', description: '' });
    expect(await acceptImport(plan)).toEqual({ added: 2, skipped: 2 });
    const saved = await readDatabase();
    const record = saved.userCollections![cid(1)] as typeof first;
    expect(record).toMatchObject({ name: 'Original', description: '', createdAt: first.createdAt, revision: 2, lastImport: { added: 2, skipped: 2 } });
    expect(Object.values(saved.userEntries!).map((e) => (e as { position: number }).position).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    results.append = { skipped: 2, added: 2, revision: record.revision, positions: [0, 1, 2, 3, 4] };
  });

  it('blocks a file that mixes identical, changed and new entries; nothing is written', async () => {
    await acceptImport(planOf(doc(1, 'Original', base(3))));
    const before = await readDatabase();
    const changed = { ...base(3)[1], translation: 'інше значення' };
    const plan = planOf(doc(1, 'Original', [base(3)[0], changed, { id: eid(1, 60), kind: 'word', english: 'fresh', translation: 'свіже' }]));
    expect(plan.issues.map((i) => i.message)).toEqual([expect.stringMatching(/ID conflict/)]);
    await expect(acceptImport(plan)).rejects.toThrow(/Fix all invalid/);
    expect(await readDatabase()).toEqual(before);
  });

  it('a new word may not link to an existing phrase that the file omits (documented contract)', async () => {
    await acceptImport(planOf(doc(1, 'Original', base(2))));
    const text = doc(1, 'Original', [{ id: eid(1, 70), kind: 'word', english: 'linked', translation: 'зв', sourcePhraseId: eid(1, 0) }]);
    expect(parseImport(text, 'x.json').issues.map((i) => i.message)).toEqual([expect.stringMatching(/missing phrase/)]);
    // Including the (identical) phrase in the file makes the same link valid.
    const ok = planOf(doc(1, 'Original', [base(2)[0], { id: eid(1, 70), kind: 'word', english: 'linked', translation: 'зв', sourcePhraseId: eid(1, 0) }]));
    expect(ok).toMatchObject({ issues: [], skipped: 1 });
    await acceptImport(ok);
    expect(buildFlashcards(catalog()).find((c) => c.id === eid(1, 0))?.wordIds).toEqual([eid(1, 70)]);
  });

  it('warns about duplicates against built-in, other collections and within the file (case/space normalised only)', async () => {
    await acceptImport(planOf(doc(2, 'Other', [{ id: eid(2, 0), kind: 'word', english: 'Unique Other Word', translation: 'x' }])));
    const plan = planOf(doc(1, 'New', [
      { id: eid(1, 0), kind: 'phrase', english: '  CONSEQUENTLY ', translation: 'x' },
      { id: eid(1, 1), kind: 'word', english: 'unique   other word', translation: 'y' },
      { id: eid(1, 2), kind: 'word', english: 'fresh text', translation: 'z' },
      { id: eid(1, 3), kind: 'word', english: 'Fresh Text', translation: 'w' },
      { id: eid(1, 4), kind: 'word', english: 'Consequently,', translation: 'v' }
    ]));
    expect(plan.duplicates).toEqual([eid(1, 0), eid(1, 1), eid(1, 3)]);
    // Punctuation is not stripped: "Consequently," is not flagged (and never merged).
    results.duplicates = { flagged: plan.duplicates.length, punctuationVariantFlagged: plan.duplicates.includes(eid(1, 4)) };
  });

  it('enforces 1,000 entries and the 2 MiB export size for the resulting collection', async () => {
    await acceptImport(planOf(doc(1, 'Big', base(999))));
    expect(planOf(doc(1, 'Big', [{ id: eid(1, 5000), kind: 'word', english: 'n1000', translation: 'x' }])).issues).toEqual([]);
    const over = planOf(doc(1, 'Big', [{ id: eid(1, 5000), kind: 'word', english: 'n1000', translation: 'x' }, { id: eid(1, 5001), kind: 'word', english: 'n1001', translation: 'x' }]));
    expect(over.issues.map((i) => i.message)).toEqual([expect.stringMatching(/exceeds 1000/)]);
    // Each file is valid alone (< 2 MiB), but the combined export would not be.
    const heavy = (c: number, from: number) => Array.from({ length: 220 }, (_, i): Entry => ({ id: eid(c, from + i), kind: 'word', english: `h${from + i}`, translation: 'т'.repeat(2000), examples: [{ en: 'e'.repeat(2000) }] }));
    resetDatabase(); storage.close(); disableCollections(); await connect();
    await acceptImport(planOf(doc(4, 'Heavy', heavy(4, 0))));
    const growth = planOf(doc(4, 'Heavy', heavy(4, 1000)));
    expect(growth.issues.map((i) => i.message)).toEqual([expect.stringMatching(/2 MiB/)]);
  });

  it('rename is atomic, validated and keeps identities; an oversized result is refused without writing', async () => {
    await acceptImport(planOf(doc(1, 'Name', base(2))));
    const before = await readDatabase();
    await expect(renameCollection(cid(1), '   ')).rejects.toThrow(/required/);
    await expect(renameCollection(cid(1), 'x'.repeat(101))).rejects.toThrow(/at most 100/);
    expect(await readDatabase()).toEqual(before);
    await renameCollection(cid(1), '<b>Нова назва</b>');
    const saved = await readDatabase();
    expect(Object.keys(saved.userEntries!)).toEqual(Object.keys(before.userEntries!));
    expect(saved.userEntries).toEqual(before.userEntries);
    expect(JSON.parse(exportCollection(cid(1))).collection.name).toBe('<b>Нова назва</b>');
  });

  it('double confirmation of one CSV preview creates exactly one collection', async () => {
    const plan = prepareImport(parseImport('english,translation\nonce,раз', 'once.csv'), catalog());
    const [a, b] = await Promise.allSettled([acceptImport(plan), acceptImport(plan)]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    await expect(acceptImport(plan)).rejects.toThrow(/changed/);
    expect(Object.keys((await readDatabase()).userCollections!)).toHaveLength(1);
    results.doubleConfirm = { concurrent: [a.status, b.status], sequentialSecond: 'rejected: collection changed' };
  });

  it('stale no-op import, stale deletion and stale rename are refused when another session changed the record', async () => {
    await acceptImport(planOf(doc(1, 'Shared', base(2))));
    const noop = planOf(doc(1, 'Shared', base(2)));
    expect(noop).toMatchObject({ additions: [], skipped: 2 });
    // Another tab appends an entry: collection record (revision) and entries change.
    const other = await openStorage();
    const current = get(userVocabulary).collections[0];
    const extra = { id: eid(1, 99), kind: 'word', english: 'other tab', translation: 'т', topic: '', examples: [], collectionId: cid(1), position: 2 };
    await other.write([{ type: 'put', store: 'userCollections', key: cid(1), value: { ...current, revision: 2 } }, { type: 'put', store: 'userEntries', key: extra.id, value: extra }]);
    const changed = await readDatabase();
    await expect(acceptImport(noop)).rejects.toThrow(/another session/);
    await expect(removeCollection(cid(1))).rejects.toThrow(/another session/);
    await expect(renameCollection(cid(1), 'Mine')).rejects.toThrow(/another session/);
    expect(await readDatabase()).toEqual(changed);
    expect(get(userVocabulary).entries).toHaveLength(2);
    other.close();
  });

  it('deletion then native reimport restores identical entry records and positions', async () => {
    await acceptImport(planOf(doc(1, 'Cycle', base(5))));
    const exported = exportCollection(cid(1));
    const before = await readDatabase();
    await removeCollection(cid(1));
    expect(catalog()).toBe(builtIn);
    await acceptImport(planOf(exported, 'Cycle.json'));
    const after = await readDatabase();
    expect(after.userEntries).toEqual(before.userEntries);
    expect(exportCollection(cid(1))).toBe(exported);
  });
});
