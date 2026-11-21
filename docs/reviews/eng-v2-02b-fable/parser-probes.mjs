// ENG-V2-02B Fable review — independent CSV/JSON parser probes.
// Imports the candidate's src/collections/format.ts directly (Node 24 type
// stripping). Does not use Astra's tests or fixtures.
// Usage: node parser-probes.mjs <candidate-root> <result.json>
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = resolve(process.argv[2] ?? '.');
const out = process.argv[3];
const F = await import(pathToFileURL(join(root, 'src/collections/format.ts')).href);
const { parseImport, serializeCollection, MAX_ENTRIES, MAX_FILE_BYTES } = F;

// Hex letters in both UUIDs so the upper-case probes really change them.
const C = 'user:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER = 'user:99999999-2222-4333-8444-555555555555';
const eid = (n, col = C) => `${col}:entry:fedcba98-0000-4000-8000-${String(n).padStart(12, '0')}`;
const entry = (n, patch = {}) => ({ id: eid(n), kind: 'word', english: `word ${n}`, translation: `слово ${n}`, topic: 'T', examples: [], ...patch });
const doc = (entries = [entry(1)], collection = { id: C, name: 'Review', description: '' }, extra = {}) => ({ format: 'eng-trainer-vocabulary', version: 1, collection, entries, ...extra });
const json = (value) => JSON.stringify(value);
const bytes = (s) => new TextEncoder().encode(s).length;

const results = [];
function probe(name, expectation, run) {
  const started = performance.now();
  let outcome, error, value;
  try { value = run(); outcome = 'returned'; } catch (e) { outcome = 'threw'; error = e.message; }
  const ms = +(performance.now() - started).toFixed(1);
  let pass = true, note = '';
  try { expectation({ outcome, error, value }); } catch (e) { pass = false; note = e.message; }
  const summary = value ? { entries: value.entries?.length, issues: value.issues?.map((i) => `${i.row}: ${i.message}`).slice(0, 4), collection: value.collection?.name } : undefined;
  results.push({ name, pass, outcome, error, ms, ...(summary ? { summary } : {}), ...(note ? { note } : {}) });
}
const accepts = (check = () => {}) => ({ outcome, error, value }) => { assert.equal(outcome, 'returned', error); assert.deepEqual(value.issues, []); check(value); };
const throws = (re) => ({ outcome, error }) => { assert.equal(outcome, 'threw', 'expected the whole file to be rejected'); assert.match(error, re); };
const issue = (re, rows) => ({ outcome, error, value }) => {
  assert.equal(outcome, 'returned', error);
  assert.ok(value.issues.length > 0, 'expected a blocking issue');
  assert.ok(value.issues.some((i) => re.test(i.message)), JSON.stringify(value.issues.slice(0, 3)));
  if (rows) assert.deepEqual(value.issues.map((i) => i.row), rows);
};
const csv = (text, name = 'review.csv') => () => parseImport(text, name);
const js = (value, name = 'review.json') => () => parseImport(typeof value === 'string' ? value : json(value), name);
const rows = (n, make = (i) => `w${i},с${i}`) => 'english,translation\n' + Array.from({ length: n }, (_, i) => make(i)).join('\n');

// ---------------- CSV: encoding, delimiters, quoting ----------------
probe('csv: BOM, CRLF, quoted comma, doubled quotes, multiline field', accepts((v) => {
  assert.deepEqual(v.entries.map((e) => [e.english, e.translation, e.topic, e.examples, e.kind]), [['say, "hi"', 'привіт', 'Travel', [{ en: 'Line 1\nLine 2' }], 'phrase']]);
}), csv('﻿english,translation,topic,example,kind\r\n"say, ""hi""",привіт,Travel,"Line 1\r\nLine 2",phrase\r\n'));
probe('csv: semicolon delimiter with quoted semicolon and literal comma', accepts((v) => {
  assert.deepEqual(v.entries.map((e) => [e.english, e.translation]), [['a;b', 'x'], ['hello, world', 'привіт, світ']]);
}), csv('english;translation\n"a;b";x\nhello, world;привіт, світ\n'));
probe('csv: comma file whose data contains semicolons stays comma-delimited', accepts((v) => assert.equal(v.entries[0].english, 'a;b')), csv('english,translation\na;b,x'));
probe('csv: headers ignore case and surrounding whitespace, columns in any order', accepts((v) => assert.deepEqual([v.entries[0].english, v.entries[0].translation, v.entries[0].topic], ['bank', 'банк', 'Money'])), csv('  Topic , TRANSLATION ,English\nMoney,банк,bank'));
probe('csv: quoted header names', accepts(), csv('"english","translation"\nx,y'));
probe('csv: lone CR line endings', accepts((v) => assert.equal(v.entries.length, 2)), csv('english,translation\rx,y\rz,w'));
probe('csv: LF without trailing newline', accepts((v) => assert.equal(v.entries.length, 1)), csv('english,translation\nx,y'));
probe('csv: empty and whitespace-only records are ignored', accepts((v) => assert.equal(v.entries.length, 2)), csv('english,translation\n\nx,y\n  ,  \n\r\nz,w\n\n'));
probe('csv: tab inside a field is kept (not a control-character error)', accepts((v) => assert.equal(v.entries[0].english, 'a\tb')), csv('english,translation\n"a\tb",y'));
probe('csv: surrounding field whitespace is trimmed', accepts((v) => assert.deepEqual([v.entries[0].english, v.entries[0].translation], ['bank', 'банк'])), csv('english,translation\n  bank  ,  банк '));
probe('csv: empty kind defaults to word; phrase kept', accepts((v) => assert.deepEqual(v.entries.map((e) => e.kind), ['word', 'phrase'])), csv('english,translation,kind\na,b,\nc,d,phrase'));
probe('csv: example column becomes one example without translation', accepts((v) => assert.deepEqual(v.entries[0].examples, [{ en: 'Use it.' }])), csv('english,translation,example\na,b,Use it.'));
probe('csv: formula-like and HTML-like text is kept literally', accepts((v) => assert.deepEqual(v.entries.map((e) => e.english), ['=HYPERLINK("http://x")', '<img src=x onerror=alert(1)>', '@SUM(1)'])), csv('english,translation\n"=HYPERLINK(""http://x"")",y\n<img src=x onerror=alert(1)>,y\n@SUM(1),y'));
probe('csv: same text with different meanings gets distinct IDs (no text dedup)', accepts((v) => {
  assert.equal(v.entries.length, 3); assert.equal(new Set(v.entries.map((e) => e.id)).size, 3);
  assert.ok(v.entries.every((e) => e.id.startsWith(v.collection.id + ':entry:')));
}), csv('english,translation\nbank,банк\nbank,берег\nBank!,банк'));
probe('csv: collection ID and entry IDs use the native lowercase UUID namespace', accepts((v) => {
  assert.match(v.collection.id, /^user:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
}), csv('english,translation\nx,y'));
probe('csv: two parses of the same file propose different collection IDs', ({ value }) => assert.notEqual(value[0], value[1]),
  () => [parseImport('english,translation\nx,y', 'a.csv').collection.id, parseImport('english,translation\nx,y', 'a.csv').collection.id]);

// ---------------- CSV: headers ----------------
probe('csv: missing translation header', throws(/english and translation headers/), csv('english\nx'));
probe('csv: missing english header', throws(/english and translation headers/), csv('translation\nx'));
probe('csv: duplicate header (case-insensitive)', throws(/duplicate or unsupported header/), csv('english,English,translation\na,b,c'));
probe('csv: unsupported header', throws(/duplicate or unsupported header/), csv('english,translation,notes\na,b,c'));
probe('csv: empty header cell', throws(/duplicate or unsupported header/), csv('english,translation,\na,b,c'));
probe('csv: empty file', throws(/empty/), csv(''));
probe('csv: BOM-only file', throws(/empty/), csv('﻿'));
probe('csv: header only', throws(/no entries/), csv('english,translation\n'));
probe('csv: header followed only by empty records', throws(/no entries/), csv('english,translation\n\n  ,  \n'));

// ---------------- CSV: malformed input ----------------
probe('csv: unclosed quote', throws(/opening quote has no closing quote/), csv('english,translation\n"x,y'));
probe('csv: quote inside an unquoted field', throws(/Malformed CSV/), csv('english,translation\na"b,y'));
probe('csv: text after a closing quote', throws(/Malformed CSV/), csv('english,translation\n"a"b,y'));
probe('csv: whitespace before an opening quote (strict RFC 4180)', throws(/Malformed CSV/), csv('english,translation\n x,"y"\n "a",b'));
probe('csv: whitespace after a closing quote (strict RFC 4180)', throws(/Malformed CSV/), csv('english,translation\n"a" ,b'));
probe('csv: fewer fields than headers -> record issue with record number', issue(/number of fields/, [3]), csv('english,translation\nok,так\nmissing\n'));
probe('csv: more fields than headers (trailing delimiter) -> record issue', issue(/number of fields/, [2]), csv('english,translation\na,b,'));
probe('csv: empty required english -> record issue', issue(/English text is required/, [2]), csv('english,translation\n,так'));
probe('csv: empty required translation -> record issue', issue(/Translation is required/, [2]), csv('english,translation\nx,'));
probe('csv: invalid kind -> record issue', issue(/Kind must be word or phrase/, [2]), csv('english,translation,kind\nx,y,verb'));
probe('csv: kind is case-sensitive (Phrase rejected)', issue(/Kind must be word or phrase/, [2]), csv('english,translation,kind\nx,y,Phrase'));
probe('csv: NUL / BEL control characters -> record issue', issue(/control characters/, [2, 3]), csv('english,translation\n"a\u0000b",y\n"a\u0007b",y'));
probe('csv: every invalid record is reported, valid ones are not imported implicitly', ({ outcome, value }) => {
  assert.equal(outcome, 'returned'); assert.deepEqual(value.issues.map((i) => i.row), [3, 5]); assert.equal(value.entries.length, 2);
}, csv('english,translation\nok1,так\nbad\nok2,так\n,missing'));
probe('csv: record numbers count non-empty records, not physical lines (empty lines and multiline fields shift them)', ({ value }) => {
  // Physical line of the bad record is 7; the reported record number is 4.
  assert.deepEqual(value.issues.map((i) => i.row), [4]);
}, csv('english,translation\n"multi\nline",y\n\n\nok,y\nbad\n'));

// ---------------- CSV: field-length boundaries ----------------
const field = (n, ch = 'a') => ch.repeat(n);
probe('csv: english 300 chars accepted', accepts(), csv(`english,translation\n${field(300)},y`));
probe('csv: english 301 chars -> issue', issue(/at most 300/), csv(`english,translation\n${field(301)},y`));
probe('csv: translation 2000 accepted / 2001 -> issue', ({ value }) => {
  assert.deepEqual(value.issues.map((i) => i.row), [3]);
}, csv(`english,translation\nx,${field(2000, 'б')}\nz,${field(2001, 'б')}`));
probe('csv: topic 100 accepted / 101 -> issue', ({ value }) => assert.deepEqual(value.issues.map((i) => i.row), [3]), csv(`english,translation,topic\nx,y,${field(100)}\nz,w,${field(101)}`));
probe('csv: example 4000 accepted / 4001 -> issue', ({ value }) => assert.deepEqual(value.issues.map((i) => i.row), [3]), csv(`english,translation,example\nx,y,${field(4000)}\nz,w,${field(4001)}`));
probe('csv: lengths are measured after trimming', accepts(), csv(`english,translation\n"   ${field(300)}   ",y`));

// ---------------- CSV: entry-count and byte boundaries ----------------
probe('csv: exactly 1,000 records accepted', accepts((v) => assert.equal(v.entries.length, MAX_ENTRIES)), csv(rows(1000)));
probe('csv: 1,001 records rejected', throws(/at most 1000 entries/), csv(rows(1001)));
probe('csv: 1,000 records plus 500 empty lines accepted', accepts((v) => assert.equal(v.entries.length, 1000)), csv(rows(1000) + '\n'.repeat(500)));
probe('csv: 1,001 records where one has a field-count error still rejected by count', throws(/at most 1000/), csv(rows(1000) + '\nbad'));
const sized = (target) => { const head = 'english,translation\nx,'; return head + 'y'.repeat(target - bytes(head)); };
probe('size: exactly 2 MiB (2,097,152 bytes) passes the byte check', ({ outcome, error }) => assert.ok(outcome === 'returned' || !/2 MiB/.test(error), error), csv(sized(MAX_FILE_BYTES)));
probe('size: 2 MiB + 1 byte rejected', throws(/2 MiB/), csv(sized(MAX_FILE_BYTES + 1)));
probe('size: limit counts UTF-8 bytes, not characters (1,048,577 Cyrillic chars)', throws(/2 MiB/), csv('english,translation\nx,' + 'б'.repeat(1048577)));
probe('size: the leading BOM counts toward the byte limit in parseImport', throws(/2 MiB/), csv('﻿' + sized(MAX_FILE_BYTES - 2)));

// ---------------- CSV: pathological input (timing) ----------------
const big = MAX_FILE_BYTES - 64;
probe('pathological: ~2 MiB of commas in one record (an all-empty record is ignored)', throws(/no entries/), csv('english,translation\n' + ','.repeat(big)));
probe('pathological: ~2 MiB of "x," fields in one record', issue(/number of fields/), csv('english,translation\n' + 'x,'.repeat(big / 2)));
probe('pathological: ~2 MiB of double quotes (one quoted field of escaped quotes)', issue(/number of fields/), csv('english,translation\n' + '"'.repeat(big)));
probe('pathological: odd number of double quotes (unclosed)', throws(/no closing quote/), csv('english,translation\n' + '"'.repeat(big - 1)));
probe('pathological: ~2 MiB of newlines', throws(/no entries/), csv('english,translation\n' + '\n'.repeat(big)));
probe('pathological: ~1M tiny records stop early at the entry limit', throws(/at most 1000/), csv('english,translation\n' + 'a,b\n'.repeat(Math.floor(big / 4))));
probe('pathological: one ~2 MiB quoted field', issue(/at most 300/), csv('english,translation\n"' + 'a'.repeat(big) + '",y'));
probe('pathological: header line with ~2 MiB of semicolons (an empty record)', throws(/empty/), csv(';'.repeat(big)));

// ---------------- File names ----------------
probe('name: upper-case .CSV extension accepted', accepts(), csv('english,translation\nx,y', 'WORDS.CSV'));
probe('name: unsupported extension rejected', throws(/\.csv or \.json/), csv('english,translation\nx,y', 'words.txt'));
probe('name: no extension rejected', throws(/\.csv or \.json/), csv('english,translation\nx,y', 'words'));
probe('name: 256-character file name rejected', throws(/File name must be at most 255/), csv('english,translation\nx,y', 'a'.repeat(252) + '.csv'));
probe('name: ".csv" alone -> default collection name', accepts((v) => assert.equal(v.collection.name, 'Imported vocabulary')), csv('english,translation\nx,y', '.csv'));
probe('name: CSV collection name truncated to 100 UTF-16 units', accepts((v) => assert.equal(v.collection.name.length, 100)), csv('english,translation\nx,y', 'n'.repeat(150) + '.csv'));
probe('name: truncation can split a surrogate pair (emoji at the 100th unit)', accepts((v) => {
  const last = v.collection.name.charCodeAt(99); assert.ok(last >= 0xd800 && last <= 0xdbff, 'expected a lone high surrogate');
}), csv('english,translation\nx,y', 'n'.repeat(99) + '😀rest.csv'));

// ---------------- JSON: envelope ----------------
probe('json: minimal valid file; optional topic/examples/description default', accepts((v) => {
  assert.deepEqual(v.collection, { id: C, name: 'Review', description: '' });
  assert.deepEqual(v.entries[0], { id: eid(1), kind: 'phrase', english: 'Hi', translation: 'Привіт', topic: '', examples: [] });
}), js(doc([{ id: eid(1), kind: 'phrase', english: 'Hi', translation: 'Привіт' }], { id: C, name: 'Review' })));
probe('json: invalid syntax', throws(/Invalid JSON/), js('{"format":'));
probe('json: top-level array', throws(/File must be an object/), js([]));
probe('json: version 2', throws(/version 1/), js(doc(undefined, undefined, { version: 2 })));
probe('json: version "1" (string)', throws(/version 1/), js(doc(undefined, undefined, { version: '1' })));
probe('json: other format marker', throws(/version 1/), js(doc(undefined, undefined, { format: 'anki' })));
probe('json: unknown envelope field', throws(/unsupported field/), js(doc(undefined, undefined, { exportedAt: 'x' })));
probe('json: unknown collection field (whole file rejected)', throws(/Collection contains an unsupported field/), js(doc(undefined, { id: C, name: 'x', description: '', color: 'red' })));
probe('json: missing collection', throws(/Collection must be an object/), js({ format: 'eng-trainer-vocabulary', version: 1, entries: [entry(1)] }));
probe('json: missing collection name', throws(/Collection name must be text/), js(doc(undefined, { id: C })));
probe('json: whitespace-only collection name', throws(/Collection name is required/), js(doc(undefined, { id: C, name: '   ' })));
probe('json: collection name 100 accepted', accepts(), js(doc(undefined, { id: C, name: field(100) })));
probe('json: collection name 101 rejected', throws(/at most 100/), js(doc(undefined, { id: C, name: field(101) })));
probe('json: description 1000 accepted / 1001 rejected', ({ value }) => assert.deepEqual(value, [true, false]), () => [1000, 1001].map((n) => { try { parseImport(json(doc(undefined, { id: C, name: 'x', description: field(n) })), 'd.json'); return true; } catch { return false; } }));
probe('json: entries not an array', throws(/Entries must be an array/), js(doc({})));
probe('json: empty entries', throws(/no entries/), js(doc([])));
probe('json: exactly 1,000 entries accepted', accepts((v) => assert.equal(v.entries.length, 1000)), js(doc(Array.from({ length: 1000 }, (_, i) => entry(i)))));
probe('json: 1,001 entries rejected', throws(/at most 1000/), js(doc(Array.from({ length: 1001 }, (_, i) => entry(i)))));

// ---------------- JSON: identity namespaces ----------------
probe('json: built-in style collection ID rejected', throws(/native user UUID/), js(doc(undefined, { id: 'phrase-001', name: 'x' })));
probe('json: upper-case UUID collection ID rejected', throws(/native user UUID/), js(doc(undefined, { id: 'user:' + C.slice(5).toUpperCase(), name: 'x' })));
probe('json: collection ID with trailing text rejected', throws(/native user UUID/), js(doc(undefined, { id: C + 'x', name: 'x' })));
probe('json: built-in entry ID (phrase-001) -> issue', issue(/belong to this collection/), js(doc([entry(1, { id: 'phrase-001' })])));
probe('json: entry ID of another collection -> issue', issue(/belong to this collection/), js(doc([entry(1, { id: eid(1, OTHER) })])));
probe('json: entry ID with upper-case UUID -> issue', issue(/belong to this collection/), js(doc([entry(1, { id: `${C}:entry:${eid(1).split(':entry:')[1].toUpperCase()}` })])));
probe('json: non-string entry ID -> issue', issue(/belong to this collection/), js(doc([entry(1, { id: 7 })])));
probe('json: duplicate entry IDs -> issue', issue(/Duplicate entry IDs/), js(doc([entry(1), entry(1, { english: 'other' })])));
probe('json: same English text with different meanings and IDs accepted', accepts((v) => assert.equal(v.entries.length, 2)), js(doc([entry(1, { english: 'bank', translation: 'банк' }), entry(2, { english: 'bank', translation: 'берег' })])));

// ---------------- JSON: links ----------------
probe('json: word -> phrase link in the same file accepted', accepts((v) => assert.equal(v.entries[1].sourcePhraseId, eid(1))), js(doc([entry(1, { kind: 'phrase' }), entry(2, { sourcePhraseId: eid(1) })])));
probe('json: link declared before its phrase accepted (order-independent)', accepts(), js(doc([entry(2, { sourcePhraseId: eid(1) }), entry(1, { kind: 'phrase' })])));
probe('json: several words linked to one phrase accepted', accepts(), js(doc([entry(1, { kind: 'phrase' }), entry(2, { sourcePhraseId: eid(1) }), entry(3, { sourcePhraseId: eid(1) })])));
probe('json: link to a word -> issue', issue(/missing phrase/), js(doc([entry(1), entry(2, { sourcePhraseId: eid(1) })])));
probe('json: self-link -> issue', issue(/missing phrase/), js(doc([entry(1, { sourcePhraseId: eid(1) })])));
probe('json: phrase with sourcePhraseId -> issue', issue(/Only a word can link/), js(doc([entry(1, { kind: 'phrase' }), entry(2, { kind: 'phrase', sourcePhraseId: eid(1) })])));
probe('json: link to built-in phrase-001 -> issue', issue(/Only a word can link/), js(doc([entry(1, { sourcePhraseId: 'phrase-001' })])));
probe('json: link to another collection -> issue', issue(/Only a word can link/), js(doc([entry(1, { sourcePhraseId: eid(1, OTHER) })])));
probe('json: dangling same-collection link -> issue', issue(/missing phrase/), js(doc([entry(1, { sourcePhraseId: eid(9) })])));
probe('json: null sourcePhraseId -> issue', issue(/Only a word can link/), js(doc([entry(1, { sourcePhraseId: null })])));

// ---------------- JSON: fields ----------------
probe('json: unknown entry field -> issue', issue(/Entry contains an unsupported field/), js(doc([entry(1, { audio: 'x.mp3' })])));
probe('json: kind verb -> issue', issue(/Kind must be word or phrase/), js(doc([entry(1, { kind: 'verb' })])));
probe('json: number as translation -> issue', issue(/Translation must be text/), js(doc([entry(1, { translation: 5 })])));
probe('json: array as topic -> issue', issue(/Topic must be text/), js(doc([entry(1, { topic: ['a'] })])));
probe('json: null topic/examples treated as absent (lenient)', accepts((v) => assert.deepEqual([v.entries[0].topic, v.entries[0].examples], ['', []])), js(doc([entry(1, { topic: null, examples: null })])));
probe('json: five examples accepted / six -> issue', ({ value }) => assert.deepEqual(value, [true, false]), () => [5, 6].map((n) => parseImport(json(doc([entry(1, { examples: Array.from({ length: n }, (_, i) => ({ en: `e${i}` })) })])), 'x.json').issues.length === 0));
probe('json: example without en -> issue', issue(/Example text must be text/), js(doc([entry(1, { examples: [{ translation: 'x' }] })])));
probe('json: example with ua instead of translation -> issue', issue(/Example contains an unsupported field/), js(doc([entry(1, { examples: [{ en: 'x', ua: 'y' }] })])));
probe('json: example translation optional, empty allowed', accepts((v) => assert.deepEqual(v.entries[0].examples, [{ en: 'x', translation: '' }, { en: 'y' }])), js(doc([entry(1, { examples: [{ en: 'x', translation: '' }, { en: 'y' }] })])));
probe('json: values are trimmed', accepts((v) => assert.deepEqual([v.entries[0].english, v.entries[0].translation, v.entries[0].topic], ['bank', 'банк', 'Money'])), js(doc([entry(1, { english: '  bank ', translation: ' банк\n', topic: ' Money ' })])));
probe('json: control character in english -> issue', issue(/control characters/), js(doc([entry(1, { english: 'a\u0001b' })])));
probe('json: lone surrogate accepted and re-serialized as an escape', accepts((v) => {
  const text = serializeCollection(v.collection, v.entries); assert.match(text, /\\ud800/); assert.deepEqual(parseImport(text, 'r.json').entries, v.entries);
}), js(doc([entry(1, { english: 'a\ud800b' })])));
probe('json: duplicate JSON keys — last value wins (JSON.parse semantics)', accepts((v) => assert.equal(v.entries[0].english, 'second')),
  js(`{"format":"eng-trainer-vocabulary","version":1,"collection":{"id":"${C}","name":"x"},"entries":[{"id":"${eid(1)}","kind":"word","english":"first","english":"second","translation":"y"}]}`));

// ---------------- JSON: object-property safety ----------------
const proto = (where) => {
  const entryText = `{"id":"${eid(1)}","kind":"word","english":"x","translation":"y"${where === 'entry' ? ',"__proto__":{"polluted":1}' : ''}${where === 'example' ? ',"examples":[{"en":"x","__proto__":{"polluted":1}}]' : ''}}`;
  return `{"format":"eng-trainer-vocabulary","version":1${where === 'envelope' ? ',"__proto__":{"polluted":1}' : ''},"collection":{"id":"${C}","name":"x"${where === 'collection' ? ',"__proto__":{"polluted":1}' : ''}},"entries":[${entryText}]}`;
};
for (const where of ['envelope', 'collection', 'entry', 'example']) {
  probe(`json: __proto__ key in ${where} rejected; Object.prototype untouched`, ({ outcome, error, value }) => {
    assert.ok(outcome === 'threw' ? /unsupported field/.test(error) : value.issues.some((i) => /unsupported field/.test(i.message)), error ?? JSON.stringify(value.issues));
    assert.equal({}.polluted, undefined);
  }, js(proto(where)));
}
probe('json: constructor / prototype keys rejected', issue(/unsupported field/), js(doc([entry(1, { constructor: { prototype: { polluted: 1 } } })])));
probe('json: ~2 MiB of nested arrays handled without crashing', ({ outcome, error }) => { assert.equal(outcome, 'threw'); assert.match(error, /Invalid JSON|File must be an object|object/); },
  js('['.repeat(big / 2) + ']'.repeat(big / 2)));

// ---------------- Export round-trip (format level) ----------------
probe('export: serialize -> parse -> serialize is byte-identical, links and order kept', ({ value }) => {
  assert.equal(value.second, value.first); assert.deepEqual(value.parsed.entries, value.entries);
}, () => {
  const entries = [entry(3, { kind: 'phrase', examples: [{ en: 'a', translation: 'б' }] }), entry(1, { sourcePhraseId: eid(3) }), entry(2, { english: '<b>x</b>' })];
  const first = serializeCollection({ id: C, name: 'Round trip', description: 'd' }, entries);
  const parsed = parseImport(first, 'rt.json');
  return { first, entries, parsed, second: serializeCollection(parsed.collection, parsed.entries) };
});
probe('export: serializer rejects invalid collection metadata', throws(/native user UUID/), () => serializeCollection({ id: 'x', name: 'y', description: '' }, []));

// ---------------- Summary ----------------
const failed = results.filter((r) => !r.pass);
const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 6).map(({ name, ms }) => ({ name, ms }));
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.pass ? '' : ' :: ' + r.note}${r.ms > 50 ? ` (${r.ms} ms)` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} parser probes behaved as expected. Slowest: ${slowest.map((s) => `${s.ms} ms`).join(', ')}`);
if (out) await writeFile(out, JSON.stringify({ node: process.version, total: results.length, failed: failed.length, slowest, results }, null, 2) + '\n');
if (failed.length) process.exitCode = 1;
