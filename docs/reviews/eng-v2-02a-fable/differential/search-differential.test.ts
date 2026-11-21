// ENG-V2-02A Fable review — differential catalog/search/flashcard test.
//
// "Released" side: catalog.ts, search.ts, text.ts and flashcards.ts extracted
// from release commit c84ef30 (by prepare-differential.mjs), fed the original
// monolithic public/data/materials.json from the same commit.
// "Candidate" side: the candidate's real loadBuiltInCatalog(), reading the
// assembled production artifact (site-dist/data) through a fetch stub.
//
// Both sides are queried with every string in the corpus plus prefixes,
// middles, suffixes, tokens, case and whitespace variants. Result IDs and
// their order must be identical for every query and every search.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import releasedJson from './baseline/materials.json';
import { createCatalog as createReleasedCatalog } from './baseline/content/catalog';
import { buildFlashcards as buildReleasedFlashcards, filterDeck as releasedFilterDeck, getTopics as releasedGetTopics } from './baseline/features/flashcards/flashcards';
import { loadBuiltInCatalog } from '../content/builtIn';
import { buildFlashcards, filterDeck, getTopics } from '../features/flashcards/flashcards';

const SITE_DATA = resolve(process.env.REVIEW_SITE_DATA ?? join(process.cwd(), 'site-dist', 'data'));
const OUT = process.env.REVIEW_OUT;
const requests: string[] = [];

afterEach(() => vi.unstubAllGlobals());

function serveAssembledSite(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push(url);
    if (init?.cache !== 'no-store') throw new Error(`unexpected fetch options for ${url}`);
    if (!url.startsWith('/eng-trainer/data/')) return new Response('outside v2 data', { status: 404 });
    try {
      return new Response(readFileSync(join(SITE_DATA, url.slice('/eng-trainer/data/'.length)), 'utf8'), { status: 200 });
    } catch {
      return new Response('missing', { status: 404 });
    }
  }));
}

function leaves(value: unknown, out: string[]): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => leaves(entry, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((entry) => leaves(entry, out));
  return out;
}

it('released and candidate catalogs, searches and flashcard decks are identical', async () => {
  const started = Date.now();
  const released = createReleasedCatalog(releasedJson as never);
  serveAssembledSite();
  const candidate = await loadBuiltInCatalog();

  // Whole-catalog equality, including derived values.
  for (const key of ['meta', 'blocks', 'phrases', 'wordIndex', 'irregularVerbs', 'patterns', 'answers', 'drills', 'phraseCategories', 'wordCategories', 'verbSets'] as const) {
    expect(candidate[key], key).toStrictEqual(released[key]);
  }

  // Flashcard identities, topics and every topic deck.
  const releasedCards = buildReleasedFlashcards(releasedJson as never);
  const candidateCards = buildFlashcards(candidate);
  expect(candidateCards).toStrictEqual(releasedCards);
  const topics = getTopics(candidateCards);
  expect(topics).toStrictEqual(releasedGetTopics(releasedCards));
  for (const topic of topics) {
    expect(filterDeck(candidateCards, 'topic', topic).map((card) => card.id), topic)
      .toStrictEqual(releasedFilterDeck(releasedCards, 'topic', topic).map((card) => card.id));
  }

  // Query corpus.
  const corpus = [...released.phrases, ...released.wordIndex, ...released.irregularVerbs, ...(releasedJson as { blocks: unknown[] }).blocks];
  const queries = new Set<string>(['', ' ', '   ', '\t', 'zz-no-match-zz', 'ї', 'є', 'ґ', 'і', '’', "'", '…', '...', '-', '—', ',', '.', '?', 'a', 'i', 'AI', 'ai', 'Ai', 'phrase-001', 'iv-001-be', 'Робота', 'РОБОТА', 'робота']);
  for (const s of new Set(leaves(corpus, []))) {
    queries.add(s);
    queries.add(s.toUpperCase());
    queries.add(s.toLowerCase());
    queries.add(`  ${s}  `);
    if (s.length >= 2) {
      queries.add(s.slice(0, 3));
      queries.add(s.slice(-3));
      queries.add(s.slice(Math.max(0, (s.length >> 1) - 2), (s.length >> 1) + 2));
    }
    for (const token of s.split(/[\s,.;:!?()"«»…/]+/u)) {
      if (token.length < 2) continue;
      queries.add(token);
      queries.add(token.toUpperCase());
      queries.add(token[0].toUpperCase() + token.slice(1).toLowerCase());
    }
  }

  const searches = ['searchPhrases', 'searchWords', 'searchVerbs', 'searchBlocks'] as const;
  const stats = Object.fromEntries(searches.map((name) => [name, { queries: 0, nonEmpty: 0, emptyResults: 0, mismatches: 0 }]));
  const mismatches: unknown[] = [];
  let processed = 0;
  for (const query of queries) {
    // Yield regularly so the Vitest worker can answer its RPC heartbeats.
    if (++processed % 2000 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    for (const name of searches) {
      const before = (released[name](query) as { id: string }[]).map((item) => item.id).join('\n');
      const after = (candidate[name](query) as { id: string }[]).map((item) => item.id).join('\n');
      const s = stats[name];
      s.queries++;
      if (before) s.nonEmpty++; else s.emptyResults++;
      if (before !== after) {
        s.mismatches++;
        if (mismatches.length < 20) mismatches.push({ name, query, before: before.split('\n').length, after: after.split('\n').length });
      }
    }
  }

  // Explicit beginning / middle / end and per-pack probes (recorded for the report).
  const manifest = JSON.parse(readFileSync(join(SITE_DATA, 'manifest.json'), 'utf8'));
  const probes: { pack: string; kind: string; position: string; id: string; query: string; found: boolean }[] = [];
  const primary = { phrases: (x: { phrase: string }) => x.phrase, wordIndex: (x: { term: string }) => x.term, irregularVerbs: (x: { pastParticiple: string }) => x.pastParticiple } as Record<string, (x: never) => string>;
  const searchFor = { phrases: 'searchPhrases', wordIndex: 'searchWords', irregularVerbs: 'searchVerbs' } as const;
  for (const entry of manifest.packs) {
    const pack = JSON.parse(readFileSync(join(SITE_DATA, entry.url), 'utf8'));
    for (const kind of ['phrases', 'wordIndex', 'irregularVerbs'] as const) {
      const list = pack.content[kind] ?? [];
      if (!list.length) continue;
      for (const [position, item] of [['first', list[0]], ['middle', list[list.length >> 1]], ['last', list[list.length - 1]]] as const) {
        const query = primary[kind](item as never).toUpperCase();
        const ids = (candidate[searchFor[kind]](query) as { id: string }[]).map((x) => x.id);
        const releasedIds = (released[searchFor[kind]](query) as { id: string }[]).map((x) => x.id);
        expect(ids).toStrictEqual(releasedIds);
        probes.push({ pack: entry.id, kind, position, id: item.id, query, found: ids.includes(item.id) });
      }
    }
  }
  expect(probes.every((p) => p.found)).toBe(true);

  const summary = {
    siteData: SITE_DATA.replace(process.cwd(), '<candidate>'),
    requests,
    uniqueQueries: queries.size,
    stats,
    mismatches,
    flashcards: { cards: candidateCards.length, topics: topics.length },
    probes,
    durationMs: Date.now() - started
  };
  if (OUT) writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`);
  expect(requests).toHaveLength(1 + manifest.packs.length);
  expect(mismatches).toStrictEqual([]);
}, 600_000);
