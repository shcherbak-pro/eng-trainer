import { FORMAT, type NativeCollection, type VocabularyEntry } from '../collections/format';

export const collection = { id: 'user:00000000-0000-4000-8000-000000000001', name: 'Synthetic vocabulary', description: 'Local test data' };
export const id = (number: number) => `${collection.id}:entry:00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export function entry(number: number, patch: Partial<VocabularyEntry> = {}): VocabularyEntry {
  return { id: id(number), kind: 'word', english: `Example ${number}`, translation: `Переклад ${number}`, topic: 'Synthetic topic', examples: [{ en: `This is example ${number}.`, translation: `Це приклад ${number}.` }], ...patch };
}
export function native(entries = [entry(1), entry(2, { kind: 'phrase' })]): NativeCollection {
  return { format: FORMAT, version: 1, collection, entries };
}
