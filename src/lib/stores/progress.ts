import { writable } from "svelte/store";
import type {
  FocusKind,
  HideKind,
  LearnPass,
  LearnPassDraft,
} from "../types/materials";

const STORAGE_KEY = "englishAssessmentTrainer.svelteState.v1";
export const DEFAULT_LEARN_PASS_ID = "default";

export type IndexPageSize = 6 | 12 | "all";
export type ListPageSize = 5 | 10 | 20 | "all";
export type IndexPanelId = "learnPass" | "learningBlocks" | "tagCloud" | "daily";

export type ProgressState = {
  activePage: string;
  phraseQuery: string;
  phraseCategory: string;
  wordQuery: string;
  wordCategory: string;
  irregularQuery: string;
  irregularGroup: string;
  reverseMode: "phrase" | "example";
  showHiddenPhrases: boolean;
  showHiddenWords: boolean;
  showHiddenIrregular: boolean;
  currentPrompt: string;
  speechRepeatCount: 10 | 20 | 50;
  selectedLearnPassId: string;
  learnPassSearch: string;
  indexTagFilter: string;
  indexPage: number;
  indexPageSize: IndexPageSize;
  indexLearnPassExpanded: boolean;
  indexLearningBlocksExpanded: boolean;
  indexTagCloudExpanded: boolean;
  indexDailyExpanded: boolean;
  phrasePage: number;
  phrasePageSize: ListPageSize;
  wordPage: number;
  wordPageSize: ListPageSize;
  irregularPage: number;
  irregularPageSize: ListPageSize;
  learnedPhrases: string[];
  hiddenPhrases: string[];
  hiddenWords: string[];
  hiddenIrregular: string[];
  favoriteBlocks: string[];
  favoritePhrases: string[];
  favoriteWords: string[];
  favoriteIrregular: string[];
  learnPasses: LearnPass[];
};

const defaultState: ProgressState = {
  activePage: "index",
  phraseQuery: "",
  phraseCategory: "All",
  wordQuery: "",
  wordCategory: "All",
  irregularQuery: "",
  irregularGroup: "All",
  reverseMode: "phrase",
  showHiddenPhrases: false,
  showHiddenWords: false,
  showHiddenIrregular: false,
  currentPrompt: "",
  speechRepeatCount: 10,
  selectedLearnPassId: DEFAULT_LEARN_PASS_ID,
  learnPassSearch: "",
  indexTagFilter: "",
  indexPage: 1,
  indexPageSize: 6,
  indexLearnPassExpanded: true,
  indexLearningBlocksExpanded: true,
  indexTagCloudExpanded: true,
  indexDailyExpanded: true,
  phrasePage: 1,
  phrasePageSize: 5,
  wordPage: 1,
  wordPageSize: 5,
  irregularPage: 1,
  irregularPageSize: 5,
  learnedPhrases: [],
  hiddenPhrases: [],
  hiddenWords: [],
  hiddenIrregular: [],
  favoriteBlocks: [],
  favoritePhrases: [],
  favoriteWords: [],
  favoriteIrregular: [],
  learnPasses: [],
};

function canUseStorage(): boolean {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizePositivePage(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 1;
}

function normalizeIndexPageSize(value: unknown): IndexPageSize {
  if (value === 12 || value === "all") return value;
  return 6;
}

function normalizeListPageSize(value: unknown): ListPageSize {
  if (value === 10 || value === 20 || value === "all") return value;
  return 5;
}

function normalizeLearnPass(value: unknown): LearnPass | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<LearnPass>;
  if (typeof candidate.id !== "string" || typeof candidate.name !== "string")
    return null;

  const now = new Date().toISOString();

  return {
    id: candidate.id,
    name: candidate.name.trim() || "Untitled pass",
    description:
      typeof candidate.description === "string" ? candidate.description : "",
    blockIds: normalizeStringList(candidate.blockIds),
    createdAt:
      typeof candidate.createdAt === "string" ? candidate.createdAt : now,
    updatedAt:
      typeof candidate.updatedAt === "string" ? candidate.updatedAt : now,
  };
}

function normalizeState(value: unknown): ProgressState {
  const raw =
    value && typeof value === "object" ? (value as Partial<ProgressState>) : {};
  const state: ProgressState = { ...defaultState, ...raw };
  const selectedExists =
    state.selectedLearnPassId === DEFAULT_LEARN_PASS_ID ||
    state.learnPasses.some((pass) => pass.id === state.selectedLearnPassId);

  return {
    ...state,
    selectedLearnPassId: selectedExists
      ? state.selectedLearnPassId
      : DEFAULT_LEARN_PASS_ID,
    indexTagFilter:
      typeof state.indexTagFilter === "string" ? state.indexTagFilter : "",
    indexPage: normalizePositivePage(state.indexPage),
    indexPageSize: normalizeIndexPageSize(state.indexPageSize),
    indexLearnPassExpanded: normalizeBoolean(state.indexLearnPassExpanded, true),
    indexLearningBlocksExpanded: normalizeBoolean(state.indexLearningBlocksExpanded, true),
    indexTagCloudExpanded: normalizeBoolean(state.indexTagCloudExpanded, true),
    indexDailyExpanded: normalizeBoolean(state.indexDailyExpanded, true),
    phrasePage: normalizePositivePage(state.phrasePage),
    phrasePageSize: normalizeListPageSize(state.phrasePageSize),
    wordPage: normalizePositivePage(state.wordPage),
    wordPageSize: normalizeListPageSize(state.wordPageSize),
    irregularPage: normalizePositivePage(state.irregularPage),
    irregularPageSize: normalizeListPageSize(state.irregularPageSize),
    learnedPhrases: normalizeStringList(state.learnedPhrases),
    hiddenPhrases: normalizeStringList(state.hiddenPhrases),
    hiddenWords: normalizeStringList(state.hiddenWords),
    hiddenIrregular: normalizeStringList(state.hiddenIrregular),
    favoriteBlocks: normalizeStringList(state.favoriteBlocks),
    favoritePhrases: normalizeStringList(state.favoritePhrases),
    favoriteWords: normalizeStringList(state.favoriteWords),
    favoriteIrregular: normalizeStringList(state.favoriteIrregular),
    learnPasses: Array.isArray(state.learnPasses)
      ? state.learnPasses
          .map(normalizeLearnPass)
          .filter((pass): pass is LearnPass => Boolean(pass))
      : [],
  };
}

function readState(): ProgressState {
  if (!canUseStorage()) return defaultState;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    return normalizeState(JSON.parse(raw));
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

function uniqueValues(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))];
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `learn-pass-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function focusKey(
  kind: FocusKind,
): keyof Pick<
  ProgressState,
  "favoriteBlocks" | "favoritePhrases" | "favoriteWords" | "favoriteIrregular"
> {
  if (kind === "block") return "favoriteBlocks";
  if (kind === "phrase") return "favoritePhrases";
  if (kind === "word") return "favoriteWords";
  return "favoriteIrregular";
}

function hiddenKey(
  kind: HideKind,
): keyof Pick<
  ProgressState,
  "hiddenPhrases" | "hiddenWords" | "hiddenIrregular"
> {
  if (kind === "phrase") return "hiddenPhrases";
  if (kind === "word") return "hiddenWords";
  return "hiddenIrregular";
}

function createProgressStore() {
  const { subscribe, set, update } = writable<ProgressState>(readState());

  subscribe(writeState);

  return {
    subscribe,
    setActivePage: (activePage: string) =>
      update((state) => ({ ...state, activePage })),
    setPhraseQuery: (phraseQuery: string) =>
      update((state) => ({ ...state, phraseQuery, phrasePage: 1 })),
    setPhraseCategory: (phraseCategory: string) =>
      update((state) => ({ ...state, phraseCategory, phrasePage: 1 })),
    setWordQuery: (wordQuery: string) =>
      update((state) => ({ ...state, wordQuery, wordPage: 1 })),
    setWordCategory: (wordCategory: string) =>
      update((state) => ({ ...state, wordCategory, wordPage: 1 })),
    setIrregularQuery: (irregularQuery: string) =>
      update((state) => ({ ...state, irregularQuery, irregularPage: 1 })),
    setIrregularGroup: (irregularGroup: string) =>
      update((state) => ({ ...state, irregularGroup, irregularPage: 1 })),
    setReverseMode: (reverseMode: ProgressState["reverseMode"]) =>
      update((state) => ({ ...state, reverseMode })),
    setCurrentPrompt: (currentPrompt: string) =>
      update((state) => ({ ...state, currentPrompt })),
    setSpeechRepeatCount: (
      speechRepeatCount: ProgressState["speechRepeatCount"],
    ) => update((state) => ({ ...state, speechRepeatCount })),
    setSelectedLearnPass: (selectedLearnPassId: string) =>
      update((state) => ({ ...state, selectedLearnPassId, indexPage: 1 })),
    setLearnPassSearch: (learnPassSearch: string) =>
      update((state) => ({ ...state, learnPassSearch })),
    setIndexTagFilter: (indexTagFilter: string) =>
      update((state) => ({ ...state, indexTagFilter, indexPage: 1 })),
    setIndexPage: (indexPage: number) =>
      update((state) => ({
        ...state,
        indexPage: normalizePositivePage(indexPage),
      })),
    setIndexPageSize: (indexPageSize: IndexPageSize) =>
      update((state) => ({ ...state, indexPageSize, indexPage: 1 })),
    toggleIndexPanel: (panel: IndexPanelId) =>
      update((state) => {
        if (panel === "learnPass") {
          return { ...state, indexLearnPassExpanded: !state.indexLearnPassExpanded };
        }
        if (panel === "learningBlocks") {
          return { ...state, indexLearningBlocksExpanded: !state.indexLearningBlocksExpanded };
        }
        if (panel === "tagCloud") {
          return { ...state, indexTagCloudExpanded: !state.indexTagCloudExpanded };
        }
        return { ...state, indexDailyExpanded: !state.indexDailyExpanded };
      }),
    setPhrasePage: (phrasePage: number) =>
      update((state) => ({
        ...state,
        phrasePage: normalizePositivePage(phrasePage),
      })),
    setPhrasePageSize: (phrasePageSize: ListPageSize) =>
      update((state) => ({ ...state, phrasePageSize, phrasePage: 1 })),
    setWordPage: (wordPage: number) =>
      update((state) => ({
        ...state,
        wordPage: normalizePositivePage(wordPage),
      })),
    setWordPageSize: (wordPageSize: ListPageSize) =>
      update((state) => ({ ...state, wordPageSize, wordPage: 1 })),
    setIrregularPage: (irregularPage: number) =>
      update((state) => ({
        ...state,
        irregularPage: normalizePositivePage(irregularPage),
      })),
    setIrregularPageSize: (irregularPageSize: ListPageSize) =>
      update((state) => ({ ...state, irregularPageSize, irregularPage: 1 })),
    saveLearnPass: (draft: LearnPassDraft) =>
      update((state) => {
        const existing = draft.id
          ? state.learnPasses.find((pass) => pass.id === draft.id)
          : undefined;
        const now = new Date().toISOString();
        const id = existing?.id ?? draft.id ?? createId();
        const pass: LearnPass = {
          id,
          name: draft.name.trim() || "Untitled pass",
          description: draft.description?.trim() ?? "",
          blockIds: uniqueValues(draft.blockIds),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        const learnPasses = existing
          ? state.learnPasses.map((item) => (item.id === id ? pass : item))
          : [...state.learnPasses, pass];
        return { ...state, learnPasses, selectedLearnPassId: id };
      }),
    deleteLearnPass: (id: string) =>
      update((state) => ({
        ...state,
        learnPasses: state.learnPasses.filter((pass) => pass.id !== id),
        selectedLearnPassId:
          state.selectedLearnPassId === id
            ? DEFAULT_LEARN_PASS_ID
            : state.selectedLearnPassId,
      })),
    toggleShowHidden: (kind: HideKind) =>
      update((state) => {
        if (kind === "phrase")
          return { ...state, showHiddenPhrases: !state.showHiddenPhrases };
        if (kind === "word")
          return { ...state, showHiddenWords: !state.showHiddenWords };
        return { ...state, showHiddenIrregular: !state.showHiddenIrregular };
      }),
    toggleLearnedPhrase: (id: string) =>
      update((state) => ({
        ...state,
        learnedPhrases: toggleValue(state.learnedPhrases, id),
      })),
    toggleFavorite: (kind: FocusKind, id: string) =>
      update((state) => {
        const key = focusKey(kind);
        return { ...state, [key]: toggleValue(state[key], id) };
      }),
    hideItem: (kind: HideKind, id: string) =>
      update((state) => {
        const hidden = hiddenKey(kind);
        const favorite =
          kind === "phrase"
            ? "favoritePhrases"
            : kind === "word"
              ? "favoriteWords"
              : "favoriteIrregular";
        const patch: Partial<ProgressState> = {
          [hidden]: state[hidden].includes(id)
            ? state[hidden]
            : [...state[hidden], id],
          [favorite]: removeValue(state[favorite], id),
        };
        if (kind === "phrase")
          patch.learnedPhrases = removeValue(state.learnedPhrases, id);
        return { ...state, ...patch };
      }),
    unhideItem: (kind: HideKind, id: string) =>
      update((state) => {
        const key = hiddenKey(kind);
        return { ...state, [key]: removeValue(state[key], id) };
      }),
    unhideAll: (kind: HideKind) =>
      update((state) => {
        const key = hiddenKey(kind);
        return { ...state, [key]: [] };
      }),
    resetAll: () => set(defaultState),
  };
}

export const progress = createProgressStore();
