import { createCatalog, type ContentCatalog } from './catalog';
import type { Phrase, WordIndexItem } from './types';
import type { UserVocabulary } from '../collections/service';

/** User entries use the same search, cards and progress services as built-in entries. */
export function combineCatalog(builtIn: ContentCatalog, user: UserVocabulary): ContentCatalog {
  if (!user.entries.length) return builtIn;
  const collections = new Map(user.collections.map((item) => [item.id, item]));
  const phrases: Phrase[] = [], words: WordIndexItem[] = [];
  const ids = new Set([...builtIn.phrases, ...builtIn.wordIndex, ...builtIn.irregularVerbs, ...builtIn.blocks].map((item) => item.id));
  for (const entry of user.entries) {
    if (ids.has(entry.id)) throw new Error('A user entry conflicts with a built-in identity.');
    ids.add(entry.id);
    const common = { id: entry.id, category: entry.topic || 'My vocabulary', section: collections.get(entry.collectionId)!.name, collectionId: entry.collectionId, examples: entry.examples.map((example) => ({ en: example.en, ...(example.translation === undefined ? {} : { ua: example.translation }) })) };
    if (entry.kind === 'phrase') phrases.push({ ...common, phrase: entry.english, translation: entry.translation });
    else words.push({ ...common, term: entry.english, meaning: entry.translation, pronunciation: '', ...(entry.sourcePhraseId ? { sourcePhraseId: entry.sourcePhraseId } : {}) });
  }
  return createCatalog({ ...builtIn, phrases: [...builtIn.phrases, ...phrases], wordIndex: [...builtIn.wordIndex, ...words], collections: user.collections.map(({ id, name }) => ({ id, name })) });
}

export function resolvedCollection(catalog: ContentCatalog, selected: string): string {
  return selected === 'built-in' || catalog.collections.some((item) => item.id === selected) ? selected : '';
}
export function inCollection(item: { collectionId?: string }, selected: string): boolean {
  return !selected || (selected === 'built-in' ? !item.collectionId : item.collectionId === selected);
}
