import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collection, native } from '../test/collections';
import { createContentFetch, realMaterials } from '../test/content';
import { readDatabase, resetDatabase, seedDatabase } from '../test/database';
import { productBase } from '../test/product';
import { PAGE_LABELS } from './navigation';

/**
 * ENG-V2-03 in the application shell (jsdom): the shared header, Home statistics and the
 * learning topic screens. Real-browser checks are in docs/evidence/eng-v2-03.
 */
type RunningApp = { root: HTMLElement; flush: () => void; saved: () => Promise<void>; close: () => void };
let running: RunningApp[] = [];
const TOPIC_PAGES = ['topic/conditionals', 'topic/small-talk', 'topic/interview-english'];
const CYRILLIC = /[Ѐ-ӿ]/;

function text(root: ParentNode | null | undefined): string {
  return (root?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

async function waitFor(condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}. Page text: ${text(document.body).slice(0, 300)}`);
}

async function startApp(): Promise<RunningApp> {
  vi.resetModules();
  const svelte = await import('svelte');
  const { persistenceSettled } = await import('../state/persistence');
  const { default: App } = await import('./App.svelte');
  const root = document.createElement('div');
  document.body.appendChild(root);
  const component = svelte.mount(App, { target: root });
  const app = { root, flush: () => svelte.flushSync(), saved: persistenceSettled, close: () => { svelte.unmount(component); root.remove(); } };
  running.push(app);
  return app;
}

async function ready(app: RunningApp): Promise<void> {
  await waitFor(() => app.root.querySelector('.app-shell') !== null, 'the app shell');
  app.flush();
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

/** Opens a screen by its address, as a link, bookmark or Back would. */
function goTo(app: RunningApp, page: string): void {
  window.location.hash = page;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  app.flush();
}

function heading(app: RunningApp): string {
  return text(app.root.querySelector('main h1'));
}

function press(app: RunningApp, root: ParentNode, label: string): void {
  const match = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.getAttribute('aria-label') === label || text(item) === label || text(item).startsWith(`${label} `)
  );
  if (!match) throw new Error(`No button "${label}"`);
  match.click();
  app.flush();
}

function type(app: RunningApp, input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  app.flush();
}

function choose(app: RunningApp, select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  app.flush();
}

/** The value shown for a statistic label on Home. */
function stat(app: RunningApp, label: string): string {
  const term = [...app.root.querySelectorAll('.home-stat dt')].find((item) => text(item) === label);
  if (!term) throw new Error(`No statistic "${label}"`);
  return text(term.nextElementSibling);
}

function vocabulary(app: RunningApp): string {
  return text(app.root.querySelector('.home-meter__value'));
}

function homeTotals(app: RunningApp): Record<string, string> {
  return Object.fromEntries([
    ['Vocabulary learned', vocabulary(app)],
    ...['Topics completed', 'In Focus', 'Words learned', 'Phrases learned', 'Remaining vocabulary', 'Words', 'Phrases', 'Verbs', 'Topics', 'Your collections'].map((label) => [label, stat(app, label)])
  ]);
}

function rowTexts(app: RunningApp): string[] {
  return [...app.root.querySelectorAll('.topic-section .entry__term')].map((item) => text(item));
}

/** Cyrillic text that is not inside an element marked as Ukrainian. */
function unmarkedCyrillic(root: ParentNode): string[] {
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  const found: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!CYRILLIC.test(node.textContent ?? '')) continue;
    if (node.parentElement?.closest('[lang]')?.getAttribute('lang') !== 'uk') found.push(text(node.parentElement).slice(0, 60));
  }
  return found;
}

beforeEach(() => {
  resetDatabase();
  window.localStorage.clear();
  window.location.hash = '';
  vi.stubGlobal('fetch', vi.fn(createContentFetch()));
});

afterEach(async () => {
  // A lazily loaded screen (experimental product) may still be importing when a test ends.
  // Let it finish inside this test, before the next one resets the module registry.
  await vi.dynamicImportSettled();
  running.forEach((app) => app.close());
  running = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('shared header (ENG-V2-03)', () => {
  it('appears once on every screen, links Eng Trainer to Home and carries no counts; each page keeps its own h1 in main', async () => {
    const app = await startApp();
    await ready(app);
    for (const page of [...Object.keys(PAGE_LABELS), ...TOPIC_PAGES]) {
      goTo(app, page);
      const headers = app.root.querySelectorAll('.app-header');
      expect(headers, page).toHaveLength(1);
      expect(text(headers[0]), page).toBe('Eng Trainer, Home Practice English at your pace');
      expect(text(headers[0])).not.toMatch(/\d/);
      expect(headers[0].closest('main'), page).toBeNull();
      expect(app.root.querySelectorAll('h1'), page).toHaveLength(1);
      expect(app.root.querySelector('main h1'), page).not.toBeNull();
    }
    const brand = app.root.querySelector<HTMLAnchorElement>('.app-header a')!;
    expect(brand.getAttribute('href')).toBe(`${productBase}#index`);
    // The skip link still comes first, before the header.
    expect(app.root.querySelector('.app-shell')!.firstElementChild!.classList.contains('skip-link')).toBe(true);
    brand.click();
    app.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(heading(app)).toBe('Home');
    expect(window.location.hash).toBe('#index');
    expect(document.activeElement).toBe(app.root.querySelector('main h1'));
  }, 20_000); // Renders all fifteen screens; can share a CI worker with other suites.

  it('keeps the brand, without a link, on start-up and error screens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unavailable', { status: 503 })));
    const app = await startApp();
    expect(text(app.root.querySelector('.app-header'))).toBe('Eng Trainer Practice English at your pace');
    await waitFor(() => app.root.querySelector('.error-card') !== null, 'the content error');
    expect(text(app.root.querySelector('.app-header'))).toBe('Eng Trainer Practice English at your pace');
    expect(app.root.querySelector('.app-header a')).toBeNull();
    expect(app.root.querySelector('.home-overview')).toBeNull();
  });

  it('shows statistics on Home only', async () => {
    const app = await startApp();
    await ready(app);
    expect(app.root.querySelector('.home-overview')).not.toBeNull();
    for (const page of [...Object.keys(PAGE_LABELS).filter((item) => item !== 'index'), ...TOPIC_PAGES]) {
      goTo(app, page);
      expect(app.root.querySelector('.home-overview, .home-meter'), page).toBeNull();
      expect(text(app.root), page).not.toContain('Vocabulary learned');
    }
  });
});

describe('Home statistics (ENG-V2-03)', () => {
  it('shows Your progress, then Library overview, then the learning topics and the existing practice access', async () => {
    const app = await startApp();
    await ready(app);
    // Expansion panel headings also contain their one-line description.
    const titles = [...app.root.querySelectorAll('main h1, main h2')].filter((item) => !item.closest('dialog:not([open])')).map((item) => text(item.querySelector('strong') ?? item));
    expect(titles).toEqual(['Home', 'Your progress', 'Library overview', 'Learning topics', 'Learn Pass', 'Tags', 'Learning blocks', 'Phrase or word of the day']);

    const total = realMaterials.phrases.length;
    expect(vocabulary(app)).toBe(`0 / ${total} 0%`);
    const bar = app.root.querySelector('.home-meter__bar')!;
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(text(document.getElementById(bar.getAttribute('aria-labelledby')!))).toBe('Vocabulary learned');
    expect([bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax')]).toEqual(['0', String(total)]);
    expect(stat(app, 'Topics completed')).toBe('0 / 34');
    expect(stat(app, 'In Focus')).toBe('0');
    expect(stat(app, 'Words learned')).toBe('0 / 566');
    expect(stat(app, 'Phrases learned')).toBe(`0 / ${total}`);
    expect(stat(app, 'Remaining vocabulary')).toBe(String(total));
    expect(text(app.root.querySelector('.home-details summary'))).toBe('View details');
    expect(app.root.querySelector<HTMLDetailsElement>('.home-details')!.open).toBe(false);
    for (const copy of [
      'Progress reflects the vocabulary currently in your library.',
      'A topic is complete when all its practice cards are marked as learned. Hidden vocabulary is included.',
      'These categories can overlap.',
      'Built-in content and your collections'
    ]) expect(text(app.root.querySelector('.home-overview'))).toContain(copy);
    expect(['Words', 'Phrases', 'Verbs', 'Topics', 'Your collections'].map((label) => stat(app, label))).toEqual(['566', String(total), '339', '34', '0']);
    expect(text(app.root.querySelector('.home-overview'))).not.toMatch(/total items/i);

    const cards = [...app.root.querySelectorAll<HTMLAnchorElement>('.topic-card')];
    expect(cards.map((card) => card.getAttribute('href'))).toEqual(TOPIC_PAGES.map((page) => `#${page}`));
    expect(cards.map((card) => text(card.querySelector('.topic-card__meta')))).toEqual([
      '0 of 18 practice cards learned', '0 of 36 practice cards learned', '0 of 18 practice cards learned'
    ]);
    expect(unmarkedCyrillic(app.root.querySelector('main')!)).toEqual([]);
  });

  it('6: Learn, Learn again, Undo and Reset update Home at once and match after a reload', async () => {
    let app = await startApp();
    await ready(app);
    const total = realMaterials.phrases.length;

    app.root.querySelector<HTMLAnchorElement>('.topic-card[href="#topic/small-talk"]')!.click();
    app.flush();
    expect(heading(app)).toBe('Small Talk');
    app.root.querySelector<HTMLButtonElement>('.topic-section .phrase-card button[aria-label="Mark as learned"]')!.click();
    app.flush();
    goTo(app, 'index');
    expect(vocabulary(app)).toBe(`1 / ${total} <1%`);
    expect(stat(app, 'Phrases learned')).toBe(`1 / ${total}`);
    expect(stat(app, 'Words learned')).toBe('0 / 566');
    expect(text(app.root.querySelector('.topic-card[href="#topic/small-talk"] .topic-card__meta'))).toBe('1 of 36 practice cards learned');

    app = await reload(app);
    expect(vocabulary(app)).toBe(`1 / ${total} <1%`);

    goTo(app, 'topic/small-talk');
    press(app, app.root, 'Practice this topic');
    expect(heading(app)).toBe('Flashcards');
    expect(app.root.querySelector<HTMLSelectElement>('.flashcards-deck select')!.value).toBe('Small Talk');
    press(app, app.root, 'I know it');
    await waitFor(() => text(app.root.querySelector('.flashcards-progress__stats')).includes('2 learned'), 'the second learned card');
    goTo(app, 'index');
    expect(vocabulary(app)).toBe(`2 / ${total} <1%`);

    goTo(app, 'flashcards');
    press(app, app.root, 'Review learned vocabulary (2)');
    press(app, app.root.querySelector('.flashcards-review__list')!, 'Learn again');
    goTo(app, 'index');
    expect(vocabulary(app)).toBe(`1 / ${total} <1%`);
    document.querySelector<HTMLButtonElement>('.toast__action')!.click();
    app.flush();
    expect(vocabulary(app)).toBe(`2 / ${total} <1%`);

    goTo(app, 'settings');
    press(app, app.root, 'Reset learning progress…');
    press(app, app.root.querySelector('dialog.dialog')!, 'Reset progress');
    // The dialog returns focus one tick after closing; a person cannot leave the screen sooner.
    await app.saved();
    await new Promise((resolve) => setTimeout(resolve, 0));
    goTo(app, 'index');
    expect(vocabulary(app)).toBe(`0 / ${total} 0%`);
    app = await reload(app);
    expect(vocabulary(app)).toBe(`0 / ${total} 0%`);
  });

  it('9: showing Home writes no summary: navigation only saves the open screen, as before', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['phrase-001', 'small-talk-meet-01'] } });
    const app = await startApp();
    await ready(app);
    await app.saved();
    const writes: string[] = [];
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      writes.push(`${this.name}:${String(args[1])}`);
      return put.apply(this, args);
    });
    for (const page of ['phrases', 'index', 'topic/conditionals', 'index']) {
      goTo(app, page);
      await app.saved();
    }
    expect(vocabulary(app)).toBe(`2 / ${realMaterials.phrases.length} <1%`);
    expect(new Set(writes)).toEqual(new Set(['settings:activePage']));
    const saved = await readDatabase();
    expect(Object.keys(saved.progress)).toEqual(['learnedPhrases']);
    expect(Object.keys(saved.settings)).toEqual(['activePage']);
  });

  it('10: search, filters, pages and chips leave Home totals unchanged; Hide keeps the inventory', async () => {
    await seedDatabase({ progress: { learnedPhrases: ['phrase-001', 'conditionals-zero-01'] } });
    const app = await startApp();
    await ready(app);
    const before = homeTotals(app);

    goTo(app, 'phrases');
    type(app, app.root.querySelector<HTMLInputElement>('main input[type="search"]')!, 'meeting');
    choose(app, app.root.querySelector<HTMLSelectElement>('main select[aria-label="Category"]')!, 'Small Talk');
    choose(app, app.root.querySelector<HTMLSelectElement>('.pagination select')!, '20');
    goTo(app, 'topic/small-talk');
    press(app, app.root, 'Traveling');
    type(app, app.root.querySelector<HTMLInputElement>('main input[type="search"]')!, 'have you');
    goTo(app, 'index');
    press(app, app.root.querySelector('.tag-cloud')!, 'grammar');
    expect(homeTotals(app)).toEqual(before);

    // Hiding a learned phrase removes its learned flag (established Hide behavior), not the entry.
    goTo(app, 'topic/conditionals');
    app.root.querySelector<HTMLButtonElement>('.topic-section .phrase-card button[aria-label^="Hide"]')!.click();
    app.flush();
    goTo(app, 'index');
    const after = homeTotals(app);
    expect(after['Vocabulary learned']).toBe(`1 / ${realMaterials.phrases.length} <1%`);
    expect({ ...after, 'Vocabulary learned': '', 'Phrases learned': '', 'Remaining vocabulary': '' }).toEqual({ ...before, 'Vocabulary learned': '', 'Phrases learned': '', 'Remaining vocabulary': '' });
  });
});

describe('learning topic screens (ENG-V2-03)', () => {
  it('opens from a Home card or a deep link, as a Library screen with a visible heading', async () => {
    window.location.hash = 'topic/interview-english';
    const app = await startApp();
    await ready(app);
    expect(heading(app)).toBe('Interview English');
    expect(app.root.querySelector('main h1')!.classList.contains('visually-hidden')).toBe(false);
    expect(app.root.querySelector('.section-nav')).toBeNull();
    expect(text(app.root.querySelector('.tab-bar [aria-current="page"]'))).toBe('Library');
    goTo(app, 'index');
    app.root.querySelector<HTMLAnchorElement>('.topic-card[href="#topic/conditionals"]')!.click();
    app.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(heading(app)).toBe('Conditionals');
    expect(window.location.hash).toBe('#topic/conditionals');
    expect(document.activeElement).toBe(app.root.querySelector('main h1'));
    // The topic's learning block opens the same screen.
    goTo(app, 'index');
    press(app, app.root.querySelector('.tag-cloud')!, 'small-talk');
    const block = [...app.root.querySelectorAll<HTMLAnchorElement>('.block-row__open')].find((item) => item.getAttribute('href') === '#topic/small-talk');
    expect(text(block)).toContain('Small Talk');
    block!.click();
    app.flush();
    expect(heading(app)).toBe('Small Talk');
    goTo(app, 'topic/no-such-topic');
    expect(heading(app)).toBe('Home');
  });

  it('shows Conditionals as rules with examples, the Mixed Conditionals group and the usage note', async () => {
    window.location.hash = 'topic/conditionals';
    const app = await startApp();
    await ready(app);
    const outline = [...app.root.querySelectorAll('main h2, main h3:not(.entry__term)')].map((item) => `${item.tagName}:${text(item)}`);
    expect(outline).toEqual([
      'H2:Zero Conditional', 'H2:First Conditional', 'H2:Second Conditional', 'H2:Third Conditional', 'H2:Mixed Conditionals',
      'H3:Past condition, present result', 'H3:General condition, past result', 'H2:Usage note'
    ]);
    expect(app.root.querySelectorAll('.topic-rule')).toHaveLength(6);
    expect(text(app.root.querySelector('.topic-rule'))).toBe('Pattern: If + present simple, present simple. Use: General truths, repeated results and habits.');
    expect(rowTexts(app)).toHaveLength(18);
    // The final subsection's rows are present and use the h4 level below their h3.
    const sectionsShown = [...app.root.querySelectorAll('.topic-section')];
    const last = sectionsShown[sectionsShown.length - 1];
    expect([...last.querySelectorAll('h4.entry__term')].map((item) => text(item))[2]).toBe('If I weren\'t afraid of flying, I would have traveled to the conference last month.');
    expect(app.root.querySelector('.topic-intro__hint')).toBeNull();
    expect(unmarkedCyrillic(app.root.querySelector('main')!)).toEqual([]);
  });

  it('filters Small Talk by situation chips together with search, in memory only, without touching progress', async () => {
    window.location.hash = 'topic/small-talk';
    let app = await startApp();
    await ready(app);
    await app.saved();
    const saved = await readDatabase();
    const chips = () => [...app.root.querySelectorAll<HTMLButtonElement>('.chip-row button')];
    expect(app.root.querySelector('.chip-row')!.getAttribute('role')).toBe('group');
    expect(app.root.querySelector('.chip-row')!.getAttribute('aria-label')).toBe('Situations');
    expect(chips().map((item) => [text(item), item.getAttribute('aria-pressed')])).toEqual([
      ['All situations', 'true'], ['Meeting new people', 'false'], ['Before a work meeting', 'false'], ['Coffee and lunch breaks', 'false'],
      ['Free time and weekends', 'false'], ['Conferences and events', 'false'], ['Traveling', 'false']
    ]);
    expect(rowTexts(app)).toHaveLength(36);
    expect(text(app.root.querySelector('.topic-intro__hint'))).toBe('Replace the text in brackets with your own details.');
    expect(rowTexts(app)[0]).toBe("Hi, I'm [name]. It's nice to meet you.");

    press(app, app.root, 'Traveling');
    expect(chips().filter((item) => item.getAttribute('aria-pressed') === 'true').map((item) => text(item))).toEqual(['Traveling']);
    expect(rowTexts(app)).toEqual(['Are you traveling for work or for a vacation?', 'Have you been here before?', 'How was your journey?', 'How long are you staying?', 'Have you had a chance to explore the city?', 'I hope you enjoy the rest of your trip.']);
    type(app, app.root.querySelector<HTMLInputElement>('main input[type="search"]')!, 'HAVE YOU');
    expect(rowTexts(app)).toEqual(['Have you been here before?', 'Have you had a chance to explore the city?']);
    expect(text(app.root.querySelector('.list-header__count'))).toBe('2 practice phrases');

    // The selection stays while moving between screens, and resets after a reload.
    goTo(app, 'phrases');
    goTo(app, 'topic/small-talk');
    expect(rowTexts(app)).toHaveLength(2);
    type(app, app.root.querySelector<HTMLInputElement>('main input[type="search"]')!, 'zzz');
    expect(text(app.root.querySelector('.empty-state'))).toContain('No phrases found');
    press(app, app.root, 'Clear search and filter');
    expect(rowTexts(app)).toHaveLength(36);
    press(app, app.root, 'Traveling');
    await app.saved();
    const after = await readDatabase();
    expect(after.progress).toEqual(saved.progress);
    expect(Object.keys(after.settings)).toEqual(['activePage']);
    app = await reload(app);
    goTo(app, 'topic/small-talk');
    expect(rowTexts(app)).toHaveLength(36);
  });

  it('shows each interview category with its questions, structure, frames, labelled model answer and translation', async () => {
    window.location.hash = 'topic/interview-english';
    const app = await startApp();
    await ready(app);
    const sections = [...app.root.querySelectorAll('.topic-section')];
    expect(sections).toHaveLength(6);
    for (const section of sections) {
      expect([...section.querySelectorAll('h3')].map((item) => text(item))).toEqual(['Typical questions', 'Answer structure', 'Answer frames', 'Model answer', 'Translation']);
      expect(section.querySelectorAll('.topic-question')).toHaveLength(2);
      expect(section.querySelectorAll('.phrase-card')).toHaveLength(3);
      expect(section.querySelectorAll('h4.entry__term')).toHaveLength(3);
    }
    const last = sections[5];
    expect(text(last.querySelector('h2'))).toBe('Describing experience and solving problems');
    expect(text(last.querySelector('.reading-card__label'))).toBe('Fictional practice example');
    expect(text(sections[3].querySelector('.reading-card__label'))).toBe('Hypothetical server-backed application');
    expect(last.querySelector('.topic-answer .reading-card__translation')!.getAttribute('lang')).toBe('uk');
    expect(last.querySelector('.topic-answer .reading-card__english')!.getAttribute('translate')).toBe('no');
    expect(text(app.root.querySelector('.topic-intro__note'))).toBe('Model answers are examples, not statements about your experience. Replace details with information that is true for you.');
    expect(text(app.root.querySelector('.topic-intro__hint'))).toBe('Replace the text in brackets with your own details.');
    // Placeholders are literal text.
    expect(text(sections[0].querySelector('.entry__term'))).toBe('Both [A] and [B] help with [goal], but they solve different problems.');
    expect(unmarkedCyrillic(app.root.querySelector('main')!)).toEqual([]);

    // The model answers also appear in the existing Answers screen.
    goTo(app, 'answers');
    expect(text(app.root.querySelector('main'))).toContain('Tell me about a time you solved a difficult problem.');
    expect(text(app.root.querySelector('main'))).toContain('Fictional practice example');
  });

  it('keeps learned state, Focus and Hide on practice rows, shared with every other view', async () => {
    window.location.hash = 'topic/conditionals';
    const app = await startApp();
    await ready(app);
    const row = app.root.querySelector<HTMLElement>('.topic-section .phrase-card')!;
    row.querySelector<HTMLButtonElement>('button[aria-label="Mark as learned"]')!.click();
    row.querySelector<HTMLButtonElement>('button[aria-label="Add to Focus List"]')!.click();
    app.flush();
    expect(row.classList.contains('learned')).toBe(true);
    await app.saved();
    expect((await readDatabase()).progress).toMatchObject({ learnedPhrases: ['conditionals-zero-01'], favoritePhrases: ['conditionals-zero-01'] });
    goTo(app, 'favorites');
    expect(text(app.root.querySelector('main'))).toContain('If I skip breakfast, I feel hungry before lunch.');
    goTo(app, 'index');
    expect(stat(app, 'In Focus')).toBe('1');

    goTo(app, 'topic/conditionals');
    expect(rowTexts(app)).toHaveLength(18);
    app.root.querySelector<HTMLButtonElement>('.topic-section .phrase-card button[aria-label^="Hide"]')!.click();
    app.flush();
    expect(rowTexts(app)).toHaveLength(17);
    expect(text(app.root.querySelector('.topic-actions'))).toContain('Show hidden (1)');
    document.querySelector<HTMLButtonElement>('.toast__action')!.click();
    app.flush();
    expect(rowTexts(app)).toHaveLength(18);
  });

  it('links the Phrases screen to a topic when its category is chosen, and respects the Learn Pass', async () => {
    const app = await startApp();
    await ready(app);
    goTo(app, 'phrases');
    choose(app, app.root.querySelector<HTMLSelectElement>('main select[aria-label="Category"]')!, 'Interview English');
    const link = app.root.querySelector<HTMLAnchorElement>('main a[href="#topic/interview-english"]')!;
    expect(text(link)).toBe('Open the Interview English topic');
    expect([...app.root.querySelectorAll('.entry-group > h2')].map((item) => text(item))[0]).toBe('Comparing concepts');
  });

  it('opens the topic deck from "Practice this topic" even when a user collection was the selected filter', async () => {
    const imported = native();
    await seedDatabase({
      userCollections: {
        [collection.id]: {
          ...collection, version: 1, createdAt: '2026-11-22T00:00:00.000Z', updatedAt: '2026-11-22T00:00:00.000Z', revision: 1,
          lastImport: { fileName: 'synthetic.json', format: 'json', importedAt: '2026-11-22T00:00:00.000Z', added: 2, skipped: 0 }
        }
      },
      userEntries: Object.fromEntries(imported.entries.map((item, position) => [item.id, { ...item, collectionId: collection.id, position }])),
      settings: { collectionFilter: collection.id, flashcardMode: 'all' }
    });
    window.location.hash = 'topic/small-talk';
    const app = await startApp();
    await ready(app);
    press(app, app.root, 'Practice this topic');
    expect(heading(app)).toBe('Flashcards');
    expect(app.root.querySelector<HTMLSelectElement>('.flashcards-deck select[aria-label="Topic"]')!.value).toBe('Small Talk');
    expect(app.root.querySelector<HTMLSelectElement>('.flashcards-deck select[aria-label="Collection"]')!.value).toBe('');
    expect(app.root.querySelector('.flashcards-progress__bar')!.getAttribute('aria-valuemax')).toBe('36');
    await app.saved();
    expect((await readDatabase()).settings).toMatchObject({ collectionFilter: '', flashcardMode: 'topic', flashcardTopic: 'Small Talk' });
  });

  it('offers only the topics of the active Learn Pass', async () => {
    await seedDatabase({
      progress: { selectedLearnPassId: 'pass' },
      learnPasses: { pass: { id: 'pass', name: 'Only small talk', description: '', blockIds: ['topic-small-talk', 'start-answer'], createdAt: '2026-11-22', updatedAt: '2026-11-22' } }
    });
    window.location.hash = 'topic/conditionals';
    const app = await startApp();
    await ready(app);
    expect(heading(app)).toBe('Home');
    expect([...app.root.querySelectorAll('.topic-card')].map((card) => card.getAttribute('href'))).toEqual(['#topic/small-talk']);
    // Statistics still describe the whole library.
    expect(stat(app, 'Topics')).toBe('34');
    goTo(app, 'topic/small-talk');
    expect(heading(app)).toBe('Small Talk');
  });
});
