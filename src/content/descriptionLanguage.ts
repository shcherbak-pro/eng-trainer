/**
 * The language of each built-in learning block's description, keyed by the stable block id.
 *
 * This is presentation metadata, kept here rather than in the frozen content packs, so pack
 * values, field order, ids and generation fingerprints stay unchanged. Each description was
 * read and classified by the language of its own wording: a Ukrainian sentence that quotes
 * English study phrases ("Фрази для структури відповіді: first of all, …") is Ukrainian.
 * The classification is deliberately explicit; there is no "contains Cyrillic" rule.
 */
const BLOCK_DESCRIPTION_LANGUAGE: Readonly<Record<string, 'en' | 'uk'>> = {
  'start-answer': 'uk',
  structure: 'uk',
  'word-index': 'uk',
  'reverse-practice': 'uk',
  'irregular-verbs-100': 'en',
  'irregular-verbs-logical-200': 'en',
  contrast: 'uk',
  ending: 'uk',
  'ai-coding-tools': 'uk',
  'lack-not-enough': 'uk',
  'speed-difficulty-clarity': 'uk',
  'time-estimates': 'uk',
  'online-meetings': 'uk',
  'compare-difference': 'uk',
  'conduct-vs-carry-out': 'uk',
  modals: 'uk',
  conjunctions: 'en',
  otherwise: 'en',
  'informal-phrases': 'uk',
  'presentation-phrases': 'en',
  'agent-framework-vocabulary': 'en',
  'hedging-phrases': 'en',
  'advanced-linking-words': 'en',
  'topic-tell-me-about-yourself': 'en',
  'topic-hobbies': 'en',
  'topic-work-life-balance': 'en',
  'topic-teamwork': 'en',
  'topic-stress-management': 'en',
  'topic-time-management': 'en',
  'topic-leadership': 'en',
  'topic-remote-work': 'en',
  'topic-career-growth': 'en',
  'topic-communication-in-distributed-teams': 'en',
  'topic-conflict-resolution-team-problems': 'en',
  'answer-patterns': 'en',
  'ready-answers': 'uk',
  'practice-mode': 'en',
  'ai-certification-vocabulary': 'en',
  'ai-certification-verbs-contextual': 'en',
  // ENG-V2-03 learning topics: English descriptions.
  'topic-conditionals': 'en',
  'topic-small-talk': 'en',
  'topic-interview-english': 'en'
};

/** The `lang` value for a block description: 'en', 'uk', or '' (unknown) for a block not classified here. */
export function blockDescriptionLang(blockId: string): 'en' | 'uk' | '' {
  return BLOCK_DESCRIPTION_LANGUAGE[blockId] ?? '';
}

/** The classified block ids, for the completeness test. */
export const CLASSIFIED_BLOCK_IDS: readonly string[] = Object.keys(BLOCK_DESCRIPTION_LANGUAGE);
