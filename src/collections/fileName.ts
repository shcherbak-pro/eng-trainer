/** Reserved device names on Windows, also with an extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_NAME_LENGTH = 80;

function isoDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A readable, portable file name for a collection export, for example
 * "Мої слова" → "Мої-слова-2026-11-22.json".
 *
 * Letters and digits of every script are kept, with combining marks and
 * apostrophes. Spaces, punctuation, path separators and characters that are
 * reserved in file names become "-". The name is limited to 80 characters
 * (code points, so no character is split), Windows device names are prefixed
 * with "_", and an empty result falls back to "vocabulary". The local date
 * keeps repeated exports of the same collection apart.
 */
export function exportFileName(collectionName: string, date: Date = new Date()): string {
  const cleaned = collectionName
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}'’ʼ_-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_'’ʼ]+|[-_'’ʼ]+$/gu, '');
  let base = Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join('').replace(/[-_'’ʼ]+$/u, '') || 'vocabulary';
  if (WINDOWS_RESERVED.test(base)) base = `_${base}`;
  return `${base}-${isoDay(date)}.json`;
}
