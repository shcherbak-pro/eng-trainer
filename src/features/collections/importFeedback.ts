import { ImportError, type ImportIssue } from '../../collections/format';
import { CollectionError } from '../../collections/service';
import { CSV_GUIDE, formatEntryLimit, formatFileLimit } from '../../collections/importGuide';

/** What the import region shows when a whole file is rejected. */
export type ImportProblem = {
  title: string;
  /** Plain-language explanation and fix. */
  text: string;
  /** Offer the CSV template as the quickest fix. */
  offerTemplate: boolean;
  /** The parser's own message, shown as technical detail. Empty when it would only repeat the text. */
  detail: string;
};

/** “a”, “a” and “b”, or “a”, “b” and “c”. */
function columnList(columns: readonly string[]): string {
  const names = columns.map((column) => (column ? `“${column}”` : 'an empty column name'));
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '');
}

const plural = (count: number, word: string) => (count === 1 ? word : `${word}s`);

export function describeImportError(error: unknown): ImportProblem {
  const detail = error instanceof Error ? error.message : String(error);
  if (!(error instanceof ImportError)) {
    return { title: 'The file could not be imported', text: 'Check the file and choose it again.', offerTemplate: false, detail };
  }
  const { code, details } = error;
  switch (code) {
    case 'unsupported-format':
      return {
        title: 'This file type is not supported',
        text: 'Choose a CSV file saved as CSV UTF-8, or a JSON file exported from eng-trainer. Excel workbooks (.xlsx), PDFs and images cannot be imported.',
        offerTemplate: true,
        detail: ''
      };
    case 'too-large':
      return { title: 'The file is too large', text: `Files can be up to ${formatFileLimit(details.limit)}. Split the vocabulary into smaller files and import them one by one.`, offerTemplate: false, detail: '' };
    case 'not-utf8':
      return { title: 'The file is not saved as UTF-8', text: 'Save it again as “CSV UTF-8”, then choose it again. Other text encodings cannot be read.', offerTemplate: true, detail: '' };
    case 'json-syntax':
      return { title: 'This JSON file is damaged', text: 'The file is not valid JSON, so it cannot be read. Export the collection from eng-trainer again. To create a new collection, use CSV.', offerTemplate: true, detail };
    case 'json-not-native':
      return {
        title: 'This JSON file is not an eng-trainer export',
        text: 'For JSON, choose a file exported from eng-trainer. Other JSON structures are not supported. To create a new collection, use CSV.',
        offerTemplate: true,
        detail: ''
      };
    case 'invalid-native':
      return { title: 'This eng-trainer file is incomplete or changed', text: 'Its collection details are not valid. Export the collection from eng-trainer again and import that file.', offerTemplate: false, detail };
    case 'csv-empty':
      return { title: 'The CSV file is empty', text: `The first row must name the columns: ${columnList(CSV_GUIDE.required)}. Each following row is one entry.`, offerTemplate: true, detail: '' };
    case 'csv-missing-columns': {
      const missing = details.columns ?? [...CSV_GUIDE.required];
      return {
        title: `Missing ${plural(missing.length, 'column')}: ${columnList(missing)}`,
        text: `The first row must name the columns. ${columnList(CSV_GUIDE.required)} are required; ${columnList(CSV_GUIDE.optional)} are optional. Upper or lower case does not matter.`,
        offerTemplate: true,
        detail: ''
      };
    }
    case 'csv-unsupported-columns': {
      const extra = details.columns ?? [];
      return {
        title: `${plural(extra.length, 'Column')} not supported: ${columnList(extra)}`,
        text: `Use each column name once, and only these names: ${columnList(CSV_GUIDE.columns)}. Remove or rename other columns.`,
        offerTemplate: true,
        detail: ''
      };
    }
    case 'csv-malformed':
      return {
        title: details.record ? `Quoting problem near record ${details.record}` : 'A quote is not closed',
        text: 'Put quotes around a whole value that contains a comma, semicolon, quote or line break, and write a quote inside it as two quotes (""). Records are counted from the header row (record 1); blank lines are skipped.',
        offerTemplate: false,
        detail
      };
    case 'no-entries':
      return { title: 'The file contains no entries', text: 'Add at least one row with English text and its translation below the header row.', offerTemplate: true, detail: '' };
    case 'too-many-entries':
      return { title: 'Too many entries', text: `A collection can contain up to ${formatEntryLimit(details.limit)} entries. Split the file and import the parts as separate collections.`, offerTemplate: false, detail: '' };
  }
}

const JSON_FIELDS: Record<string, string> = {
  example: 'examples[].en',
  exampleTranslation: 'examples[].translation'
};

/** "Record 3, column “translation”: Translation is required." — using the parser's own record numbers. */
export function describeIssue(issue: ImportIssue, source: 'csv' | 'json'): string {
  if (!issue.row) return issue.message;
  if (source === 'csv') {
    const column = issue.field && (CSV_GUIDE.columns as readonly string[]).includes(issue.field) ? `, column “${issue.field}”` : '';
    return `Record ${issue.row}${column}: ${issue.message}`;
  }
  const field = issue.field ? `, field “${JSON_FIELDS[issue.field] ?? issue.field}”` : '';
  return `Entry ${issue.row}${field}: ${issue.message}`;
}

export type CollectionAction = 'import' | 'rename' | 'remove' | 'export';

/** Advice for a failed collection change, worded for the action that failed. */
export function describeCollectionError(error: unknown, action: CollectionAction): { text: string; reload: boolean } {
  const kind = error instanceof CollectionError ? error.kind : 'storage';
  const what = { import: 'The import', rename: 'The new name', remove: 'The removal', export: 'The export' }[action];
  switch (kind) {
    case 'conflict':
      return { text: `${what} was not saved: this collection was changed in another tab or window. Reload the page to see the latest version, then try again.`, reload: true };
    case 'stale':
      return action === 'import'
        ? { text: 'This preview is out of date because the collection changed. Choose the file again to refresh it.', reload: false }
        : { text: 'This collection is no longer available in this tab. Reload the page to see the current list.', reload: true };
    case 'quota':
      return { text: `${what} was not saved: the browser has no more storage space for this site. Nothing was changed. Free up space, for example by removing a collection you no longer need, then try again.`, reload: false };
    case 'unavailable':
      return { text: 'Saving is off in this session, so collections cannot be changed. Reload the app to turn saving on.', reload: true };
    case 'busy':
      return { text: 'Another collection change is still being saved. Wait a moment, then try again.', reload: false };
    case 'validation':
      return { text: error instanceof Error ? error.message : String(error), reload: false };
    default:
      return { text: `${what} was not saved: the browser could not complete the change, so nothing was changed. Try again. If it keeps failing, reload the page.`, reload: false };
  }
}
