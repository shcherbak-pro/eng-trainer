import type { ContentCatalog } from '../../content/catalog';
import { phraseTargets, verbTargets, type SpokenTarget, type SpokenTargetKind } from './spokenTarget.js';

/**
 * What the Pronunciation screen can offer to say, taken from the same catalog as the
 * other screens (ENG-V3-02, stage A). Built-in and imported phrases go through the same
 * rules (spokenTarget.js). Words are not listed on their own: a word is practised under
 * its phrase.
 */
export type PracticeItem = {
  target: SpokenTarget;
  /** Ukrainian meaning of the entry, for orientation. Empty when the target is not the entry's own text. */
  translation: string;
  /** The entry's own text, when the target is a part or an example of it. */
  source: string;
};

export type PracticeGroup = { id: string; title: string; items: PracticeItem[] };

export const KIND_LABELS: Record<SpokenTargetKind, string> = {
  text: 'Phrase',
  frame: 'Beginning of a sentence',
  example: 'Example sentence',
  'verb-forms': 'Verb forms'
};

export const VERBS_GROUP_ID = 'irregular-verbs';

export function practiceGroups(catalog: ContentCatalog): PracticeGroup[] {
  const groups = new Map<string, PracticeGroup>();
  for (const phrase of catalog.phrases) {
    const targets = phraseTargets(phrase);
    if (!targets.length) continue;
    const id = `phrases:${phrase.category}`;
    const group = groups.get(id) ?? { id, title: phrase.category, items: [] };
    groups.set(id, group);
    for (const target of targets) {
      const own = target.kind === 'text';
      group.items.push({ target, translation: own ? phrase.translation : '', source: own ? '' : phrase.phrase });
    }
  }

  const result = [...groups.values()];
  if (catalog.irregularVerbs.length) {
    result.push({
      id: VERBS_GROUP_ID,
      title: 'Irregular verbs',
      items: catalog.irregularVerbs.flatMap((verb) => verbTargets(verb).map((target) => ({ target, translation: verb.translation, source: '' })))
    });
  }
  return result;
}
