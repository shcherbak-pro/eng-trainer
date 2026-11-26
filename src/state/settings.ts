import { writable } from 'svelte/store';
import type { StoredRecords, WriteOp } from '../storage/database';
import { changesHeld, persist } from './persistence';
import { viewState } from './viewState';

/**
 * User preferences: theme, speech, list filters and sizes, open panels and the
 * selected flashcard deck.
 *
 * Every preference is one record in the `settings` store of the database, with
 * the property name as its key.
 */
export type ThemePreference = 'system' | 'light' | 'dark';
export type SpeechRepeatCount = 10 | 20 | 50;
export type IndexPageSize = 6 | 12 | 'all';
export type ListPageSize = 5 | 10 | 20 | 'all';
export type IndexPanelId = 'learnPass' | 'learningBlocks' | 'tagCloud' | 'daily';
export type FlashcardMode = 'all' | 'topic';
export type HiddenListKind = 'phrase' | 'word' | 'irregular';

export type SettingsState = {
  collectionFilter: string;
  theme: ThemePreference;
  speechRepeatCount: SpeechRepeatCount;
  /** The screen that opens when the address has no page in it. */
  activePage: string;
  phraseCategory: string;
  wordCategory: string;
  irregularSet: string;
  irregularGroup: string;
  indexTagFilter: string;
  showHiddenPhrases: boolean;
  showHiddenWords: boolean;
  showHiddenIrregular: boolean;
  indexPageSize: IndexPageSize;
  phrasePageSize: ListPageSize;
  wordPageSize: ListPageSize;
  irregularPageSize: ListPageSize;
  indexLearnPassExpanded: boolean;
  indexLearningBlocksExpanded: boolean;
  indexTagCloudExpanded: boolean;
  indexDailyExpanded: boolean;
  flashcardMode: FlashcardMode;
  flashcardTopic: string;
};

const defaultState: SettingsState = {
  collectionFilter: '',
  theme: 'system',
  speechRepeatCount: 10,
  activePage: 'index',
  phraseCategory: 'All',
  wordCategory: 'All',
  irregularSet: 'essential-100',
  irregularGroup: 'All',
  indexTagFilter: '',
  showHiddenPhrases: false,
  showHiddenWords: false,
  showHiddenIrregular: false,
  indexPageSize: 6,
  phrasePageSize: 5,
  wordPageSize: 5,
  irregularPageSize: 5,
  indexLearnPassExpanded: true,
  indexLearningBlocksExpanded: true,
  indexTagCloudExpanded: true,
  indexDailyExpanded: true,
  flashcardMode: 'all',
  flashcardTopic: ''
};

export type SettingKey = keyof SettingsState;

/** Every stored preference, in a stable order. */
export const SETTING_KEYS = Object.keys(defaultState) as SettingKey[];

function isString(value: unknown): boolean {
  return typeof value === 'string';
}

function isBoolean(value: unknown): boolean {
  return typeof value === 'boolean';
}

function oneOf(...allowed: unknown[]): (value: unknown) => boolean {
  return (value) => allowed.includes(value);
}

/** A saved value that fails its check is ignored and the default is used. */
const isValid: Record<SettingKey, (value: unknown) => boolean> = {
  collectionFilter: isString,
  theme: oneOf('system', 'light', 'dark'),
  speechRepeatCount: oneOf(10, 20, 50),
  activePage: isString,
  phraseCategory: isString,
  wordCategory: isString,
  irregularSet: isString,
  irregularGroup: isString,
  indexTagFilter: isString,
  showHiddenPhrases: isBoolean,
  showHiddenWords: isBoolean,
  showHiddenIrregular: isBoolean,
  indexPageSize: oneOf(6, 12, 'all'),
  phrasePageSize: oneOf(5, 10, 20, 'all'),
  wordPageSize: oneOf(5, 10, 20, 'all'),
  irregularPageSize: oneOf(5, 10, 20, 'all'),
  indexLearnPassExpanded: isBoolean,
  indexLearningBlocksExpanded: isBoolean,
  indexTagCloudExpanded: isBoolean,
  indexDailyExpanded: isBoolean,
  flashcardMode: oneOf('all', 'topic'),
  flashcardTopic: isString
};

/** Builds the settings from the saved records. Missing records keep their defaults. */
export function readSettings(records: StoredRecords): SettingsState {
  const saved: Partial<Record<SettingKey, unknown>> = {};

  for (const key of SETTING_KEYS) {
    const value = records.settings.get(key);
    if (value !== undefined && isValid[key](value)) saved[key] = value;
  }

  return { ...defaultState, ...(saved as Partial<SettingsState>) };
}

function changedRecords(previous: SettingsState, next: SettingsState): WriteOp[] {
  return SETTING_KEYS.filter((key) => previous[key] !== next[key]).map((key) => ({
    type: 'put',
    store: 'settings',
    key,
    value: next[key]
  }));
}

function createSettingsStore() {
  let state = defaultState;
  const store = writable<SettingsState>(state);

  function update(patch: Partial<SettingsState> | ((current: SettingsState) => Partial<SettingsState>)): void {
    // A recovery from a backup is replacing the saved state (experimental product only): no change is accepted.
    if (__ENG_BACKUP__ && changesHeld()) return;
    const next = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    const ops = changedRecords(state, next);
    if (!ops.length) return;

    state = next;
    store.set(next);
    persist(ops);
  }

  return {
    subscribe: store.subscribe,
    setCollectionFilter(collectionFilter: string): void {
      update({ collectionFilter });
      viewState.resetPage('phrase');
      viewState.resetPage('word');
    },
    /** Replaces the in-memory settings with the saved ones. Writes nothing. */
    hydrate(records: StoredRecords): void {
      state = readSettings(records);
      store.set(state);
    },
    setTheme: (theme: ThemePreference) => update({ theme }),
    setSpeechRepeatCount: (speechRepeatCount: SpeechRepeatCount) => update({ speechRepeatCount }),
    setActivePage: (activePage: string) => update({ activePage }),
    setPhraseCategory(phraseCategory: string): void {
      update({ phraseCategory });
      viewState.resetPage('phrase');
    },
    setWordCategory(wordCategory: string): void {
      update({ wordCategory });
      viewState.resetPage('word');
    },
    setIrregularSet(irregularSet: string): void {
      update({ irregularSet, irregularGroup: 'All' });
      viewState.resetPage('irregular');
    },
    setIrregularGroup(irregularGroup: string): void {
      update({ irregularGroup });
      viewState.resetPage('irregular');
    },
    setIndexTagFilter(indexTagFilter: string): void {
      update({ indexTagFilter });
      viewState.resetPage('index');
    },
    setIndexPageSize(indexPageSize: IndexPageSize): void {
      update({ indexPageSize });
      viewState.resetPage('index');
    },
    setPhrasePageSize(phrasePageSize: ListPageSize): void {
      update({ phrasePageSize });
      viewState.resetPage('phrase');
    },
    setWordPageSize(wordPageSize: ListPageSize): void {
      update({ wordPageSize });
      viewState.resetPage('word');
    },
    setIrregularPageSize(irregularPageSize: ListPageSize): void {
      update({ irregularPageSize });
      viewState.resetPage('irregular');
    },
    toggleShowHidden: (kind: HiddenListKind) =>
      update((current) => {
        if (kind === 'phrase') return { showHiddenPhrases: !current.showHiddenPhrases };
        if (kind === 'word') return { showHiddenWords: !current.showHiddenWords };
        return { showHiddenIrregular: !current.showHiddenIrregular };
      }),
    toggleIndexPanel: (panel: IndexPanelId) =>
      update((current) => {
        if (panel === 'learnPass') return { indexLearnPassExpanded: !current.indexLearnPassExpanded };
        if (panel === 'learningBlocks') return { indexLearningBlocksExpanded: !current.indexLearningBlocksExpanded };
        if (panel === 'tagCloud') return { indexTagCloudExpanded: !current.indexTagCloudExpanded };
        return { indexDailyExpanded: !current.indexDailyExpanded };
      }),
    setFlashcardMode: (flashcardMode: FlashcardMode) => update({ flashcardMode }),
    setFlashcardTopic: (flashcardTopic: string) => update({ flashcardTopic }),
    /** Back to the defaults. The theme is kept, as it is not learning state. */
    reset: () => update((current) => ({ ...defaultState, theme: current.theme }))
  };
}

export const settings = createSettingsStore();
