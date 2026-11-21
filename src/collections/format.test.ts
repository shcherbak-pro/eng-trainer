import { describe, expect, it } from 'vitest';
import { collection, entry, id, native } from '../test/collections';
import { csvRows, MAX_ENTRIES, MAX_FILE_BYTES, parseImport, serializeCollection } from './format';

describe('CSV vocabulary imports', () => {
  it('reads UTF-8 BOM, quoted commas, quotes, multiline examples and CRLF', () => {
    const parsed = parseImport('\uFEFFenglish,translation,topic,example,kind\r\n"say, hello",привіт,Travel,"She said ""hello"".\r\nAgain.",phrase\r\n', 'Travel.CSV');
    expect(parsed.issues).toEqual([]);
    expect(parsed.entries[0]).toMatchObject({ kind: 'phrase', english: 'say, hello', translation: 'привіт', topic: 'Travel', examples: [{ en: 'She said "hello".\nAgain.' }] });
    expect(parsed.entries[0].id.startsWith(`${parsed.collection.id}:entry:`)).toBe(true);
  });
  it('supports semicolons, case-insensitive headers and optional columns', () => {
    const parsed = parseImport(' English ; TRANSLATION \nleft;ліворуч\n\n', 'simple.csv');
    expect(parsed.issues).toEqual([]);
    expect(parsed.entries[0]).toMatchObject({ kind: 'word', english: 'left', translation: 'ліворуч', topic: '', examples: [] });
  });
  it.each(['english,translation\n"broken,x', 'english,translation\na"b,x', 'english,translation\n"a"bad,x'])('rejects malformed quoting: %s', (csv) => {
    expect(() => parseImport(csv, 'bad.csv')).toThrow(/Malformed CSV/);
  });
  it.each(['english,other\nx,y', 'english,translation,translation\nx,y,z', 'english,translation,unknown\nx,y,z', ''])('rejects invalid headers or empty files: %s', (csv) => {
    expect(() => parseImport(csv, 'bad.csv')).toThrow(/headers|header|empty/);
  });
  it('reports invalid records without silently accepting a partial import', () => {
    const parsed = parseImport('english,translation,kind\nvalid,так,word\nmissing\n,ні,phrase\nx,y,verb', 'rows.csv');
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.issues.map((issue) => issue.row)).toEqual([3, 4, 5]);
  });
  it('retains distinct IDs for identical text and multiple meanings', () => {
    const parsed = parseImport('english,translation\nbank,банк\nbank,берег\nbank,банк', 'bank.csv');
    expect(parsed.entries).toHaveLength(3);
    expect(new Set(parsed.entries.map((item) => item.id)).size).toBe(3);
  });
  it('handles a trailing empty field and quoted delimiters', () => {
    expect(csvRows('a,b,c\n"x,y",z,', ',')).toEqual([['a', 'b', 'c'], ['x,y', 'z', '']]);
  });
});

describe('native vocabulary JSON', () => {
  it('round-trips IDs, kinds, topics, examples and explicit links exactly', () => {
    const entries = [entry(1, { kind: 'phrase' }), entry(2, { sourcePhraseId: id(1) }), entry(3, { english: 'Example 1' })];
    const parsed = parseImport(serializeCollection(collection, entries), 'roundtrip.json');
    expect(parsed.issues).toEqual([]);
    expect(parsed.collection).toEqual(collection);
    expect(parsed.entries).toEqual(entries);
  });
  it.each([null, [], {}, { ...native(), version: 2 }, { ...native(), format: 'other' }, { ...native(), unsupported: true }])('rejects invalid envelopes: %j', (value) => {
    expect(() => parseImport(JSON.stringify(value), 'bad.json')).toThrow(/object|unsupported|version/);
  });
  it('rejects invalid JSON and unsupported file extensions', () => {
    expect(() => parseImport('{', 'bad.json')).toThrow(/Invalid JSON/);
    expect(() => parseImport('{}', 'bad.txt')).toThrow(/\.csv or \.json/);
  });
  it.each([
    { english: '' }, { translation: 4 }, { english: 'a'.repeat(301) }, { kind: 'verb' },
    { id: 'phrase-001' }, { id: '__proto__' }, { topic: ['topic'] }, { english: 'bad\u0000text' },
    { examples: [{ en: '' }] }, { examples: [{ en: 'example', html: true }] },
    { sourcePhraseId: 'phrase-001' }, { kind: 'phrase', sourcePhraseId: id(2) }
  ])('reports invalid entries: %j', (patch) => {
    const value = native(); Object.assign(value.entries[0], patch);
    expect(parseImport(JSON.stringify(value), 'bad.json').issues.length).toBeGreaterThan(0);
  });
  it('rejects duplicate IDs and dangling links', () => {
    expect(parseImport(JSON.stringify(native([entry(1), entry(1)])), 'ids.json').issues[0].message).toMatch(/Duplicate entry IDs/);
    expect(parseImport(JSON.stringify(native([entry(1, { sourcePhraseId: id(2) })])), 'link.json').issues[0].message).toMatch(/missing phrase/);
  });
  it('keeps HTML-looking text as inert strings', () => {
    const value = native([entry(1, { english: '<img src=x onerror=alert(1)>', translation: '=HYPERLINK("x")' })]);
    const parsed = parseImport(JSON.stringify(value), 'text.json');
    expect(parsed.issues).toEqual([]);
    expect(parsed.entries).toEqual(value.entries);
  });
  it('limits file bytes and record count before persistence', () => {
    expect(() => parseImport('x'.repeat(MAX_FILE_BYTES + 1), 'large.csv')).toThrow(/2 MiB/);
    expect(() => parseImport(JSON.stringify(native(Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => entry(i)))), 'many.json')).toThrow(/1000/);
  });
});
