import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import realMaterials from '../../public/data/materials.json';
import { PAGE_LABELS } from './navigation';
import { readDatabase, resetDatabase, seedDatabase } from '../test/database';

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

function navButton(app: RunningApp, page: string): HTMLButtonElement {
  const match = [...app.root.querySelectorAll<HTMLButtonElement>('.desktop-nav button')].find((item) =>
    text(item).startsWith(PAGE_LABELS[page])
  );
  if (!match) throw new Error(`No navigation button for ${page}`);
  return match;
}

function open(app: RunningApp, page: string): void {
  navButton(app, page).click();
  app.flush();
}

function type(app: RunningApp, input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  app.flush();
}

beforeEach(() => {
  resetDatabase();
  window.localStorage.clear();
  window.location.hash = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(realMaterials), { status: 200 }))
  );
});

afterEach(() => {
  running.forEach((app) => app.close());
  running = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('application shell', () => {
  it('loads the built-in content from its own base path and shows the index', async () => {
    const app = await startApp();
    expect(text(app.root)).toContain('Loading training materials');

    await ready(app);

    expect(fetch).toHaveBeenCalledWith('/eng-trainer/data/materials.json', { cache: 'no-store' });
    expect(text(app.root.querySelector('.hero')!)).toContain(`${realMaterials.phrases.length} phrases`);
    expect(text(app.root)).toContain('Learning blocks');
    expect(app.root.querySelector('.storage-notice')).toBeNull();
  });

  it('links to the preserved v1 application', async () => {
    const app = await startApp();
    await ready(app);

    const link = app.root.querySelector<HTMLAnchorElement>('.app-footer a')!;
    expect(link.getAttribute('href')).toBe('/eng-trainer/v1/');
    expect(text(link)).toContain('v1');
  });

  it('renders every screen from the catalog', async () => {
    const app = await startApp();
    await ready(app);

    const expected: Record<string, string> = {
      phrases: 'Listen phrases',
      wordIndex: 'Word Index',
      flashcards: 'Tap to flip',
      reverse: 'Reverse Practice',
      irregularVerbs: 'Listen verbs',
      patterns: 'Answer Patterns',
      answers: 'Ready-Made Answers',
      practice: 'Practice Mode',
      favorites: 'Focus list is empty',
      index: 'Learning blocks'
    };

    for (const [page, marker] of Object.entries(expected)) {
      open(app, page);
      expect(window.location.hash).toBe(`#${page}`);
      expect(text(app.root.querySelector('.page-wrap')!), page).toContain(marker);
    }
  });

  it('searches the whole catalog, not only the items shown on the current page', async () => {
    const app = await startApp();
    await ready(app);
    open(app, 'phrases');

    // The last phrase of the dataset is far beyond the first page of five.
    const last = realMaterials.phrases[realMaterials.phrases.length - 1];
    expect(text(app.root.querySelector('.cards-list, .sectioned-list')!)).not.toContain(last.phrase);

    type(app, app.root.querySelector<HTMLInputElement>('.controls-filter-stack input')!, last.phrase);

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

    expect(text(reloaded.root.querySelector('.hero h1')!)).toBe('Phrases');
    expect(reloaded.root.querySelector('.phrase-card.learned')).not.toBeNull();
    expect(text(reloaded.root.querySelector('.hero__stats')!)).toContain('1 focus');
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

    expect(await readDatabase()).toEqual({ ...seeded, learnPasses: {}, flashcardSessions: {} });
  });
});

describe('loading and storage errors', () => {
  it('shows an error and a retry when the content cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('missing', { status: 404 }))
    );

    const app = await startApp();
    await waitFor(() => app.root.querySelector('.error-card') !== null, 'the content error');

    expect(text(app.root)).toContain('Unable to start the app');
    expect(text(app.root)).toContain('/eng-trainer/data/materials.json');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(realMaterials), { status: 200 }))
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
