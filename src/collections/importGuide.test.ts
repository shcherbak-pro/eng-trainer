import { describe, expect, it } from 'vitest';
import { MAX_ENTRIES, MAX_FILE_BYTES, parseImport } from './format';
import {
  CSV_DETAILED_EXAMPLE,
  CSV_EXAMPLE,
  CSV_GUIDE,
  CSV_SEMICOLON_EXAMPLE,
  csvTemplateParts,
  formatEntryLimit,
  formatFileLimit,
  IMPORT_LIMITS,
  nativeJsonExample
} from './importGuide';

/** The bytes of the downloaded template, decoded the way the import reads a file. */
function templateText(): string {
  const bytes = new TextEncoder().encode(csvTemplateParts().map(String).join(''));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

describe('import help examples', () => {
  it('uses the agreed minimal example, and the real parser accepts it', () => {
    expect(CSV_EXAMPLE).toBe('english,translation\nreliable,надійний\nimprove,покращувати');
    const parsed = parseImport(CSV_EXAMPLE, 'example.csv');
    expect(parsed.issues).toEqual([]);
    expect(parsed.entries.map((entry) => [entry.english, entry.translation, entry.kind])).toEqual([
      ['reliable', 'надійний', 'word'],
      ['improve', 'покращувати', 'word']
    ]);
  });

  it('downloads the same text as the displayed and copied example, with a UTF-8 byte order mark', () => {
    const parts = csvTemplateParts();
    expect(parts[0]).toBe('﻿');
    expect(parts.slice(1).join('')).toBe(CSV_EXAMPLE);
    const decoded = templateText();
    expect(decoded).toBe(CSV_EXAMPLE);
    expect(parseImport(decoded, 'eng-trainer-vocabulary-template.csv').issues).toEqual([]);
  });

  it('describes the detailed example exactly as the parser reads it: explicit phrase, quoting and defaults', () => {
    const parsed = parseImport(CSV_DETAILED_EXAMPLE, 'detailed.csv');
    expect(parsed.issues).toEqual([]);
    expect(parsed.entries.map(({ english, translation, topic, kind, examples }) => ({ english, translation, topic, kind, examples }))).toEqual([
      { english: 'reliable', translation: 'надійний', topic: 'Work', kind: 'word', examples: [{ en: 'Our tests are reliable, so we release often.' }] },
      { english: 'take ownership', translation: 'брати відповідальність', topic: 'Work', kind: 'phrase', examples: [{ en: 'She said, "I\'ll take ownership of the release."' }] },
      { english: 'improve', translation: 'покращувати', topic: '', kind: 'word', examples: [] }
    ]);
  });

  it('accepts the semicolon variant that the help text mentions', () => {
    const parsed = parseImport(CSV_SEMICOLON_EXAMPLE, 'semicolons.csv');
    expect(parsed.issues).toEqual([]);
    expect(parsed.entries[0]).toMatchObject({ english: 'reliable', translation: 'надійний' });
  });

  it('states the columns, kinds and default that the parser enforces', () => {
    expect(CSV_GUIDE.required).toEqual(['english', 'translation']);
    expect(CSV_GUIDE.optional).toEqual(['topic', 'example', 'kind']);
    expect(CSV_GUIDE.kinds).toEqual(['word', 'phrase']);
    expect(CSV_GUIDE.defaultKind).toBe('word');
    // An upper-case kind is not accepted, as the help says ("in lowercase").
    expect(parseImport('english,translation,kind\nx,y,Phrase', 'kind.csv').issues[0]).toMatchObject({ row: 2, field: 'kind' });
  });

  it('reads the limits from the import contract and keeps its boundaries', () => {
    expect(IMPORT_LIMITS).toEqual({ bytes: MAX_FILE_BYTES, entries: MAX_ENTRIES });
    expect(formatFileLimit()).toBe('2 MiB');
    expect(formatEntryLimit()).toBe('1,000');
    const rows = (count: number) => ['english,translation', ...Array.from({ length: count }, (_, index) => `w${index},п${index}`)].join('\n');
    expect(parseImport(rows(MAX_ENTRIES), 'max.csv').entries).toHaveLength(MAX_ENTRIES);
    expect(() => parseImport(rows(MAX_ENTRIES + 1), 'over.csv')).toThrow(/at most 1000 entries/);
  });
});

describe('native JSON reference', () => {
  it('is produced by the real exporter and imports cleanly', () => {
    const json = nativeJsonExample();
    const parsed = parseImport(json, 'reference.json');
    expect(parsed.issues).toEqual([]);
    expect(parsed.source).toBe('json');
    expect(parsed.entries.map((entry) => entry.kind)).toEqual(['word', 'phrase']);
    expect(Object.keys(JSON.parse(json))).toEqual(['format', 'version', 'collection', 'entries']);
  });

  it('never shares identities: every reference gets new collection and entry IDs', () => {
    const first = JSON.parse(nativeJsonExample());
    const second = JSON.parse(nativeJsonExample());
    expect(first.collection.id).not.toBe(second.collection.id);
    expect(first.entries.map((entry: { id: string }) => entry.id)).not.toEqual(second.entries.map((entry: { id: string }) => entry.id));
    for (const entry of first.entries) expect(entry.id.startsWith(`${first.collection.id}:entry:`)).toBe(true);
  });
});
