import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORE_NAMES } from '../storage/database';
import { contentBase, createContentFetch, manifest, realMaterials } from '../test/content';
import { readDatabase, resetDatabase } from '../test/database';
import { describeExperimental, describeStable, productBase, v1Url } from '../test/product';

/**
 * What differs between the products at the level of the whole application (ENG-V3-01):
 * addresses, the experimental Pronunciation screen and the separation of saved data.
 * Smoke tests in jsdom with synthetic data. They do not replace the browser checks.
 */
type RunningApp = { root: HTMLElement; flush: () => void; saved: () => Promise<void>; close: () => void };

// A backup file is handed to the browser as a download, which jsdom cannot do. The file is kept here instead.
const downloads: { name: string; text: string }[] = [];
vi.mock('../shared/download', () => ({
  downloadFile: (name: string, parts: BlobPart[]) => downloads.push({ name, text: String(parts[0]) })
}));

// Every test here mounts the whole application, and the first one also pays for compiling it
// (about 3 seconds). An explicit limit keeps these new tests away from the default of 5 seconds.
vi.setConfig({ testTimeout: 15_000 });

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
  await waitFor(() => root.querySelector('.app-shell') !== null, 'the app shell');
  app.flush();
  return app;
}

function navLink(app: RunningApp, page: string): HTMLAnchorElement | null {
  return app.root.querySelector<HTMLAnchorElement>(`.side-nav nav a[href="#${page}"]`);
}

function open(app: RunningApp, page: string): void {
  navLink(app, page)!.click();
  app.flush();
}

const heading = (app: RunningApp): string => text(app.root.querySelector('main h1')!);
/** The experimental-only screen, when it is shown. */
const placeholder = (app: RunningApp): HTMLElement | null => app.root.querySelector<HTMLElement>('[data-experimental-feature]');
/** The Backup screen of the experimental product (ENG-V3-R1A), when it is shown. */
const backupScreen = (app: RunningApp): HTMLElement | null => app.root.querySelector<HTMLElement>('[data-experimental-feature="backup-recovery"]');
/** The screen once it has read the state of its speech model. */
const settled = (app: RunningApp): boolean => {
  app.flush();
  const phase = placeholder(app)?.getAttribute('data-phase');
  return phase !== undefined && phase !== null && phase !== 'checking';
};

const V2_NAME = 'eng-trainer-v2';
const V1_STATE = ['englishAssessmentTrainer.svelteState.v1', '{"learnedPhrases":["phrase-001"],"hiddenPhrases":["phrase-002"]}'] as const;
const V1_THEME = ['englishAssessmentTrainer.theme.v1', 'dark'] as const;

async function snapshot(name: string): Promise<{ version: number; stores: Record<string, Record<string, unknown>> }> {
  const db = await openDB(name);
  const stores: Record<string, Record<string, unknown>> = {};
  for (const store of [...db.objectStoreNames].sort()) {
    const keys = await db.getAllKeys(store);
    const values = await db.getAll(store);
    stores[store] = Object.fromEntries(keys.map((key, index) => [String(key), values[index]]));
  }
  const result = { version: db.version, stores };
  db.close();
  return result;
}

beforeEach(() => {
  resetDatabase();
  window.localStorage.clear();
  window.location.hash = '';
  downloads.length = 0;
  vi.stubGlobal('fetch', vi.fn(createContentFetch()));
});

afterEach(async () => {
  // The lazily loaded screen may still be importing when a test ends. Let it finish inside
  // this test, before the next one resets the module registry.
  await vi.dynamicImportSettled();
  running.forEach((app) => app.close());
  running = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('addresses of a product', () => {
  it('takes brand, content and nothing else from its own base path, and v1 from the site base, in the shell and in Settings', async () => {
    const app = await startApp();

    expect(app.root.querySelector<HTMLAnchorElement>('.app-header a')!.getAttribute('href')).toBe(`${productBase}#index`);
    const requested = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(requested).toHaveLength(manifest.packs.length + 1);
    for (const url of requested) expect(url.startsWith(contentBase)).toBe(true);

    const shellLinks = [...app.root.querySelectorAll<HTMLAnchorElement>('a')].filter((link) => link.getAttribute('href')?.endsWith('v1/'));
    expect(shellLinks.length).toBeGreaterThan(0);
    for (const link of shellLinks) expect(link.getAttribute('href')).toBe(v1Url);

    open(app, 'settings');
    const settingsLink = app.root.querySelector<HTMLAnchorElement>('main .settings-page a[href$="v1/"]')!;
    expect(settingsLink.getAttribute('href')).toBe(v1Url);
    expect(text(settingsLink)).toContain('previous version (v1)');
    // A product published below the site base must not look for v1 below its own path.
    if (productBase !== __SITE_BASE__) expect(app.root.querySelector(`a[href="${productBase}v1/"]`)).toBeNull();
  });
});

describeStable('stable-v2 has no experimental screen', () => {
  it('offers no Pronunciation link and never renders or requests the experimental screen', async () => {
    const app = await startApp();
    expect(navLink(app, 'pronunciation')).toBeNull();
    expect(text(app.root)).not.toContain('Pronunciation');
    expect(placeholder(app)).toBeNull();
    expect(app.root.querySelector('a[href="#pronunciation"]')).toBeNull();
    // Backup and recovery (ENG-V3-R1A) are not part of the stable product either.
    expect(navLink(app, 'backup')).toBeNull();
    expect(app.root.querySelector('a[href="#backup"]')).toBeNull();
    expect(text(app.root)).not.toContain('Backup');
  });

  it('treats #backup like any unknown address, and never reads the first version\'s records', async () => {
    window.localStorage.setItem(...V1_STATE);
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    window.location.hash = 'backup';
    const app = await startApp();

    expect(heading(app)).toBe('Home');
    expect(placeholder(app)).toBeNull();
    await app.saved();
    expect((await readDatabase()).settings.activePage).toBeUndefined();
    expect(getItem).not.toHaveBeenCalled();
  });

  it('treats #pronunciation like any unknown address: Home is shown and nothing is saved for it', async () => {
    window.location.hash = 'pronunciation';
    const app = await startApp();

    expect(heading(app)).toBe('Home');
    expect(placeholder(app)).toBeNull();
    await app.saved();
    // Home is the default screen, so no "last page" is saved at all: the address left no trace.
    expect((await readDatabase()).settings.activePage).toBeUndefined();
  });
});

describeExperimental('experimental-v3: the Pronunciation screen', () => {
  it('lists Pronunciation last in Practice and loads the screen only when it is opened', async () => {
    const app = await startApp();
    const practice = [...app.root.querySelectorAll<HTMLAnchorElement>('.side-nav nav a')].map((link) => link.getAttribute('href'));
    expect(practice.slice(practice.indexOf('#flashcards'), practice.indexOf('#flashcards') + 4)).toEqual(['#flashcards', '#reverse', '#practice', '#pronunciation']);
    expect(placeholder(app)).toBeNull();

    open(app, 'pronunciation');
    await waitFor(() => settled(app), 'the Pronunciation screen');
    expect(heading(app)).toBe('Pronunciation');
    expect(placeholder(app)!.getAttribute('data-experimental-feature')).toBe('pronunciation-prototype');
    expect(text(placeholder(app)!)).toContain('Prototype: use a disposable browser profile');
    expect(text(placeholder(app)!)).toContain('It is not a score of your pronunciation.');
    expect(navLink(app, 'pronunciation')!.getAttribute('aria-current')).toBe('page');
    // The test environment has no microphone, no Worker and no Cache Storage. The screen says
    // so and offers nothing to download, load or record.
    expect(placeholder(app)!.getAttribute('data-phase')).toBe('unsupported');
    expect(text(placeholder(app)!)).toContain('Recording is not available here.');
    expect(placeholder(app)!.querySelectorAll('[data-action], audio, video')).toHaveLength(0);
  });

  it('names its product and database, and links to the other versions from the route list', async () => {
    window.location.hash = 'pronunciation';
    const app = await startApp();
    await waitFor(() => placeholder(app) !== null, 'the Pronunciation screen');
    app.flush();
    const screen = placeholder(app)!;

    expect(text(screen.querySelector('[data-build-fact="product"]')!)).toBe('experimental-v3');
    expect(text(screen.querySelector('[data-build-fact="database"]')!)).toBe('eng-trainer-v3');
    const links = [...screen.querySelectorAll<HTMLAnchorElement>('a[data-version-link]')];
    expect(links.map((link) => [link.dataset.versionLink, link.getAttribute('href'), text(link)])).toEqual([
      ['stable-v2', '/eng-trainer/', 'Open the stable version'],
      ['legacy-v1', '/eng-trainer/v1/', 'Open the previous version (v1)']
    ]);
  });

  it('keeps the screen as the saved last page, in its own database, and reopens it after a reload', async () => {
    const app = await startApp();
    open(app, 'pronunciation');
    await waitFor(() => placeholder(app) !== null, 'the Pronunciation screen');
    await app.saved();
    expect((await readDatabase()).settings.activePage).toBe('pronunciation');

    app.close();
    running = [];
    window.location.hash = '';
    const reloaded = await startApp();
    await waitFor(() => placeholder(reloaded) !== null, 'the Pronunciation screen after a reload');
    expect(heading(reloaded)).toBe('Pronunciation');
  });

  it('makes no request beyond the built-in content, and none at all when the screen opens', async () => {
    const app = await startApp();
    const before = vi.mocked(fetch).mock.calls.length;
    expect(before).toBe(manifest.packs.length + 1);

    open(app, 'pronunciation');
    await waitFor(() => settled(app), 'the Pronunciation screen');
    // Opening the screen downloads nothing: a model is fetched only after an explicit click.
    expect(vi.mocked(fetch).mock.calls.length).toBe(before);
  });
});

describeExperimental('experimental-v3: saved data stays apart from stable v2 and v1', () => {
  /** Synthetic stable progress: phrases other than the one the test learns in the experimental product. */
  const STABLE_LEARNED = [realMaterials.phrases[3].id, realMaterials.phrases[4].id];

  async function seedOtherVersions(): Promise<void> {
    const db = await openDB(V2_NAME, 2, {
      upgrade(database) {
        for (const name of STORE_NAMES) database.createObjectStore(name);
      }
    });
    await db.put('progress', STABLE_LEARNED, 'learnedPhrases');
    await db.put('progress', [realMaterials.phrases[5].id], 'favoritePhrases');
    await db.put('settings', 'dark', 'theme');
    await db.put('settings', 'phrases', 'activePage');
    db.close();
    window.localStorage.setItem(...V1_STATE);
    window.localStorage.setItem(...V1_THEME);
  }

  it('starts with an empty profile next to seeded v2 and v1 data, and ordinary use changes neither', async () => {
    await seedOtherVersions();
    const stableBefore = await snapshot(V2_NAME);
    const open2 = vi.spyOn(indexedDB, 'open');
    const readV1 = vi.spyOn(Storage.prototype, 'getItem');

    const app = await startApp();
    // The experimental profile is empty: nothing of the stable version is shown as learned.
    open(app, 'phrases');
    expect(app.root.querySelectorAll('.phrase-card.learned')).toHaveLength(0);
    expect(document.documentElement.dataset.themePreference).not.toBe('dark');

    // Ordinary use: learn a phrase, add one to Focus, change the theme, move between screens.
    app.root.querySelector<HTMLButtonElement>('.phrase-card button[aria-label="Mark as learned"]')!.click();
    app.flush();
    open(app, 'settings');
    const light = app.root.querySelector<HTMLInputElement>('input[name="theme"][value="light"]')!;
    light.checked = true;
    light.dispatchEvent(new Event('change', { bubbles: true }));
    app.flush();
    open(app, 'pronunciation');
    await waitFor(() => placeholder(app) !== null, 'the Pronunciation screen');
    // Opening the Backup screen is ordinary use too: nothing is read until a backup is asked for.
    open(app, 'backup');
    await waitFor(() => backupScreen(app) !== null, 'the Backup screen');
    open(app, 'index');
    await app.saved();

    expect(open2.mock.calls.map(([name]) => name)).toEqual(['eng-trainer-v3']);
    open2.mockRestore();
    expect(readV1).not.toHaveBeenCalled();
    readV1.mockRestore();
    // The experimental database holds exactly what was done here, and nothing of the stable one.
    const own = await readDatabase();
    expect(own.progress.learnedPhrases).toEqual([realMaterials.phrases[0].id]);
    expect(own.progress.favoritePhrases).toBeUndefined();
    expect(own.settings.theme).toBe('light');
    expect(stableBefore.stores.progress.learnedPhrases).toEqual(STABLE_LEARNED);

    expect(await snapshot(V2_NAME)).toEqual(stableBefore);
    expect(window.localStorage.length).toBe(2);
    expect(window.localStorage.getItem(V1_STATE[0])).toBe(V1_STATE[1]);
    expect(window.localStorage.getItem(V1_THEME[0])).toBe(V1_THEME[1]);
    expect((await indexedDB.databases()).map((db) => db.name).sort()).toEqual([V2_NAME, 'eng-trainer-v3']);
  });

  it('never creates the stable database on a fresh origin', async () => {
    const app = await startApp();
    open(app, 'phrases');
    app.root.querySelector<HTMLButtonElement>('.phrase-card button[aria-label="Mark as learned"]')!.click();
    app.flush();
    await app.saved();

    expect((await indexedDB.databases()).map((db) => db.name)).toEqual(['eng-trainer-v3']);
    expect(window.localStorage.length).toBe(0);
  });
});

describeExperimental('experimental-v3: the Backup screen (ENG-V3-R1A)', () => {
  /** Made-up data of the other two products, in the forms those products save. */
  async function seedOtherVersions(): Promise<void> {
    const db = await openDB(V2_NAME, 2, {
      upgrade(database) {
        for (const name of STORE_NAMES) database.createObjectStore(name);
      }
    });
    await db.put('progress', [realMaterials.phrases[3].id, realMaterials.phrases[4].id], 'learnedPhrases');
    await db.put('settings', 'dark', 'theme');
    db.close();
    window.localStorage.setItem(...V1_STATE);
    window.localStorage.setItem(...V1_THEME);
  }

  it('lists Backup last under More and loads the screen only when it is opened', async () => {
    const app = await startApp();
    const links = [...app.root.querySelectorAll<HTMLAnchorElement>('.side-nav nav a')].map((link) => link.getAttribute('href'));
    expect(links.slice(links.indexOf('#collections'))).toEqual(['#collections', '#settings', '#backup']);
    expect(backupScreen(app)).toBeNull();

    open(app, 'backup');
    await waitFor(() => backupScreen(app) !== null, 'the Backup screen');
    app.flush();
    expect(heading(app)).toBe('Backup');
    expect(navLink(app, 'backup')!.getAttribute('aria-current')).toBe('page');
    expect(text(backupScreen(app)!)).toContain('Make a backup file');
    expect(text(backupScreen(app)!)).toContain('Recover from a backup file');
  });

  it('is reachable by its address on a profile that holds nothing, and offers the recovery there', async () => {
    window.location.hash = 'backup';
    const app = await startApp();
    await waitFor(() => backupScreen(app) !== null, 'the Backup screen');
    app.flush();
    expect(heading(app)).toBe('Backup');
    expect(text(backupScreen(app)!)).toContain('This version holds no learning data in this browser.');
    expect(backupScreen(app)!.querySelector('#backup-file')).not.toBeNull();
  });

  it('reads the other versions only when a backup is asked for, and changes neither of them', async () => {
    await seedOtherVersions();
    const stableBefore = await snapshot(V2_NAME);
    const app = await startApp();
    open(app, 'phrases');
    app.root.querySelector<HTMLButtonElement>('.phrase-card button[aria-label="Mark as learned"]')!.click();
    app.flush();
    open(app, 'backup');
    await waitFor(() => backupScreen(app) !== null, 'the Backup screen');
    await app.saved();

    const opened = vi.spyOn(indexedDB, 'open');
    const modes = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    backupScreen(app)!.querySelector<HTMLButtonElement>('[data-backup-action="make"]')!.click();
    await waitFor(() => { app.flush(); return backupScreen(app)!.dataset.exportPhase === 'done'; }, 'the backup file');

    // The explicit request read this product's database and the stable one, each without a version and read-only.
    expect(opened.mock.calls).toEqual([['eng-trainer-v3'], [V2_NAME]]);
    expect(modes.mock.calls.map(([, mode]) => mode)).toEqual(['readonly', 'readonly']);
    expect(getItem.mock.calls.map(([key]) => key)).toEqual([V1_STATE[0], V1_THEME[0]]);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    vi.restoreAllMocks();

    expect(downloads).toHaveLength(1);
    const file = JSON.parse(downloads[0].text);
    expect(Object.keys(file.sections)).toEqual(['experimental-v3', 'stable-v2', 'legacy-v1']);
    expect(file.sections['experimental-v3'].stores.progress).toEqual([['learnedPhrases', [realMaterials.phrases[0].id]]]);
    expect(file.sections['stable-v2'].stores.progress).toEqual([['learnedPhrases', [realMaterials.phrases[3].id, realMaterials.phrases[4].id]]]);
    expect(file.sections['legacy-v1'].records).toEqual({ [V1_STATE[0]]: V1_STATE[1], [V1_THEME[0]]: V1_THEME[1] });

    expect(await snapshot(V2_NAME)).toEqual(stableBefore);
    expect(window.localStorage.length).toBe(2);
    expect(window.localStorage.getItem(V1_STATE[0])).toBe(V1_STATE[1]);
    expect((await indexedDB.databases()).map((db) => db.name).sort()).toEqual([V2_NAME, 'eng-trainer-v3']);
  });
});

describeExperimental('experimental-v3: the open screen stays while a recovery holds the changes (ENG-V3-R1A-RC3)', () => {
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

  it('puts the address back and keeps the Backup screen, whatever asks for another one, and navigates again after the hold', async () => {
    window.location.hash = 'backup';
    const app = await startApp();
    await waitFor(() => backupScreen(app) !== null, 'the Backup screen');
    await app.saved();
    const state = await import('../state');
    expect((await readDatabase()).settings.activePage).toBe('backup');
    const entries = window.history.length;

    // What a recovery does at the moment it starts to write.
    expect(state.holdState()).toBe('held');

    // The Back button, or an address typed by hand.
    window.location.hash = 'phrases';
    await waitFor(() => window.location.hash === '#backup', 'the address to be put back');
    app.flush();
    expect(backupScreen(app)).not.toBeNull();
    expect(heading(app)).toBe('Backup');

    // A link of the application itself.
    navLink(app, 'phrases')!.click();
    await settle();
    app.flush();
    expect(window.location.hash).toBe('#backup');
    expect(backupScreen(app)).not.toBeNull();
    expect(navLink(app, 'backup')!.getAttribute('aria-current')).toBe('page');

    // Nothing was accepted on the way: the saved last page is still this one.
    await app.saved();
    expect((await readDatabase()).settings.activePage).toBe('backup');
    expect(state.stateHeld()).toBe(true);
    // Putting the address back replaces an entry. It does not add one.
    expect(window.history.length).toBeLessThanOrEqual(entries + 2);

    state.releaseState();
    open(app, 'phrases');
    await app.saved();
    expect(heading(app)).toBe('Phrases');
    expect(backupScreen(app)).toBeNull();
    expect((await readDatabase()).settings.activePage).toBe('phrases');
  });
});

describeStable('stable-v2 has no hold on changes', () => {
  it('navigates and saves as always, also when the hold was asked for: no part of the application looks at it', async () => {
    const app = await startApp();
    const state = await import('../state');
    expect(state.holdState()).toBe('held');

    open(app, 'phrases');
    app.root.querySelector<HTMLButtonElement>('.phrase-card button[aria-label="Mark as learned"]')!.click();
    app.flush();
    await app.saved();

    expect(heading(app)).toBe('Phrases');
    const saved = await readDatabase();
    expect(saved.settings.activePage).toBe('phrases');
    expect(saved.progress.learnedPhrases).toEqual([realMaterials.phrases[0].id]);
    state.releaseState();
  });
});
