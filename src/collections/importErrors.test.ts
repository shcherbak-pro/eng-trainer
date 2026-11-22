import { describe, expect, it } from 'vitest';
import { checkImportFileSize, decodeImportFile, ImportError, importFormatOf, MAX_FILE_BYTES, parseImport } from './format';
import { collection, entry, native } from '../test/collections';
import { describeImportError, describeIssue } from '../features/collections/importFeedback';

function rejection(run: () => unknown): ImportError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError);
    return error as ImportError;
  }
  throw new Error('Expected the file to be rejected');
}

describe('typed import errors (messages unchanged)', () => {
  it('names the exact missing column and offers the template', () => {
    const error = rejection(() => parseImport('english,meaning\nreliable,надійний', 'words.csv'));
    expect(error.code).toBe('csv-missing-columns');
    expect(error.details.columns).toEqual(['translation']);
    expect(error.message).toBe('CSV needs english and translation headers; topic, example and kind are optional.');
    const problem = describeImportError(error);
    expect(problem.title).toBe('Missing column: “translation”');
    expect(problem.text).toBe(
      'The first row must name the columns. “english” and “translation” are required; “topic”, “example” and “kind” are optional. Upper or lower case does not matter.'
    );
    // The parser message would only repeat the explanation, so no technical detail is shown.
    expect(problem.detail).toBe('');
    expect(problem.offerTemplate).toBe(true);
    expect(describeImportError(rejection(() => parseImport('topic\nWork', 'words.csv'))).title).toBe('Missing columns: “english” and “translation”');
  });

  it('lists unsupported or repeated columns', () => {
    expect(rejection(() => parseImport('english,translation,notes\nx,y,z', 'a.csv')).details.columns).toEqual(['notes']);
    expect(rejection(() => parseImport('english,translation,english\nx,y,z', 'a.csv')).details.columns).toEqual(['english']);
    expect(describeImportError(rejection(() => parseImport('english,translation,notes\nx,y,z', 'a.csv'))).title).toBe('Column not supported: “notes”');
    expect(describeImportError(rejection(() => parseImport('english,translation,notes,level\nx,y,z,w', 'a.csv'))).title).toBe('Columns not supported: “notes” and “level”');
    // Damaged JSON keeps the parser's message as technical detail: it says where the file breaks.
    expect(describeImportError(rejection(() => parseImport('{"format":', 'export.json'))).detail).not.toBe('');
  });

  it('separates unsupported files, damaged JSON and JSON that is not an eng-trainer export', () => {
    expect(rejection(() => importFormatOf('vocabulary.xlsx')).code).toBe('unsupported-format');
    expect(rejection(() => parseImport('{"format":', 'export.json')).code).toBe('json-syntax');
    expect(rejection(() => parseImport('{"words":[]}', 'other.json')).code).toBe('json-not-native');
    expect(rejection(() => parseImport('[1,2,3]', 'other.json')).code).toBe('json-not-native');
    expect(rejection(() => parseImport(JSON.stringify({ ...native(), collection: { ...collection, id: 'user:bad' } }), 'broken.json')).code).toBe('invalid-native');
    expect(describeImportError(rejection(() => parseImport('{"words":[]}', 'other.json'))).text).toContain('For JSON, choose a file exported from eng-trainer. Other JSON structures are not supported.');
    expect(describeImportError(rejection(() => parseImport('{"format":', 'export.json'))).title).toBe('This JSON file is damaged');
  });

  it('states the limits that were exceeded', () => {
    const size = rejection(() => checkImportFileSize(MAX_FILE_BYTES + 1));
    expect(size.code).toBe('too-large');
    expect(describeImportError(size).text).toContain('up to 2 MiB');
    expect(() => checkImportFileSize(MAX_FILE_BYTES)).not.toThrow();
    const many = rejection(() => parseImport(JSON.stringify(native(Array.from({ length: 1001 }, (_, i) => entry(i)))), 'many.json'));
    expect(many.code).toBe('too-many-entries');
    expect(describeImportError(many).text).toContain('up to 1,000 entries');
  });

  it('recognizes empty files, header-only files and other encodings', () => {
    expect(rejection(() => parseImport('', 'empty.csv')).code).toBe('csv-empty');
    expect(rejection(() => parseImport('english,translation\n', 'header.csv')).code).toBe('no-entries');
    expect(rejection(() => decodeImportFile(new Uint8Array([0xff, 0xfe, 0x41]).buffer)).code).toBe('not-utf8');
    expect(decodeImportFile(new TextEncoder().encode('﻿english,translation').buffer)).toBe('english,translation');
  });

  it('reports a quoting problem with the parser\'s record number', () => {
    const error = rejection(() => parseImport('english,translation\nok,так\nbad "quote",ні', 'quotes.csv'));
    expect(error.code).toBe('csv-malformed');
    expect(error.details.record).toBe(3);
    expect(describeImportError(error).title).toBe('Quoting problem near record 3');
  });
});

describe('record-level issues', () => {
  it('names the record and the column, counting records rather than lines', () => {
    // Record 2 spans two lines because its example is quoted. Record 3 is the invalid one.
    const csv = 'english,translation,example\nfirst,перший,"one line\nand another"\nsecond,,"x"';
    const parsed = parseImport(csv, 'multiline.csv');
    expect(parsed.issues).toEqual([{ row: 3, field: 'translation', message: 'Translation is required.' }]);
    expect(describeIssue(parsed.issues[0], 'csv')).toBe('Record 3, column “translation”: Translation is required.');
  });

  it('describes field-count mismatches without inventing a column', () => {
    const parsed = parseImport('english,translation\nok,так\ntoo,many,fields', 'count.csv');
    expect(describeIssue(parsed.issues[0], 'csv')).toBe('Record 3: The number of fields does not match the header.');
  });

  it('uses entry numbers and JSON field names for native files', () => {
    const parsed = parseImport(JSON.stringify(native([entry(1), entry(2, { translation: '' })])), 'native.json');
    expect(describeIssue(parsed.issues[0], 'json')).toBe('Entry 2, field “translation”: Translation is required.');
  });

  it('keeps whole-import validation: an invalid record is reported, never silently dropped', () => {
    const parsed = parseImport('english,translation\nyes,так\nmissing,', 'partial.csv');
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.issues).toHaveLength(1);
  });
});
