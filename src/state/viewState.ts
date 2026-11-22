import { writable } from 'svelte/store';

/**
 * Transient interface state: search text, the current page of each list and
 * the current practice prompt.
 *
 * It is kept in memory only. It survives moving between screens, and it starts
 * empty after a reload.
 */
export type ViewState = {
  phraseQuery: string;
  wordQuery: string;
  irregularQuery: string;
  learnPassSearch: string;
  indexPage: number;
  phrasePage: number;
  wordPage: number;
  irregularPage: number;
  currentPrompt: string;
  /** Search text of each learning topic screen, by topic id (ENG-V2-03). */
  topicQueries: Record<string, string>;
  /** Selected subsection chip of each learning topic, by topic id; "" means all. */
  topicSections: Record<string, string>;
};

export type ListId = 'index' | 'phrase' | 'word' | 'irregular';

const defaultState: ViewState = {
  phraseQuery: '',
  wordQuery: '',
  irregularQuery: '',
  learnPassSearch: '',
  indexPage: 1,
  phrasePage: 1,
  wordPage: 1,
  irregularPage: 1,
  currentPrompt: '',
  topicQueries: {},
  topicSections: {}
};

function positivePage(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function createViewState() {
  const { subscribe, set, update } = writable<ViewState>(defaultState);

  return {
    subscribe,
    setPhraseQuery: (phraseQuery: string) => update((state) => ({ ...state, phraseQuery, phrasePage: 1 })),
    setWordQuery: (wordQuery: string) => update((state) => ({ ...state, wordQuery, wordPage: 1 })),
    setIrregularQuery: (irregularQuery: string) => update((state) => ({ ...state, irregularQuery, irregularPage: 1 })),
    setLearnPassSearch: (learnPassSearch: string) => update((state) => ({ ...state, learnPassSearch })),
    setIndexPage: (page: number) => update((state) => ({ ...state, indexPage: positivePage(page) })),
    setPhrasePage: (page: number) => update((state) => ({ ...state, phrasePage: positivePage(page) })),
    setWordPage: (page: number) => update((state) => ({ ...state, wordPage: positivePage(page) })),
    setIrregularPage: (page: number) => update((state) => ({ ...state, irregularPage: positivePage(page) })),
    /** A changed filter or page size always shows the first page of its list. */
    resetPage: (list: ListId) => update((state) => ({ ...state, [`${list}Page`]: 1 })),
    setCurrentPrompt: (currentPrompt: string) => update((state) => ({ ...state, currentPrompt })),
    setTopicQuery: (topicId: string, query: string) =>
      update((state) => ({ ...state, topicQueries: { ...state.topicQueries, [topicId]: query } })),
    setTopicSection: (topicId: string, sectionId: string) =>
      update((state) => ({ ...state, topicSections: { ...state.topicSections, [topicId]: sectionId } })),
    reset: () => set(defaultState)
  };
}

export const viewState = createViewState();
