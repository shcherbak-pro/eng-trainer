import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCatalog } from '../../content/catalog';
import { realMaterials } from '../../test/content';
import { describeExperimental } from '../../test/product';
import { factsFor, last } from './testing';
import PronunciationPage from './PronunciationPage.svelte';
import type { Installation } from './models/store';
import { KIND_LABELS, practiceGroups } from './practiceItems';
import type { PracticeSession, PracticeState, StorageView } from './session';

/**
 * The Pronunciation screen with a session under the test's control (ENG-V3-02 stage A,
 * ENG-V3-R1B): what each state shows, what each control does, and what the screen never says.
 */
const BASE: PracticeState = { phase: 'checking', installed: false, installation: null, storage: null, fileProblems: null, working: null, askingPersistence: false, downloadOffered: true, downloadBytes: 46_792_602, progress: null, notice: null, outcome: null };

/** The browser's answers for a site that uses 1.2 MB of 2 GB: room for the model and the reserve. */
const ROOM: StorageView = { ...factsFor({ known: true, usage: 1_200_000, quota: 2_000_000_000 }), answer: null };
/** 100 MB free: less than the 131.0 MB that a download asks for. */
const NO_ROOM: StorageView = { ...factsFor({ known: true, usage: 400_000_000, quota: 500_000_000 }), answer: null };
const NO_ESTIMATE: StorageView = { ...factsFor({ known: false, reason: 'This browser does not say how much storage this site uses or may use.' }, { persistence: 'unknown', canAskForPersistence: false }), answer: null };
const ABSENT: Installation = { state: 'absent', bytes: 0, otherBytes: 0 };
const INSTALLED: Installation = { state: 'installed', bytes: 46_792_602, otherBytes: 0 };

function fakeSession(initial: Partial<PracticeState> = {}) {
  let state: PracticeState = { ...BASE, ...initial };
  const listeners = new Set<(state: PracticeState) => void>();
  const calls: string[] = [];
  const note = (name: string) => async (): Promise<void> => void calls.push(name);
  const session: PracticeSession = {
    subscribe(run) {
      listeners.add(run);
      run(state);
      return () => listeners.delete(run);
    },
    init: note('init'),
    prepare: note('prepare'),
    install: async (options) => void calls.push(options?.confirmed === true ? 'install confirmed' : 'install without a confirmation'),
    cancelPrepare: () => void calls.push('cancelPrepare'),
    removeModel: note('removeModel'),
    refreshStorage: note('refreshStorage'),
    askForPersistence: note('askForPersistence'),
    checkFiles: note('checkFiles'),
    record: note('record'),
    stop: note('stop'),
    cancel: () => void calls.push('cancel'),
    clearOutcome: () => void calls.push('clearOutcome'),
    pageHidden: () => void calls.push('pageHidden'),
    recordedSeconds: () => 2.4,
    dispose: () => void calls.push('dispose')
  };
  return {
    session,
    calls,
    set(next: Partial<PracticeState>): void {
      state = { ...state, ...next };
      for (const listener of listeners) listener(state);
      flushSync();
    }
  };
}

describeExperimental('Pronunciation screen', () => {
  const catalog = createCatalog(realMaterials);
  /** The first topic, as the screen lists it. Its first entry is a sentence frame with two targets. */
  const topic = practiceGroups(catalog)[0];
  let root: HTMLElement;
  let component: ReturnType<typeof mount> | null;
  let fake: ReturnType<typeof fakeSession>;

  const text = (node: ParentNode | null = root): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const action = (name: string): HTMLButtonElement | null => root.querySelector<HTMLButtonElement>(`[data-action="${name}"]`);
  const actions = (): string[] => [...root.querySelectorAll<HTMLElement>('[data-action]')].map((button) => button.dataset.action!);
  const click = (name: string): void => {
    action(name)!.click();
    flushSync();
  };
  /** A click whose handler asks the session first and then changes the screen. */
  const clickAndSettle = async (name: string): Promise<void> => {
    action(name)!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
  };
  const dialog = (): HTMLDialogElement => root.querySelector<HTMLDialogElement>('dialog[data-install-confirm]')!;

  function open(initial: Partial<PracticeState> = {}): void {
    fake = fakeSession(initial);
    component = mount(PronunciationPage, { target: root, props: { catalog, createSession: () => fake.session } });
    flushSync();
  }

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    component = null;
  });

  afterEach(() => {
    if (component) unmount(component);
    root.remove();
    vi.useRealTimers();
  });

  it('opens as a prototype for disposable profiles, reads the model state, and says what the result is not', () => {
    open();
    const page = root.querySelector('[data-experimental-feature]')!;
    expect(page.getAttribute('data-experimental-feature')).toBe('pronunciation-prototype');
    expect(page.getAttribute('data-phase')).toBe('checking');
    expect(fake.calls).toEqual(['init']);
    expect(text()).toContain('Prototype: use a disposable browser profile');
    expect(text()).toContain('Use it only in a browser profile made for testing, with made-up learning data.');
    expect(text()).toContain('Your speech is recognized on this device. The recording is not stored and is not sent anywhere.');
    expect(text()).toContain('It is not a score of your pronunciation.');
    expect(actions()).toEqual([]);
  });

  it('names the pinned model and runtime, the product and its database, and the other versions', () => {
    open();
    expect(text(root.querySelector('[data-model-fact="model"]'))).toBe('Moonshine tiny, 8-bit quantized (onnx-community/moonshine-tiny-ONNX, revision a6da1241cd30, MIT)');
    expect(text(root.querySelector('[data-model-fact="runtime"]'))).toBe('onnxruntime-web 1.31.1, WebAssembly, one thread (MIT)');
    expect(text(root.querySelector('[data-build-fact="product"]'))).toBe('experimental-v3');
    expect(text(root.querySelector('[data-build-fact="database"]'))).toBe('eng-trainer-v3');
    expect([...root.querySelectorAll<HTMLAnchorElement>('a[data-version-link]')].map((link) => [link.dataset.versionLink, link.getAttribute('href')])).toEqual([
      ['stable-v2', '/eng-trainer/'],
      ['legacy-v1', '/eng-trainer/v1/']
    ]);
  });

  it('without a model: states the exact size before any download, and the click asks first', async () => {
    open({ phase: 'no-model', storage: ROOM, installation: ABSENT });
    expect(text(root.querySelector('[data-model-state]'))).toBe('Recording needs a speech model of 46.8 MB (46,792,602 bytes). It is downloaded once from this site, checked file by file and kept in this browser.');
    expect(actions()).toEqual(['install-model', 'open-backup', 'refresh-storage', 'ask-persistence']);
    expect(text(action('install-model'))).toBe('Download and install (46.8 MB)');
    expect(fake.calls).toEqual(['init']);
    // No phrase and no record control while there is no model.
    expect(root.querySelector('[data-target-text]')).toBeNull();

    // The click reads the numbers again and opens the question. Nothing is downloaded by it.
    await clickAndSettle('install-model');
    expect(fake.calls).toEqual(['init', 'refreshStorage']);
    expect(dialog().dataset.installConfirm).toBe('open');
    expect(text(dialog())).toContain('This stores 46.8 MB in this browser, in the same storage as your learning data. The browser estimates 2.0 GB of free storage for this site, and this site uses 1.2 MB now.');
    expect(text(dialog())).toContain('A browser that runs short of storage can remove everything that this site keeps, in one step: the learning data of every version together with the model.');
    expect(text(dialog())).toContain('Only a backup file that is kept outside this browser protects your learning data. The trainer cannot see whether you have one.');
    expect(dialog().querySelector('[data-action="open-backup-first"]')!.getAttribute('href')).toBe('#backup');

    // Without the learner's own statement there is no download.
    expect(action('confirm-install')!.disabled).toBe(true);
    click('confirm-install');
    expect(fake.calls).toEqual(['init', 'refreshStorage']);

    const box = dialog().querySelector<HTMLInputElement>('[data-control="backup-acknowledged"]')!;
    expect(text(box.closest('label'))).toBe('I have saved a backup file of the learning data in this browser, or this browser profile holds nothing that I want to keep.');
    box.click();
    flushSync();
    expect(action('confirm-install')!.disabled).toBe(false);
    click('confirm-install');
    expect(fake.calls).toEqual(['init', 'refreshStorage', 'install confirmed']);
    expect(dialog().dataset.installConfirm).toBe('closed');
  });

  it('the question can be cancelled, and it starts unconfirmed each time', async () => {
    open({ phase: 'no-model', storage: ROOM, installation: ABSENT });
    await clickAndSettle('install-model');
    const box = (): HTMLInputElement => dialog().querySelector<HTMLInputElement>('[data-control="backup-acknowledged"]')!;
    box().click();
    flushSync();
    click('cancel-install-confirm');
    expect(dialog().dataset.installConfirm).toBe('closed');
    expect(action('confirm-install')).toBeNull();
    expect(fake.calls).toEqual(['init', 'refreshStorage']);

    await clickAndSettle('install-model');
    expect(box().checked).toBe(false);
    expect(action('confirm-install')!.disabled).toBe(true);

    // Going to the Backup screen closes the question. Nothing is downloaded.
    dialog().querySelector<HTMLAnchorElement>('[data-action="open-backup-first"]')!.addEventListener('click', (event) => event.preventDefault());
    click('open-backup-first');
    expect(dialog().dataset.installConfirm).toBe('closed');
    expect(fake.calls.filter((call) => call.startsWith('prepare') || call.startsWith('install'))).toEqual([]);
  });

  it('the question closes without a download when the estimate changed meanwhile', async () => {
    open({ phase: 'no-model', storage: ROOM, installation: ABSENT });
    await clickAndSettle('install-model');
    dialog().querySelector<HTMLInputElement>('[data-control="backup-acknowledged"]')!.click();
    flushSync();
    fake.set({ storage: NO_ROOM });
    expect(text(dialog().querySelector('[data-install-changed]'))).toBe('The browser\'s estimate changed while this question was open: there is no room for the model now. Nothing was downloaded.');
    expect(action('confirm-install')!.disabled).toBe(true);
    click('confirm-install');
    expect(fake.calls.filter((call) => call.startsWith('prepare') || call.startsWith('install'))).toEqual([]);
  });

  it('the click reads the estimate again: with no room left, no question opens', async () => {
    open({ phase: 'no-model', storage: ROOM, installation: ABSENT });
    // Something else filled the site's storage since the screen was opened.
    fake.session.refreshStorage = async () => {
      fake.calls.push('refreshStorage');
      fake.set({ storage: NO_ROOM });
    };
    await clickAndSettle('install-model');
    expect(dialog().dataset.installConfirm).toBe('closed');
    expect(action('confirm-install')).toBeNull();
    expect(action('install-model')).toBeNull();
    expect(fake.calls).toEqual(['init', 'refreshStorage']);
  });

  it('without room there is no download control: the numbers, what is missing, and never an advice to clear the site', () => {
    open({ phase: 'no-model', storage: NO_ROOM, installation: ABSENT });
    expect(action('install-model')).toBeNull();
    expect(actions()).toEqual(['check-storage', 'open-backup', 'refresh-storage', 'ask-persistence']);
    const warning = root.querySelector('.notice--warning')!;
    expect(text(warning)).toBe('The model cannot be downloaded now The browser estimates 100.0 MB of free storage for this site. A download asks for 131.0 MB, so 31.0 MB are missing. Your learning data is not changed. Do not clear the data of this site to make room: that would remove your learning data too.');
    expect(root.querySelector('[data-storage-panel]')!.getAttribute('data-capacity')).toBe('insufficient');
    click('check-storage');
    expect(fake.calls).toEqual(['init', 'refreshStorage']);

    // Room again: the download is offered again.
    fake.set({ storage: ROOM });
    expect(action('install-model')).not.toBeNull();
    expect(root.querySelector('.notice--warning')).toBeNull();
  });

  it('without an estimate there is no download control either', () => {
    open({ phase: 'no-model', storage: NO_ESTIMATE, installation: ABSENT });
    expect(action('install-model')).toBeNull();
    expect(text(root.querySelector('[data-capacity-reason]'))).toBe('This browser does not say how much storage this site uses or may use. Without an estimate the model is not downloaded.');
    expect(text(root.querySelector('[data-storage-fact="usage"]'))).toBe('Not known. This browser does not say how much storage this site uses or may use.');
    expect(root.querySelector('[data-storage-panel]')!.getAttribute('data-capacity')).toBe('unknown');
    // A browser that cannot be asked gets no control for asking.
    expect(action('ask-persistence')).toBeNull();
    expect(text(root.querySelector('[data-storage-fact="persistence"]'))).toBe('This browser does not say whether it may remove this site\'s data by itself. Assume that it may.');

    // The browser's storage could not be asked at all.
    fake.set({ storage: null });
    expect(action('install-model')).toBeNull();
    expect(text(root.querySelector('[data-capacity-reason]'))).toBe('The browser\'s storage could not be asked, so there is no estimate to decide on.');
  });

  it('says what the site uses, what a download asks for, and that none of it is a backup', () => {
    open({ phase: 'no-model', storage: ROOM, installation: ABSENT });
    const panel = root.querySelector('[data-storage-panel]')!;
    expect(panel.getAttribute('data-capacity')).toBe('sufficient');
    expect(panel.getAttribute('data-persistence')).toBe('best-effort');
    expect(panel.getAttribute('data-installation')).toBe('absent');
    expect(text(panel)).toContain('Every version of the trainer keeps its data in the storage that this browser gives to this site: the learning data of this version, of the stable version and of the previous version (v1), and the speech model.');
    expect(text(panel.querySelector('[data-storage-fact="usage"]'))).toBe('1.2 MB of 2.0 GB, by the browser\'s estimate, all versions together');
    expect(text(panel.querySelector('[data-storage-fact="free"]'))).toBe('2.0 GB');
    expect(text(panel.querySelector('[data-storage-fact="need"]'))).toBe('131.0 MB of free storage, by the browser\'s estimate: 46.8 MB for the files, 20.2 MB while a file is being stored, and 64.0 MB of headroom for learning data');
    expect(text(panel.querySelector('[data-storage-fact="installation"]'))).toBe('Not in this browser.');
    expect(text(panel.querySelector('[data-storage-fact="persistence"]'))).toBe('The browser may remove this site\'s data by itself, for example when the device runs low on storage.');
    expect(text(panel.querySelector('[data-not-a-backup]'))).toBe('None of this is a backup. Whatever the browser says, the data of this site is lost when the site\'s data is cleared, with the browser profile, and with the device. Only a backup file that is kept outside this browser protects your learning data. Open the Backup screen');
    expect(panel.querySelector('[data-action="open-backup"]')!.getAttribute('href')).toBe('#backup');
    click('refresh-storage');
    expect(fake.calls).toEqual(['init', 'refreshStorage']);
  });

  it('asks the browser to keep the data only on the click, and shows each answer as what it is', () => {
    open({ phase: 'no-model', storage: ROOM, installation: ABSENT });
    expect(fake.calls).toEqual(['init']);
    expect(text(action('ask-persistence'))).toBe('Ask the browser to keep this site’s data');
    click('ask-persistence');
    expect(fake.calls).toEqual(['init', 'askForPersistence']);

    // The browser may take as long as the learner likes. Nothing else waits for it.
    fake.set({ askingPersistence: true });
    expect(action('ask-persistence')!.disabled).toBe(true);
    expect(text(action('ask-persistence'))).toBe('Waiting for the browser’s answer…');
    expect(action('install-model')!.disabled).toBe(false);
    expect(action('refresh-storage')!.disabled).toBe(false);

    const answer = (): string => text(root.querySelector('[data-persistence-answer]'));
    fake.set({ askingPersistence: false, storage: { ...ROOM, answer: 'declined' } });
    expect(answer()).toBe('The browser did not agree. Some browsers decide this by themselves, without asking you. Nothing changed.');
    fake.set({ storage: { ...ROOM, answer: 'failed' } });
    expect(answer()).toBe('The browser could not be asked. Nothing changed.');
    fake.set({ storage: { ...ROOM, answer: 'unsupported', canAskForPersistence: false } });
    expect(answer()).toBe('This browser cannot be asked to keep this site\'s data.');
    expect(action('ask-persistence')).toBeNull();

    // Granted: said as the browser's statement, with the reminder that it is not a backup.
    fake.set({ storage: { ...ROOM, persistence: 'persistent', answer: 'granted' } });
    expect(answer()).toBe('The browser agreed to keep this site\'s data. That is not a backup.');
    expect(text(root.querySelector('[data-storage-fact="persistence"]'))).toBe('The browser says that it will not remove this site\'s data by itself.');
    expect(action('ask-persistence')).toBeNull();
    expect(text(root.querySelector('[data-not-a-backup]'))).toContain('None of this is a backup.');
    // In no state does the screen call the data safe, protected or guaranteed by the browser.
    expect(text(root.querySelector('[data-storage-panel]'))).not.toMatch(/\bsafe\b|guarantee|is protected|are protected|cannot be lost|will not be lost/i);
  });

  it('files of an unfinished download are named as such, never loaded, and can be removed or replaced', () => {
    open({ phase: 'no-model', storage: ROOM, installation: { state: 'incomplete', bytes: 17_000_000, files: 3, otherBytes: 0 } });
    expect(text(root.querySelector('[data-model-state]'))).toBe('This browser holds 3 files (17.0 MB) of a download that did not finish. They are not used. A new download replaces them.');
    expect(text(root.querySelector('[data-storage-fact="installation"]'))).toBe('3 files of a download that did not finish, 17.0 MB. Never used.');
    expect(action('load-model')).toBeNull();
    expect(actions()).toEqual(['install-model', 'remove-model-files', 'open-backup', 'refresh-storage', 'ask-persistence']);
    expect(text()).toContain('Removing deletes the files of the speech model and nothing else. Learning data, settings and the other versions stay as they are.');
    click('remove-model-files');
    expect(fake.calls).toEqual(['init', 'removeModel']);

    // On a page that offers no download they can still be removed.
    fake.set({ downloadOffered: false, installation: { state: 'incomplete', bytes: 921, files: 1, otherBytes: 0 } });
    expect(text(root.querySelector('[data-model-state]'))).toBe('This browser holds 1 file (0.0 MB) of a download that did not finish. They are not used.');
    expect(actions()).toEqual(['remove-model-files', 'open-backup', 'refresh-storage', 'ask-persistence']);
  });

  it('a damaged installation and files of another version are named, never loaded, and can be removed', () => {
    open({ phase: 'no-model', storage: ROOM, installation: { state: 'damaged', bytes: 30_000_000, problems: ['model/tokenizer.json is missing', 'runtime/ort-wasm-simd-threaded.wasm has 5 bytes, not 14848852'], otherBytes: 0 } });
    expect(text(root.querySelector('[data-model-state]'))).toBe('The speech model in this browser is damaged, so it is not used. A new download replaces it.');
    expect(text(root.querySelector('[data-storage-fact="installation"]'))).toBe('Damaged, 30.0 MB: model/tokenizer.json is missing; runtime/ort-wasm-simd-threaded.wasm has 5 bytes, not 14848852. Never used.');
    expect(action('load-model')).toBeNull();
    expect(action('remove-model-files')).not.toBeNull();

    fake.set({ installation: { state: 'absent', bytes: 0, otherBytes: 44_000_000 } });
    expect(text(root.querySelector('[data-storage-fact="installation"]'))).toBe('Not in this browser. Also 44.0 MB of another version of the model, which this build does not use.');
    expect(action('remove-model-files')).not.toBeNull();

    fake.set({ installation: ABSENT });
    expect(action('remove-model-files')).toBeNull();
  });

  it('checks the installed files on request, and files that are not the expected ones are not offered for loading', () => {
    open({ phase: 'no-model', installed: true, storage: ROOM, installation: INSTALLED });
    expect(text(root.querySelector('[data-storage-fact="installation"]'))).toBe('Installed, 46.8 MB. Complete by the list of files and their sizes.');
    expect(actions()).toEqual(['load-model', 'delete-model', 'open-backup', 'refresh-storage', 'check-files', 'ask-persistence']);
    click('check-files');
    expect(fake.calls).toEqual(['init', 'checkFiles']);

    fake.set({ working: 'files' });
    expect(text(action('check-files'))).toBe('Checking the files…');
    expect(action('check-files')!.disabled).toBe(true);
    expect(action('delete-model')!.disabled).toBe(true);

    fake.set({ working: null, fileProblems: [] });
    expect(text(root.querySelector('[data-files-checked]'))).toBe('Checked now: every installed file is the expected one, by its size and its SHA-256.');
    expect(action('load-model')).not.toBeNull();

    fake.set({ fileProblems: ['model/tokenizer.json: does not have the pinned SHA-256'] });
    expect(text(root.querySelector('[data-model-state]'))).toBe('The files of the speech model in this browser are damaged. They are not used. Remove them, then download the model again.');
    expect([...root.querySelectorAll('[data-file-problems] li')].map((item) => text(item))).toEqual(['model/tokenizer.json: does not have the pinned SHA-256']);
    expect(action('load-model')).toBeNull();
    expect(action('check-files')).toBeNull();
    expect(actions()).toEqual(['remove-model-files', 'open-backup', 'refresh-storage', 'ask-persistence']);
  });

  it('with the model loaded, a check of the files shows its result too', () => {
    open({ phase: 'ready', installed: true, storage: ROOM, installation: INSTALLED });
    expect(action('check-files')).not.toBeNull();
    click('check-files');
    expect(fake.calls).toEqual(['init', 'checkFiles']);
    fake.set({ fileProblems: [] });
    expect(text(root.querySelector('[data-files-checked]'))).toBe('Checked now: every installed file is the expected one, by its size and its SHA-256.');

    // The stored files changed after the model was loaded: recording goes on, and the files are offered for removal.
    fake.set({ fileProblems: ['runtime/ort-wasm-simd-threaded.wasm: does not have the pinned SHA-256'] });
    expect([...root.querySelectorAll('[data-file-problems] li')].map((item) => text(item))).toEqual(['runtime/ort-wasm-simd-threaded.wasm: does not have the pinned SHA-256']);
    expect(text(root.querySelector('[data-files-loaded-note]'))).toBe('The model that is loaded now was checked when it was read. It cannot be loaded again from these files: remove them, then download the model again.');
    expect(action('record')).not.toBeNull();
    expect(action('delete-model')).toBeNull();
    expect(action('remove-model-files')).not.toBeNull();
  });

  // ---- ENG-V3-R1B-RC1 --------------------------------------------------------------------

  it('F1: "Load" asks to load and nothing else, and "Download" never loads by itself', async () => {
    open({ phase: 'no-model', installed: true, storage: ROOM, installation: INSTALLED });
    click('load-model');
    expect(fake.calls).toEqual(['init', 'prepare']);
    expect(dialog().dataset.installConfirm).toBe('closed');

    // The cache changed in another tab and the screen read it again: the controls follow.
    fake.set({ installed: false, installation: ABSENT });
    expect(action('load-model')).toBeNull();
    expect(action('delete-model')).toBeNull();
    expect(action('install-model')).not.toBeNull();
    await clickAndSettle('install-model');
    // The click opens the question. It asked for no installation yet, and for no loading.
    expect(dialog().dataset.installConfirm).toBe('open');
    expect(fake.calls).toEqual(['init', 'prepare', 'refreshStorage']);

    // And back: installed elsewhere, read again.
    click('cancel-install-confirm');
    fake.set({ installed: true, installation: INSTALLED });
    expect(action('install-model')).toBeNull();
    expect(action('load-model')).not.toBeNull();
  });

  it('F1: a model that is loaded while its files are gone: recording goes on, and the screen says what that means', () => {
    open({ phase: 'ready', installed: false, storage: ROOM, installation: ABSENT });
    expect(text(root.querySelector('[data-model-state]'))).toBe('The speech model is loaded.');
    expect(text(root.querySelector('[data-storage-fact="installation"]'))).toBe('Not in this browser. The model that is loaded now stays in memory until you leave this screen. It cannot be loaded again without a new download.');
    expect(action('record')).not.toBeNull();
    expect(action('delete-model')).toBeNull();
    expect(action('load-model')).toBeNull();
    expect(action('install-model')).toBeNull();

    // With the files in place there is no such note.
    fake.set({ installed: true, installation: INSTALLED });
    expect(root.querySelector('[data-storage-fact="in-memory"]')).toBeNull();
    expect(action('delete-model')).not.toBeNull();
  });

  it('F2: where the browser cannot coordinate the tabs, no download and no removal is offered, and the screen says why', () => {
    const alone: StorageView = { ...ROOM, canCoordinate: false };
    open({ phase: 'no-model', storage: alone, installation: ABSENT });
    expect(action('install-model')).toBeNull();
    expect(action('check-storage')).toBeNull();
    expect(text(root.querySelector('[data-no-coordination]'))).toBe('This browser has no way to make sure that only one tab changes the speech model at a time. Without that, one tab could remove files that another tab has just stored. So nothing is downloaded and nothing is removed here.');

    // A model that is here can be loaded: that changes nothing in the cache. It cannot be removed.
    fake.set({ installed: true, installation: INSTALLED });
    expect(actions()).toEqual(['load-model', 'open-backup', 'refresh-storage', 'check-files', 'ask-persistence']);
    expect(text(root.querySelector('[data-no-coordination]'))).toContain('The model that is in this browser can still be loaded.');
    expect(text()).not.toContain('Removing deletes the files of the speech model');

    // Leftovers are named and stay: no removal either.
    fake.set({ installed: false, installation: { state: 'incomplete', bytes: 140, files: 2, otherBytes: 0 } });
    expect(action('remove-model-files')).toBeNull();
    expect(action('install-model')).toBeNull();

    // With coordination the controls are there again.
    fake.set({ storage: ROOM });
    expect(root.querySelector('[data-no-coordination]')).toBeNull();
    expect(action('install-model')).not.toBeNull();
    expect(action('remove-model-files')).not.toBeNull();
  });

  it('F2: the click reads the storage again: without coordination, no question opens', async () => {
    open({ phase: 'no-model', storage: ROOM, installation: ABSENT });
    // The answer about coordination is another one when it is read at the click.
    fake.session.refreshStorage = async () => {
      fake.calls.push('refreshStorage');
      fake.set({ storage: { ...ROOM, canCoordinate: false } });
    };
    await clickAndSettle('install-model');
    expect(dialog().dataset.installConfirm).toBe('closed');
    expect(action('confirm-install')).toBeNull();
    expect(action('install-model')).toBeNull();
    expect(root.querySelector('[data-no-coordination]')).not.toBeNull();
    expect(fake.calls).toEqual(['init', 'refreshStorage']);
  });

  it('F3: the numbers are called an estimate, and the headroom is never called reserved or guaranteed', async () => {
    open({ phase: 'no-model', storage: ROOM, installation: ABSENT });
    const panel = root.querySelector('[data-storage-panel]')!;
    expect(text(panel.querySelector('[data-estimate-limits]'))).toBe('These numbers are the browser\'s estimate. They are approximate, and the trainer cannot reserve storage. A download that succeeds does not mean that 64.0 MB are left afterwards. A later save of learning data, or a recovery from a backup, can still be refused for lack of room.');
    expect(text(panel.querySelector('[data-storage-fact="need"]'))).toContain('by the browser\'s estimate');

    await clickAndSettle('install-model');
    expect(text(dialog())).toContain('The trainer cannot stop a browser from removing a site\'s data, and it cannot reserve storage. The numbers are estimates: the browser can still refuse to store a file, and after the download less room can be left than the estimate says. A later save of learning data, or a recovery from a backup, can then be refused.');

    // Nowhere does the screen say that room stays free, is kept free, is reserved for the learner or is guaranteed.
    for (const shown of [text(panel), text(dialog()), text(root.querySelector('[data-model-state]'))]) {
      expect(shown).not.toMatch(/stays? free|kept free|keeps? free|is reserved|are reserved|guarantee/i);
    }

    // The same with too little room, and with the model installed.
    click('cancel-install-confirm');
    fake.set({ storage: NO_ROOM });
    expect(text(root.querySelector('[data-estimate-limits]'))).toContain('approximate');
    fake.set({ storage: ROOM, installed: true, installation: INSTALLED });
    expect(text(root.querySelector('[data-estimate-limits]'))).toContain('the trainer cannot reserve storage');
    expect(text(root.querySelector('[data-not-a-backup]'))).toContain('None of this is a backup.');
  });

  it('on a page that offers no download there is no download control', () => {
    open({ phase: 'no-model', downloadOffered: false });
    expect(text(root.querySelector('[data-model-state]'))).toBe('This page does not offer a model download, so recording is not available here.');
    expect(actions()).toEqual([]);
  });

  it('an installed model can be loaded or deleted', () => {
    open({ phase: 'no-model', installed: true });
    expect(text(root.querySelector('[data-model-state]'))).toBe('The speech model is in this browser. Load it to record.');
    expect(actions()).toEqual(['load-model', 'delete-model']);
    expect(text()).toContain('Removing deletes the files of the speech model and nothing else. Learning data, settings and the other versions stay as they are.');
    click('load-model');
    click('delete-model');
    expect(fake.calls).toEqual(['init', 'prepare', 'removeModel']);
  });

  it('shows the download progress, and Cancel stops it', () => {
    open({ phase: 'installing', progress: { loaded: 11_698_150, total: 46_792_602 } });
    const progress = root.querySelector('progress')!;
    expect([progress.value, progress.max]).toEqual([11_698_150, 46_792_602]);
    expect(text(root.querySelector('[data-model-state]'))).toContain('11.7 of 46.8 MB');
    expect(actions()).toEqual(['cancel-install']);
    click('cancel-install');
    expect(fake.calls).toContain('cancelPrepare');

    fake.set({ phase: 'loading', progress: null });
    expect(text(root.querySelector('[data-model-state]'))).toBe('Loading the speech model…');
    expect(actions()).toEqual(['cancel-install']);
  });

  it('explains a failed preparation and an unsupported browser', () => {
    open({ phase: 'no-model', notice: 'A downloaded file is not the expected one and was discarded. Nothing was installed.' });
    expect(text(root.querySelector('.notice--error'))).toContain('The speech model is not loaded');
    expect(text(root.querySelector('.notice--error'))).toContain('A downloaded file is not the expected one and was discarded.');

    fake.set({ phase: 'unsupported', notice: 'This browser has no Workers.' });
    expect(text(root.querySelector('[data-model-state]'))).toBe('Recording is not available here. This browser has no Workers.');
    expect(actions()).toEqual([]);
    expect(root.querySelector('.notice--error')).toBeNull();
  });

  it('with the model loaded: shows a phrase to say and one Record control', () => {
    open({ phase: 'ready', installed: true });
    const first = topic.items[0];
    expect(first.target).toEqual({ contract: 1, entryId: 'phrase-001', kind: 'frame', text: 'I would start by saying that' });
    expect(text(root.querySelector('[data-target-text]'))).toBe(first.target.text);
    expect(root.querySelector('[data-target-text]')!.getAttribute('lang')).toBe('en');
    expect(root.querySelector('[data-target-entry]')!.getAttribute('data-target-entry')).toBe('phrase-001');
    expect(root.querySelector('[data-target-kind]')!.getAttribute('data-target-kind')).toBe('frame');
    expect(text(root.querySelector('.prompt-card'))).toContain(`${KIND_LABELS.frame} 1 of ${topic.items.length}`);
    // A part of an entry says which entry it comes from.
    expect(text(root.querySelector('.prompt-card'))).toContain(`From: ${catalog.phrases[0].phrase}`);
    expect(actions()).toEqual(['delete-model', 'previous', 'next', 'record']);
    expect(text(action('record'))).toBe('Record');
    expect(text()).toContain('Recording stops by itself after 20 seconds.');

    click('record');
    expect(fake.calls).toEqual(['init', 'record']);
  });

  it('Next, Previous and Topic choose another phrase, end a recording and clear the last result', () => {
    open({ phase: 'ready', installed: true });
    click('next');
    expect(text(root.querySelector('[data-target-text]'))).toBe(topic.items[1].target.text);
    expect(topic.items[1].target.text).not.toBe(topic.items[0].target.text);
    expect(fake.calls).toEqual(['init', 'cancel', 'clearOutcome']);
    click('previous');
    expect(text(root.querySelector('[data-target-text]'))).toBe(topic.items[0].target.text);
    // Previous from the first phrase goes to the last one of the topic.
    click('previous');
    expect(text(root.querySelector('.prompt-card .muted'))).toMatch(/ (\d+) of \1$/);

    const select = root.querySelector<HTMLSelectElement>('[data-control="group"]')!;
    select.value = 'irregular-verbs';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(root.querySelector('[data-target-kind]')!.getAttribute('data-target-kind')).toBe('verb-forms');
    expect(text(root.querySelector('.prompt-card .muted'))).toBe('Verb forms 1 of 339');
    expect(text(root.querySelector('[data-target-text]'))).toBe('be, was/were, been');
  });

  it('while recording: Stop and Cancel, the elapsed time, and no way to change the phrase', () => {
    vi.useFakeTimers();
    open({ phase: 'ready', installed: true });
    fake.set({ phase: 'starting' });
    expect(actions()).toEqual(['previous', 'next', 'cancel']);
    expect(text(root.querySelector('[data-record-status]'))).toBe('Waiting for the microphone. The browser may ask for permission.');

    fake.set({ phase: 'recording' });
    vi.advanceTimersByTime(250);
    flushSync();
    expect(actions()).toEqual(['previous', 'next', 'stop', 'cancel']);
    expect(text(root.querySelector('[data-record-status]'))).toBe('Recording: 2.4 s. Say the phrase, then choose Stop.');
    expect(action('next')!.disabled).toBe(true);
    expect(root.querySelector<HTMLSelectElement>('[data-control="group"]')!.disabled).toBe(true);
    click('stop');
    expect(fake.calls).toContain('stop');

    fake.set({ phase: 'recognizing' });
    expect(actions()).toEqual(['previous', 'next', 'cancel']);
    expect(text(root.querySelector('[data-record-status]'))).toBe('Recognizing on this device…');
    click('cancel');
    expect(fake.calls).toContain('cancel');
  });

  it('shows what the recognizer heard, with the two cautions, and offers to record again', () => {
    open({ phase: 'ready', installed: true, outcome: { kind: 'heard', text: 'Let me explain.', audioSeconds: 2.04, elapsedMs: 310 } });
    const outcome = root.querySelector('[data-outcome]')!;
    expect(outcome.getAttribute('data-outcome')).toBe('heard');
    expect(text(outcome)).toBe('The recognizer heard: Let me explain. 2.0 s recorded, recognized in 0.3 s. A recognizer can mishear correct speech, and it can also turn a mispronounced word into the expected one. A difference is not a mistake, and a match is not a proof.');
    expect(text(action('record'))).toBe('Record again');

    fake.set({ outcome: { kind: 'heard', text: '', audioSeconds: 2, elapsedMs: 100 } });
    expect(text(root.querySelector('[data-heard-text]'))).toBe('(no words)');
  });

  it('says why a recording has no result, without blaming the speaker', () => {
    open({ phase: 'ready', installed: true, outcome: { kind: 'unable', message: 'Nothing was heard. Check that the microphone is on and not muted, then record again.' } });
    const outcome = root.querySelector('[data-outcome]')!;
    expect(outcome.getAttribute('data-outcome')).toBe('unable');
    expect(text(outcome)).toBe('No result for this recording Nothing was heard. Check that the microphone is on and not muted, then record again.');
    expect(text(action('record'))).toBe('Record again');
  });

  it('never shows a score, a percentage, a grade or a verdict', () => {
    const cautions = ['It is not a score of your pronunciation.', 'A recognizer can mishear correct speech, and it can also turn a mispronounced word into the expected one. A difference is not a mistake, and a match is not a proof.'];
    const verdict = /score|grade|percent|%|accura|correct|wrong|mistake|well done|good job|try harder|\bpass(?:ed)?\b|\bfail(?:ed)?\b/i;
    open({ phase: 'ready', installed: true });
    // The page text without the phrase to say, which is study material.
    const shown = (): string => {
      const copy = root.cloneNode(true) as HTMLElement;
      copy.querySelector('.prompt-card')?.remove();
      copy.querySelector('[data-control="group"]')?.remove();
      return cautions.reduce((all, caution) => all.split(caution).join(''), text(copy));
    };

    const states: Partial<PracticeState>[] = [
      { outcome: null },
      // With the storage panel in view.
      { outcome: null, storage: ROOM, installation: INSTALLED },
      { outcome: null, storage: { ...ROOM, persistence: 'persistent', answer: 'granted' }, installation: INSTALLED, fileProblems: [] },
      { storage: null, installation: null, fileProblems: null },
      { outcome: { kind: 'heard', text: 'Let me explain.', audioSeconds: 2, elapsedMs: 310 } },
      { outcome: { kind: 'heard', text: '', audioSeconds: 2, elapsedMs: 310 } },
      { outcome: { kind: 'unable', message: 'The recording is shorter than one second. Record the whole phrase.' } },
      { phase: 'recording', outcome: null },
      { phase: 'recognizing' }
    ];
    for (const state of states) {
      fake.set({ phase: 'ready', ...state });
      expect(shown()).not.toMatch(verdict);
      // No colour scale either: the result carries no class that depends on the text.
      expect(root.querySelector('.heard')?.className ?? 'heard').toMatch(/^heard(?: svelte-\w+)?$/);
    }
    expect(root.querySelectorAll('meter, [role="meter"], [role="progressbar"]')).toHaveLength(0);
  });

  it('a hidden page tells the session, and leaving the screen disposes of it', () => {
    open({ phase: 'recording', installed: true });
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fake.calls).not.toContain('pageHidden');
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fake.calls).toContain('pageHidden');

    unmount(component!);
    component = null;
    expect(last(fake.calls)).toBe('dispose');
    // The listener is gone: a later event reaches no session.
    const before = fake.calls.length;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fake.calls).toHaveLength(before);
    visibility.mockRestore();
  });
});
