import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetDatabase } from '../../test/database';
import { describeExperimental } from '../../test/product';
import { SYNTHETIC_META, V1_STATE, V1_STATE_KEY, V1_THEME_KEY, V2_NAME, V3_NAME, bytesOf, databaseNames, seedExperimental, seedLegacy, seedStable, snapshot, syntheticStores } from './testing';

/**
 * The Backup screen (ENG-V3-R1A, ENG-V3-R1A-RC1), mounted in jsdom with made-up data. The
 * browser acceptance test covers the real file download and file picker.
 */
const V3 = 'experimental-v3';
const V2 = 'stable-v2';
const V1 = 'legacy-v1';
const downloads: { name: string; parts: BlobPart[]; type: string }[] = [];
vi.mock('../../shared/download', () => ({
  downloadFile: (name: string, parts: BlobPart[], type: string) => downloads.push({ name, parts, type })
}));

type Screen = {
  root: HTMLElement;
  flush: () => void;
  close: () => void;
  state: typeof import('../../state');
  persistence: typeof import('../../state/persistence');
  exporter: typeof import('./exportBackup');
};

let screens: Screen[] = [];

const text = (node: ParentNode | null): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function waitFor(condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}. Screen text: ${text(document.body).slice(0, 400)}`);
}

/** The application after start-up, with the Backup screen open. `storage: false` is "Continue without saving". */
async function openScreen({ storage = true } = {}): Promise<Screen> {
  vi.resetModules();
  const svelte = await import('svelte');
  const state = await import('../../state');
  const persistence = await import('../../state/persistence');
  const exporter = await import('./exportBackup');
  if (storage) await state.initState();
  else state.initStateWithoutStorage();
  const { default: BackupPage } = await import('./BackupPage.svelte');
  const root = document.createElement('div');
  document.body.appendChild(root);
  const component = svelte.mount(BackupPage, { target: root });
  const screen: Screen = { root, flush: () => svelte.flushSync(), close: () => { svelte.unmount(component); root.remove(); }, state, persistence, exporter };
  screens.push(screen);
  screen.flush();
  return screen;
}

const page = (screen: Screen): HTMLElement => screen.root.querySelector<HTMLElement>('[data-experimental-feature="backup-recovery"]')!;
const action = (screen: Screen, name: string): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(`[data-backup-action="${name}"]`);
const source = (screen: Screen, product: string): HTMLElement | null => screen.root.querySelector<HTMLElement>(`[data-backup-source="${product}"]`);
const section = (screen: Screen, product: string): HTMLElement | null => screen.root.querySelector<HTMLElement>(`[data-backup-section="${product}"]`);
/** What the screen says about the destination of one part of the file. */
const destination = (screen: Screen, product: string): string | null => section(screen, product)?.querySelector('[data-backup-destination]')?.getAttribute('data-backup-destination') ?? null;
/** The button that starts the recovery of one part. It exists only while that recovery is possible. */
const recoverButton = (screen: Screen, product: string): HTMLButtonElement | null => screen.root.querySelector<HTMLButtonElement>(`[data-backup-action="recover"][data-backup-product="${product}"]`);

function click(screen: Screen, name: string): void {
  action(screen, name)!.click();
  screen.flush();
}

/** Asks for the recovery of one part: this opens its confirmation. */
function recover(screen: Screen, product: string): void {
  recoverButton(screen, product)!.click();
  screen.flush();
}

async function makeBackup(screen: Screen): Promise<void> {
  click(screen, 'make');
  await waitFor(() => { screen.flush(); return page(screen).dataset.exportPhase !== 'reading'; }, 'the end of the export');
}

/** Hands a file to the file picker, as a selection by the learner does. */
async function choose(screen: Screen, name: string, content: string | Uint8Array): Promise<void> {
  const bytes = typeof content === 'string' ? bytesOf(content) : content;
  const input = screen.root.querySelector<HTMLInputElement>('#backup-file')!;
  const file = { name, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => { screen.flush(); return !text(screen.root).includes('Checking “'); }, 'the file to be checked');
  screen.flush();
}

/** The text of a backup of a profile with all three products, and then the loss of the browser storage. */
async function backupThenLoss(): Promise<string> {
  await seedExperimental();
  await seedStable();
  seedLegacy();
  const made = await openScreen();
  await makeBackup(made);
  const content = String(downloads[downloads.length - 1].parts[0]);
  made.close();
  screens = [];
  resetDatabase();
  window.localStorage.clear();
  return content;
}

/** The stable product was opened once after the loss: it created its own storage, and nothing is in it. */
const stableOpenedOnce = (): Promise<void> => seedStable({});

beforeEach(() => {
  resetDatabase();
  window.localStorage.clear();
  downloads.length = 0;
});

afterEach(() => {
  screens.forEach((screen) => screen.close());
  screens = [];
  vi.restoreAllMocks();
});

describeExperimental('Backup screen: making a backup file', () => {
  it('reads nothing of another product when the screen is opened: only the click on the button does', async () => {
    await seedStable();
    seedLegacy();
    const open = vi.spyOn(indexedDB, 'open');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');

    const screen = await openScreen();
    await new Promise((resolve) => setTimeout(resolve, 30));
    screen.flush();

    expect(open.mock.calls.map(([name]) => name)).toEqual([V3_NAME]);
    expect(getItem).not.toHaveBeenCalled();
    expect(page(screen).dataset.exportPhase).toBe('idle');
    expect(screen.root.querySelectorAll('[data-backup-source]')).toHaveLength(0);

    await makeBackup(screen);

    expect(open.mock.calls.map(([name]) => name)).toEqual([V3_NAME, V3_NAME, V2_NAME]);
    expect(getItem.mock.calls.map(([key]) => key)).toEqual([V1_STATE_KEY, V1_THEME_KEY]);
  });

  it('hands the learner one file with all three products, says what it holds and that it cannot know whether the file was kept', async () => {
    await seedExperimental();
    await seedStable();
    seedLegacy();
    const screen = await openScreen();
    const { readBackup } = await import('./validate');

    await makeBackup(screen);

    expect(page(screen).dataset.exportPhase).toBe('done');
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toMatch(/^eng-trainer-backup-\d{8}-\d{6}\.json$/);
    expect(downloads[0].type).toBe('application/json;charset=utf-8');
    const file = await readBackup(bytesOf(String(downloads[0].parts[0])));
    expect(Object.keys(file.sections)).toEqual(['experimental-v3', 'stable-v2', 'legacy-v1']);

    expect(text(screen.root)).toContain(`Backup file made: ${downloads[0].name}`);
    expect(text(screen.root)).toContain('The application cannot check that you kept the file.');
    for (const product of ['experimental-v3', 'stable-v2', 'legacy-v1']) expect(source(screen, product)!.dataset.backupSourceState).toBe('included');
    expect(text(source(screen, 'experimental-v3'))).toContain('This version (experimental v3) In the file 3 learned items, 2 hidden items, 4 Focus items, 1 Learn pass, 2 flashcard decks with a saved place, the collection “Synthetic collection 3” (2 entries) and 8 saved preferences.');
    expect(text(source(screen, 'stable-v2'))).toContain('the collection “Synthetic collection 2” (2 entries)');
    expect(text(source(screen, 'legacy-v1'))).toContain('Previous version (v1) In the file 2 learned items, 1 hidden item, 1 Focus item, 1 Learn pass and 1 flashcard deck with a saved place.');
  });

  it('names a product that has nothing saved in this browser, and still makes the file', async () => {
    const screen = await openScreen();
    await makeBackup(screen);

    expect(downloads).toHaveLength(1);
    expect(source(screen, 'experimental-v3')!.dataset.backupSourceState).toBe('included');
    expect(text(source(screen, 'experimental-v3'))).toContain('No learning data yet.');
    expect(source(screen, 'stable-v2')!.dataset.backupSourceState).toBe('absent');
    expect(text(source(screen, 'stable-v2'))).toContain('This browser has no saved data of the stable version.');
    expect(source(screen, 'legacy-v1')!.dataset.backupSourceState).toBe('absent');
    expect(await databaseNames()).toEqual([V3_NAME]);
  });

  it('makes no file when a product cannot be read, until the learner asks for the file without it', async () => {
    await seedExperimental();
    await seedStable(syntheticStores(2), 3);
    const screen = await openScreen();

    await makeBackup(screen);

    expect(page(screen).dataset.exportPhase).toBe('blocked');
    expect(downloads).toHaveLength(0);
    expect(text(screen.root)).toContain('No file was made yet');
    expect(text(screen.root)).toContain('The saved data of the stable version could not be read or checked, so a backup would not be complete.');
    expect(source(screen, 'stable-v2')!.dataset.backupSourceState).toBe('failed');
    expect(text(source(screen, 'stable-v2'))).toContain('Not in the file');
    expect(text(source(screen, 'stable-v2'))).toContain('newer storage schema 3');
    expect(text(action(screen, 'make-incomplete'))).toBe('Make the file without the stable version');

    const open = vi.spyOn(indexedDB, 'open');
    click(screen, 'make-incomplete');
    await waitFor(() => { screen.flush(); return page(screen).dataset.exportPhase === 'done'; }, 'the incomplete file');

    // The file is made from what was already read: nothing is read a second time.
    expect(open).not.toHaveBeenCalled();
    expect(downloads).toHaveLength(1);
    expect(Object.keys(JSON.parse(String(downloads[0].parts[0])).sections)).toEqual(['experimental-v3']);
    expect(text(screen.root)).toContain('This backup is incomplete. It does not hold the data of the stable version.');
  });

  it('says that nothing can be backed up while the session runs without saving and nothing was ever saved', async () => {
    const screen = await openScreen({ storage: false });
    await makeBackup(screen);

    expect(page(screen).dataset.exportPhase).toBe('failed');
    expect(downloads).toHaveLength(0);
    expect(text(screen.root.querySelector('[data-backup-failure]'))).toContain('there is nothing to back up');
    expect(screen.root.querySelector('[data-backup-empty-profile]')).toBeNull();
  });
});

describeExperimental('Backup screen: recovering this version from a backup file', () => {
  it('says on an empty profile that the data may have been removed, and that the application cannot tell', async () => {
    const screen = await openScreen();
    expect(text(screen.root.querySelector('[data-backup-empty-profile]'))).toBe('This version holds no learning data in this browser. If you had data here before, the browser may have removed it. The application cannot tell. You can recover it from a backup file.');
  });

  it('checks and shows the file, names the destination of each part, and changes nothing before a confirmation', async () => {
    const content = await backupThenLoss();
    const screen = await openScreen();
    const before = await snapshot(V3_NAME);
    const open = vi.spyOn(indexedDB, 'open');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');

    await choose(screen, 'eng-trainer-backup-20261125-140322.json', content);

    expect(page(screen).dataset.restorePhase).toBe('preview');
    expect(text(screen.root)).toContain('Backup file “eng-trainer-backup-20261125-140322.json”');
    expect(text(screen.root)).toContain('The file passed every check: its form, the digest of each part and every record.');
    expect(text(section(screen, V3))).toContain('3 learned items');
    expect(destination(screen, V3)).toBe('empty');
    expect(text(section(screen, V3))).toContain('Can be recovered into this version in this browser: it holds no learning data here.');
    expect(text(recoverButton(screen, V3))).toBe('Recover into this version…');
    // Each of the other two parts has its own destination. The stable version has no storage here yet:
  // nothing but the stable version itself creates it, so that part waits.
    expect(destination(screen, V2)).toBe('absent');
    expect(text(section(screen, V2))).toContain('Cannot be recovered yet. The stable version has no storage for its data in this browser. It creates that storage when it is opened, and nothing else may. Open the stable version once, change nothing there, then come back and check again.');
    expect(recoverButton(screen, V2)).toBeNull();
    const first = section(screen, V2)!.querySelector<HTMLAnchorElement>('[data-backup-open-first]')!;
    expect([first.getAttribute('href'), first.getAttribute('target'), first.getAttribute('rel'), text(first)]).toEqual(['/eng-trainer/', '_blank', 'noopener', 'Open the stable version']);
    expect(text(section(screen, V2)!.querySelector('[data-backup-action="check-again"]'))).toBe('Check again');
    expect(destination(screen, V1)).toBe('empty');
    expect(text(section(screen, V1))).toContain('Can be recovered into the previous version (v1) in this browser: it holds no learning data here.');
    expect(text(section(screen, V1))).toContain('1 flashcard deck with a saved place. Theme: dark.');
    expect(text(recoverButton(screen, V1))).toBe('Recover into the previous version (v1)…');

    // The look read the two records of the first version. The stable database does not exist, so it was not opened.
    expect(open.mock.calls.map(([name]) => name)).toEqual([V3_NAME]);
    expect(getItem.mock.calls.map(([key]) => key)).toEqual([V1_STATE_KEY, V1_THEME_KEY]);
    expect(setItem).not.toHaveBeenCalled();
    expect(transactions.mock.calls.map(([, mode]) => mode)).toEqual(['readonly']);
    vi.restoreAllMocks();
    expect(await snapshot(V3_NAME)).toEqual(before);
    expect(await databaseNames()).toEqual([V3_NAME]);
    expect(window.localStorage.length).toBe(0);
  });

  it('reads the storage of another product only for a part that the file holds', async () => {
    await seedExperimental();
    const made = await openScreen();
    await makeBackup(made);
    const content = String(downloads[downloads.length - 1].parts[0]);
    made.close();
    screens = [];
    resetDatabase();
    await seedStable();
    seedLegacy();
    const screen = await openScreen();
    const open = vi.spyOn(indexedDB, 'open');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');

    await choose(screen, 'only-this-version.json', content);

    expect(section(screen, V2)).toBeNull();
    expect(section(screen, V1)).toBeNull();
    expect(open.mock.calls.map(([name]) => name)).toEqual([V3_NAME]);
    expect(getItem).not.toHaveBeenCalled();
  });

  it('recovers after an explicit confirmation, reports the result and shows the recovered state at once', async () => {
    const content = await backupThenLoss();
    const screen = await openScreen();
    await choose(screen, 'my-backup.json', content);

    recover(screen, V3);
    await waitFor(() => text(document.querySelector('dialog.dialog')).includes('This writes the data of this version'), 'the confirmation');
    const dialog = document.querySelector<HTMLDialogElement>('dialog.dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(text(dialog)).toContain('Recover into this version?');
    expect(text(dialog)).toContain('from “my-backup.json” into this browser: 3 learned items');
    expect(text(dialog)).toContain('Your preferences in this version, such as the theme and the list sizes, are replaced by those of the backup.');
    expect(text(dialog)).toContain('The stable version and the previous version (v1) are not changed.');
    expect(text(dialog)).toContain('Close other tabs of this application first.');
    // Nothing was written by opening the confirmation.
    expect((await snapshot(V3_NAME)).stores.progress).toEqual({});

    click(screen, 'confirm-recover');
    await waitFor(() => { screen.flush(); return screen.root.querySelector('[data-backup-outcome]') !== null; }, 'the result');

    expect(screen.root.querySelector('[data-backup-outcome]')!.getAttribute('data-backup-outcome')).toBe('success');
    expect(text(screen.root)).toContain('Recovery complete');
    expect(text(screen.root)).toContain('The data of this version from “my-backup.json” is in this browser again: 3 learned items');
    expect(text(screen.root)).toContain('It was read back after writing and matches the backup file.');
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(screen.root.querySelector('[data-backup-empty-profile]')).toBeNull();
    expect(screen.root.querySelector('[data-backup-open]')).toBeNull();
    expect((await snapshot(V3_NAME)).stores).toEqual({ ...syntheticStores(3), meta: SYNTHETIC_META });
    const { get } = await import('svelte/store');
    expect(get(screen.state.progress).learnedPhrases).toEqual(syntheticStores(3).progress.learnedPhrases);
    // Only this version was written.
    expect(await databaseNames()).toEqual([V3_NAME]);
    expect(window.localStorage.length).toBe(0);

    // The file stays open for its other parts. The recovered part says so and is not offered again.
    await waitFor(() => { screen.flush(); return destination(screen, V3) === 'recovered'; }, 'the recovered part');
    expect(page(screen).dataset.restorePhase).toBe('preview');
    expect(text(section(screen, V3))).toContain('Recovered from this file: this version holds this data in this browser now.');
    expect(recoverButton(screen, V3)).toBeNull();
    expect(destination(screen, V2)).toBe('absent');
    expect(recoverButton(screen, V1)).not.toBeNull();
  });

  it('changes nothing when the confirmation is cancelled', async () => {
    const content = await backupThenLoss();
    await stableOpenedOnce();
    const screen = await openScreen();
    const before = await snapshot(V3_NAME);
    const stable = await snapshot(V2_NAME);
    await choose(screen, 'my-backup.json', content);

    for (const product of [V3, V2, V1]) {
      recover(screen, product);
      expect(document.querySelector('dialog.dialog')!.getAttribute('data-backup-confirm')).toBe(product);
      click(screen, 'cancel-recover');
      expect(document.querySelector('dialog.dialog')!.hasAttribute('open')).toBe(false);
    }

    expect(page(screen).dataset.restorePhase).toBe('preview');
    expect(screen.root.querySelector('[data-backup-outcome]')).toBeNull();
    expect(await snapshot(V3_NAME)).toEqual(before);
    expect(await snapshot(V2_NAME)).toEqual(stable);
    expect(window.localStorage.length).toBe(0);
  });

  it('keeps the confirmation open and ignores Cancel and Escape while the recovery runs', async () => {
    const content = await backupThenLoss();
    await stableOpenedOnce();
    const screen = await openScreen();
    await choose(screen, 'my-backup.json', content);
    recover(screen, V3);

    // Hold the first write of the recovery, so the running state can be looked at.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const settled = screen.persistence.persistenceSettled;
    vi.spyOn(screen.persistence, 'persistenceSettled').mockImplementation(async () => { await held; return settled(); });

    click(screen, 'confirm-recover');
    await new Promise((resolve) => setTimeout(resolve, 20));
    screen.flush();
    const dialog = document.querySelector<HTMLDialogElement>('dialog.dialog')!;
    expect(page(screen).dataset.restorePhase).toBe('restoring');
    expect(action(screen, 'confirm-recover')!.disabled).toBe(true);
    expect(action(screen, 'cancel-recover')!.disabled).toBe(true);
    expect(text(action(screen, 'confirm-recover'))).toBe('Recovering…');
    expect(screen.root.querySelector<HTMLInputElement>('#backup-file')!.disabled).toBe(true);
    // No other part can be started meanwhile.
    expect(recoverButton(screen, V2)!.disabled).toBe(true);
    expect(recoverButton(screen, V1)!.disabled).toBe(true);

    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    action(screen, 'cancel-recover')!.click();
    action(screen, 'confirm-recover')!.click();
    recoverButton(screen, V2)!.click();
    screen.flush();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.getAttribute('data-backup-confirm')).toBe(V3);

    release();
    await waitFor(() => { screen.flush(); return screen.root.querySelector('[data-backup-outcome="success"]') !== null; }, 'the result');
    expect(dialog.hasAttribute('open')).toBe(false);
    expect((await snapshot(V3_NAME)).stores.meta).toEqual(SYNTHETIC_META);
    // The click on the other part, made while this one was running, started nothing.
    expect((await snapshot(V2_NAME)).stores.progress).toEqual({});
  });

  it('offers no recovery into a profile that holds learning data, and says how to proceed', async () => {
    const content = await backupThenLoss();
    const stores = syntheticStores(2);
    await seedExperimental({ progress: { learnedPhrases: ['phrase-kept'] }, learnPasses: stores.learnPasses });
    const before = await snapshot(V3_NAME);
    const screen = await openScreen();
    expect(screen.root.querySelector('[data-backup-empty-profile]')).toBeNull();

    await choose(screen, 'my-backup.json', content);

    expect(destination(screen, V3)).toBe('occupied');
    expect(text(section(screen, V3))).toContain('Cannot be recovered now. This version already holds learning data in this browser: 1 learned, hidden or Focus item and 1 Learn pass. A recovery never overwrites data.');
    expect(text(section(screen, V3))).toContain('make a backup of the present data first, then choose Reset learning progress in Settings and remove your collections');
    expect(recoverButton(screen, V3)).toBeNull();
    expect(await snapshot(V3_NAME)).toEqual(before);
  });

  it('reports a refusal that happens at the last moment, with nothing recovered', async () => {
    const content = await backupThenLoss();
    const screen = await openScreen();
    await choose(screen, 'my-backup.json', content);
    recover(screen, V3);

    // Another tab saves learning data after the preview and before the confirmation.
    const { openDB } = await import('idb');
    const otherTab = await openDB(V3_NAME);
    await otherTab.put('progress', ['phrase-learned-in-another-tab'], 'learnedPhrases');
    otherTab.close();

    click(screen, 'confirm-recover');
    await waitFor(() => { screen.flush(); return screen.root.querySelector('[data-backup-outcome]') !== null; }, 'the result');

    expect(screen.root.querySelector('[data-backup-outcome]')!.getAttribute('data-backup-outcome')).toBe('error');
    expect(text(screen.root)).toContain('Nothing was recovered');
    expect(text(screen.root)).toContain('A recovery never overwrites data, so nothing was changed.');
    // The preview now shows the destination as it is, and offers no second attempt.
    await waitFor(() => { screen.flush(); return destination(screen, V3) === 'occupied'; }, 'the destination to be judged again');
    expect(recoverButton(screen, V3)).toBeNull();
    expect((await snapshot(V3_NAME)).stores.progress).toEqual({ learnedPhrases: ['phrase-learned-in-another-tab'] });
  });

  it('refuses a file that is not a complete, unchanged backup, and changes nothing', async () => {
    const content = await backupThenLoss();
    const screen = await openScreen();
    const before = await snapshot(V3_NAME);
    const cases: [string, string | Uint8Array, string, string][] = [
      ['cut short', content.slice(0, Math.floor(content.length / 2)), 'This file is cut short or damaged', 'not complete JSON'],
      ['one value changed', content.replace('"phrase-301"', '"phrase-999"'), 'This backup is damaged or was changed', 'does not match its digest'],
      ['one value of the stable part changed', content.replace('"phrase-201"', '"phrase-999"'), 'This backup is damaged or was changed', 'The section "stable-v2" does not match its digest'],
      ['a newer format', content.replace('"version": 1', '"version": 2'), 'This backup needs another version of the application', 'made by a newer version'],
      ['a vocabulary export', '{"format":"eng-trainer-vocabulary","version":1,"collection":{},"entries":[]}', 'This file is not a backup', 'import it on the Collections screen'],
      ['an unknown member', content.replace('"format": "eng-trainer-backup",', '"format": "eng-trainer-backup", "note": "x",'), 'This file does not have the form of a backup', 'unknown: note'],
      ['not text', new Uint8Array([0xff, 0xfe, 0x00]), 'This file is not a backup', 'not UTF-8 text'],
      ['empty', '', 'This file is empty', 'The file is empty.']
    ];
    for (const [name, bytes, title, detail] of cases) {
      await choose(screen, `${name}.json`, bytes);
      expect(text(screen.root), name).toContain(title);
      expect(text(screen.root.querySelector('[data-backup-problem]')), name).toContain(detail);
      expect(text(screen.root), name).toContain('Nothing was changed.');
      expect(page(screen).dataset.restorePhase, name).toBe('idle');
      expect(action(screen, 'recover'), name).toBeNull();
    }
    expect(await snapshot(V3_NAME)).toEqual(before);
    expect(await databaseNames()).toEqual([V3_NAME]);
    expect(window.localStorage.length).toBe(0);
  });

  it('refuses a file from its size before reading it', async () => {
    const screen = await openScreen();
    const input = screen.root.querySelector<HTMLInputElement>('#backup-file')!;
    const arrayBuffer = vi.fn();
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'huge.json', size: 33 * 1024 * 1024, arrayBuffer }] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => { screen.flush(); return screen.root.querySelector('[data-backup-problem]') !== null; }, 'the refusal');
    expect(text(screen.root)).toContain('This file is too large to be a backup');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('offers no recovery of this version while the session runs without saving', async () => {
    const content = await backupThenLoss();
    const screen = await openScreen({ storage: false });
    await choose(screen, 'my-backup.json', content);

    expect(destination(screen, V3)).toBe('unavailable');
    expect(text(section(screen, V3))).toContain('Saving is switched off in this session');
    expect(recoverButton(screen, V3)).toBeNull();
    expect(await databaseNames()).toEqual([]);
  });

  it('closes a file without changing anything', async () => {
    const content = await backupThenLoss();
    const screen = await openScreen();
    await choose(screen, 'my-backup.json', content);
    click(screen, 'close-file');
    expect(page(screen).dataset.restorePhase).toBe('idle');
    expect(section(screen, V3)).toBeNull();
    expect(action(screen, 'recover')).toBeNull();
    expect((await snapshot(V3_NAME)).stores.progress).toEqual({});
    expect(await databaseNames()).toEqual([V3_NAME]);
    expect(window.localStorage.length).toBe(0);
  });
});

describeExperimental('Backup screen: recovering the stable version and the previous version (ENG-V3-R1A-RC1)', () => {
  /** Confirms the open confirmation and waits for the result. */
  async function confirm(screen: Screen): Promise<HTMLElement> {
    click(screen, 'confirm-recover');
    await waitFor(() => { screen.flush(); return screen.root.querySelector('[data-backup-outcome]') !== null && page(screen).dataset.restorePhase !== 'restoring'; }, 'the result');
    return screen.root.querySelector<HTMLElement>('[data-backup-outcome]')!;
  }
  const dialogText = (): string => text(document.querySelector('dialog.dialog'));
  /** The warning that every confirmation of a recovery of v1 carries, the ordinary one and the completion. */
  const OTHER_TABS_OF_V1 = 'Close every tab of the previous version first. A tab that stays open could later save its older state over the recovered data.';

  it('waits for the stable version to create its own storage, creates none itself, and recovers after a confirmation that names it', async () => {
    const content = await backupThenLoss();
    const screen = await openScreen();
    const own = await snapshot(V3_NAME);
    await choose(screen, 'my-backup.json', content);
    expect(destination(screen, V2)).toBe('absent');
    expect(recoverButton(screen, V2)).toBeNull();

    // Looking again changes nothing while the stable version was not opened.
    click(screen, 'check-again');
    await new Promise((resolve) => setTimeout(resolve, 30));
    screen.flush();
    expect(destination(screen, V2)).toBe('absent');
    expect(await databaseNames()).toEqual([V3_NAME]);

    // The learner opens the stable version once. It creates its storage, empty.
    await stableOpenedOnce();
    const open = vi.spyOn(indexedDB, 'open');
    const create = vi.spyOn(IDBDatabase.prototype, 'createObjectStore');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    click(screen, 'check-again');
    await waitFor(() => { screen.flush(); return destination(screen, V2) === 'empty'; }, 'the destination to be looked at again');
    expect(text(section(screen, V2))).toContain('Can be recovered into the stable version in this browser: it holds no learning data here.');
    expect(text(recoverButton(screen, V2))).toBe('Recover into the stable version…');

    recover(screen, V2);
    expect(document.querySelector('dialog.dialog')!.getAttribute('data-backup-confirm')).toBe(V2);
    expect(dialogText()).toContain('Recover into the stable version?');
    expect(dialogText()).toContain('This writes the data of the stable version from “my-backup.json” into the storage of the stable version in this browser: 3 learned items');
    expect(dialogText()).toContain('The stable version holds no learning data here, so nothing is overwritten.');
    expect(dialogText()).toContain('Your preferences in the stable version, such as the theme and the list sizes, are replaced by those of the backup.');
    expect(dialogText()).toContain('This version and the previous version (v1) are not changed.');
    expect(dialogText()).toContain('Close every tab of the stable version first.');
    // Opening the confirmation wrote nothing.
    expect((await snapshot(V2_NAME)).stores.progress).toEqual({});

    const outcome = await confirm(screen);

    expect(outcome.getAttribute('data-backup-outcome')).toBe('success');
    expect(text(screen.root)).toContain('Recovery complete');
    expect(text(outcome)).toContain('The data of the stable version from “my-backup.json” is in this browser again: 3 learned items');
    expect(text(outcome)).toContain('It was read back after writing and matches the backup file.');
    const link = screen.root.querySelector<HTMLAnchorElement>('[data-backup-open]')!;
    expect([link.getAttribute('href'), text(link)]).toEqual(['/eng-trainer/', 'Open the stable version']);
    expect(await snapshot(V2_NAME)).toEqual({ version: 2, stores: syntheticStores(2) });
    // No request named a version, no store was created, and no key-value record was written.
    expect(open.mock.calls.filter(([, version]) => version !== undefined)).toEqual([]);
    expect(create).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(await snapshot(V3_NAME)).toEqual(own);
    expect(window.localStorage.length).toBe(0);

    await waitFor(() => { screen.flush(); return destination(screen, V2) === 'recovered'; }, 'the recovered part');
    expect(text(section(screen, V2))).toContain('Recovered from this file: the stable version holds this data in this browser now.');
    expect(recoverButton(screen, V2)).toBeNull();
    expect(recoverButton(screen, V3)).not.toBeNull();
  });

  it('recovers the stable version into the storage that it left empty, and says that nothing is overwritten', async () => {
    const content = await backupThenLoss();
    await seedStable({ progress: { learnedPhrases: [] }, settings: { theme: 'light', wordPageSize: 20 } });
    const screen = await openScreen();
    await choose(screen, 'my-backup.json', content);

    expect(destination(screen, V2)).toBe('empty');
    expect(text(section(screen, V2))).toContain('Can be recovered into the stable version in this browser: it holds no learning data here.');
    recover(screen, V2);
    expect(dialogText()).toContain('The stable version holds no learning data here, so nothing is overwritten.');

    expect((await confirm(screen)).getAttribute('data-backup-outcome')).toBe('success');
    expect(await snapshot(V2_NAME)).toEqual({ version: 2, stores: syntheticStores(2) });
  });

  it('offers no recovery of the stable version where it holds learning data, and says how to proceed', async () => {
    const content = await backupThenLoss();
    await seedStable({ progress: { learnedPhrases: ['phrase-kept'] } });
    const before = await snapshot(V2_NAME);
    const screen = await openScreen();
    await choose(screen, 'my-backup.json', content);

    expect(destination(screen, V2)).toBe('occupied');
    expect(text(section(screen, V2))).toContain('Cannot be recovered now. The stable version already holds learning data in this browser: 1 learned, hidden or Focus item. A recovery never overwrites data.');
    expect(text(section(screen, V2))).toContain('then open the stable version, choose Reset learning progress in Settings and remove your collections');
    expect(recoverButton(screen, V2)).toBeNull();
    expect(section(screen, V2)!.querySelector('[data-backup-action="check-again"]')).not.toBeNull();
    expect(section(screen, V2)!.querySelector('[data-backup-open-first]')).toBeNull();
    // The other parts are still offered: each product is judged on its own.
    expect(recoverButton(screen, V3)).not.toBeNull();
    expect(recoverButton(screen, V1)).not.toBeNull();
    expect(await snapshot(V2_NAME)).toEqual(before);
  });

  it('offers no recovery of the stable version over a storage schema that it does not know', async () => {
    const content = await backupThenLoss();
    await seedStable({}, 3);
    const before = await snapshot(V2_NAME);
    const screen = await openScreen();
    await choose(screen, 'my-backup.json', content);

    expect(destination(screen, V2)).toBe('unavailable');
    expect(text(section(screen, V2))).toContain('Cannot be recovered now. The saved data of the stable version has a storage schema (version 3) that this version of the application does not know. It is never changed or upgraded from here.');
    expect(recoverButton(screen, V2)).toBeNull();
    expect(await snapshot(V2_NAME)).toEqual(before);
  });

  it('reports a refusal of the stable version at the last moment, with nothing recovered', async () => {
    const content = await backupThenLoss();
    await seedStable({ settings: { theme: 'light' } });
    const screen = await openScreen();
    await choose(screen, 'my-backup.json', content);
    recover(screen, V2);

    // A tab of the stable version saves learning data after the preview and before the confirmation.
    const { openDB } = await import('idb');
    const otherTab = await openDB(V2_NAME);
    await otherTab.put('progress', ['phrase-learned-in-another-tab'], 'learnedPhrases');
    otherTab.close();
    const before = await snapshot(V2_NAME);

    const outcome = await confirm(screen);

    expect(outcome.getAttribute('data-backup-outcome')).toBe('error');
    expect(text(screen.root)).toContain('Nothing was recovered');
    expect(text(outcome)).toContain('The stable version already holds learning data in this browser. A recovery never overwrites data, so nothing was changed.');
    expect(screen.root.querySelector('[data-backup-open]')).toBeNull();
    await waitFor(() => { screen.flush(); return destination(screen, V2) === 'occupied'; }, 'the destination to be judged again');
    expect(recoverButton(screen, V2)).toBeNull();
    expect(await snapshot(V2_NAME)).toEqual(before);
  });

  it('recovers the previous version after a confirmation that names it and explains its two records', async () => {
    const content = await backupThenLoss();
    const screen = await openScreen();
    const own = await snapshot(V3_NAME);
    await choose(screen, 'my-backup.json', content);
    const open = vi.spyOn(indexedDB, 'open');

    recover(screen, V1);
    expect(dialogText()).toContain('Recover into the previous version (v1)?');
    expect(dialogText()).toContain('This writes the data of the previous version (v1) from “my-backup.json” into the storage of the previous version in this browser: 2 learned items, 1 hidden item, 1 Focus item, 1 Learn pass and 1 flashcard deck with a saved place. Theme: dark.');
    expect(dialogText()).toContain('The previous version holds no learning data here, so nothing is overwritten.');
    expect(dialogText()).toContain('a browser cannot write them in one step. If the second one cannot be written, this screen says so, and the recovery can be completed later.');
    expect(dialogText()).toContain(OTHER_TABS_OF_V1);
    expect(dialogText()).toContain('This version and the stable version are not changed.');
    expect(window.localStorage.length).toBe(0);

    const outcome = await confirm(screen);

    expect(outcome.getAttribute('data-backup-outcome')).toBe('success');
    expect(text(outcome)).toContain('The data of the previous version (v1) from “my-backup.json” is in this browser again');
    const link = screen.root.querySelector<HTMLAnchorElement>('[data-backup-open]')!;
    expect([link.getAttribute('href'), text(link)]).toEqual(['/eng-trainer/v1/', 'Open the previous version (v1)']);
    expect(window.localStorage.getItem(V1_STATE_KEY)).toBe(V1_STATE);
    expect(window.localStorage.getItem(V1_THEME_KEY)).toBe('dark');
    expect(window.localStorage.length).toBe(2);
    // No database was opened for it, and none was created.
    expect(open.mock.calls.map(([name]) => name).filter((name) => name !== V3_NAME)).toEqual([]);
    vi.restoreAllMocks();
    expect(await snapshot(V3_NAME)).toEqual(own);
    expect(await databaseNames()).toEqual([V3_NAME]);
    await waitFor(() => { screen.flush(); return destination(screen, V1) === 'recovered'; }, 'the recovered part');
    expect(recoverButton(screen, V1)).toBeNull();
  });

  it('never reports an incomplete recovery of the previous version as a success, and completes it after a second confirmation', async () => {
    const content = await backupThenLoss();
    const screen = await openScreen();
    await choose(screen, 'my-backup.json', content);
    const setItem = Storage.prototype.setItem;
    const written: string[] = [];
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === V1_THEME_KEY) throw new DOMException('synthetic failure', 'UnknownError');
      setItem.call(this, key, value);
      written.push(key);
    });

    recover(screen, V1);
    const outcome = await confirm(screen);
    vi.restoreAllMocks();

    expect(outcome.getAttribute('data-backup-outcome')).toBe('error');
    expect(text(screen.root)).toContain('The recovery is not complete');
    expect(text(screen.root)).not.toContain('Recovery complete');
    expect(text(outcome)).toContain('Its learning data is in this browser and was checked. Its theme could not be written.');
    expect(written).toEqual([V1_STATE_KEY]);
    expect(window.localStorage.getItem(V1_THEME_KEY)).toBeNull();

    // The destination is judged again: the learning data is the backup's, so only the theme is offered.
    await waitFor(() => { screen.flush(); return destination(screen, V1) === 'partial'; }, 'the partly recovered destination');
    expect(text(section(screen, V1))).toContain('Partly recovered. The learning data of this backup is already in the previous version (v1) in this browser, unchanged. Its theme is not. You can complete the recovery.');
    expect(text(recoverButton(screen, V1))).toBe('Complete the recovery of the previous version (v1)…');

    recover(screen, V1);
    expect(dialogText()).toContain('Complete the recovery of the previous version (v1)?');
    expect(dialogText()).toContain('is already in this browser, and it is unchanged. This writes only what is still missing: the theme (dark).');
    expect(dialogText()).toContain('The learning data is not written again.');
    expect(dialogText()).toContain(OTHER_TABS_OF_V1);
    expect(text(action(screen, 'confirm-recover'))).toBe('Complete the recovery');
    const second = vi.spyOn(Storage.prototype, 'setItem');

    expect((await confirm(screen)).getAttribute('data-backup-outcome')).toBe('success');

    expect(second.mock.calls).toEqual([[V1_THEME_KEY, 'dark']]);
    expect(window.localStorage.getItem(V1_STATE_KEY)).toBe(V1_STATE);
    expect(window.localStorage.getItem(V1_THEME_KEY)).toBe('dark');
    await waitFor(() => { screen.flush(); return destination(screen, V1) === 'recovered'; }, 'the recovered part');
  });

  it('offers the completion from the file alone, in a session that knows nothing of the interrupted one', async () => {
    const content = await backupThenLoss();
    // What a tab that was closed between the two writes leaves behind.
    window.localStorage.setItem(V1_STATE_KEY, V1_STATE);
    const screen = await openScreen();

    await choose(screen, 'my-backup.json', content);

    expect(destination(screen, V1)).toBe('partial');
    expect(text(recoverButton(screen, V1))).toBe('Complete the recovery of the previous version (v1)…');

    // This session goes straight to the completion: its confirmation is the only one the learner sees,
    // so it carries the same warning about other tabs as the ordinary one.
    recover(screen, V1);
    expect(document.querySelector('dialog.dialog')!.getAttribute('data-backup-confirm')).toBe(V1);
    expect(dialogText()).toContain('Complete the recovery of the previous version (v1)?');
    expect(dialogText()).toContain('This writes only what is still missing: the theme (dark).');
    expect(dialogText()).toContain(OTHER_TABS_OF_V1);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    expect((await confirm(screen)).getAttribute('data-backup-outcome')).toBe('success');

    expect(setItem.mock.calls).toEqual([[V1_THEME_KEY, 'dark']]);
    expect(window.localStorage.getItem(V1_STATE_KEY)).toBe(V1_STATE);
  });

  it('offers no completion once the previous version has changed the recovered data', async () => {
    const content = await backupThenLoss();
    const used = JSON.stringify({ ...JSON.parse(V1_STATE), learnedPhrases: ['phrase-101', 'phrase-102', 'phrase-learned-since'] });
    window.localStorage.setItem(V1_STATE_KEY, used);
    const screen = await openScreen();

    await choose(screen, 'my-backup.json', content);

    expect(destination(screen, V1)).toBe('occupied');
    expect(text(section(screen, V1))).toContain('Cannot be recovered now. The previous version (v1) already holds learning data in this browser: 5 learned, hidden or Focus items, 1 Learn pass and 1 flashcard deck with a saved place. A recovery never overwrites data.');
    expect(text(section(screen, V1))).toContain('then open the previous version and choose Reset progress');
    expect(recoverButton(screen, V1)).toBeNull();
    expect(window.localStorage.getItem(V1_STATE_KEY)).toBe(used);
  });

  it('has nothing to offer where the previous version already holds exactly the records of the backup', async () => {
    const content = await backupThenLoss();
    seedLegacy();
    const screen = await openScreen();

    await choose(screen, 'my-backup.json', content);

    expect(destination(screen, V1)).toBe('identical');
    expect(text(section(screen, V1))).toContain('Nothing to recover: the previous version (v1) already holds exactly this data in this browser.');
    expect(recoverButton(screen, V1)).toBeNull();
  });

  it('shows a backup without data of this version, and recovers its two parts', async () => {
    await seedStable();
    seedLegacy();
    const source = await import('./exportBackup');
    const { sections } = await source.collectSections();
    const { text: content } = await source.composeBackup(sections);
    resetDatabase();
    window.localStorage.clear();
    await stableOpenedOnce();
    const screen = await openScreen();

    await choose(screen, 'others.json', content);

    expect(section(screen, V3)).toBeNull();
    expect(recoverButton(screen, V3)).toBeNull();
    expect(screen.root.querySelectorAll('[data-backup-action="recover"]')).toHaveLength(2);
    expect((await snapshot(V2_NAME)).stores.progress).toEqual({});
    expect(window.localStorage.length).toBe(0);

    recover(screen, V2);
    expect((await confirm(screen)).getAttribute('data-backup-outcome')).toBe('success');
    recover(screen, V1);
    expect((await confirm(screen)).getAttribute('data-backup-outcome')).toBe('success');

    expect(await snapshot(V2_NAME)).toEqual({ version: 2, stores: syntheticStores(2) });
    expect(window.localStorage.getItem(V1_STATE_KEY)).toBe(V1_STATE);
  });

  it('recovers all three versions from one file, one after the other, after the browser lost everything', async () => {
    const content = await backupThenLoss();
    expect(await databaseNames()).toEqual([]);
    expect(window.localStorage.length).toBe(0);
    await stableOpenedOnce();
    const screen = await openScreen();
    await choose(screen, 'my-backup.json', content);

    for (const product of [V3, V2, V1]) {
      recover(screen, product);
      expect((await confirm(screen)).getAttribute('data-backup-outcome'), product).toBe('success');
      await waitFor(() => { screen.flush(); return destination(screen, product) === 'recovered'; }, `the recovered part ${product}`);
    }

    expect((await snapshot(V3_NAME)).stores).toEqual({ ...syntheticStores(3), meta: SYNTHETIC_META });
    expect(await snapshot(V2_NAME)).toEqual({ version: 2, stores: syntheticStores(2) });
    expect(window.localStorage.getItem(V1_STATE_KEY)).toBe(V1_STATE);
    expect(window.localStorage.getItem(V1_THEME_KEY)).toBe('dark');
    expect(await databaseNames()).toEqual([V2_NAME, V3_NAME]);
    expect(window.localStorage.length).toBe(2);
    expect(screen.root.querySelectorAll('[data-backup-action="recover"]')).toHaveLength(0);
    expect(page(screen).dataset.restorePhase).toBe('preview');

    // Chosen again, the same file finds its own data in every destination, offers nothing, and gives no advice to reset.
    await choose(screen, 'my-backup.json', content);
    expect([destination(screen, V3), destination(screen, V2), destination(screen, V1)]).toEqual(['identical', 'identical', 'identical']);
    expect(text(section(screen, V3))).toContain('Nothing to recover: this version already holds exactly this data in this browser.');
    expect(text(section(screen, V2))).toContain('Nothing to recover: the stable version already holds exactly this data in this browser.');
    expect(text(screen.root)).not.toContain('Reset');
    expect(screen.root.querySelectorAll('[data-backup-action="recover"]')).toHaveLength(0);
  });

  it('recovers the other versions also while this session runs without saving, and leaves this version alone', async () => {
    const content = await backupThenLoss();
    await stableOpenedOnce();
    const screen = await openScreen({ storage: false });
    await choose(screen, 'my-backup.json', content);

    recover(screen, V2);
    expect((await confirm(screen)).getAttribute('data-backup-outcome')).toBe('success');

    expect(await snapshot(V2_NAME)).toEqual({ version: 2, stores: syntheticStores(2) });
    expect(await databaseNames()).toEqual([V2_NAME]);
    expect(destination(screen, V3)).toBe('unavailable');
  });
});

describeExperimental('Backup screen: a recovery that was written but could not be checked (ENG-V3-R1A-RC2)', () => {
  async function confirm(screen: Screen): Promise<HTMLElement> {
    click(screen, 'confirm-recover');
    await waitFor(() => { screen.flush(); return screen.root.querySelector('[data-backup-outcome]') !== null && page(screen).dataset.restorePhase !== 'restoring'; }, 'the result');
    return screen.root.querySelector<HTMLElement>('[data-backup-outcome]')!;
  }
  /** The fault of the review: the first listing of the databases after the confirmation is refused, once. */
  const refuseTheNextListing = () => vi.spyOn(indexedDB, 'databases').mockRejectedValueOnce(new DOMException('Injected post-commit read failure', 'UnknownError'));
  const button = (screen: Screen, label: string): HTMLButtonElement | undefined => [...screen.root.querySelectorAll('button')].find((item) => text(item) === label);

  it('this version: says that the data was written, asks for a reload, and saves nothing of the old state in the same tab', async () => {
    const content = await backupThenLoss();
    const screen = await openScreen();
    await choose(screen, 'my-backup.json', content);
    recover(screen, V3);
    refuseTheNextListing();

    const outcome = await confirm(screen);
    vi.restoreAllMocks();

    expect(outcome.getAttribute('data-backup-outcome')).toBe('error');
    expect(text(screen.root)).toContain('Written, but not checked');
    expect(text(screen.root)).not.toContain('Nothing was recovered');
    expect(text(screen.root)).not.toContain('Recovery complete');
    expect(text(outcome)).toContain('The data was written, but it could not be read back to check it.');
    expect(text(outcome)).toContain('This tab saves nothing until the page is reloaded, so that nothing can be written over the recovered data. Reload the page.');
    expect(button(screen, 'Reload page')).toBeDefined();
    // Nothing on the screen tells the learner to reset or remove what was just recovered.
    expect(text(screen.root)).not.toContain('Reset learning progress');
    expect(text(screen.root)).not.toContain('remove your collections');
    expect(page(screen).dataset.restorePhase).toBe('idle');
    expect(action(screen, 'recover')).toBeNull();
    const { get } = await import('svelte/store');
    expect(get(screen.persistence.saveStatus).state).toBe('disabled');
    expect((await snapshot(V3_NAME)).stores).toEqual({ ...syntheticStores(3), meta: SYNTHETIC_META });

    // The learner goes on in the same tab, without a reload: the tab still shows the state from before.
    expect(get(screen.state.progress).learnedPhrases).toEqual([]);
    screen.state.settings.setActivePage('phrases');
    screen.state.progress.toggleLearnedPhrase('phrase-001');
    screen.state.progress.toggleFavorite('phrase', 'phrase-002');
    await screen.persistence.persistenceSettled();
    screen.flush();

    expect((await snapshot(V3_NAME)).stores).toEqual({ ...syntheticStores(3), meta: SYNTHETIC_META });
    expect((await snapshot(V3_NAME)).stores.progress.learnedPhrases).toEqual(syntheticStores(3).progress.learnedPhrases);
  });

  it('this version: a file chosen in the detached tab is not offered, and the reason is the reload', async () => {
    const content = await backupThenLoss();
    const screen = await openScreen();
    await choose(screen, 'my-backup.json', content);
    recover(screen, V3);
    refuseTheNextListing();
    await confirm(screen);
    vi.restoreAllMocks();

    await choose(screen, 'my-backup.json', content);

    expect(destination(screen, V3)).toBe('unavailable');
    expect(text(section(screen, V3))).toContain('Saving is switched off in this session, so nothing can be recovered now. Reload the page and try again.');
    expect(recoverButton(screen, V3)).toBeNull();
    expect(text(section(screen, V3))).not.toContain('Reset learning progress');
  });

  it('this version: a digest that does not match after the commit is written but not checked too', async () => {
    const content = await backupThenLoss();
    const screen = await openScreen();
    await choose(screen, 'my-backup.json', content);
    recover(screen, V3);
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      return put.call(this, key === 'hiddenWords' ? ['word-kept-wrongly'] : value, key);
    });

    const outcome = await confirm(screen);
    vi.restoreAllMocks();

    expect(text(screen.root)).toContain('Written, but not checked');
    expect(text(screen.root)).not.toContain('Nothing was recovered');
    expect(text(outcome)).toContain('The data was written, but reading it back gave another result.');
    expect(button(screen, 'Reload page')).toBeDefined();
    const { get } = await import('svelte/store');
    expect(get(screen.persistence.saveStatus).state).toBe('disabled');
    const written = await snapshot(V3_NAME);
    screen.state.progress.toggleLearnedPhrase('phrase-001');
    await screen.persistence.persistenceSettled();
    expect(await snapshot(V3_NAME)).toEqual(written);
  });

  it('this version: a write that was rolled back is still "Nothing was recovered", and the tab saves as before', async () => {
    const content = await backupThenLoss();
    const screen = await openScreen();
    await choose(screen, 'my-backup.json', content);
    recover(screen, V3);
    const put = IDBObjectStore.prototype.put;
    let calls = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      calls += 1;
      if (calls === 7) throw new DOMException('synthetic failure', 'UnknownError');
      return put.apply(this, args);
    });

    const outcome = await confirm(screen);
    vi.restoreAllMocks();

    expect(text(screen.root)).toContain('Nothing was recovered');
    expect(text(screen.root)).not.toContain('Written, but not checked');
    expect(text(outcome)).toContain('nothing was changed');
    expect(button(screen, 'Reload page')).toBeUndefined();
    const { get } = await import('svelte/store');
    expect(get(screen.persistence.saveStatus).state).toBe('idle');
    await waitFor(() => { screen.flush(); return destination(screen, V3) === 'empty'; }, 'the destination to be judged again');
    expect(recoverButton(screen, V3)).not.toBeNull();
    screen.state.progress.toggleLearnedPhrase('phrase-learned-after-the-failed-attempt');
    await screen.persistence.persistenceSettled();
    expect((await snapshot(V3_NAME)).stores.progress.learnedPhrases).toEqual(['phrase-learned-after-the-failed-attempt']);
  });

  it('the stable version: says that the data may already be written, links to the stable version, and gives no advice to reset', async () => {
    const content = await backupThenLoss();
    await stableOpenedOnce();
    const screen = await openScreen();
    await choose(screen, 'my-backup.json', content);
    recover(screen, V2);
    const listing = refuseTheNextListing();

    const outcome = await confirm(screen);

    expect(listing).toHaveBeenCalled();
    expect(outcome.getAttribute('data-backup-outcome')).toBe('error');
    expect(text(screen.root)).toContain('Written, but not checked');
    expect(text(screen.root)).not.toContain('Nothing was recovered');
    expect(text(outcome)).toContain('The data of the stable version was written, but it could not be read back to check it.');
    expect(text(outcome)).toContain('Do not reset anything because of this message. Check again here, or open the stable version and look at your data.');
    const link = screen.root.querySelector<HTMLAnchorElement>('[data-backup-open]')!;
    expect([link.getAttribute('href'), text(link)]).toEqual(['/eng-trainer/', 'Open the stable version']);
    expect(button(screen, 'Reload page')).toBeUndefined();
    vi.restoreAllMocks();
    expect(await snapshot(V2_NAME)).toEqual({ version: 2, stores: syntheticStores(2) });

    // The screen looks at the destination again. This time the read works, and the data is seen to be the backup's.
    await waitFor(() => { screen.flush(); return destination(screen, V2) === 'identical'; }, 'the destination to be compared with the file');
    expect(text(section(screen, V2))).toContain('Nothing to recover: the stable version already holds exactly this data in this browser.');
    expect(text(section(screen, V2))).not.toContain('Reset learning progress');
    expect(text(section(screen, V2))).not.toContain('Cannot be recovered now');
    expect(recoverButton(screen, V2)).toBeNull();
    // This version was not touched, and it still saves.
    const { get } = await import('svelte/store');
    expect(get(screen.persistence.saveStatus).state).not.toBe('disabled');
  });

  it('the stable version: while the storage cannot be read, the part says written but not checked, and "Check again" settles it', async () => {
    const content = await backupThenLoss();
    await stableOpenedOnce();
    const screen = await openScreen();
    await choose(screen, 'my-backup.json', content);
    recover(screen, V2);
    // The storage refuses every listing from now on: the check after the write, and the look after that.
    vi.spyOn(indexedDB, 'databases').mockRejectedValue(new DOMException('Injected post-commit read failure', 'UnknownError'));

    await confirm(screen);
    await waitFor(() => { screen.flush(); return destination(screen, V2) === 'unverified'; }, 'the part that was written but not checked');

    const part = text(section(screen, V2));
    expect(part).toContain('Written, but not checked. The data of this part may already be in the stable version in this browser. Do not reset or remove anything because of this message. Open the stable version and look at your data, or check again: that compares the storage with this file.');
    expect(part).not.toContain('Reset learning progress');
    expect(part).not.toContain('Cannot be recovered now');
    expect(recoverButton(screen, V2)).toBeNull();
    const first = section(screen, V2)!.querySelector<HTMLAnchorElement>('[data-backup-open-first]')!;
    expect([first.getAttribute('href'), text(first)]).toEqual(['/eng-trainer/', 'Open the stable version']);

    // The storage answers again. The learner asks for another look, and the comparison with the file succeeds.
    vi.restoreAllMocks();
    section(screen, V2)!.querySelector<HTMLButtonElement>('[data-backup-action="check-again"]')!.click();
    await waitFor(() => { screen.flush(); return destination(screen, V2) === 'identical'; }, 'the comparison with the file');
    expect(text(section(screen, V2))).toContain('Nothing to recover: the stable version already holds exactly this data in this browser.');
    expect(await snapshot(V2_NAME)).toEqual({ version: 2, stores: syntheticStores(2) });
  });

  it('the stable version: data that reads back differently is never shown as data to reset', async () => {
    const content = await backupThenLoss();
    await stableOpenedOnce();
    const screen = await openScreen();
    await choose(screen, 'my-backup.json', content);
    recover(screen, V2);
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      return put.call(this, key === 'hiddenWords' ? ['word-kept-wrongly'] : value, key);
    });

    const outcome = await confirm(screen);
    vi.restoreAllMocks();

    expect(text(screen.root)).toContain('Written, but not checked');
    expect(text(outcome)).toContain('The data of the stable version was written, but reading it back gave another result.');
    await waitFor(() => { screen.flush(); return destination(screen, V2) === 'unverified'; }, 'the part that was written but not checked');
    expect(text(section(screen, V2))).toContain('Open the stable version and look at your data');
    expect(text(section(screen, V2))).not.toContain('Reset learning progress');
    expect(recoverButton(screen, V2)).toBeNull();
    // Looking again does not change the answer while the data differs from the file.
    section(screen, V2)!.querySelector<HTMLButtonElement>('[data-backup-action="check-again"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    screen.flush();
    expect(destination(screen, V2)).toBe('unverified');
  });
});

/**
 * ENG-V3-R1A-RC3, finding 3 of the review: how the running application hands over to a
 * recovery of this version, as the screen shows it. The rules themselves are tested in
 * handover.test.ts.
 */
describeExperimental('Backup screen: the handover to a recovery of this version (ENG-V3-R1A-RC3)', () => {
  const button = (screen: Screen, label: string): HTMLButtonElement | undefined => [...screen.root.querySelectorAll('button')].find((item) => text(item) === label);
  const holding = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-backup-holding]');

  async function result(screen: Screen): Promise<HTMLElement> {
    await waitFor(() => { screen.flush(); return screen.root.querySelector('[data-backup-outcome]') !== null && page(screen).dataset.restorePhase !== 'restoring'; }, 'the result');
    return screen.root.querySelector<HTMLElement>('[data-backup-outcome]')!;
  }

  /** Keeps the recovery's own transaction open, as a slow disk does, until `release` is called. */
  function holdTransaction(): { open: () => boolean; release: () => void } {
    let started = false;
    let released = false;
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      const request = put.apply(this, args);
      if (!started && this.transaction.objectStoreNames.length === 7) {
        started = true;
        const store = this;
        const keep = (): void => {
          if (!released) store.get('kept-open-by-the-test').onsuccess = keep;
        };
        keep();
      }
      return request;
    });
    return { open: () => started && !released, release: () => { released = true; } };
  }

  it('says while it recovers that this tab accepts no changes, accepts none, and saves again once the recovered state is shown', async () => {
    const content = await backupThenLoss();
    const screen = await openScreen();
    const { get } = await import('svelte/store');
    await choose(screen, 'my-backup.json', content);
    recover(screen, V3);
    expect(holding()).toBeNull();
    const transaction = holdTransaction();

    click(screen, 'confirm-recover');
    await waitFor(() => transaction.open() && screen.state.stateHeld(), 'the recovery to write');
    screen.flush();

    expect(text(holding())).toBe('Recovering… Until this has finished, this tab accepts no changes and keeps this screen open.');
    expect(holding()!.getAttribute('role')).toBe('status');
    expect(document.querySelector<HTMLDialogElement>('dialog.dialog')!.hasAttribute('open')).toBe(true);
    const before = get(screen.state.progress);
    screen.state.progress.toggleLearnedPhrase('phrase-of-the-old-state');
    screen.state.settings.setActivePage('phrases');
    expect(get(screen.state.progress)).toBe(before);
    expect(get(screen.state.settings).activePage).not.toBe('phrases');

    transaction.release();
    const outcome = await result(screen);
    vi.restoreAllMocks();

    expect(outcome.getAttribute('data-backup-outcome')).toBe('success');
    expect(holding()).toBeNull();
    expect(screen.state.stateHeld()).toBe(false);
    expect((await snapshot(V3_NAME)).stores).toEqual({ ...syntheticStores(3), meta: SYNTHETIC_META });
    screen.state.progress.toggleLearnedPhrase('phrase-learned-after-the-recovery');
    await screen.persistence.persistenceSettled();
    expect((await snapshot(V3_NAME)).stores.progress.learnedPhrases).toEqual([...(syntheticStores(3).progress.learnedPhrases as string[]), 'phrase-learned-after-the-recovery']);
  });

  it('a change that could not be saved: nothing is recovered, no reload is asked for, and the change keeps its way to be saved', async () => {
    const content = await backupThenLoss();
    const screen = await openScreen();
    const { get } = await import('svelte/store');
    await choose(screen, 'my-backup.json', content);
    recover(screen, V3);
    const before = await snapshot(V3_NAME);
    // A preference is changed, and the browser refuses to save it.
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('synthetic failure', 'UnknownError'); });
    screen.state.settings.setWordPageSize(20);
    await screen.persistence.persistenceSettled();
    put.mockRestore();
    expect(get(screen.persistence.saveStatus).state).toBe('error');

    click(screen, 'confirm-recover');
    const outcome = await result(screen);

    expect(outcome.getAttribute('data-backup-outcome')).toBe('error');
    expect(text(screen.root)).toContain('Nothing was recovered');
    expect(text(outcome)).toContain('The latest changes in this tab could not be saved, so nothing was recovered');
    expect(text(outcome)).toContain('They are still on screen. Choose “Try saving again” at the top of the page, then start the recovery again.');
    // The tab is not detached, so no reload is asked for: a reload would lose the change.
    expect(button(screen, 'Reload page')).toBeUndefined();
    expect(text(outcome)).not.toMatch(/reload/i);
    expect(await snapshot(V3_NAME)).toEqual(before);
    expect(get(screen.state.settings).wordPageSize).toBe(20);
    expect(get(screen.persistence.saveStatus).state).toBe('error');
    // The recovery is still offered. Once the change is saved, it goes through.
    await waitFor(() => { screen.flush(); return destination(screen, V3) === 'empty'; }, 'the destination to be judged again');
    await screen.persistence.retrySave();
    expect((await snapshot(V3_NAME)).stores.settings.wordPageSize).toBe(20);
    recover(screen, V3);
    click(screen, 'confirm-recover');
    await waitFor(() => { screen.flush(); return screen.root.querySelector('[data-backup-outcome="success"]') !== null; }, 'the recovery');
    expect((await snapshot(V3_NAME)).stores).toEqual({ ...syntheticStores(3), meta: SYNTHETIC_META });
  });

  it('a screen that is closed before the recovery writes: the recovery does not start, and the tab goes on as it was', async () => {
    const content = await backupThenLoss();
    const screen = await openScreen();
    const { get } = await import('svelte/store');
    await choose(screen, 'my-backup.json', content);
    recover(screen, V3);
    const before = await snapshot(V3_NAME);
    // The recovery is still being prepared: it waits for the saves of this tab.
    let release: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const settled = screen.persistence.persistenceSettled;
    const prepared = vi.spyOn(screen.persistence, 'persistenceSettled').mockImplementation(async () => { await waiting; return settled(); });
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');

    click(screen, 'confirm-recover');
    await waitFor(() => prepared.mock.calls.length > 0, 'the recovery to be prepared');
    // The learner leaves the screen, for example with the Back button.
    screen.close();
    screens = screens.filter((item) => item !== screen);
    screen.state.progress.toggleLearnedPhrase('phrase-learned-on-another-screen');
    release();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await settled();

    expect(transactions.mock.results.map((item) => item.value as IDBTransaction).filter((item) => item.mode === 'readwrite').map((item) => [...item.objectStoreNames])).toEqual([['progress']]);
    vi.restoreAllMocks();
    expect(screen.state.stateHeld()).toBe(false);
    expect(get(screen.state.progress).learnedPhrases).toEqual(['phrase-learned-on-another-screen']);
    expect((await snapshot(V3_NAME)).stores).toEqual({ ...before.stores, progress: { learnedPhrases: ['phrase-learned-on-another-screen'] } });
    expect(get(screen.persistence.saveStatus).state).toBe('saved');
  });
});
