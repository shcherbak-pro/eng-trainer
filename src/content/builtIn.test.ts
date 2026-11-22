import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBuiltInCatalog } from './builtIn';
import { contentBase, contentResponses, createContentFetch, manifest, packs, realMaterials } from '../test/content';
import type { BuiltInPack } from './packTypes';

afterEach(() => vi.unstubAllGlobals());

function serve(responses: Map<string, unknown>): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const value = responses.get(String(input));
    return value instanceof Response ? value : new Response(JSON.stringify(value), { status: 200 });
  }));
}

describe('built-in pack loading', () => {
  it('waits for every pack, preserves source order despite response order, and searches the last pack immediately', async () => {
    const responses = contentResponses();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const lastUrl = `${contentBase}${manifest.packs[manifest.packs.length - 1].url}`;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === lastUrl) await held;
      // Earlier packs finish later; network order cannot change catalog order.
      const position = manifest.packs.findIndex((pack) => `${contentBase}${pack.url}` === String(input));
      if (position >= 0) await new Promise((resolve) => setTimeout(resolve, manifest.packs.length - position));
      return new Response(JSON.stringify(responses.get(String(input))), { status: 200 });
    }));
    let ready = false;
    const pending = loadBuiltInCatalog().then((catalog) => { ready = true; return catalog; });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(manifest.packs.length + 1));
    expect(ready).toBe(false);
    release();
    const catalog = await pending;
    expect(catalog.phrases).toEqual(realMaterials.phrases);
    expect(catalog.wordIndex).toEqual(realMaterials.wordIndex);
    expect(catalog.irregularVerbs).toEqual(realMaterials.irregularVerbs);
    const last = realMaterials.irregularVerbs[realMaterials.irregularVerbs.length - 1];
    expect(catalog.searchVerbs(last.base).map((entry) => entry.id)).toContain(last.id);
    for (const [url] of vi.mocked(fetch).mock.calls) expect(String(url)).toMatch(/^\/eng-trainer\/data\/(manifest\.json|packs\/)/);
  });

  it.each(['http', 'json', 'metadata', 'counts', 'duplicate', 'reference', 'schema'])(
    'rejects the complete load for a pack %s failure, then retries all content successfully', async (failure) => {
      const responses = contentResponses();
      const url = `${contentBase}${manifest.packs[0].url}`;
      const pack = structuredClone(packs[0]) as BuiltInPack;
      if (failure === 'http') responses.set(url, new Response('Missing pack', { status: 503 }));
      if (failure === 'json') responses.set(url, new Response('<html>Not JSON</html>', { status: 200 }));
      if (failure === 'metadata') pack.id = 'another-pack';
      if (failure === 'counts') pack.content.phrases!.pop();
      if (failure === 'duplicate') pack.content.phrases![0].id = packs[1].content.phrases![0].id;
      if (failure === 'reference') pack.content.wordIndex![0].sourcePhraseId = 'absent-phrase';
      if (failure === 'schema') (pack as { schemaVersion: number }).schemaVersion = 2;
      if (!['http', 'json'].includes(failure)) responses.set(url, pack);
      serve(responses);
      await expect(loadBuiltInCatalog()).rejects.toThrow();
      vi.stubGlobal('fetch', vi.fn(createContentFetch()));
      const catalog = await loadBuiltInCatalog();
      expect(catalog.phrases).toHaveLength(realMaterials.phrases.length);
      expect(fetch).toHaveBeenCalledTimes(manifest.packs.length + 1);
    }
  );

  it('rejects unsafe manifest paths before issuing any pack requests', async () => {
    const responses = contentResponses();
    const unsafe = structuredClone(manifest);
    unsafe.packs[0].url = '../v1/data/materials.json';
    responses.set(`${contentBase}manifest.json`, unsafe);
    serve(responses);
    await expect(loadBuiltInCatalog()).rejects.toThrow(/relative pack path/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('complete search through the loaded shared catalog', () => {
  it('matches a direct field-by-field oracle for every searchable field across all packs', async () => {
    vi.stubGlobal('fetch', vi.fn(createContentFetch()));
    const catalog = await loadBuiltInCatalog();
    const alternatives = (value?: string[] | string) => Array.isArray(value) ? value.join(' ') : value;
    // This oracle uses separate fields and raw records, independent of the
    // catalog's precomputed, joined search strings. Baseline hashes separately
    // prove these records still equal the released monolithic corpus.
    const cases: { search: (query: string) => { id: string }[]; rows: { id: string; fields: unknown[] }[] }[] = [
      { search: catalog.searchPhrases, rows: realMaterials.phrases.map((item) => ({ id: item.id, fields: [item.phrase, item.example, ...(item.examples ?? []).flatMap((example) => [example.en, example.ua]), item.translation, item.transcription, alternatives(item.commonAlternatives), item.category, item.section, item.tag] })) },
      { search: catalog.searchWords, rows: realMaterials.wordIndex.map((item) => ({ id: item.id, fields: [item.term, item.meaning, item.pronunciation, item.transcription, alternatives(item.commonAlternatives), ...item.examples.flatMap((example) => [example.en, example.ua]), item.category, item.section, item.tag] })) },
      { search: catalog.searchVerbs, rows: realMaterials.irregularVerbs.map((item) => ({ id: item.id, fields: [item.base, item.pastSimple, item.pastParticiple, item.translation, item.transcription, alternatives(item.commonAlternatives), item.group] })) },
      { search: catalog.searchBlocks, rows: [...realMaterials.blocks].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)).map((item) => ({ id: item.id, fields: [item.title, item.description, item.type, item.category, item.tag] })) }
    ];
    for (const { rows, search } of cases) {
      const oracle = rows.map((row) => ({ id: row.id, fields: row.fields.map((value) => String(value ?? '').toLowerCase().trim()) }));
      const queries = new Set(['', '   ', 'UNMATCHED zzz 987', 'ai', 'робот', ...rows.flatMap((row) => row.fields.filter((value): value is string => typeof value === 'string' && value.length > 0))]);
      for (const query of queries) {
        const normalized = query.toLowerCase().trim();
        const expected = oracle.filter((row) => !normalized || row.fields.some((field) => field.includes(normalized))).map((row) => row.id);
        expect(search(query.toUpperCase()).map((row) => row.id), query).toEqual(expected);
      }
    }
  }, 20_000); // Exhaustive corpus comparison can share a CI worker with other suites.
});
