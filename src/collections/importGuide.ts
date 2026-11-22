import { collectionId, CSV_COLUMNS, DEFAULT_KIND, ENTRY_KINDS, entryId, MAX_ENTRIES, MAX_FILE_BYTES, REQUIRED_CSV_COLUMNS, serializeCollection, type VocabularyEntry } from './format';

/**
 * Import help content. The examples are the single source for what the page
 * shows, what "Copy example" copies and what "Download CSV template" saves,
 * and the tests parse every one of them with the real parser.
 */

/** The short example shown first. It is also the downloadable template. */
export const CSV_EXAMPLE = 'english,translation\nreliable,надійний\nimprove,покращувати';

/** A fuller example: optional columns, an explicit phrase, quoting and an empty optional value. */
export const CSV_DETAILED_EXAMPLE = [
  'english,translation,topic,example,kind',
  'reliable,надійний,Work,"Our tests are reliable, so we release often.",word',
  'take ownership,брати відповідальність,Work,"She said, ""I\'ll take ownership of the release.""",phrase',
  'improve,покращувати,,,'
].join('\n');

/** The same short example with semicolons, as some spreadsheet apps save it. */
export const CSV_SEMICOLON_EXAMPLE = 'english;translation\nreliable;надійний';

export const CSV_TEMPLATE_FILE_NAME = 'eng-trainer-vocabulary-template.csv';

/**
 * The template file: the example text with a UTF-8 byte order mark, so that
 * spreadsheet apps such as Excel open the Ukrainian text correctly. The import
 * decoder removes the mark again.
 */
export function csvTemplateParts(): BlobPart[] {
  return ['﻿', CSV_EXAMPLE];
}

export const IMPORT_LIMITS = { bytes: MAX_FILE_BYTES, entries: MAX_ENTRIES };

export function formatFileLimit(bytes = MAX_FILE_BYTES): string {
  const mib = bytes / (1024 * 1024);
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MiB`;
}

export function formatEntryLimit(entries = MAX_ENTRIES): string {
  return new Intl.NumberFormat('en').format(entries);
}

export const CSV_GUIDE = {
  columns: CSV_COLUMNS,
  required: REQUIRED_CSV_COLUMNS,
  optional: CSV_COLUMNS.filter((column) => !(REQUIRED_CSV_COLUMNS as readonly string[]).includes(column)),
  kinds: ENTRY_KINDS,
  defaultKind: DEFAULT_KIND
};

/**
 * A native JSON reference produced by the real exporter. Every call creates new
 * collection and entry identities, so the reference is never a shared template.
 */
export function nativeJsonExample(): string {
  const collection = { id: collectionId(), name: 'Work vocabulary', description: 'Exported from eng-trainer' };
  const word: VocabularyEntry = { id: entryId(collection.id), kind: 'word', english: 'reliable', translation: 'надійний', topic: 'Work', examples: [] };
  const phrase: VocabularyEntry = {
    id: entryId(collection.id),
    kind: 'phrase',
    english: 'take ownership',
    translation: 'брати відповідальність',
    topic: 'Work',
    examples: [{ en: "I'll take ownership of the release.", translation: 'Я візьму відповідальність за реліз.' }]
  };
  return serializeCollection(collection, [word, phrase]);
}
