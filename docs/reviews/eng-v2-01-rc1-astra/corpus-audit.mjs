// Review-only independent corpus and saved-order audit. No application writes.
// node corpus-audit.mjs <candidate> <original-candidate> <output.json>
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [candidateArg, originalArg, output] = process.argv.slice(2);
const candidate = resolve(candidateArg), original = resolve(originalArg);
const { default: ts } = await import(pathToFileURL(join(candidate, 'node_modules/typescript/lib/typescript.js')));
async function load(root) {
  const source = readFileSync(join(root, 'src/features/flashcards/flashcards.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}
const current = await load(candidate), prior = await load(original);
const data = JSON.parse(readFileSync(join(candidate, 'public/data/materials.json'), 'utf8'));
const cards = current.buildFlashcards(data), oldCards = prior.buildFlashcards(data);
const ids = cards.map(c => c.id), phraseIds = data.phrases.map(p => p.id);
assert.equal(cards.length, 566);
assert.equal(oldCards.length, 560);
assert.deepEqual(ids, phraseIds, 'Default ordering must exactly follow distinct source phrase IDs');
assert.equal(new Set(ids).size, 566);
assert.equal(data.wordIndex.length, 566);
for (const p of data.phrases) {
  const c = cards.find(c => c.id === p.id);
  const links = data.wordIndex.filter(w => w.sourcePhraseId === p.id);
  assert.equal(links.length, 1, `Shipped phrase ${p.id} has exactly one explicit word link`);
  assert.equal(c.phraseId, p.id);
  assert.equal(c.text, p.phrase);
  assert.deepEqual(c.wordIds, links.map(w => w.id));
  assert.deepEqual([...c.topics].sort(), [...new Set([p.category, ...links.map(w => w.category)].filter(Boolean))].sort());
}
assert.deepEqual(cards.flatMap(c => c.wordIds).sort(), data.wordIndex.map(w => w.id).sort());
const pairs = [
  ['phrase-005', 'hedging-005-from-my-perspective'],
  ['phrase-013', 'advanced-linking-008-that-being-said'],
  ['phrase-084', 'advanced-linking-004-consequently'],
  ['presentation-phrase-085', 'advanced-linking-009-as-a-result'],
  ['presentation-phrase-087', 'advanced-linking-012-more-importantly'],
  ['presentation-phrase-088', 'hedging-008-to-some-extent']
];
assert.deepEqual(oldCards.filter(c => c.phraseIds.length > 1).map(c => c.phraseIds).sort(), [...pairs].sort());
const empty = { learnedPhrases: [], hiddenPhrases: [], hiddenWords: [] };
const cases = pairs.map(pair => {
  const pairCards = pair.map(id => cards.find(c => c.id === id));
  for (const learnedId of pair) {
    const result = current.summarizeDeck(pairCards, { ...empty, learnedPhrases: [learnedId] });
    assert.deepEqual(result.learned.map(c => c.id), [learnedId]);
    assert.deepEqual(result.learning.map(c => c.id), pair.filter(id => id !== learnedId));
    const hidden = current.summarizeDeck(pairCards, { ...empty, hiddenWords: cards.find(c => c.id === learnedId).wordIds });
    assert.equal(hidden.hiddenCount, 1);
    assert.deepEqual(hidden.learning.map(c => c.id), pair.filter(id => id !== learnedId));
  }
  return pairCards.map(c => ({ id: c.id, text: c.text, topics: c.topics, wordIds: c.wordIds, index: ids.indexOf(c.id) }));
});
const sourceTopics = [...new Set([...data.phrases.map(p => p.category), ...data.wordIndex.map(w => w.category)].filter(Boolean))].sort((a,b) => a.localeCompare(b));
assert.deepEqual(current.getTopics(cards), sourceTopics);
const topics = sourceTopics.map(topic => {
  // Oracle is raw content membership, independent of card-builder output.
  const expected = data.phrases.filter(p => p.category === topic || data.wordIndex.some(w => w.sourcePhraseId === p.id && w.category === topic)).map(p => p.id);
  const deck = current.filterDeck(cards, 'topic', topic);
  assert.deepEqual(deck.map(c => c.id), expected);
  const learnedPhrases = pairs.map(pair => pair[0]);
  const summary = current.summarizeDeck(deck, { ...empty, learnedPhrases });
  assert.deepEqual(summary.learned.map(c => c.id), expected.filter(id => learnedPhrases.includes(id)));
  return { topic, oldCount: prior.filterDeck(oldCards, 'topic', topic).length, count: deck.length, ids: expected };
});
const oldOrder = oldCards.map(c => c.id);
const saved = { order: oldOrder, index: 80 };
const restored = current.resolveSession(saved, ids);
const newIds = ids.filter(id => !oldOrder.includes(id));
assert.deepEqual(restored.order, [...oldOrder, ...newIds]);
assert.equal(restored.index, 80);
assert.equal(restored.order[restored.index], oldOrder[80]);
assert.equal(new Set(restored.order).size, 566);
const report = { status: 'PASS', candidate, original, phraseCount: phraseIds.length, wordCount: data.wordIndex.length, oldCards: oldCards.length, cards: cards.length, cases, topics, savedOrder: { previousCount: oldOrder.length, restoredCount: restored.order.length, index: restored.index, currentId: restored.order[restored.index], appendedIds: newIds } };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, cases, topics: topics.map(({ids, ...rest}) => rest) }, null, 2));
