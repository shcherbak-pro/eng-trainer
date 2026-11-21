export type PageSizeOption = number | 'all';

export function paginate<T>(items: T[], page: number, pageSize: PageSizeOption): T[] {
  if (pageSize === 'all') return items;
  const start = (Math.max(1, page) - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function totalPages(total: number, pageSize: PageSizeOption): number {
  return pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / pageSize));
}
