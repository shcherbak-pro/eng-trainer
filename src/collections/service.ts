import { get, writable } from 'svelte/store';
import type { ContentCatalog } from '../content/catalog';
import { StorageError, type AppStorage, type StoredRecords, type WriteOp } from '../storage/database';
import { check, collectionInfo, MAX_ENTRIES, serializeCollection, validateEntry, validateLinks, withinSize, type CollectionInfo, type ImportIssue, type ParsedImport, type VocabularyEntry } from './format';

/**
 * Why a collection operation failed. The interface words its advice per kind:
 * - `conflict`: another tab changed the saved collection first (reload, then retry);
 * - `stale`: this tab's preview or collection list is out of date;
 * - `quota`: the browser refused to store more data for this site;
 * - `storage`: any other failed transaction (nothing was saved);
 * - `unavailable`: the app runs without saving;
 * - `busy`: another collection change is still being saved;
 * - `validation`: the proposal or the new name is not acceptable.
 */
export type CollectionErrorKind = 'conflict' | 'stale' | 'quota' | 'storage' | 'unavailable' | 'busy' | 'validation';

export class CollectionError extends Error {
  readonly kind: CollectionErrorKind;
  constructor(kind: CollectionErrorKind, message: string) {
    super(message);
    this.name = 'CollectionError';
    this.kind = kind;
  }
}

function ensure(condition: unknown, kind: CollectionErrorKind, message: string): asserts condition {
  if (!condition) throw new CollectionError(kind, message);
}

function validated<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    throw error instanceof CollectionError ? error : new CollectionError('validation', error instanceof Error ? error.message : String(error));
  }
}

export type UserCollection = CollectionInfo & {
  version: 1; createdAt: string; updatedAt: string; revision: number;
  lastImport: { fileName: string; format: 'csv' | 'json'; importedAt: string; added: number; skipped: number };
};
export type UserEntry = VocabularyEntry & { collectionId: string; position: number };
export type UserVocabulary = { available: boolean; collections: UserCollection[]; entries: UserEntry[] };
const empty = (): UserVocabulary => ({ available: false, collections: [], entries: [] });
const store = writable<UserVocabulary>(empty());
export const userVocabulary = { subscribe: store.subscribe };
let storage: AppStorage | null = null;
let writing = false;
const info = ({ id, name, description }: CollectionInfo): CollectionInfo => ({ id, name, description });
const plain = ({ collectionId: _collection, position: _position, ...entry }: UserEntry): VocabularyEntry => entry;
function ordered(state: UserVocabulary): UserVocabulary {
  const collections = [...state.collections].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const rank = new Map(collections.map((item, index) => [item.id, index]));
  return { ...state, collections, entries: [...state.entries].sort((a, b) => rank.get(a.collectionId)! - rank.get(b.collectionId)! || a.position - b.position) };
}

/** Fail visibly on corrupt imported content; never repair it by writing defaults. */
export function readCollections(records: StoredRecords): UserVocabulary {
  const collections: UserCollection[] = [];
  for (const [key, raw] of records.userCollections) {
    check(raw && typeof raw === 'object', 'A saved collection is malformed.');
    const value = raw as UserCollection;
    collectionInfo(info(value));
    check(key === value.id && value.version === 1 && Number.isSafeInteger(value.revision) && value.revision > 0, 'A saved collection has an invalid identity or version.');
    check(typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)) && typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)), 'A saved collection has invalid dates.');
    check(value.lastImport && ['csv', 'json'].includes(value.lastImport.format) && typeof value.lastImport.fileName === 'string' && value.lastImport.fileName.length <= 255 && Number.isSafeInteger(value.lastImport.added) && Number.isSafeInteger(value.lastImport.skipped) && typeof value.lastImport.importedAt === 'string', 'A saved collection has invalid import information.');
    collections.push(value);
  }
  collections.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const entries: UserEntry[] = [];
  for (const [key, raw] of records.userEntries) {
    check(raw && typeof raw === 'object', 'A saved vocabulary entry is malformed.');
    const value = raw as UserEntry;
    check(byId.has(value.collectionId) && key === value.id && Number.isSafeInteger(value.position) && value.position >= 0, 'A saved vocabulary entry has an invalid collection, identity or position.');
    entries.push({ ...validateEntry(plain(value), value.collectionId), collectionId: value.collectionId, position: value.position });
  }
  const ordered: UserEntry[] = [];
  for (const collection of collections) {
    const own = entries.filter((entry) => entry.collectionId === collection.id).sort((a, b) => a.position - b.position);
    check(own.length > 0 && own.length <= MAX_ENTRIES && new Set(own.map((entry) => entry.position)).size === own.length, 'A saved collection has invalid entry positions or size.');
    validateLinks(own);
    withinSize(serializeCollection(info(collection), own.map(plain)));
    ordered.push(...own);
  }
  return { available: true, collections, entries: ordered };
}
export function connectCollections(next: AppStorage, vocabulary: UserVocabulary): void { storage = next; store.set(vocabulary); }
export function disableCollections(): void { storage = null; store.set(empty()); }

export type ImportPlan = {
  parsed: ParsedImport; target: CollectionInfo; existing?: UserCollection; additions: VocabularyEntry[];
  skipped: number; issues: ImportIssue[]; duplicates: string[];
};
const normalized = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/** A preview is an explicit proposal, not a write or a text-based merge. */
export function prepareImport(parsed: ParsedImport, catalog: ContentCatalog): ImportPlan {
  const current = get(store);
  const existing = current.collections.find((collection) => collection.id === parsed.collection.id);
  const plan: ImportPlan = { parsed, target: info(existing ?? parsed.collection), existing, additions: [], skipped: 0, issues: [...parsed.issues], duplicates: [] };
  const own = current.entries.filter((entry) => entry.collectionId === parsed.collection.id);
  const byId = new Map(current.entries.map((entry) => [entry.id, entry]));
  const catalogIds = new Set([...catalog.phrases, ...catalog.wordIndex, ...catalog.irregularVerbs, ...catalog.blocks].map((item) => item.id));
  const texts = new Set([...catalog.phrases.map((item) => item.phrase), ...catalog.wordIndex.map((item) => item.term)].map(normalized));
  for (const entry of parsed.entries) {
    const saved = byId.get(entry.id);
    if (saved) {
      if (saved.collectionId === parsed.collection.id && JSON.stringify(plain(saved)) === JSON.stringify(entry)) plan.skipped++;
      else plan.issues.push({ row: 0, message: `ID conflict for “${entry.english}”. Existing entries are never overwritten by import.` });
    } else {
      if (catalogIds.has(entry.id)) plan.issues.push({ row: 0, message: `Entry ID collision for “${entry.english}”.` });
      if (texts.has(normalized(entry.english))) plan.duplicates.push(entry.id);
      texts.add(normalized(entry.english));
      plan.additions.push(entry);
    }
  }
  try {
    collectionInfo(plan.target);
    check(own.length + plan.additions.length <= MAX_ENTRIES, `The resulting collection exceeds ${MAX_ENTRIES} entries.`);
    const combined = [...own.map(plain), ...plan.additions];
    validateLinks(combined);
    withinSize(serializeCollection(plan.target, combined));
  } catch (error) { plan.issues.push({ row: 0, message: (error as Error).message }); }
  return plan;
}

async function write(ops: WriteOp[], previous: UserCollection | undefined, id: string): Promise<void> {
  ensure(storage, 'unavailable', 'Saving is unavailable. Reopen the app with browser storage enabled before managing collections.');
  ensure(!writing, 'busy', 'A collection change is already being saved. Please wait.');
  writing = true;
  try {
    await storage.write(ops, [{ store: 'userCollections', key: id, expected: previous }]);
  } catch (error) {
    const kind = error instanceof StorageError ? error.kind : 'failure';
    const detail = error instanceof Error ? error.message : String(error);
    if (kind === 'conflict') {
      throw new CollectionError('conflict', 'Collection change was not saved: the saved collection changed in another session. No partial import or deletion was kept.');
    }
    if (kind === 'quota') {
      throw new CollectionError('quota', `Collection change was not saved. No partial import or deletion was kept. ${detail} Check available browser storage and try again.`);
    }
    throw new CollectionError('storage', `Collection change was not saved. No partial import or deletion was kept. ${detail}`);
  } finally { writing = false; }
}

export async function acceptImport(plan: ImportPlan, allowDuplicates = false): Promise<{ added: number; skipped: number }> {
  ensure(plan.issues.length === 0, 'validation', 'Fix all invalid entries and ID conflicts before importing.');
  ensure(!plan.duplicates.length || allowDuplicates, 'validation', 'Review and acknowledge possible duplicates before importing.');
  ensure(storage, 'unavailable', 'Saving is unavailable. No collection was imported.');
  if (!plan.additions.length) {
    await write([], plan.existing, plan.target.id);
    return { added: 0, skipped: plan.skipped };
  }
  const current = get(store);
  ensure(JSON.stringify(current.collections.find((collection) => collection.id === plan.target.id)) === JSON.stringify(plan.existing), 'stale', 'This collection changed. Select the file again to refresh the preview.');
  const now = new Date().toISOString();
  const collection: UserCollection = {
    ...collectionInfo(plan.target), version: 1, createdAt: plan.existing?.createdAt ?? now, updatedAt: now,
    revision: (plan.existing?.revision ?? 0) + 1,
    lastImport: { fileName: plan.parsed.fileName, format: plan.parsed.source, importedAt: now, added: plan.additions.length, skipped: plan.skipped }
  };
  const own = current.entries.filter((entry) => entry.collectionId === collection.id);
  const start = own.reduce((max, entry) => Math.max(max, entry.position + 1), 0);
  const additions = plan.additions.map((entry, index) => ({ ...entry, collectionId: collection.id, position: start + index }));
  await write([
    { type: 'put', store: 'userCollections', key: collection.id, value: collection },
    ...additions.map((entry): WriteOp => ({ type: 'put', store: 'userEntries', key: entry.id, value: entry }))
  ], plan.existing, collection.id);
  // Publish only after transaction completion. Failed operations never reach the catalog.
  store.update((state) => ordered({ ...state, collections: [...state.collections.filter((item) => item.id !== collection.id), collection], entries: [...state.entries, ...additions] }));
  return { added: additions.length, skipped: plan.skipped };
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const previous = get(store).collections.find((item) => item.id === id);
  ensure(previous, 'stale', 'Collection no longer exists. Reload the app.');
  const collection = validated(() => ({ ...previous, ...collectionInfo({ ...info(previous), name }), updatedAt: new Date().toISOString(), revision: previous.revision + 1 }));
  validated(() => withinSize(serializeCollection(info(collection), get(store).entries.filter((entry) => entry.collectionId === id).map(plain))));
  await write([{ type: 'put', store: 'userCollections', key: id, value: collection }], previous, id);
  store.update((state) => ({ ...state, collections: state.collections.map((item) => item.id === id ? collection : item) }));
}
/** Deliberately retain all progress: native reimport restores the same identities. */
export async function removeCollection(id: string): Promise<void> {
  const current = get(store);
  const previous = current.collections.find((item) => item.id === id);
  ensure(previous, 'stale', 'Collection no longer exists. Reload the app.');
  await write([
    { type: 'delete', store: 'userCollections', key: id },
    ...current.entries.filter((entry) => entry.collectionId === id).map((entry): WriteOp => ({ type: 'delete', store: 'userEntries', key: entry.id }))
  ], previous, id);
  store.update((state) => ({ ...state, collections: state.collections.filter((item) => item.id !== id), entries: state.entries.filter((entry) => entry.collectionId !== id) }));
}
export function exportCollection(id: string): string {
  const current = get(store);
  const collection = current.collections.find((item) => item.id === id);
  ensure(collection, 'stale', 'Collection no longer exists.');
  return serializeCollection(info(collection), current.entries.filter((entry) => entry.collectionId === id).map(plain));
}
