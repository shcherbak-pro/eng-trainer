import { writable } from 'svelte/store';
import type { StoredRecords, WriteOp } from '../storage/database';
import { changesHeld, persist } from './persistence';
import { viewState } from './viewState';

/**
 * Learning state: learned and hidden entries, the Focus List, Learn Passes and
 * the review sequence of every flashcard deck.
 *
 * Entries are referenced by their dataset ids. In the database:
 * - `progress` holds one record per id list (key = property name) and the
 *   selected Learn Pass;
 * - `learnPasses` holds one record per Learn Pass (key = pass id);
 * - `flashcardSessions` holds one record per deck (key = deck key).
 */
export const DEFAULT_LEARN_PASS_ID = 'default';

export type FocusKind = 'block' | 'phrase' | 'word' | 'irregular';
export type HideKind = 'phrase' | 'word' | 'irregular';

export type LearnPass = {
  id: string;
  name: string;
  description?: string;
  blockIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type LearnPassDraft = {
  id?: string;
  name: string;
  description?: string;
  blockIds: string[];
};

/** The cards of one deck that are still being learned, and the current position. */
export type FlashcardSession = {
  order: string[];
  index: number;
};

const LIST_KEYS = [
  'learnedPhrases',
  'hiddenPhrases',
  'hiddenWords',
  'hiddenIrregular',
  'favoriteBlocks',
  'favoritePhrases',
  'favoriteWords',
  'favoriteIrregular'
] as const;

type ListKey = (typeof LIST_KEYS)[number];

export type ProgressState = Record<ListKey, string[]> & {
  learnPasses: LearnPass[];
  selectedLearnPassId: string;
  flashcardSessions: Record<string, FlashcardSession>;
};

const defaultState: ProgressState = {
  learnedPhrases: [],
  hiddenPhrases: [],
  hiddenWords: [],
  hiddenIrregular: [],
  favoriteBlocks: [],
  favoritePhrases: [],
  favoriteWords: [],
  favoriteIrregular: [],
  learnPasses: [],
  selectedLearnPassId: DEFAULT_LEARN_PASS_ID,
  flashcardSessions: {}
};

/** Every field of the learning state, in a stable order. */
export const PROGRESS_KEYS = Object.keys(defaultState) as (keyof ProgressState)[];

/**
 * The stored entry state that an Undo would restore:
 * - `hide`: the hidden flag, the Focus flag and, for a phrase, the learned flag of one entry;
 * - `learned`: the learned flag of one learning identity (a flashcard id).
 */
export type UndoScope = { type: 'hide'; kind: HideKind; id: string } | { type: 'learned'; id: string };

/**
 * An issued Undo. It can be used once, and only while nothing newer has touched
 * the same stored entry state and no Reset or reload of the saved state has happened.
 */
export type UndoToken = {
  readonly generation: number;
  readonly revisions: ReadonlyArray<readonly [string, number]>;
  used: boolean;
};

const FOCUS_LIST: Record<FocusKind, ListKey> = {
  block: 'favoriteBlocks',
  phrase: 'favoritePhrases',
  word: 'favoriteWords',
  irregular: 'favoriteIrregular'
};

const HIDDEN_LIST: Record<HideKind, ListKey> = {
  phrase: 'hiddenPhrases',
  word: 'hiddenWords',
  irregular: 'hiddenIrregular'
};

function uniqueValues(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))];
}

function toggleValue(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

function removeValue(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : list;
}

function removeValues(list: string[], ids: string[]): string[] {
  return list.some((id) => ids.includes(id)) ? list.filter((id) => !ids.includes(id)) : list;
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `learn-pass-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// --- Reading saved records -------------------------------------------------

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? uniqueValues(value.filter((item): item is string => typeof item === 'string')) : [];
}

function readLearnPass(value: unknown): LearnPass | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<LearnPass>;
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return null;

  const now = new Date().toISOString();

  return {
    id: candidate.id,
    name: candidate.name.trim() || 'Untitled pass',
    description: typeof candidate.description === 'string' ? candidate.description : '',
    blockIds: readStringList(candidate.blockIds),
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : now,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : now
  };
}

function readFlashcardSession(value: unknown): FlashcardSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const candidate = value as Partial<FlashcardSession>;
  const order = readStringList(candidate.order);
  const index =
    typeof candidate.index === 'number' && Number.isFinite(candidate.index) && candidate.index > 0
      ? Math.floor(candidate.index)
      : 0;

  return { order, index: index < order.length ? index : 0 };
}

/**
 * Builds the learning state from the saved records.
 * Missing records keep their defaults; malformed records are repaired or skipped.
 */
export function readProgress(records: StoredRecords): ProgressState {
  const state: ProgressState = { ...defaultState };

  for (const key of LIST_KEYS) {
    state[key] = readStringList(records.progress.get(key));
  }

  state.learnPasses = [...records.learnPasses.values()]
    .map(readLearnPass)
    .filter((pass): pass is LearnPass => pass !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const selected = records.progress.get('selectedLearnPassId');
  state.selectedLearnPassId =
    typeof selected === 'string' && state.learnPasses.some((pass) => pass.id === selected)
      ? selected
      : DEFAULT_LEARN_PASS_ID;

  state.flashcardSessions = {};
  for (const [deckKey, value] of records.flashcardSessions) {
    const session = readFlashcardSession(value);
    if (session) state.flashcardSessions[deckKey] = session;
  }

  return state;
}

// --- Writing changes ---------------------------------------------------------

/** The storage operations that turn the saved `previous` state into `next`. */
function changedRecords(previous: ProgressState, next: ProgressState): WriteOp[] {
  const ops: WriteOp[] = [];

  for (const key of LIST_KEYS) {
    if (previous[key] !== next[key]) ops.push({ type: 'put', store: 'progress', key, value: next[key] });
  }

  if (previous.selectedLearnPassId !== next.selectedLearnPassId) {
    ops.push({ type: 'put', store: 'progress', key: 'selectedLearnPassId', value: next.selectedLearnPassId });
  }

  if (previous.learnPasses !== next.learnPasses) {
    const before = new Map(previous.learnPasses.map((pass) => [pass.id, pass]));
    for (const pass of next.learnPasses) {
      if (before.get(pass.id) !== pass) ops.push({ type: 'put', store: 'learnPasses', key: pass.id, value: pass });
      before.delete(pass.id);
    }
    for (const id of before.keys()) ops.push({ type: 'delete', store: 'learnPasses', key: id });
  }

  if (previous.flashcardSessions !== next.flashcardSessions) {
    for (const [deckKey, session] of Object.entries(next.flashcardSessions)) {
      if (previous.flashcardSessions[deckKey] !== session) {
        ops.push({ type: 'put', store: 'flashcardSessions', key: deckKey, value: session });
      }
    }
    for (const deckKey of Object.keys(previous.flashcardSessions)) {
      if (!(deckKey in next.flashcardSessions)) ops.push({ type: 'delete', store: 'flashcardSessions', key: deckKey });
    }
  }

  return ops;
}

function createProgressStore() {
  let state = defaultState;
  const store = writable<ProgressState>(state);

  // Operation validity, in memory only (nothing here is saved). Every action records a
  // new revision for the stored entry state it touches, even when the stored value does
  // not change: "Keep learning" on a card that is not learned is still newer intent.
  // Reset and every reload of the saved state start a new generation.
  let generation = 0;
  let clock = 0;
  const revisions = new Map<string, number>();

  /** Keys are the stored list and the id it holds, never display text. */
  const entryKey = (list: ListKey, id: string): string => `${list}:${id}`;

  function touch(keys: string[]): void {
    for (const key of keys) revisions.set(key, ++clock);
  }

  function newGeneration(): void {
    generation += 1;
    revisions.clear();
  }

  function scopeKeys(scope: UndoScope): string[] {
    if (scope.type === 'learned') return [entryKey('learnedPhrases', scope.id)];
    const keys = [entryKey(HIDDEN_LIST[scope.kind], scope.id), entryKey(FOCUS_LIST[scope.kind], scope.id)];
    if (scope.kind === 'phrase') keys.push(entryKey('learnedPhrases', scope.id));
    return keys;
  }

  const learnedKeys = (ids: string[]): string[] => ids.map((id) => entryKey('learnedPhrases', id));

  /** Applies a change in memory and queues the records that changed. */
  function update(change: (current: ProgressState) => ProgressState): void {
    // A recovery from a backup is replacing the saved state (experimental product only): no change is accepted.
    if (__ENG_BACKUP__ && changesHeld()) return;
    const next = change(state);
    const ops = changedRecords(state, next);
    if (!ops.length) return;

    state = next;
    store.set(next);
    persist(ops);
  }

  return {
    subscribe: store.subscribe,
    /** Replaces the in-memory state with the saved one. Writes nothing. Earlier Undo offers expire. */
    hydrate(records: StoredRecords): void {
      newGeneration();
      state = readProgress(records);
      store.set(state);
    },
    /** Issues an Undo for the entry state of `scope` as it is now. Call it right after the action. */
    issueUndo(scope: UndoScope): UndoToken {
      return { generation, revisions: scopeKeys(scope).map((key) => [key, revisions.get(key) ?? 0] as const), used: false };
    },
    /**
     * Uses an Undo. It is refused when it was used before, after a Reset or reload of the saved
     * state, and after any newer action on the same stored entry state.
     */
    redeemUndo(token: UndoToken): boolean {
      if (token.used || token.generation !== generation) return false;
      if (token.revisions.some(([key, revision]) => (revisions.get(key) ?? 0) !== revision)) return false;
      token.used = true;
      return true;
    },
    /** Records newer intent for an entry without changing it, such as "Keep learning". */
    noteIntent: (scope: UndoScope) => touch(scopeKeys(scope)),
    toggleLearnedPhrase: (id: string) => {
      touch([entryKey('learnedPhrases', id)]);
      update((current) => ({ ...current, learnedPhrases: toggleValue(current.learnedPhrases, id) }));
    },
    toggleFavorite: (kind: FocusKind, id: string) => {
      touch([entryKey(FOCUS_LIST[kind], id)]);
      update((current) => ({ ...current, [FOCUS_LIST[kind]]: toggleValue(current[FOCUS_LIST[kind]], id) }));
    },
    /** A hidden item also leaves the Focus List and is no longer "learned". */
    hideItem: (kind: HideKind, id: string) => {
      touch(scopeKeys({ type: 'hide', kind, id }));
      update((current) => {
        const hidden = HIDDEN_LIST[kind];
        const focus = FOCUS_LIST[kind];
        return {
          ...current,
          [hidden]: current[hidden].includes(id) ? current[hidden] : [...current[hidden], id],
          [focus]: removeValue(current[focus], id),
          learnedPhrases: kind === 'phrase' ? removeValue(current.learnedPhrases, id) : current.learnedPhrases
        };
      });
    },
    unhideItem: (kind: HideKind, id: string) => {
      touch([entryKey(HIDDEN_LIST[kind], id)]);
      update((current) => ({ ...current, [HIDDEN_LIST[kind]]: removeValue(current[HIDDEN_LIST[kind]], id) }));
    },
    // Bulk unhide is scoped to catalog-known IDs; absent collections keep their flags.
    unhideAll: (kind: HideKind, availableIds: string[]) => {
      touch(availableIds.map((id) => entryKey(HIDDEN_LIST[kind], id)));
      update((current) => ({ ...current, [HIDDEN_LIST[kind]]: removeValues(current[HIDDEN_LIST[kind]], availableIds) }));
    },
    setSelectedLearnPass(selectedLearnPassId: string): void {
      update((current) => ({ ...current, selectedLearnPassId }));
      viewState.resetPage('index');
    },
    /** Creates or updates a Learn Pass and makes it the active one. */
    saveLearnPass: (draft: LearnPassDraft) =>
      update((current) => {
        const existing = draft.id ? current.learnPasses.find((pass) => pass.id === draft.id) : undefined;
        const now = new Date().toISOString();
        const id = existing?.id ?? draft.id ?? createId();
        const pass: LearnPass = {
          id,
          name: draft.name.trim() || 'Untitled pass',
          description: draft.description?.trim() ?? '',
          blockIds: uniqueValues(draft.blockIds),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        };
        const learnPasses = existing
          ? current.learnPasses.map((item) => (item.id === id ? pass : item))
          : [...current.learnPasses, pass];
        return { ...current, learnPasses, selectedLearnPassId: id };
      }),
    deleteLearnPass: (id: string) =>
      update((current) => ({
        ...current,
        learnPasses: current.learnPasses.filter((pass) => pass.id !== id),
        selectedLearnPassId: current.selectedLearnPassId === id ? DEFAULT_LEARN_PASS_ID : current.selectedLearnPassId
      })),
    // Saves the review sequence of one deck. `learnedIds` are the items the
    // learner has just marked as known; they are shared with every other deck.
    saveFlashcardSession: (deckKey: string, session: FlashcardSession, learnedIds: string[] = []) => {
      touch(learnedKeys(learnedIds));
      update((current) => ({
        ...current,
        learnedPhrases: learnedIds.every((id) => current.learnedPhrases.includes(id))
          ? current.learnedPhrases
          : uniqueValues([...current.learnedPhrases, ...learnedIds]),
        flashcardSessions: { ...current.flashcardSessions, [deckKey]: session }
      }));
    },
    // "Learn again": the items go back to the learning pool of every deck.
    relearnFlashcards: (ids: string[]) => {
      touch(learnedKeys(ids));
      update((current) => ({ ...current, learnedPhrases: removeValues(current.learnedPhrases, ids) }));
    },
    // Resets one deck: its learned items become unlearned and its review
    // sequence starts from the beginning. A reconciled session may retain
    // temporarily unavailable vocabulary in its existing slots. The reset is
    // newer intent for every card of the deck (`deckCardIds`), learned or not.
    resetFlashcardDeck: (deckKey: string, ids: string[], session?: FlashcardSession, deckCardIds: string[] = []) => {
      touch(learnedKeys([...ids, ...deckCardIds, ...(session?.order ?? [])]));
      update((current) => {
        const flashcardSessions = { ...current.flashcardSessions };
        if (session) flashcardSessions[deckKey] = session;
        else delete flashcardSessions[deckKey];
        return { ...current, learnedPhrases: removeValues(current.learnedPhrases, ids), flashcardSessions };
      });
    },
    /** Removes all v2 learning state. Nothing outside the v2 database is touched. Every earlier Undo expires. */
    reset: () => {
      newGeneration();
      update(() => defaultState);
    }
  };
}

export const progress = createProgressStore();
