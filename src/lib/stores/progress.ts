import { writable } from 'svelte/store';
import type { FocusKind, HideKind } from '../types/materials';

const STORAGE_KEY = 'englishAssessmentTrainer.svelteState.v1';

export type ProgressState = {
  activePage: string;
  phraseQuery: string;
  phraseCategory: string;
  wordQuery: string;
  wordCategory: string;
  irregularQuery: string;
  irregularGroup: string;
  reverseMode: 'phrase' | 'example';
  showHiddenPhrases: boolean;
  showHiddenWords: boolean;
  showHiddenIrregular: boolean;
  currentPrompt: string;
  speechRepeatCount: 10 | 20 | 50;
  learnedPhrases: string[];
  hiddenPhrases: string[];
  hiddenWords: string[];
  hiddenIrregular: string[];
  favoriteBlocks: string[];
  favoritePhrases: string[];
  favoriteWords: string[];
  favoriteIrregular: string[];
};

const defaultState: ProgressState = {
  activePage: 'index',
  phraseQuery: '',
  phraseCategory: 'All',
  wordQuery: '',
  wordCategory: 'All',
  irregularQuery: '',
  irregularGroup: 'All',
  reverseMode: 'phrase',
  showHiddenPhrases: false,
  showHiddenWords: false,
  showHiddenIrregular: false,
  currentPrompt: '',
  speechRepeatCount: 10,
  learnedPhrases: [],
  hiddenPhrases: [],
  hiddenWords: [],
  hiddenIrregular: [],
  favoriteBlocks: [],
  favoritePhrases: [],
  favoriteWords: [],
  favoriteIrregular: []
};

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readState(): ProgressState {
  if (!canUseStorage()) return defaultState;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    return { ...defaultState, ...JSON.parse(raw) };
  } catch {
    return defaultState;
  }
}

function writeState(state: ProgressState): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage can be disabled in private mode; the app should still work.
  }
}

function toggleValue(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

function removeValue(list: string[], id: string): string[] {
  return list.filter((item) => item !== id);
}

function focusKey(kind: FocusKind): keyof Pick<ProgressState, 'favoriteBlocks' | 'favoritePhrases' | 'favoriteWords' | 'favoriteIrregular'> {
  if (kind === 'block') return 'favoriteBlocks';
  if (kind === 'phrase') return 'favoritePhrases';
  if (kind === 'word') return 'favoriteWords';
  return 'favoriteIrregular';
}

function hiddenKey(kind: HideKind): keyof Pick<ProgressState, 'hiddenPhrases' | 'hiddenWords' | 'hiddenIrregular'> {
  if (kind === 'phrase') return 'hiddenPhrases';
  if (kind === 'word') return 'hiddenWords';
  return 'hiddenIrregular';
}

function createProgressStore() {
  const { subscribe, set, update } = writable<ProgressState>(readState());

  subscribe(writeState);

  return {
    subscribe,
    setActivePage: (activePage: string) => update((state) => ({ ...state, activePage })),
    setPhraseQuery: (phraseQuery: string) => update((state) => ({ ...state, phraseQuery })),
    setPhraseCategory: (phraseCategory: string) => update((state) => ({ ...state, phraseCategory })),
    setWordQuery: (wordQuery: string) => update((state) => ({ ...state, wordQuery })),
    setWordCategory: (wordCategory: string) => update((state) => ({ ...state, wordCategory })),
    setIrregularQuery: (irregularQuery: string) => update((state) => ({ ...state, irregularQuery })),
    setIrregularGroup: (irregularGroup: string) => update((state) => ({ ...state, irregularGroup })),
    setReverseMode: (reverseMode: ProgressState['reverseMode']) => update((state) => ({ ...state, reverseMode })),
    setCurrentPrompt: (currentPrompt: string) => update((state) => ({ ...state, currentPrompt })),
    setSpeechRepeatCount: (speechRepeatCount: ProgressState['speechRepeatCount']) => update((state) => ({ ...state, speechRepeatCount })),
    toggleShowHidden: (kind: HideKind) => update((state) => {
      if (kind === 'phrase') return { ...state, showHiddenPhrases: !state.showHiddenPhrases };
      if (kind === 'word') return { ...state, showHiddenWords: !state.showHiddenWords };
      return { ...state, showHiddenIrregular: !state.showHiddenIrregular };
    }),
    toggleLearnedPhrase: (id: string) => update((state) => ({
      ...state,
      learnedPhrases: toggleValue(state.learnedPhrases, id)
    })),
    toggleFavorite: (kind: FocusKind, id: string) => update((state) => {
      const key = focusKey(kind);
      return { ...state, [key]: toggleValue(state[key], id) };
    }),
    hideItem: (kind: HideKind, id: string) => update((state) => {
      const hidden = hiddenKey(kind);
      const favorite = kind === 'phrase' ? 'favoritePhrases' : kind === 'word' ? 'favoriteWords' : 'favoriteIrregular';
      const patch: Partial<ProgressState> = {
        [hidden]: state[hidden].includes(id) ? state[hidden] : [...state[hidden], id],
        [favorite]: removeValue(state[favorite], id)
      };
      if (kind === 'phrase') patch.learnedPhrases = removeValue(state.learnedPhrases, id);
      return { ...state, ...patch };
    }),
    unhideItem: (kind: HideKind, id: string) => update((state) => {
      const key = hiddenKey(kind);
      return { ...state, [key]: removeValue(state[key], id) };
    }),
    unhideAll: (kind: HideKind) => update((state) => {
      const key = hiddenKey(kind);
      return { ...state, [key]: [] };
    }),
    resetAll: () => set(defaultState)
  };
}

export const progress = createProgressStore();
