import { normalize } from '../shared/text';

export type Search<T> = (query: string) => T[];

/**
 * Builds an in-memory search over a list of entries.
 *
 * The searchable text of every entry is prepared once, when the catalog is
 * created, so a search always covers the whole list and never depends on which
 * screens were opened before. An entry matches when one of its fields contains
 * the query (case-insensitive). An empty query returns every entry.
 */
export function createSearch<T>(items: T[], fields: (item: T) => unknown[]): Search<T> {
  // Fields are joined with a line break, which a search box query cannot
  // contain, so a query never matches across two fields.
  const haystacks = items.map((item) => fields(item).map(normalize).join('\n'));

  return (query) => {
    const q = normalize(query);
    if (!q) return items;
    return items.filter((_, index) => haystacks[index].includes(q));
  };
}
