/** Native, local-only vocabulary format. IDs are never derived from display text. */
export const FORMAT = 'eng-trainer-vocabulary';
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_ENTRIES = 1000;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const COLLECTION_ID = new RegExp(`^user:${UUID}$`);
export type EntryKind = 'word' | 'phrase';
export type VocabularyEntry = {
  id: string;
  kind: EntryKind;
  english: string;
  translation: string;
  topic: string;
  examples: { en: string; translation?: string }[];
  sourcePhraseId?: string;
};
export type CollectionInfo = { id: string; name: string; description: string };
export type NativeCollection = { format: typeof FORMAT; version: 1; collection: CollectionInfo; entries: VocabularyEntry[] };
/**
 * A blocking problem in one record. `row` is the record number: for CSV the header is record 1
 * and blank lines are skipped (a quoted value may span several lines); for JSON it is the
 * entry's position in `entries`, starting at 1. Row 0 concerns the whole file.
 * `field` names the field when the problem belongs to one (for example `translation`).
 */
export type ImportIssue = { row: number; message: string; field?: string };
export type ParsedImport = NativeCollection & { fileName: string; source: 'csv' | 'json'; issues: ImportIssue[] };

/** Why a whole file was rejected. The messages are unchanged; the code and details let the interface explain the fix. */
export type ImportErrorCode =
  | 'unsupported-format'
  | 'too-large'
  | 'not-utf8'
  | 'json-syntax'
  | 'json-not-native'
  | 'invalid-native'
  | 'csv-empty'
  | 'csv-missing-columns'
  | 'csv-unsupported-columns'
  | 'csv-malformed'
  | 'no-entries'
  | 'too-many-entries';

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  readonly details: { columns?: string[]; record?: number; limit?: number };
  constructor(code: ImportErrorCode, message: string, details: ImportError['details'] = {}) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
    this.details = details;
  }
}

/** A validation failure that belongs to one field of an entry. */
export class FieldError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'FieldError';
    this.field = field;
  }
}

/** CSV column names the parser accepts. `english` and `translation` are required. */
export const CSV_COLUMNS = ['english', 'translation', 'topic', 'example', 'kind'] as const;
export const REQUIRED_CSV_COLUMNS = ['english', 'translation'] as const;
export const ENTRY_KINDS: readonly EntryKind[] = ['word', 'phrase'];
export const DEFAULT_KIND: EntryKind = 'word';

export function collectionId(): string { return `user:${crypto.randomUUID()}`; }
export function entryId(collection: string): string { return `${collection}:entry:${crypto.randomUUID()}`; }
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function fieldCheck(condition: unknown, field: string | undefined, message: string): asserts condition {
  if (!condition) throw field ? new FieldError(field, message) : new Error(message);
}
function object(value: unknown, allowed: string[], label: string): Record<string, unknown> {
  check(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
  const result = value as Record<string, unknown>;
  check(Object.keys(result).every((key) => allowed.includes(key)), `${label} contains an unsupported field.`);
  return result;
}
function text(value: unknown, label: string, max: number, required = false, field?: string): string {
  fieldCheck(typeof value === 'string', field, `${label} must be text.`);
  const result = value.trim();
  fieldCheck(!required || result.length > 0, field, `${label} is required.`);
  fieldCheck(result.length <= max, field, `${label} must be at most ${max} characters.`);
  fieldCheck(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result), field, `${label} contains unsupported control characters.`);
  return result;
}

/** The import format, chosen by file extension, before the file is read. */
export function importFormatOf(fileName: string): 'csv' | 'json' {
  if (/\.json$/i.test(fileName)) return 'json';
  if (/\.csv$/i.test(fileName)) return 'csv';
  throw new ImportError('unsupported-format', 'Choose a .csv or .json file.');
}

/** Rejects an oversized file from its size alone, before reading it. */
export function checkImportFileSize(bytes: number): void {
  if (bytes > MAX_FILE_BYTES) throw new ImportError('too-large', 'Choose a file no larger than 2 MiB.', { limit: MAX_FILE_BYTES });
}

/** Strict UTF-8 decoding. A leading byte order mark is removed. */
export function decodeImportFile(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new ImportError('not-utf8', 'The file could not be read as UTF-8. Save it as CSV UTF-8 or native JSON and try again.');
  }
}
export function collectionInfo(value: unknown): CollectionInfo {
  const item = object(value, ['id', 'name', 'description'], 'Collection');
  check(typeof item.id === 'string' && COLLECTION_ID.test(item.id), 'Collection ID must use the native user UUID namespace.');
  return { id: item.id, name: text(item.name, 'Collection name', 100, true), description: text(item.description ?? '', 'Collection description', 1000) };
}
export function validateEntry(value: unknown, collection: string): VocabularyEntry {
  const item = object(value, ['id', 'kind', 'english', 'translation', 'topic', 'examples', 'sourcePhraseId'], 'Entry');
  const idPattern = new RegExp(`^${collection}:entry:${UUID}$`);
  fieldCheck(typeof item.id === 'string' && idPattern.test(item.id), 'id', 'Entry ID must belong to this collection and use a native entry UUID.');
  fieldCheck(item.kind === 'word' || item.kind === 'phrase', 'kind', 'Kind must be word or phrase.');
  const examples = item.examples ?? [];
  fieldCheck(Array.isArray(examples) && examples.length <= 5, 'examples', 'Examples must be an array of at most 5 items.');
  const result: VocabularyEntry = {
    id: item.id, kind: item.kind, english: text(item.english, 'English text', 300, true, 'english'),
    translation: text(item.translation, 'Translation', 2000, true, 'translation'), topic: text(item.topic ?? '', 'Topic', 100, false, 'topic'),
    examples: examples.map((value) => {
      const example = object(value, ['en', 'translation'], 'Example');
      return { en: text(example.en, 'Example text', 4000, true, 'example'), ...(example.translation === undefined ? {} : { translation: text(example.translation, 'Example translation', 4000, false, 'exampleTranslation') }) };
    })
  };
  if (item.sourcePhraseId !== undefined) {
    fieldCheck(item.kind === 'word' && typeof item.sourcePhraseId === 'string' && idPattern.test(item.sourcePhraseId), 'sourcePhraseId', 'Only a word can link to a phrase in the same collection.');
    result.sourcePhraseId = item.sourcePhraseId;
  }
  return result;
}
export function validateLinks(entries: VocabularyEntry[]): void {
  const ids = new Set(entries.map((item) => item.id));
  check(ids.size === entries.length, 'Duplicate entry IDs are not allowed.');
  const phrases = new Set(entries.filter((item) => item.kind === 'phrase').map((item) => item.id));
  for (const item of entries) check(!item.sourcePhraseId || phrases.has(item.sourcePhraseId), `Word “${item.english}” links to a missing phrase.`);
}
export function serializeCollection(collection: CollectionInfo, entries: VocabularyEntry[]): string {
  return JSON.stringify({ format: FORMAT, version: 1, collection: collectionInfo(collection), entries } satisfies NativeCollection, null, 2) + '\n';
}
export function withinSize(value: string): void {
  if (new TextEncoder().encode(value).length > MAX_FILE_BYTES) {
    throw new ImportError('too-large', 'The file or resulting collection exceeds the 2 MiB limit.', { limit: MAX_FILE_BYTES });
  }
}

/** Strict quoted CSV: commas or semicolons, escaped quotes, CRLF and embedded newlines. */
export function csvRows(source: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false;
  const pushRow = () => { row.push(field); if (row.some((cell) => cell.trim())) rows.push(row); row = []; field = ''; closed = false; };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; }
      } else if (char === '\r') { if (source[i + 1] === '\n') i++; field += '\n'; }
      else field += char;
    } else if (char === delimiter) { row.push(field); field = ''; closed = false; }
    else if (char === '\n' || char === '\r') { pushRow(); if (char === '\r' && source[i + 1] === '\n') i++; }
    else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (closed || char === '"') {
        throw new ImportError('csv-malformed', `Malformed CSV near record ${rows.length + 1}: unexpected text or quote.`, { record: rows.length + 1 });
      }
      field += char;
    }
    if (rows.length > MAX_ENTRIES + 1) {
      throw new ImportError('too-many-entries', `A collection may contain at most ${MAX_ENTRIES} entries.`, { limit: MAX_ENTRIES });
    }
  }
  if (quoted) throw new ImportError('csv-malformed', 'Malformed CSV: an opening quote has no closing quote.');
  pushRow();
  return rows;
}

export function parseImport(source: string, fileName: string): ParsedImport {
  withinSize(source);
  source = source.replace(/^\uFEFF/, '');
  const name = text(fileName, 'File name', 255, true);
  const issues: ImportIssue[] = [];
  let collection: CollectionInfo;
  let rawEntries: unknown[];
  let format: 'csv' | 'json';
  if (/\.json$/i.test(name)) {
    format = 'json';
    let parsed: unknown;
    try { parsed = JSON.parse(source); } catch { throw new ImportError('json-syntax', 'Invalid JSON. Check the file syntax before importing.'); }
    let data: Record<string, unknown>;
    try {
      data = object(parsed, ['format', 'version', 'collection', 'entries'], 'File');
      check(data.format === FORMAT && data.version === 1, 'Expected eng-trainer-vocabulary JSON version 1.');
    } catch (error) {
      // Valid JSON, but not an eng-trainer export.
      throw new ImportError('json-not-native', (error as Error).message);
    }
    try { collection = collectionInfo(data.collection); } catch (error) { throw new ImportError('invalid-native', (error as Error).message); }
    if (!Array.isArray(data.entries)) throw new ImportError('invalid-native', 'Entries must be an array.');
    rawEntries = data.entries;
  } else {
    importFormatOf(name);
    format = 'csv';
    collection = { id: collectionId(), name: name.replace(/\.csv$/i, '').slice(0, 100) || 'Imported vocabulary', description: '' };
    // The header contains only simple field names. Quoted field names are allowed.
    const headerLine = source.split(/\r?\n/)[0];
    const delimiter = headerLine.includes(';') && !headerLine.includes(',') ? ';' : ',';
    const rows = csvRows(source, delimiter);
    if (!rows.length) throw new ImportError('csv-empty', 'The CSV file is empty.');
    const headers = rows.shift()!.map((cell) => cell.trim().toLowerCase());
    const missing = REQUIRED_CSV_COLUMNS.filter((column) => !headers.includes(column));
    if (missing.length) {
      throw new ImportError('csv-missing-columns', 'CSV needs english and translation headers; topic, example and kind are optional.', { columns: missing });
    }
    const offending = headers.filter((header, index) => !(CSV_COLUMNS as readonly string[]).includes(header) || headers.indexOf(header) !== index);
    if (offending.length) {
      throw new ImportError('csv-unsupported-columns', 'CSV has a duplicate or unsupported header.', { columns: [...new Set(offending)] });
    }
    rawEntries = rows.map((row, index) => {
      if (row.length !== headers.length) { issues.push({ row: index + 2, message: 'The number of fields does not match the header.' }); return null; }
      const value = Object.fromEntries(headers.map((header, i) => [header, row[i].trim()]));
      return { id: entryId(collection.id), kind: value.kind || DEFAULT_KIND, english: value.english, translation: value.translation, topic: value.topic || '', examples: value.example ? [{ en: value.example }] : [] };
    });
  }
  if (!rawEntries.length) throw new ImportError('no-entries', 'The file contains no entries.');
  if (rawEntries.length > MAX_ENTRIES) {
    throw new ImportError('too-many-entries', `A collection may contain at most ${MAX_ENTRIES} entries.`, { limit: MAX_ENTRIES });
  }
  const entries: VocabularyEntry[] = [];
  rawEntries.forEach((item, index) => {
    if (item === null && format === 'csv') return;
    try { entries.push(validateEntry(item, collection.id)); }
    catch (error) {
      issues.push({ row: index + (format === 'csv' ? 2 : 1), message: (error as Error).message, ...(error instanceof FieldError ? { field: error.field } : {}) });
    }
  });
  try { validateLinks(entries); } catch (error) { issues.push({ row: 0, message: (error as Error).message }); }
  return { format: FORMAT, version: 1, collection, entries, fileName: name, source: format, issues };
}
