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
export type ImportIssue = { row: number; message: string };
export type ParsedImport = NativeCollection & { fileName: string; source: 'csv' | 'json'; issues: ImportIssue[] };

export function collectionId(): string { return `user:${crypto.randomUUID()}`; }
export function entryId(collection: string): string { return `${collection}:entry:${crypto.randomUUID()}`; }
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function object(value: unknown, allowed: string[], label: string): Record<string, unknown> {
  check(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
  const result = value as Record<string, unknown>;
  check(Object.keys(result).every((key) => allowed.includes(key)), `${label} contains an unsupported field.`);
  return result;
}
function text(value: unknown, label: string, max: number, required = false): string {
  check(typeof value === 'string', `${label} must be text.`);
  const result = value.trim();
  check(!required || result.length > 0, `${label} is required.`);
  check(result.length <= max, `${label} must be at most ${max} characters.`);
  check(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result), `${label} contains unsupported control characters.`);
  return result;
}
export function collectionInfo(value: unknown): CollectionInfo {
  const item = object(value, ['id', 'name', 'description'], 'Collection');
  check(typeof item.id === 'string' && COLLECTION_ID.test(item.id), 'Collection ID must use the native user UUID namespace.');
  return { id: item.id, name: text(item.name, 'Collection name', 100, true), description: text(item.description ?? '', 'Collection description', 1000) };
}
export function validateEntry(value: unknown, collection: string): VocabularyEntry {
  const item = object(value, ['id', 'kind', 'english', 'translation', 'topic', 'examples', 'sourcePhraseId'], 'Entry');
  const idPattern = new RegExp(`^${collection}:entry:${UUID}$`);
  check(typeof item.id === 'string' && idPattern.test(item.id), 'Entry ID must belong to this collection and use a native entry UUID.');
  check(item.kind === 'word' || item.kind === 'phrase', 'Kind must be word or phrase.');
  const examples = item.examples ?? [];
  check(Array.isArray(examples) && examples.length <= 5, 'Examples must be an array of at most 5 items.');
  const result: VocabularyEntry = {
    id: item.id, kind: item.kind, english: text(item.english, 'English text', 300, true),
    translation: text(item.translation, 'Translation', 2000, true), topic: text(item.topic ?? '', 'Topic', 100),
    examples: examples.map((value) => {
      const example = object(value, ['en', 'translation'], 'Example');
      return { en: text(example.en, 'Example text', 4000, true), ...(example.translation === undefined ? {} : { translation: text(example.translation, 'Example translation', 4000) }) };
    })
  };
  if (item.sourcePhraseId !== undefined) {
    check(item.kind === 'word' && typeof item.sourcePhraseId === 'string' && idPattern.test(item.sourcePhraseId), 'Only a word can link to a phrase in the same collection.');
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
  check(new TextEncoder().encode(value).length <= MAX_FILE_BYTES, 'The file or resulting collection exceeds the 2 MiB limit.');
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
      check(!closed && char !== '"', `Malformed CSV near record ${rows.length + 1}: unexpected text or quote.`);
      field += char;
    }
    check(rows.length <= MAX_ENTRIES + 1, `A collection may contain at most ${MAX_ENTRIES} entries.`);
  }
  check(!quoted, 'Malformed CSV: an opening quote has no closing quote.');
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
    try { parsed = JSON.parse(source); } catch { throw new Error('Invalid JSON. Check the file syntax before importing.'); }
    const data = object(parsed, ['format', 'version', 'collection', 'entries'], 'File');
    check(data.format === FORMAT && data.version === 1, 'Expected eng-trainer-vocabulary JSON version 1.');
    collection = collectionInfo(data.collection);
    check(Array.isArray(data.entries), 'Entries must be an array.');
    rawEntries = data.entries;
  } else {
    check(/\.csv$/i.test(name), 'Choose a .csv or .json file.');
    format = 'csv';
    collection = { id: collectionId(), name: name.replace(/\.csv$/i, '').slice(0, 100) || 'Imported vocabulary', description: '' };
    // The header contains only simple field names. Quoted field names are allowed.
    const headerLine = source.split(/\r?\n/)[0];
    const delimiter = headerLine.includes(';') && !headerLine.includes(',') ? ';' : ',';
    const rows = csvRows(source, delimiter);
    check(rows.length > 0, 'The CSV file is empty.');
    const headers = rows.shift()!.map((cell) => cell.trim().toLowerCase());
    check(headers.includes('english') && headers.includes('translation'), 'CSV needs english and translation headers; topic, example and kind are optional.');
    check(new Set(headers).size === headers.length && headers.every((h) => ['english', 'translation', 'topic', 'example', 'kind'].includes(h)), 'CSV has a duplicate or unsupported header.');
    rawEntries = rows.map((row, index) => {
      if (row.length !== headers.length) { issues.push({ row: index + 2, message: 'The number of fields does not match the header.' }); return null; }
      const value = Object.fromEntries(headers.map((header, i) => [header, row[i].trim()]));
      return { id: entryId(collection.id), kind: value.kind || 'word', english: value.english, translation: value.translation, topic: value.topic || '', examples: value.example ? [{ en: value.example }] : [] };
    });
  }
  check(rawEntries.length > 0, 'The file contains no entries.');
  check(rawEntries.length <= MAX_ENTRIES, `A collection may contain at most ${MAX_ENTRIES} entries.`);
  const entries: VocabularyEntry[] = [];
  rawEntries.forEach((item, index) => {
    if (item === null && format === 'csv') return;
    try { entries.push(validateEntry(item, collection.id)); }
    catch (error) { issues.push({ row: index + (format === 'csv' ? 2 : 1), message: (error as Error).message }); }
  });
  try { validateLinks(entries); } catch (error) { issues.push({ row: 0, message: (error as Error).message }); }
  return { format: FORMAT, version: 1, collection, entries, fileName: name, source: format, issues };
}
