import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATABASE_NAME, STATE_STORE_NAMES } from '../storage/database';
import { collection, native } from '../test/collections';
import { contentBase, createContentFetch, manifest, realMaterials } from '../test/content';
import { EXPERIMENTAL_MORE_PAGES, describeStableLineage, v1Url } from '../test/product';
import type { Materials } from '../content/types';
import { PAGE_LABELS } from './navigation';
import {
  abortReadTransactions,
  readDatabase,
  resetDatabase,
  seedDatabase,
  watchUnhandledRejections
} from '../test/database';

/**
 * Smoke tests of the application shell in jsdom: startup order, every screen
 * rendering from the catalog, and the visible storage states. They do not
 * replace testing in a real browser.
 */
type RunningApp = {
  root: HTMLElement;
  flush: () => void;
  saved: () => Promise<void>;
  close: () => void;
};

let running: RunningApp[] = [];
/** Undo functions for failures injected by a test. They always run after the test. */
let cleanups: (() => void)[] = [];

function text(root: ParentNode = document.body): string {
  return (root.textContent ?? '').replace(/\s+/g, ' ').trim();
}

async function waitFor(condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}. Page text: ${text().slice(0, 300)}`);
}

async function startApp(): Promise<RunningApp> {
  vi.resetModules();
  const svelte = await import('svelte');
  const { persistenceSettled } = await import('../state/persistence');
  const { default: App } = await import('./App.svelte');

  const root = document.createElement('div');
  document.body.appendChild(root);
  const component = svelte.mount(App, { target: root });

  const app: RunningApp = {
    root,
    flush: () => svelte.flushSync(),
    saved: persistenceSettled,
    close: () => {
      svelte.unmount(component);
      root.remove();
    }
  };
  running.push(app);
  return app;
}

async function ready(app: RunningApp): Promise<void> {
  await waitFor(() => app.root.querySelector('.app-shell') !== null, 'the app shell');
  app.flush();
}

/** The link to a screen in the main navigation (the side navigation on wide screens). */
function navLink(app: RunningApp, page: string): HTMLAnchorElement {
  const match = app.root.querySelector<HTMLAnchorElement>(`.side-nav nav a[href="#${page}"]`);
  if (!match) throw new Error(`No navigation link for ${page}`);
  expect(text(match)).toContain(PAGE_LABELS[page]);
  return match;
}

function open(app: RunningApp, page: string): void {
  navLink(app, page).click();
  app.flush();
}

/** The title of the open screen. */
function heading(app: RunningApp): string {
  return text(app.root.querySelector('main h1')!);
}

function searchField(app: RunningApp): HTMLInputElement {
  return app.root.querySelector<HTMLInputElement>('main input[type="search"]')!;
}

function type(app: RunningApp, input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  app.flush();
}

function phraseCard(app: RunningApp, heading: string): HTMLElement {
  const match = [...app.root.querySelectorAll<HTMLElement>('.phrase-card')].find((card) => text(card.querySelector('h3')!) === heading);
  if (!match) throw new Error(`No phrase card "${heading}". Cards: ${[...app.root.querySelectorAll('.phrase-card h3')].map((item) => text(item)).join(' | ')}`);
  return match;
}

function press(app: RunningApp, root: ParentNode, label: string): void {
  // A text button can end with an icon name, for example "I know it arrow_forward".
  const match = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.getAttribute('aria-label') === label || text(item) === label || text(item).startsWith(`${label} `)
  );
  if (!match) throw new Error(`No button "${label}"`);
  match.click();
  app.flush();
}

function hasButton(root: ParentNode, label: string): boolean {
  return root.querySelector(`button[aria-label="${label}"]`) !== null;
}

function choose(app: RunningApp, select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  app.flush();
}

/** Selects a flashcard deck: a topic name, or "all" for All Vocabulary. */
function openDeck(app: RunningApp, topic: string): void {
  if (topic === 'all') {
    press(app, app.root, 'All Vocabulary');
    return;
  }
  press(app, app.root, 'By Topic');
  choose(app, app.root.querySelector<HTMLSelectElement>('.flashcards-deck select')!, topic);
}

/** Learned and total card counts of the open deck, as its progress bar reports them. */
function deckCounts(app: RunningApp): { learned: number; total: number } {
  const bar = app.root.querySelector('[role="progressbar"]')!;
  return { learned: Number(bar.getAttribute('aria-valuenow')), total: Number(bar.getAttribute('aria-valuemax')) };
}

function reviewedTexts(app: RunningApp): string[] {
  return [...app.root.querySelectorAll('.flashcards-review__text strong')].map((item) => text(item));
}

function frontText(app: RunningApp): string {
  return text(app.root.querySelector('.flashcard__term') ?? document.createElement('span'));
}

async function reload(app: RunningApp): Promise<RunningApp> {
  await app.saved();
  app.close();
  running = running.filter((item) => item !== app);
  window.location.hash = '';

  const next = await startApp();
  await ready(next);
  return next;
}

beforeEach(() => {
  resetDatabase();
  window.localStorage.clear();
  window.location.hash = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(createContentFetch())
  );
});

afterEach(async () => {
  // A lazily loaded screen (experimental product) may still be importing when a test ends.
  // Let it finish inside this test, before the next one resets the module registry.
  await vi.dynamicImportSettled();
  cleanups.forEach((undo) => undo());
  cleanups = [];
  running.forEach((app) => app.close());
  running = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('application shell', () => {
  it('preserves existing IndexedDB records when a pack fails, then restores Focus and learning state on retry', async () => {
    const first = realMaterials.phrases[0];
    const last = realMaterials.phrases[realMaterials.phrases.length - 1];
    const word = realMaterials.wordIndex[realMaterials.wordIndex.length - 1];
    const verb = realMaterials.irregularVerbs[realMaterials.irregularVerbs.length - 1];
    const stored = {
      progress: {
        learnedPhrases: [first.id], favoritePhrases: [first.id, last.id],
        favoriteWords: [word.id], favoriteIrregular: [verb.id],
        hiddenPhrases: [realMaterials.phrases[1].id], hiddenWords: [word.id], hiddenIrregular: [verb.id],
        favoriteBlocks: ['ai-certification-vocabulary'], selectedLearnPassId: 'legacy-pass'
      },
      settings: { activePage: 'favorites', theme: 'dark' },
      learnPasses: {
        'legacy-pass': { id: 'legacy-pass', name: 'Saved pass', description: '', blockIds: ['start-answer', 'ai-certification-vocabulary'], createdAt: '2026-11-20', updatedAt: '2026-11-20' }
      },
      flashcardSessions: { all: { order: [last.id, first.id], index: 1 } }
    };
    await seedDatabase(stored);
    const fetchContent = createContentFetch();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith(manifest.packs[1].url)
        ? Promise.resolve(new Response('Pack unavailable', { status: 503 }))
        : fetchContent(input, init)
    ));
    const app = await startApp();
    await waitFor(() => app.root.querySelector('.error-card') !== null, 'the pack error');
    expect(app.root.querySelector('.app-shell')).toBeNull();
    expect(await readDatabase()).toEqual({ ...stored, userCollections: {}, userEntries: {} });
    vi.stubGlobal('fetch', vi.fn(createContentFetch()));
    press(app, app.root, 'Try again');
    await ready(app);
    expect(phraseCard(app, first.phrase).classList.contains('learned')).toBe(true);
    expect(phraseCard(app, last.phrase).classList.contains('learned')).toBe(false);
    await app.saved();
    expect(await readDatabase()).toEqual({ ...stored, userCollections: {}, userEntries: {} });
    const reloaded = await reload(app);
    expect(phraseCard(reloaded, first.phrase).classList.contains('learned')).toBe(true);
    expect(await readDatabase()).toEqual({ ...stored, userCollections: {}, userEntries: {} });
  });

  it('loads the built-in content from its own base path and shows the index', async () => {
    const app = await startApp();
    expect(text(app.root)).toContain('Loading training materials');

    await ready(app);

    expect(fetch).toHaveBeenCalledWith(`${contentBase}manifest.json`, { cache: 'no-store' });
    expect(fetch).toHaveBeenCalledTimes(manifest.packs.length + 1);
    for (const pack of manifest.packs) {
      expect(fetch).toHaveBeenCalledWith(`${contentBase}${pack.url}`, { cache: 'no-store' });
    }
    expect(text(app.root)).toContain('Learning blocks');
    expect(app.root.querySelector('.storage-notice')).toBeNull();
    open(app, 'phrases');
    expect(text(app.root.querySelector('.list-header__count')!)).toBe(`${realMaterials.phrases.length} phrases`);
  });

  it('links to the preserved v1 application', async () => {
    const app = await startApp();
    await ready(app);

    // v1 lives at the base path of the site, not below this product's own path.
    const link = app.root.querySelector<HTMLAnchorElement>(`a[href="${v1Url}"]`)!;
    expect(link.getAttribute('href')).toBe(v1Url);
    expect(text(link)).toContain('v1');
  });

  it('renders every screen from the catalog', async () => {
    const app = await startApp();
    await ready(app);

    const expected: Record<string, string> = {
      phrases: realMaterials.phrases[0].phrase,
      wordIndex: 'Search words',
      flashcards: 'Say it aloud, then tap to see the meaning',
      reverse: 'Your answer in English',
      irregularVerbs: 'Search verbs',
      patterns: 'Structured frameworks',
      answers: 'Assessment-style answers',
      practice: 'Random prompt',
      favorites: 'Focus list is empty',
      collections: 'How to prepare your file',
      settings: 'Reset learning progress',
      index: 'Learning blocks'
    };

    for (const [page, marker] of Object.entries(expected)) {
      open(app, page);
      expect(window.location.hash).toBe(`#${page}`);
      expect(heading(app), page).toBe(PAGE_LABELS[page]);
      expect(text(app.root.querySelector('main')!), page).toContain(marker);
    }
  });

  it('searches the whole catalog, not only the items shown on the current page', async () => {
    const app = await startApp();
    await ready(app);
    open(app, 'phrases');

    // The last phrase of the dataset is far beyond the first page of five.
    const last = realMaterials.phrases[realMaterials.phrases.length - 1];
    expect(text(app.root.querySelector('.entry-list')!)).not.toContain(last.phrase);

    type(app, searchField(app), last.phrase);

    expect([...app.root.querySelectorAll('.phrase-card h3')].map((item) => text(item))).toContain(last.phrase);
  });

  it('opens the saved screen and keeps progress and preferences after a reload', async () => {
    const first = await startApp();
    await ready(first);
    open(first, 'phrases');
    first.root.querySelector<HTMLButtonElement>('.phrase-card button[aria-label="Mark as learned"]')!.click();
    first.root.querySelector<HTMLButtonElement>('.phrase-card button[aria-label="Add to Focus List"]')!.click();
    first.root.querySelector<HTMLButtonElement>('.theme-toggle')!.click();
    first.flush();
    await first.saved();
    first.close();
    running = [];
    window.location.hash = '';

    const reloaded = await startApp();
    await ready(reloaded);

    expect(heading(reloaded)).toBe('Phrases');
    expect(reloaded.root.querySelector('.phrase-card.learned')).not.toBeNull();
    expect(text(reloaded.root.querySelector('.side-nav .nav-count')!)).toBe('1 item');
    expect(reloaded.root.querySelector('.theme-toggle')!.getAttribute('aria-label')).toContain('Theme: Light');

    const saved = await readDatabase();
    expect(saved.progress.learnedPhrases).toEqual([realMaterials.phrases[0].id]);
    expect(saved.settings).toMatchObject({ theme: 'light', activePage: 'phrases' });
  });

  it('does not write anything while starting with existing saved state', async () => {
    const seeded = {
      progress: { learnedPhrases: ['phrase-001'], hiddenWords: ['word-phrase-002'] },
      settings: { theme: 'dark', activePage: 'index', phrasePageSize: 20 }
    };
    await seedDatabase(seeded);

    const app = await startApp();
    await ready(app);
    await app.saved();

    expect(await readDatabase()).toEqual({ ...seeded, learnPasses: {}, flashcardSessions: {}, userCollections: {}, userEntries: {} });
  });
});

describe('learning identity across Phrases, Focus and Flashcards', () => {
  it('keeps "consequently" and "Consequently, …" apart in every view, also after a reload', async () => {
    let app = await startApp();
    await ready(app);
    open(app, 'phrases');
    type(app, searchField(app), 'consequently');

    // phrase-084 is learned. advanced-linking-004-consequently goes to the Focus List.
    press(app, phraseCard(app, 'consequently'), 'Mark as learned');
    press(app, phraseCard(app, 'Consequently, …'), 'Add to Focus List');

    app = await reload(app);

    open(app, 'favorites');
    const focused = phraseCard(app, 'Consequently, …');
    expect(focused.classList.contains('learned')).toBe(false);
    expect(hasButton(focused, 'Mark as learned')).toBe(true);
    expect(hasButton(focused, 'Mark as not learned')).toBe(false);

    open(app, 'phrases');
    type(app, searchField(app), 'consequently');
    expect(phraseCard(app, 'consequently').classList.contains('learned')).toBe(true);
    expect(phraseCard(app, 'Consequently, …').classList.contains('learned')).toBe(false);

    open(app, 'flashcards');
    openDeck(app, 'Advanced Linking Words');
    expect(deckCounts(app).learned).toBe(0);
    press(app, app.root, 'Review learned vocabulary');
    expect(reviewedTexts(app)).toEqual([]);

    openDeck(app, 'Conjunctions');
    expect(deckCounts(app).learned).toBe(1);
    expect(reviewedTexts(app)).toEqual(['consequently']);

    openDeck(app, 'all');
    expect(deckCounts(app)).toEqual({ learned: 1, total: realMaterials.phrases.length });
    expect(reviewedTexts(app)).toEqual(['consequently']);

    await app.saved();
    const saved = await readDatabase();
    expect(saved.progress.learnedPhrases).toEqual(['phrase-084']);
    expect(saved.progress.favoritePhrases).toEqual(['advanced-linking-004-consequently']);
  });

  it('keeps distinct entries with similar-looking text independent: C++ and C#', async () => {
    const fixture = {
      ...realMaterials,
      phrases: [
        { id: 'review-cpp', category: 'Languages', phrase: 'C++', translation: 'Language C++', example: 'C++ templates' },
        { id: 'review-csharp', category: 'Languages', phrase: 'C#', translation: 'Language C#', example: 'C# records' }
      ],
      wordIndex: [],
      topics: [],
      blocks: [{ id: 'review-languages', title: 'Languages', type: 'phraseCategory', category: 'Languages', description: '' }]
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(createContentFetch(fixture as Materials))
    );

    let app = await startApp();
    await ready(app);
    open(app, 'phrases');
    expect([...app.root.querySelectorAll('.phrase-card h3')].map((item) => text(item))).toEqual(['C++', 'C#']);

    open(app, 'flashcards');
    expect(deckCounts(app)).toEqual({ learned: 0, total: 2 });
    expect(frontText(app)).toBe('C++');

    press(app, app.root, 'I know it');
    await waitFor(() => frontText(app) === 'C#', 'the next card');
    expect(deckCounts(app)).toEqual({ learned: 1, total: 2 });
    await app.saved();
    expect((await readDatabase()).progress.learnedPhrases).toEqual(['review-cpp']);

    app = await reload(app);

    open(app, 'phrases');
    expect(phraseCard(app, 'C++').classList.contains('learned')).toBe(true);
    expect(phraseCard(app, 'C#').classList.contains('learned')).toBe(false);
    expect(hasButton(phraseCard(app, 'C#'), 'Mark as learned')).toBe(true);

    open(app, 'flashcards');
    expect(deckCounts(app)).toEqual({ learned: 1, total: 2 });
    expect(frontText(app)).toBe('C#');

    // The other entry can be learned on its own.
    press(app, app.root, 'I know it');
    await waitFor(() => text(app.root).includes('Deck complete'), 'the completed deck');
    await app.saved();
    expect((await readDatabase()).progress.learnedPhrases).toEqual(['review-cpp', 'review-csharp']);
  });

  it('treats a phrase and its linked word-index entry as one learning identity: the phrase id', async () => {
    const phrase = realMaterials.phrases[0];
    const linkedWord = realMaterials.wordIndex.find((item) => item.sourcePhraseId === phrase.id)!;
    expect(linkedWord).toBeDefined();

    let app = await startApp();
    await ready(app);
    open(app, 'flashcards');
    expect(deckCounts(app)).toEqual({ learned: 0, total: realMaterials.phrases.length });
    expect(frontText(app)).toBe(phrase.phrase);

    press(app, app.root, 'I know it');
    await waitFor(() => frontText(app) === realMaterials.phrases[1].phrase, 'the next card');
    await app.saved();

    // One id is saved: the phrase id. The word-index id is not a second record of the same progress.
    const saved = await readDatabase();
    expect(saved.progress.learnedPhrases).toEqual([phrase.id]);
    expect(JSON.stringify(saved)).not.toContain(linkedWord.id);

    app = await reload(app);

    // Learned on Flashcards means learned on Phrases.
    open(app, 'phrases');
    expect(phraseCard(app, phrase.phrase).classList.contains('learned')).toBe(true);

    // Unlearned on Phrases means back in the flashcard deck.
    press(app, phraseCard(app, phrase.phrase), 'Mark as not learned');
    open(app, 'flashcards');
    expect(deckCounts(app)).toEqual({ learned: 0, total: realMaterials.phrases.length });
    await app.saved();
    expect((await readDatabase()).progress.learnedPhrases).toEqual([]);

    // Hiding the linked word-index entry takes exactly this one card out of the deck.
    open(app, 'wordIndex');
    type(app, searchField(app), linkedWord.term);
    const wordCard = [...app.root.querySelectorAll<HTMLElement>('.word-card')].find((card) => text(card.querySelector('h3')!) === linkedWord.term)!;
    press(app, wordCard, 'Hide item');
    open(app, 'flashcards');
    expect(deckCounts(app)).toEqual({ learned: 0, total: realMaterials.phrases.length - 1 });
  });
});

describe('loading and storage errors', () => {
  it('handles a read transaction that aborts by itself: error screen, no unhandled rejection, and retry restores the saved state', async () => {
    const seeded = {
      progress: { learnedPhrases: [realMaterials.phrases[0].id] },
      settings: { theme: 'dark', activePage: 'phrases' }
    };
    await seedDatabase(seeded);
    const rejections = watchUnhandledRejections();
    const removeFailure = abortReadTransactions();
    cleanups.push(removeFailure);

    const app = await startApp();
    await waitFor(() => app.root.querySelector('.error-card') !== null, 'the storage error');
    removeFailure();

    expect(app.root.querySelector('.app-shell')).toBeNull();
    expect(text(app.root)).toContain('Unable to open your saved progress');
    expect(text(app.root)).toMatch(/IndexedDB read failed/);
    expect(await rejections.stop()).toEqual([]);
    expect(await readDatabase()).toEqual({ ...seeded, learnPasses: {}, flashcardSessions: {}, userCollections: {}, userEntries: {} });

    [...app.root.querySelectorAll('button')].find((item) => text(item) === 'Try again')!.click();
    await ready(app);

    expect(heading(app)).toBe('Phrases');
    expect(phraseCard(app, realMaterials.phrases[0].phrase).classList.contains('learned')).toBe(true);
    expect(app.root.querySelector('.theme-toggle')!.getAttribute('aria-label')).toContain('Theme: Dark');
    expect(app.root.querySelector('.storage-notice')).toBeNull();

    await app.saved();
    expect(await readDatabase()).toEqual({ ...seeded, learnPasses: {}, flashcardSessions: {}, userCollections: {}, userEntries: {} });
  });

  it('shows an error and a retry when the content cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('missing', { status: 404 }))
    );

    const app = await startApp();
    await waitFor(() => app.root.querySelector('.error-card') !== null, 'the content error');

    expect(text(app.root)).toContain('The study material could not be loaded');
    expect(text(app.root)).not.toContain('npm run');
    expect(text(app.root)).toContain(`${contentBase}manifest.json`);

    vi.stubGlobal(
      'fetch',
      vi.fn(createContentFetch())
    );
    [...app.root.querySelectorAll('button')].find((item) => text(item) === 'Try again')!.click();
    await ready(app);
    expect(text(app.root)).toContain('Learning blocks');
  });

  it('stops with a visible error when the saved state cannot be opened, and can continue without saving', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['phrase-001'] } });
    vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(() => {
      throw new DOMException('Simulated read failure', 'UnknownError');
    });

    const app = await startApp();
    await waitFor(() => app.root.querySelector('.error-card') !== null, 'the storage error');

    expect(app.root.querySelector('.app-shell')).toBeNull();
    expect(text(app.root)).toContain('Unable to open your saved progress');
    expect(text(app.root)).toContain('Simulated read failure');

    [...app.root.querySelectorAll('button')].find((item) => text(item) === 'Continue without saving')!.click();
    await ready(app);

    expect(text(app.root.querySelector('.storage-notice')!)).toContain('Saving is off');

    open(app, 'phrases');
    app.root.querySelector<HTMLButtonElement>('.phrase-card button[aria-label="Mark as learned"]')!.click();
    app.flush();
    await app.saved();

    vi.restoreAllMocks();
    expect((await readDatabase()).progress).toEqual({ learnedPhrases: ['phrase-001'] });
  });

  it('shows a notice when a change cannot be saved, until saving succeeds', async () => {
    const app = await startApp();
    await ready(app);
    open(app, 'phrases');
    await app.saved();

    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Simulated write failure', 'QuotaExceededError');
    });
    app.root.querySelector<HTMLButtonElement>('.phrase-card button[aria-label="Mark as learned"]')!.click();
    app.flush();
    await app.saved();
    app.flush();

    expect(text(app.root.querySelector('.storage-notice')!)).toContain('Your latest changes are not saved');
    expect(text(app.root.querySelector('.storage-notice')!)).toContain('Simulated write failure');

    put.mockRestore();
    [...app.root.querySelectorAll('button')].find((item) => text(item) === 'Try saving again')!.click();
    await app.saved();
    app.flush();

    expect(app.root.querySelector('.storage-notice')).toBeNull();
    expect((await readDatabase()).progress.learnedPhrases).toEqual([realMaterials.phrases[0].id]);
  });
});

/** Another tab that still runs a build with database version 1 and does not close for upgrades. */
function holdLegacyConnection() {
  return openDB(DATABASE_NAME, 1, { upgrade(db) { STATE_STORE_NAMES.forEach((name) => db.createObjectStore(name)); } });
}

describeStableLineage('blocked database upgrade at start-up (F4)', () => {
  it('keeps the waiting guidance on "Check again" and continues by itself when the other tab closes', async () => {
    const legacy = await holdLegacyConnection();
    const app = await startApp();
    await waitFor(() => text(app.root).includes('Close other eng-trainer tabs'), 'the waiting screen');
    expect(text(app.root)).toContain('Waiting for the other tabs to close');

    press(app, app.root, 'Check again');
    press(app, app.root, 'Check again');
    await waitFor(() => text(app.root).includes('Still waiting for the other tabs to close.'), 'the repeated check');
    expect(app.root.querySelector('.app-shell')).toBeNull();

    legacy.close();
    await ready(app);
    expect(app.root.querySelector('.storage-notice')).toBeNull();
  });

  it('keeps "Continue without saving" in charge when the database opens later', async () => {
    const legacy = await holdLegacyConnection();
    const app = await startApp();
    await waitFor(() => text(app.root).includes('Close other eng-trainer tabs'), 'the waiting screen');
    press(app, app.root, 'Continue without saving');
    await ready(app);
    expect(text(app.root.querySelector('.storage-notice')!)).toContain('Saving is off');

    legacy.close();
    await new Promise((resolve) => setTimeout(resolve, 60));
    app.flush();
    expect(text(app.root.querySelector('.storage-notice')!)).toContain('Saving is off');

    open(app, 'phrases');
    app.root.querySelector<HTMLButtonElement>('.phrase-card button[aria-label="Mark as learned"]')!.click();
    app.flush();
    await app.saved();
    expect((await readDatabase()).progress).toEqual({});
  });
});

describe('Settings and Reset progress', () => {
  it('asks before resetting; Cancel changes nothing; the theme and imported collections stay', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['phrase-001'], favoritePhrases: ['phrase-002'] }, settings: { theme: 'dark', speechRepeatCount: 20 } });
    const app = await startApp();
    await ready(app);
    // Home no longer offers a one-tap reset.
    expect([...app.root.querySelectorAll('button')].some((item) => /reset/i.test(text(item)) || /reset/i.test(item.getAttribute('aria-label') ?? ''))).toBe(false);

    open(app, 'settings');
    await app.saved();
    const before = await readDatabase();
    press(app, app.root, 'Reset learning progress…');
    const dialog = app.root.querySelector<HTMLDialogElement>('dialog.dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(text(dialog)).toContain('Phrases you marked as learned');
    expect(text(dialog)).toContain('your imported vocabulary collections, your theme');
    // Focus moves to Cancel once the dialog has opened.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement?.textContent).toBe('Cancel');

    press(app, dialog, 'Cancel');
    await app.saved();
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(await readDatabase()).toEqual(before);

    press(app, app.root, 'Reset learning progress…');
    press(app, dialog, 'Reset progress');
    await app.saved();
    const saved = await readDatabase();
    expect(saved.progress).toMatchObject({ learnedPhrases: [], favoritePhrases: [] });
    expect(saved.settings).toMatchObject({ theme: 'dark', speechRepeatCount: 10 });
  });
});

describe('language of study text and translations', () => {
  it('marks built-in Ukrainian as uk, leaves imported translations unmarked, and protects English study text from translation', async () => {
    const imported = native();
    await seedDatabase({
      userCollections: {
        [collection.id]: {
          ...collection, version: 1, createdAt: '2026-11-21T00:00:00.000Z', updatedAt: '2026-11-21T00:00:00.000Z', revision: 1,
          lastImport: { fileName: 'synthetic.json', format: 'json', importedAt: '2026-11-21T00:00:00.000Z', added: 2, skipped: 0 }
        }
      },
      userEntries: Object.fromEntries(imported.entries.map((item, position) => [item.id, { ...item, collectionId: collection.id, position }]))
    });
    const app = await startApp();
    await ready(app);
    open(app, 'phrases');

    const builtIn = phraseCard(app, realMaterials.phrases[0].phrase);
    expect(builtIn.querySelector('.entry__translation')!.getAttribute('lang')).toBe('uk');
    expect(builtIn.querySelector('h3')!.getAttribute('lang')).toBe('en');
    expect(builtIn.querySelector('h3')!.getAttribute('translate')).toBe('no');

    type(app, searchField(app), imported.entries[1].english);
    const user = phraseCard(app, imported.entries[1].english);
    expect(user.querySelector('.entry__translation')!.getAttribute('lang')).toBe('');
    expect(user.querySelector('h3')!.getAttribute('translate')).toBe('no');
  });
});

describe('language of learning block descriptions (RC1, F5)', () => {
  /** The effective language of an element: its nearest lang attribute. */
  const langOf = (element: Element) => element.closest('[lang]')?.getAttribute('lang') ?? null;
  const blockIdByTitle = new Map(realMaterials.blocks.map((block) => [block.title, block.id]));
  // Test oracle only: in the built-in material, exactly the Ukrainian descriptions contain Cyrillic
  // (descriptionLanguage.test.ts checks this against the hand-made table the app uses).
  const descriptionById = new Map(realMaterials.blocks.map((block) => [block.id, block.description]));
  const blockDescriptionLang = (id: string) => (/[Ѐ-ӿ]/.test(descriptionById.get(id) ?? '') ? 'uk' : 'en');

  it('marks English and Ukrainian descriptions by their actual language in Focus, Home and the Verbs set note', async () => {
    await seedDatabase({ progress: { favoriteBlocks: ['irregular-verbs-100', 'start-answer', 'ready-answers', 'topic-hobbies'] } });
    const app = await startApp();
    await ready(app);

    open(app, 'favorites');
    const focusRows = [...app.root.querySelectorAll('main .block-row')];
    expect(focusRows).toHaveLength(4);
    const byTitle = (rows: Element[]) =>
      Object.fromEntries(rows.map((row) => [text(row.querySelector('.block-row__title')!), langOf(row.querySelectorAll('.block-row__meta')[row.querySelectorAll('.block-row__meta').length - 1])]));
    expect(byTitle(focusRows)).toEqual({ '100 Irregular Verbs': 'en', 'Start Answer Phrases': 'uk', 'Ready-Made Answers': 'uk', Hobbies: 'en' });

    open(app, 'index');
    const homeRows = [...app.root.querySelectorAll('main .block-row')];
    expect(homeRows.length).toBeGreaterThan(0);
    for (const row of homeRows) {
      const id = blockIdByTitle.get(text(row.querySelector('.block-row__title')!))!;
      const metas = row.querySelectorAll('.block-row__meta');
      expect(langOf(metas[metas.length - 1]), id).toBe(blockDescriptionLang(id));
    }

    open(app, 'irregularVerbs');
    const note = [...app.root.querySelectorAll('main .list-note')].find((item) => text(item).startsWith('About this set:'))!;
    expect(langOf(note.querySelector('span')!)).toBe('en');
  });
});

describe('hiding an entry from a list', () => {
  it('keeps keyboard users in place: focus moves to the entry that took its place, and Undo returns it to the restored entry', async () => {
    const app = await startApp();
    await ready(app);
    open(app, 'phrases');
    // Opening a screen moves focus to its heading once it has rendered; let that settle first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    app.flush();
    const cards = () => [...app.root.querySelectorAll<HTMLElement>('.phrase-card')];
    const title = (card: Element | null | undefined) => (card ? text(card.querySelector('h3')!) : '');
    const [first, second] = cards();
    const firstTitle = title(first);
    const secondTitle = title(second);

    const hide = first.querySelector<HTMLButtonElement>('button[aria-label="Hide item"]')!;
    hide.focus();
    hide.click();
    app.flush();
    await waitFor(() => title(document.activeElement?.closest('.phrase-card')) === secondTitle, 'focus on the next entry');
    expect(document.activeElement!.getAttribute('aria-label')).toBe('Hide item');
    expect(title(cards()[0])).toBe(secondTitle);

    const undo = app.root.querySelector<HTMLButtonElement>('.toast__action')!;
    expect(undo.textContent).toBe('Undo');
    undo.focus();
    undo.click();
    app.flush();
    await waitFor(() => title(cards()[0]) === firstTitle && document.activeElement?.closest('.phrase-card') === cards()[0], 'focus on the restored entry');
    expect(document.activeElement!.getAttribute('aria-label')).toBe('Hide item');
  });
});

describe('navigation', () => {
  it('opens More as a sheet from a button, with links to Collections, Settings and the previous version', async () => {
    const app = await startApp();
    await ready(app);
    const more = app.root.querySelector<HTMLButtonElement>('.tab-bar button')!;
    expect(more.getAttribute('aria-haspopup')).toBe('dialog');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    more.click();
    app.flush();
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const sheet = app.root.querySelector('#more-sheet')!;
    // The experimental product has one more screen here, Backup (ENG-V3-R1A). The list is empty for the stable product.
    expect([...sheet.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(['#collections', '#settings', ...EXPERIMENTAL_MORE_PAGES.map((page) => `#${page}`), v1Url]);

    sheet.querySelector<HTMLAnchorElement>('a[href="#settings"]')!.click();
    app.flush();
    expect(heading(app)).toBe('Settings');
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });

  it('marks the current screen in every navigation and moves focus to the new heading', async () => {
    const app = await startApp();
    await ready(app);
    open(app, 'wordIndex');
    await new Promise((resolve) => setTimeout(resolve, 0));
    app.flush();
    expect(app.root.querySelector('.side-nav [aria-current="page"]')!.getAttribute('href')).toBe('#wordIndex');
    expect(app.root.querySelector('.section-nav [aria-current="page"]')!.getAttribute('href')).toBe('#wordIndex');
    expect(app.root.querySelector('.tab-bar [aria-current="page"]')!.textContent).toContain('Library');
    expect(document.activeElement).toBe(app.root.querySelector('main h1'));
    expect(app.root.querySelector('.section-nav a[href="#collections"]')!.textContent).toContain('Import words');
  });
});
