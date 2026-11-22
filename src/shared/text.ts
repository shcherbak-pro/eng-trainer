export function normalize(value: unknown): string {
  return String(value ?? '').toLowerCase().trim();
}

export function matchesQuery(query: string, ...values: unknown[]): boolean {
  const q = normalize(query);
  if (!q) return true;
  return values.some((value) => normalize(value).includes(q));
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** The dataset stores alternatives either as a list or as one `a; b; c` string. */
export function splitAlternatives(value?: string[] | string): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : value.split(';').map((item) => item.trim()).filter(Boolean);
}

/**
 * Language of an entry's translation and example translations. Built-in material
 * is translated into Ukrainian. Imported collections may use any language, so
 * their translations are marked as unknown ("") instead of assuming Ukrainian.
 */
export function translationLang(item: { collectionId?: string }): 'uk' | '' {
  return item.collectionId ? '' : 'uk';
}
