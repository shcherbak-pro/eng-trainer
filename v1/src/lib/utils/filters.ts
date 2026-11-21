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

export function includesId(list: string[], id: string): boolean {
  return list.includes(id);
}
