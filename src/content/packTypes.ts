import type { Materials } from './types';

export type PackContent = Omit<Materials, 'meta' | 'blocks'>;
export type ContentCounts = Record<keyof PackContent, number>;

export type ContentDescriptor = Pick<Materials, 'meta' | 'blocks'> & {
  schemaVersion: 1;
};

export type BuiltInPack = {
  schemaVersion: 1;
  id: string;
  title: string;
  /** Unique ascending order; each collection keeps its order within a pack. */
  order: number;
  content: Partial<PackContent>;
};

export type PackManifestEntry = Pick<BuiltInPack, 'id' | 'title' | 'order'> & {
  /** Relative to data/; generated from the pack's content hash. */
  url: string;
  counts: ContentCounts;
};

export type ContentManifest = ContentDescriptor & {
  counts: ContentCounts;
  packs: PackManifestEntry[];
};
