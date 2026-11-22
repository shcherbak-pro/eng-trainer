import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCatalog } from '../../content/catalog';
import { combineCatalog } from '../../content/userCatalog';
import { parseImport } from '../../collections/format';
import { CSV_EXAMPLE, CSV_TEMPLATE_FILE_NAME } from '../../collections/importGuide';
import { openStorage } from '../../storage/database';
import { collection, entry, native } from '../../test/collections';
import { realMaterials } from '../../test/content';
import { readDatabase, resetDatabase, seedDatabase } from '../../test/database';

const downloads = vi.hoisted(() => [] as { name: string; parts: BlobPart[]; type: string }[]);
vi.mock('../../shared/download', () => ({
  downloadFile: (name: string, parts: BlobPart[], type: string) => {
    downloads.push({ name, parts, type });
  }
}));

type FakeFile = { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> };

/** jsdom has no File.arrayBuffer; the page only needs the name, the size and the bytes. */
function file(name: string, text: string, gate?: Promise<void>): FakeFile {
  const bytes = new TextEncoder().encode(text);
  return {
    name,
    size: bytes.length,
    arrayBuffer: async () => {
      if (gate) await gate;
      return bytes.buffer.slice(0) as ArrayBuffer;
    }
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

const builtIn = createCatalog(realMaterials);
const cleanups: (() => void)[] = [];

async function mountPage() {
  vi.resetModules();
  const svelte = await import('svelte');
  const state = await import('../../state');
  const persistence = await import('../../state/persistence');
  const service = await import('../../collections/service');
  const Page = (await import('./CollectionsPage.svelte')).default;
  await state.initState();

  const root = document.createElement('div');
  document.body.appendChild(root);
  const component = svelte.mount(Page, { target: root, props: { catalog: combineCatalog(builtIn, get(service.userVocabulary)) } });
  svelte.flushSync();
  cleanups.push(() => {
    svelte.unmount(component);
    root.remove();
  });

  const input = () => root.querySelector<HTMLInputElement>('input[type="file"]')!;
  const flush = async () => {
    for (let round = 0; round < 6; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      svelte.flushSync();
    }
  };
  return {
    root,
    service,
    persistence,
    input,
    flush,
    text: () => (root.textContent ?? '').replace(/\s+/g, ' '),
    button: (label: string) =>
      [...root.querySelectorAll<HTMLButtonElement>('button')].find(
        (item) => item.getAttribute('aria-label') === label || (item.textContent ?? '').replace(/\s+/g, ' ').trim() === label
      ),
    async choose(chosen: FakeFile) {
      Object.defineProperty(input(), 'files', { value: [chosen], configurable: true });
      input().dispatchEvent(new Event('change', { bubbles: true }));
      svelte.flushSync();
    },
    async click(label: string) {
      const target = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
        (item) => item.getAttribute('aria-label') === label || (item.textContent ?? '').replace(/\s+/g, ' ').trim() === label
      );
      expect(target, label).toBeDefined();
      target!.click();
      svelte.flushSync();
      await flush();
    }
  };
}

beforeEach(() => {
  resetDatabase();
  downloads.length = 0;
});

afterEach(() => {
  cleanups.splice(0).forEach((close) => close());
  vi.restoreAllMocks();
});

describe('import help', () => {
  it('shows formats, encoding, required columns, limits and the example without writing anything', async () => {
    const page = await mountPage();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    const remove = vi.spyOn(IDBObjectStore.prototype, 'delete');
    const before = await readDatabase();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const help = page.root.querySelector('.help-card')!;
    const helpText = (help.textContent ?? '').replace(/\s+/g, ' ');
    expect(helpText).toContain('How to prepare your file');
    expect(helpText).toContain('CSV, or a JSON file exported from eng-trainer');
    expect(helpText).toContain('UTF-8');
    expect(helpText).toContain('Required columns: english and translation');
    expect(helpText).toContain('up to 2 MiB per file and 1,000 entries per collection');
    expect(help.querySelector('pre')!.textContent).toBe(CSV_EXAMPLE);
    expect(help.querySelector('details > summary')!.textContent).toBe('More format details');

    await page.click('Copy example');
    expect(writeText).toHaveBeenCalledWith(CSV_EXAMPLE);
    expect(helpText.length).toBeGreaterThan(0);
    expect(page.text()).toContain('Example copied.');

    await page.click('Download CSV template');
    expect(downloads).toEqual([{ name: CSV_TEMPLATE_FILE_NAME, parts: ['﻿', CSV_EXAMPLE], type: 'text/csv;charset=utf-8' }]);

    // The JSON reference in the details is a valid native export.
    const reference = help.querySelectorAll('pre')[2].textContent ?? '';
    expect(parseImport(reference, 'reference.json').issues).toEqual([]);

    await page.persistence.persistenceSettled();
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(await readDatabase()).toEqual(before);
  });
});

describe('file selection (F3) and validation feedback', () => {
  it('keeps the picker usable while reading, focuses the review, and writes nothing until the import is confirmed', async () => {
    const page = await mountPage();
    const before = await readDatabase();
    const gate = deferred();
    await page.choose(file('Work words.csv', 'english,translation\nzyxwv one,перше\nzyxwv two,друге', gate.promise));
    expect(page.input().disabled).toBe(false);
    expect(page.text()).toContain('Reading “Work words.csv”…');

    gate.resolve();
    await page.flush();
    const heading = page.root.querySelector('#review-title')!;
    expect(heading.textContent).toBe('Review “Work words.csv”');
    expect(document.activeElement).toBe(heading);
    expect(await readDatabase()).toEqual(before);

    await page.click('Cancel import');
    expect(page.root.querySelector('#review-title')).toBeNull();
    expect(document.activeElement).toBe(page.input());
    expect(await readDatabase()).toEqual(before);
  });

  it('explains how to fix a rejected file, offers the template, focuses the summary and writes nothing', async () => {
    const page = await mountPage();
    const before = await readDatabase();
    const cases: [string, string, string][] = [
      ['missing.csv', 'english,meaning\nx,y', 'Missing column: “translation”'],
      ['other.json', '{"words":[]}', 'This JSON file is not an eng-trainer export'],
      ['damaged.json', '{"format":', 'This JSON file is damaged'],
      ['vocabulary.xlsx', 'PK', 'This file type is not supported']
    ];
    for (const [name, content, title] of cases) {
      await page.choose(file(name, content));
      await page.flush();
      const summary = page.root.querySelector<HTMLElement>('.notice--error[role="alert"]')!;
      expect(summary.textContent).toContain(title);
      expect(document.activeElement).toBe(summary);
    }
    expect(page.button('Download CSV template')).toBeDefined();
    expect(await readDatabase()).toEqual(before);
  });

  it('lets only the latest selection update the page, and a cancelled selection never reappears', async () => {
    const page = await mountPage();
    const slow = deferred();
    await page.choose(file('first.csv', 'english,translation\nfirst only,перше', slow.promise));
    await page.choose(file('second.csv', 'english,translation\nsecond only,друге'));
    await page.flush();
    expect(page.root.querySelector('#review-title')!.textContent).toBe('Review “second.csv”');
    const focused = document.activeElement;

    slow.resolve();
    await page.flush();
    expect(page.root.querySelector('#review-title')!.textContent).toBe('Review “second.csv”');
    expect(page.text()).not.toContain('first only');
    expect(document.activeElement).toBe(focused);

    // Cancel while a file is still being read.
    const pending = deferred();
    await page.choose(file('third.csv', 'english,translation\nthird only,третє', pending.promise));
    expect(page.root.querySelector('#review-title')).toBeNull();
    await page.click('Cancel');
    pending.resolve();
    await page.flush();
    expect(page.root.querySelector('#review-title')).toBeNull();
    expect(page.root.querySelector('.notice--error')).toBeNull();
    expect(page.text()).not.toContain('Reading');
  });

  it('accepts the same file name again after it has been corrected', async () => {
    const page = await mountPage();
    await page.choose(file('words.csv', 'english,translation\nbroken,'));
    await page.flush();
    expect(page.text()).toContain('Record 2, column “translation”: Translation is required.');
    expect(page.button('Confirm import')!.disabled).toBe(true);

    await page.choose(file('words.csv', 'english,translation\nfixed zyxwv,виправлено'));
    await page.flush();
    expect(page.text()).not.toContain('Translation is required');
    expect(page.button('Import 1 entry')!.disabled).toBe(false);
  });
});

describe('saving and managing collections', () => {
  it('reports success only after the import transaction, then exports with a readable Cyrillic file name (F6)', async () => {
    const page = await mountPage();
    await page.choose(file('Мої слова.csv', 'english,translation\nzyxwv alpha,альфа\nzyxwv beta,бета'));
    await page.flush();
    await page.click('Import 2 entries');
    await page.flush();
    const success = page.root.querySelector<HTMLElement>('.notice--success')!;
    expect(success.textContent).toContain('Imported 2 entries.');
    expect(document.activeElement).toBe(success);
    const saved = await readDatabase();
    expect(Object.values(saved.userCollections).map((item) => (item as { name: string }).name)).toEqual(['Мої слова']);

    await page.click('Export JSON: Мої слова');
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toMatch(/^Мої-слова-\d{4}-\d{2}-\d{2}\.json$/);
    expect(parseImport(String(downloads[0].parts[0]), downloads[0].name).issues).toEqual([]);
  });

  it('shows a rename conflict next to the form, with a reload action and no storage advice (F5)', async () => {
    const page = await mountPage();
    await page.choose(file('Synthetic.csv', 'english,translation\nzyxwv gamma,гамма'));
    await page.flush();
    await page.click('Import 1 entry');
    const [saved] = get(page.service.userVocabulary).collections;

    // Another tab renames the collection first.
    const otherTab = await openStorage();
    await otherTab.write([{ type: 'put', store: 'userCollections', key: saved.id, value: { ...saved, name: 'Renamed elsewhere', revision: saved.revision + 1 } }]);
    otherTab.close();

    await page.click('Rename Synthetic');
    const field = page.root.querySelector<HTMLInputElement>('.rename-form input')!;
    expect(document.activeElement).toBe(field);
    field.value = 'Mine';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await page.click('Save name');

    const form = page.root.querySelector('.rename-form')!;
    const notice = (form.querySelector('.notice--error')!.textContent ?? '').replace(/\s+/g, ' ');
    expect(notice).toContain('The new name was not saved: this collection was changed in another tab or window.');
    expect(notice).not.toMatch(/storage space/i);
    expect(page.button('Reload page')).toBeDefined();
    expect((await readDatabase()).userCollections[saved.id]).toMatchObject({ name: 'Renamed elsewhere' });
  });
});

describe('focus once the final import plan is ready (RC1, F3)', () => {
  const issueSummary = (page: Awaited<ReturnType<typeof mountPage>>) => page.root.querySelector<HTMLElement>('.review__problems');

  async function seedCollection() {
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
  }

  it.each([
    ['a missing translation', 'missing-translation.csv', 'english,translation\ninvalid,', 'Record 2, column “translation”'],
    ['an invalid kind', 'invalid-kind.csv', 'english,translation,kind\nfirst,one,noun', 'Record 2, column “kind”']
  ])('focuses the named issue summary for %s, and saves nothing', async (_case, name, content, location) => {
    const page = await mountPage();
    const before = await readDatabase();
    await page.choose(file(name, content));
    await page.flush();
    const summary = issueSummary(page);
    expect(summary).not.toBeNull();
    expect(document.activeElement).toBe(summary);
    expect(summary!.getAttribute('tabindex')).toBe('-1');
    expect(document.getElementById(summary!.getAttribute('aria-labelledby')!)!.textContent).toBe(
      'Nothing can be imported until these problems are fixed in the file:'
    );
    expect(summary!.textContent).toContain(location);
    expect(page.root.querySelector<HTMLButtonElement>('.review__actions button')!.disabled).toBe(true);
    expect(await readDatabase()).toEqual(before);
  });

  it('focuses the issue summary for a native file that would change an existing entry', async () => {
    await seedCollection();
    const page = await mountPage();
    const before = await readDatabase();
    const changed = native([entry(1, { translation: 'Інший переклад' }), entry(2, { kind: 'phrase' })]);
    await page.choose(file('changed.json', JSON.stringify(changed)));
    await page.flush();
    expect(issueSummary(page)!.textContent).toContain('ID conflict');
    expect(document.activeElement).toBe(issueSummary(page));
    expect(await readDatabase()).toEqual(before);
  });

  it('focuses the review heading for an importable file, also when duplicates only need acknowledging', async () => {
    const page = await mountPage();
    await page.choose(file('duplicates.csv', 'english,translation\nzyxwv same,перше\nzyxwv same,друге'));
    await page.flush();
    expect(issueSummary(page)).toBeNull();
    expect(page.text()).toContain('possible duplicate');
    expect(document.activeElement).toBe(page.root.querySelector('#review-title'));
  });

  it('a superseded result with problems never takes focus from the newer preview', async () => {
    const page = await mountPage();
    const slowInvalid = deferred();
    await page.choose(file('invalid.csv', 'english,translation\ninvalid,', slowInvalid.promise));
    await page.choose(file('valid.csv', 'english,translation\nzyxwv valid,дійсне'));
    await page.flush();
    const heading = page.root.querySelector('#review-title')!;
    expect(document.activeElement).toBe(heading);
    slowInvalid.resolve();
    await page.flush();
    expect(page.root.querySelector('.review .notice--error')).toBeNull();
    expect(page.root.querySelector('#review-title')!.textContent).toBe('Review “valid.csv”');
    expect(document.activeElement).toBe(heading);
  });

  it('a superseded importable result never takes focus from the newer issue summary', async () => {
    const page = await mountPage();
    const slowValid = deferred();
    await page.choose(file('late.csv', 'english,translation\nzyxwv late,пізно', slowValid.promise));
    await page.choose(file('now.csv', 'english,translation\nnow,'));
    await page.flush();
    expect(document.activeElement).toBe(issueSummary(page));
    slowValid.resolve();
    await page.flush();
    expect(page.root.querySelector('#review-title')!.textContent).toBe('Review “now.csv”');
    expect(document.activeElement).toBe(issueSummary(page));
  });

  it('a Cancel after the result has rendered, but before focus moves, keeps the cancelled result from taking focus', async () => {
    const page = await mountPage();
    // Cancel as soon as the problem summary is in the page: the result is published and rendered,
    // and the page has not yet decided where focus goes.
    const observer = new MutationObserver(() => {
      if (!page.root.querySelector('.review .notice--error')) return;
      observer.disconnect();
      [...page.root.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === 'Cancel import')!.click();
    });
    observer.observe(page.root, { childList: true, subtree: true });
    await page.choose(file('invalid.csv', 'english,translation\ninvalid,'));
    await page.flush();
    expect(page.root.querySelector('.review')).toBeNull();
    expect(document.activeElement).toBe(page.input());
  });
});

describe('study text in the import preview (RC1, F5)', () => {
  it('keeps the English example out of browser translation, but not its label', async () => {
    const page = await mountPage();
    await page.choose(file('examples.csv', 'english,translation,example\nzyxwv ownership,відповідальність,I take ownership of it.'));
    await page.flush();
    const extra = [...page.root.querySelectorAll<HTMLElement>('.review__extra')].find((item) => item.textContent?.includes('Example:'))!;
    const example = [...extra.querySelectorAll<HTMLElement>('span')].find((item) => item.textContent === 'I take ownership of it.');
    expect(example).toBeDefined();
    expect(example!.translate).toBe(false);
    expect(example!.closest('[lang]')!.getAttribute('lang')).toBe('en');
    expect(extra.translate).toBe(true);
  });
});
