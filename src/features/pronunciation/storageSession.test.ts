import { beforeEach, expect, it } from 'vitest';
import { describeExperimental } from '../../test/product';
import type { Recorder } from './capture/capture';
import { describeCapacity, readEstimate } from './models/capacity';
import { MODEL_LOCK_NAME, ModelBusyError, NoCoordinationError, type LockManagerLike } from './models/exclusive';
import { InstallError, installModel } from './models/install';
import { createModelStorage } from './models/management';
import type { PinnedFile, PinnedSet } from './models/pinned';
import { MODEL_CACHE_NAME, createModelStore, type Installation } from './models/store';
import { ModelFilesError, createLocalMlRecognizer } from './recognition/localMl';
import type { RecognizerState, SpeechRecognizer } from './recognition/types';
import { createPracticeSession, type PracticeSession, type PracticeState } from './session';
import { FakeRecognizerWorker, factsFor, fakeCacheStorage, fakeLocks, fakeModelStorage, fakeStorageManager, gate, inPieces, last, pinnedSet, served, syntheticBytes, type FakeCacheStorage } from './testing';

/**
 * The practice session and the model's storage (ENG-V3-R1B): what the session reads, the
 * order of a download, what it says after a refusal, and what it does with files that
 * cannot be used. First with everything faked, then with the real installer, model cache
 * and recognizer over an in-memory cache.
 *
 * ENG-V3-R1B-RC1 added the schedules of the independent review: a cache that another tab
 * changes while this screen is open (F1), and a browser that cannot coordinate the tabs (F2).
 */
const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const DOWNLOAD: RecognizerState = { status: 'needs-download', bytes: 46_792_602 };
const ABSENT: Installation = { state: 'absent', bytes: 0, otherBytes: 0 };
const INSTALLED: Installation = { state: 'installed', bytes: 46_792_602, otherBytes: 0 };
/** 100 MB free: 31 MB less than a download asks for. */
const NO_ROOM = factsFor({ known: true, usage: 400_000_000, quota: 500_000_000 });
const NO_ESTIMATE = factsFor({ known: false, reason: 'This browser does not say how much storage this site uses or may use.' }, { persistence: 'unknown', canAskForPersistence: false });
const UNTOUCHED = 'Your learning data was not changed. Do not clear the data of this site to make room: that would remove your learning data too.';

const idleRecorder: Recorder = {
  prepare: async () => undefined,
  start: async () => {
    throw new Error('no recording in these tests');
  },
  close: () => undefined
};

describeExperimental('practice session: the model\'s storage', () => {
  let log: string[];
  let status: RecognizerState;
  let install: () => Promise<void>;
  let prepare: () => Promise<void>;
  let remove: () => Promise<void>;
  let storage: ReturnType<typeof fakeModelStorage>;
  let session: PracticeSession;
  let state: PracticeState;
  let working: PracticeState['working'][];

  /** The cache and the recognizer of the fake, changed together as another tab would change them. */
  function theCacheHolds(installation: Installation): void {
    storage.installation = installation;
    if (status.status !== 'ready') status = installation.state === 'installed' ? { status: 'installed' } : DOWNLOAD;
  }

  function create(downloadOffered = true): void {
    const recognizer: SpeechRecognizer = {
      descriptor: { provider: 'local-ml', model: 'test', revision: 'abc', runtime: 'test' },
      state: async () => status,
      install: (options) => {
        log.push(options.confirmed === true ? 'install confirmed' : 'install without a confirmation');
        return install();
      },
      prepare: () => {
        log.push('prepare');
        return prepare();
      },
      begin() {
        throw new Error('no recording in these tests');
      },
      release: async () => {
        log.push('release');
        if (status.status === 'ready') status = storage.installation.state === 'installed' ? { status: 'installed' } : DOWNLOAD;
      },
      remove: () => {
        log.push('remove');
        return remove();
      }
    };
    session = createPracticeSession({ recognizer, modelStorage: storage.like, recorder: idleRecorder, downloadOffered });
    working = [];
    session.subscribe((next) => {
      state = next;
      if (last(working) !== next.working) working.push(next.working);
    });
  }

  beforeEach(() => {
    log = [];
    status = DOWNLOAD;
    install = async () => {
      status = { status: 'installed' };
      storage.installation = INSTALLED;
    };
    // Loading, as the recognizer does it: it looks at the cache itself, fetches nothing, and refuses without the files.
    prepare = async () => {
      if (storage.installation.state !== 'installed') throw new ModelFilesError('not-installed', 'The speech model is not installed in this browser.');
      status = { status: 'ready' };
    };
    remove = async () => {
      status = DOWNLOAD;
      storage.installation = ABSENT;
    };
    storage = fakeModelStorage();
    create();
  });

  it('reads the model cache and the storage facts when the screen opens, and asks the browser for nothing', async () => {
    expect(state).toMatchObject({ installation: null, storage: null, fileProblems: null, working: null, askingPersistence: false, downloadBytes: 46_792_602 });
    await session.init();
    expect(state.installation).toEqual(ABSENT);
    expect(state.storage).toEqual({ ...storage.facts, answer: null });
    expect(state.storage?.capacity.state).toBe('sufficient');
    expect(storage.calls.sort()).toEqual(['facts', 'inspect']);
  });

  it('a storage that cannot be read is "not known": the screen opens, and no download starts', async () => {
    storage.fail = new Error('The operation is insecure.');
    await session.init();
    expect(state).toMatchObject({ phase: 'no-model', installed: false, installation: null, storage: null });

    await session.install({ confirmed: true });
    expect(log).toEqual([]);
    expect(state.phase).toBe('no-model');
    expect(state.notice).toBe(`The model was not downloaded: the browser's storage could not be asked, so there is no estimate to decide on. ${UNTOUCHED}`);
  });

  it('a download needs room and then the confirmation: without either, nothing is requested', async () => {
    await session.init();

    // Room, but no confirmation.
    await session.install();
    expect(state).toMatchObject({ phase: 'no-model', notice: 'The model was not downloaded: the download has to be confirmed first.' });
    await session.install({ confirmed: false });
    expect(log).toEqual([]);

    // The confirmation, but no room. The numbers are read again at the click.
    storage.facts = NO_ROOM;
    await session.install({ confirmed: true });
    expect(log).toEqual([]);
    expect(state.phase).toBe('no-model');
    expect(state.notice).toBe(
      `The model was not downloaded: The browser estimates 100.0 MB of free storage for this site, and the installation asks for 131.0 MB, 64.0 MB of them as headroom for learning data. 31.0 MB are missing, so the model is not downloaded. ${UNTOUCHED}`
    );
    expect(state.storage?.capacity.state).toBe('insufficient');

    // No estimate at all.
    storage.facts = NO_ESTIMATE;
    await session.install({ confirmed: true });
    expect(log).toEqual([]);
    expect(state.notice).toBe(`The model was not downloaded: This browser does not say how much storage this site uses or may use. Without an estimate the model is not downloaded. ${UNTOUCHED}`);

    // Room and the confirmation: the confirmation is handed to the recognizer, and loading follows as its own step.
    storage.facts = factsFor({ known: true, usage: 1_000_000, quota: 2_000_000_000 });
    await session.install({ confirmed: true });
    expect(log).toEqual(['install confirmed', 'prepare']);
    expect(state).toMatchObject({ phase: 'ready', installed: true, notice: null });
  });

  it('two requests at once start one download', async () => {
    await session.init();
    const first = session.install({ confirmed: true });
    const second = session.install({ confirmed: true });
    await Promise.all([first, second]);
    expect(log).toEqual(['install confirmed', 'prepare']);
    expect(state.phase).toBe('ready');
  });

  it('a screen that is left while the estimate is read starts no download', async () => {
    await session.init();
    const slow = gate();
    const facts = storage.like.facts;
    storage.like.facts = async () => {
      await slow.promise;
      return storage.facts;
    };
    const preparing = session.install({ confirmed: true });
    await turn();
    session.dispose();
    slow.open();
    await preparing;
    await turn();
    expect(log).toEqual(['release']);
    storage.like.facts = facts;
  });

  it('loading an installed model needs neither room nor a confirmation, and asks for no installation', async () => {
    theCacheHolds(INSTALLED);
    storage.facts = NO_ROOM;
    await session.init();
    await session.prepare();
    expect(log).toEqual(['prepare']);
    expect(state.phase).toBe('ready');
  });

  // ---- ENG-V3-R1B-RC1, F1: loading and installing are two requests -----------------------

  it('F1: "Load" on a screen that still believes in a model that another tab removed downloads nothing', async () => {
    theCacheHolds(INSTALLED);
    await session.init();
    expect(state).toMatchObject({ phase: 'no-model', installed: true });

    // Another tab removes the model. This screen is not told and still offers "Load".
    theCacheHolds(ABSENT);
    expect(state.installed).toBe(true);
    await session.prepare();

    // Loading was tried and refused. No installation was asked for, with or without a confirmation.
    expect(log).toEqual(['prepare', 'release']);
    expect(state).toMatchObject({ phase: 'no-model', installed: false, installation: ABSENT, fileProblems: null });
    expect(state.notice).toBe('The speech model is not in this browser any more. It may have been removed in another tab. Nothing was downloaded. To record, download the model again.');
    expect(storage.calls).not.toContain('verify');

    // A download is asked for again, and it needs its confirmation again.
    await session.install();
    expect(log).toEqual(['prepare', 'release']);
    expect(state.notice).toBe('The model was not downloaded: the download has to be confirmed first.');
    await session.install({ confirmed: true });
    expect(log).toEqual(['prepare', 'release', 'install confirmed', 'prepare']);
    expect(state.phase).toBe('ready');
  });

  it('F1: "Read again" makes what is offered follow the cache, in both directions, without reopening the screen', async () => {
    theCacheHolds(INSTALLED);
    await session.init();
    expect(state).toMatchObject({ installed: true, installation: INSTALLED });

    // Removed in another tab.
    theCacheHolds(ABSENT);
    await session.refreshStorage();
    expect(state).toMatchObject({ phase: 'no-model', installed: false, installation: ABSENT });
    await session.prepare();
    expect(log).toEqual(['prepare', 'release']);
    expect(log).not.toContain('install confirmed');

    // Installed in another tab.
    theCacheHolds(INSTALLED);
    await session.refreshStorage();
    expect(state).toMatchObject({ phase: 'no-model', installed: true, installation: INSTALLED });
    await session.prepare();
    expect(state.phase).toBe('ready');
    expect(log.filter((entry) => entry.startsWith('install'))).toEqual([]);
  });

  it('F1: a model in memory and a model on the device are two things', async () => {
    theCacheHolds(INSTALLED);
    await session.init();
    await session.prepare();
    expect(state).toMatchObject({ phase: 'ready', installed: true });

    // Another tab removes the files. The model that is loaded here stays loaded.
    storage.installation = ABSENT;
    await session.refreshStorage();
    expect(state).toMatchObject({ phase: 'ready', installed: false, installation: ABSENT });

    // And the other way round: files on the device do not make a model ready.
    create();
    status = { status: 'installed' };
    storage.installation = INSTALLED;
    await session.init();
    expect(state).toMatchObject({ phase: 'no-model', installed: true });
  });

  it('F1: a download that is asked for when the model is already complete loads it and downloads nothing', async () => {
    await session.init();
    expect(state.installed).toBe(false);
    // Another tab has installed the model since. This screen still offers "Download", and it is confirmed.
    theCacheHolds(INSTALLED);
    await session.install({ confirmed: true });
    expect(log).toEqual(['prepare']);
    expect(state).toMatchObject({ phase: 'ready', installed: true });
  });

  it('F1: files that are incomplete are not loaded and not downloaded by "Load"', async () => {
    theCacheHolds({ state: 'incomplete', bytes: 140, files: 2, otherBytes: 0 });
    await session.init();
    await session.prepare();
    expect(log).toEqual(['prepare', 'release']);
    expect(state).toMatchObject({ phase: 'no-model', installed: false, fileProblems: null });
    expect(state.notice).toBe('The installed files of the speech model are incomplete or damaged, so they were not used. Remove them and download the model again. (The speech model is not installed in this browser.)');
  });

  // ---- ENG-V3-R1B-RC1, F2: no coordination, no change -------------------------------------

  it('F2: where the browser cannot coordinate the tabs, a confirmed download is refused before anything is asked of the recognizer', async () => {
    storage.facts = factsFor({ known: true, usage: 1_000_000, quota: 2_000_000_000 }, { canCoordinate: false });
    await session.init();
    expect(state.storage?.canCoordinate).toBe(false);
    await session.install({ confirmed: true });
    expect(log).toEqual([]);
    expect(state.phase).toBe('no-model');
    expect(state.notice).toBe('This browser cannot make sure that only one tab changes the speech model at a time (it has no Web Locks). So the model is not downloaded, replaced or removed here. This request changed nothing.');
  });

  it('a page that offers no download requests nothing, also with room and a confirmation', async () => {
    create(false);
    await session.init();
    await session.install({ confirmed: true });
    expect(log).toEqual([]);
    expect(state).toMatchObject({ phase: 'no-model', notice: 'This page does not offer a model download.' });
  });

  it('explains a refusal for lack of room, a full storage, a busy cache and a browser without coordination, and never advises clearing the site', async () => {
    const capacity = NO_ROOM.capacity;
    const noCoordination = new NoCoordinationError('it has no Web Locks').message;
    const cases: [Error, string][] = [
      [new InstallError('capacity', describeCapacity(capacity), capacity), `The model was not downloaded: there is not enough room for it in this browser, or the browser cannot say. ${describeCapacity(capacity)} ${UNTOUCHED}`],
      [
        new InstallError('storage', 'The browser refused to store model/tokenizer.json: its storage for this site is full.'),
        `The browser could not store the model. Nothing was installed. (The browser refused to store model/tokenizer.json: its storage for this site is full.) ${UNTOUCHED}`
      ],
      [new InstallError('busy', new ModelBusyError().message), 'The speech model is being installed or removed at this moment, in this or another tab of this browser. This request changed nothing.'],
      [new InstallError('uncoordinated', noCoordination), noCoordination],
      [new InstallError('not-confirmed', 'The download of the speech model was not confirmed. Nothing was requested.'), 'The model was not downloaded: the download has to be confirmed first.']
    ];
    for (const [error, notice] of cases) {
      log = [];
      status = DOWNLOAD;
      storage = fakeModelStorage();
      create();
      await session.init();
      install = async () => {
        throw error;
      };
      await session.install({ confirmed: true });
      expect(log).toEqual(['install confirmed', 'release']);
      expect(state.phase).toBe('no-model');
      expect(state.notice).toBe(notice);
      // The only mention of clearing the site's data is the warning against it.
      expect(state.notice!.replace(UNTOUCHED, '')).not.toMatch(/clear|delete|free up|make room/i);
    }
  });

  it('files that a loading refused are checked one by one and reported, and nothing becomes ready', async () => {
    theCacheHolds(INSTALLED);
    storage.problems = ['model/tokenizer.json: does not have the pinned SHA-256'];
    await session.init();
    prepare = async () => {
      throw new ModelFilesError('integrity', 'model/tokenizer.json: does not have the pinned SHA-256');
    };
    await session.prepare();
    expect(log).toEqual(['prepare', 'release']);
    expect(storage.calls).toContain('verify');
    expect(state.phase).toBe('no-model');
    expect(state.notice).toBe('The installed files of the speech model are incomplete or damaged, so they were not used. Remove them and download the model again. (model/tokenizer.json: does not have the pinned SHA-256)');
    expect(state.fileProblems).toEqual(['model/tokenizer.json: does not have the pinned SHA-256']);

    // A check that finds nothing any more still leaves the refusal on the screen.
    storage.problems = [];
    await session.prepare();
    expect(state.fileProblems).toEqual(['The installed files of the speech model are incomplete or damaged, so they were not used. Remove them and download the model again.']);

    // A cache that cannot be read afterwards: nothing is known, so nothing is offered for loading, and nothing is downloaded.
    storage.fail = new Error('the cache cannot be read');
    await session.prepare();
    expect(state).toMatchObject({ phase: 'no-model', installed: false, installation: null, fileProblems: null });
    expect(state.notice).toContain('so they were not used');
    expect(log.filter((entry) => entry.startsWith('install'))).toEqual([]);
  });

  it('another failure of the loading is not taken for damaged files', async () => {
    theCacheHolds(INSTALLED);
    await session.init();
    prepare = async () => {
      throw new Error('The speech model could not be loaded: out of memory');
    };
    await session.prepare();
    expect(state.fileProblems).toBeNull();
    expect(storage.calls).not.toContain('verify');
  });

  it('removing clears the report and reads the cache again', async () => {
    theCacheHolds(INSTALLED);
    storage.problems = ['model/config.json: does not have the pinned SHA-256'];
    await session.init();
    prepare = async () => {
      throw new ModelFilesError('integrity', 'model/config.json: does not have the pinned SHA-256');
    };
    await session.prepare();
    expect(state.fileProblems).toEqual(['model/config.json: does not have the pinned SHA-256']);

    await session.removeModel();
    expect(log).toEqual(['prepare', 'release', 'remove']);
    expect(working).toEqual([null, 'removal', null]);
    expect(state).toMatchObject({ phase: 'no-model', installed: false, fileProblems: null, installation: ABSENT, notice: null });
  });

  it('a removal that is refused changes nothing and says so', async () => {
    theCacheHolds(INSTALLED);
    await session.init();
    remove = async () => {
      throw new ModelBusyError();
    };
    await session.removeModel();
    expect(state).toMatchObject({ phase: 'no-model', installed: true, working: null, installation: INSTALLED });
    expect(state.notice).toBe(`The model could not be deleted: The speech model is being installed or removed at this moment, in this or another tab of this browser. This request changed nothing. ${UNTOUCHED}`);

    // The same where the browser cannot coordinate the tabs at all.
    remove = async () => {
      throw new NoCoordinationError('it has no Web Locks');
    };
    await session.removeModel();
    expect(state).toMatchObject({ phase: 'no-model', installed: true, installation: INSTALLED });
    expect(state.notice).toBe(`The model could not be deleted: This browser cannot make sure that only one tab changes the speech model at a time (it has no Web Locks). So the model is not downloaded, replaced or removed here. This request changed nothing. ${UNTOUCHED}`);
  });

  it('asks the browser to keep the data only when told to, and records each answer as it is', async () => {
    await session.init();
    await session.install();
    await session.refreshStorage();
    expect(storage.calls).not.toContain('askForPersistence');

    await session.askForPersistence();
    expect(storage.calls.filter((call) => call === 'askForPersistence')).toHaveLength(1);
    expect(state.storage).toMatchObject({ persistence: 'best-effort', answer: 'declined' });
    // The answer stays on the screen when the numbers are read again.
    await session.refreshStorage();
    expect(state.storage?.answer).toBe('declined');

    storage.fail = new Error('not allowed here');
    await session.askForPersistence();
    // Nothing can be read while the browser fails: the screen says "not known" again.
    expect(state.storage).toBeNull();
    storage.fail = null;
    await session.refreshStorage();

    storage.answer = 'granted';
    await session.askForPersistence();
    expect(state.storage).toMatchObject({ persistence: 'persistent', answer: 'granted' });
    expect(state.askingPersistence).toBe(false);
  });

  it('a request that fails is recorded as failed', async () => {
    await session.init();
    const failing = storage.like.askForPersistence;
    storage.like.askForPersistence = async () => {
      storage.calls.push('askForPersistence');
      throw new Error('not allowed here');
    };
    await session.askForPersistence();
    expect(state.storage).toMatchObject({ persistence: 'best-effort', answer: 'failed' });
    storage.like.askForPersistence = failing;
  });

  it('does not ask a browser that cannot be asked', async () => {
    storage.facts = NO_ESTIMATE;
    await session.init();
    await session.askForPersistence();
    expect(storage.calls).not.toContain('askForPersistence');
    expect(state.storage?.answer).toBeNull();
  });

  it('a question that the browser leaves open blocks nothing else on the screen', async () => {
    theCacheHolds(INSTALLED);
    await session.init();
    storage.wait = gate();
    const asking = session.askForPersistence();
    await turn();
    expect(state.askingPersistence).toBe(true);
    // A second click while the first question is open asks nothing.
    await session.askForPersistence();
    expect(storage.calls.filter((call) => call === 'askForPersistence')).toHaveLength(1);

    await session.checkFiles();
    expect(state.fileProblems).toEqual([]);
    await session.prepare();
    expect(state.phase).toBe('ready');
    await session.removeModel();
    expect(log).toEqual(['prepare', 'remove']);
    expect(state.askingPersistence).toBe(true);

    storage.answer = 'granted';
    storage.wait.open();
    await asking;
    expect(state).toMatchObject({ askingPersistence: false, installed: false, storage: { answer: 'granted', persistence: 'persistent' } });
  });

  it('checks every installed file on request only, and only when there is an installation', async () => {
    await session.init();
    await session.checkFiles();
    expect(storage.calls).not.toContain('verify');

    theCacheHolds(INSTALLED);
    await session.refreshStorage();
    await session.checkFiles();
    expect(working).toEqual([null, 'files', null]);
    expect(state.fileProblems).toEqual([]);

    storage.problems = ['runtime/ort-wasm-simd-threaded.wasm: does not have the pinned SHA-256'];
    await session.checkFiles();
    expect(state.fileProblems).toEqual(['runtime/ort-wasm-simd-threaded.wasm: does not have the pinned SHA-256']);

    storage.like.verify = async () => {
      throw new Error('the cache cannot be read');
    };
    await session.checkFiles();
    expect(state.fileProblems).toEqual(['The files could not be read: the cache cannot be read']);
  });

  it('reads the storage again on request', async () => {
    await session.init();
    storage.facts = NO_ROOM;
    storage.installation = { state: 'incomplete', bytes: 921, files: 1, otherBytes: 0 };
    await session.refreshStorage();
    expect(state.storage?.capacity.state).toBe('insufficient');
    expect(state.installation).toEqual({ state: 'incomplete', bytes: 921, files: 1, otherBytes: 0 });
    expect(state.installed).toBe(false);
  });
});

describeExperimental('storage lifecycle: session, recognizer, installer and model cache together', () => {
  const KEY_BASE = 'http://localhost:3000/eng-trainer/model-cache/';
  const SOURCE = 'http://localhost:3000/eng-trainer/v3/models/test/';
  let caches: FakeCacheStorage;
  let manager: ReturnType<typeof fakeStorageManager>;
  let locks: ReturnType<typeof fakeLocks>;
  let files: Record<string, Uint8Array>;
  let pinned: PinnedSet;
  let requested: string[];
  let workers: FakeRecognizerWorker[];
  /** Holds the download of one file back, when a test sets it. */
  let hold: { id: string; until: Promise<void> } | null;

  const store = () => createModelStore({ storage: caches, keyBase: KEY_BASE, pinned });
  const sourceUrl = (file: PinnedFile): string => `${SOURCE}${file.id}`;
  const staged = (): string[] => caches.entries(MODEL_CACHE_NAME).filter((url) => url.startsWith(`${KEY_BASE}${pinned.version}/`));

  const fetchFile = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requested.push(url);
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const id = url.slice(SOURCE.length);
    // A held answer ends when the request is aborted, as a browser ends it.
    if (hold?.id === id) await Promise.race([hold.until, new Promise<void>((resolve) => init?.signal?.addEventListener('abort', () => resolve()))]);
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return served(url, inPieces(files[id], 16));
  }) as typeof fetch;

  /** A screen as a tab opens it: its own session and recognizer over the browser's shared cache, estimate and locks. */
  function openScreen(lockManager: LockManagerLike | null = locks) {
    const recognizer = createLocalMlRecognizer({
      store: store(),
      sourceUrl,
      keyBase: KEY_BASE,
      startWorker: () => {
        const worker = new FakeRecognizerWorker();
        workers.push(worker);
        return worker;
      },
      mayDownload: () => true,
      readEstimate: () => readEstimate(manager.like),
      locks: lockManager,
      unsupported: () => null,
      install: (options) => installModel({ ...options, fetchFile })
    });
    const session = createPracticeSession({ recognizer, modelStorage: createModelStorage({ store: store(), manager: () => manager.like, locks: () => lockManager }), recorder: idleRecorder, downloadOffered: true });
    const screen = { session, state: null as unknown as PracticeState };
    session.subscribe((next) => {
      screen.state = next;
    });
    return screen;
  }

  /** Lets the Worker that the session starts next answer with `answer`. */
  async function workerAnswers(count: number, answer: (worker: FakeRecognizerWorker) => void): Promise<void> {
    for (let waited = 0; waited < 100 && workers.length < count; waited += 1) await turn();
    expect(workers).toHaveLength(count);
    answer(last(workers));
  }

  beforeEach(async () => {
    caches = fakeCacheStorage();
    // 64 MB of reserve and a few hundred bytes of files: 200 MB of limit is room enough.
    manager = fakeStorageManager({ usage: 300_000, quota: 200_000_000 });
    locks = fakeLocks();
    requested = [];
    workers = [];
    hold = null;
    files = { 'model/config.json': syntheticBytes(1, 40), 'model/weights.bin': syntheticBytes(2, 100), 'runtime/runtime.wasm': syntheticBytes(3, 70) };
    pinned = await pinnedSet('test-model-1', files);
    const other = await caches.open('another-cache');
    await other.put('http://localhost:3000/kept', new Response('kept'));
  });

  it('low quota: the screen says so and requests nothing; with room, the confirmed download installs and loads', async () => {
    manager.quota = 60_000_000;
    const screen = openScreen();
    await screen.session.init();
    expect(screen.state.storage?.capacity.state).toBe('insufficient');
    await screen.session.install({ confirmed: true });
    expect(requested).toEqual([]);
    expect(caches.names()).toEqual(['another-cache']);
    expect(screen.state.notice).toContain('so the model is not downloaded');

    manager.quota = 200_000_000;
    const preparing = screen.session.install({ confirmed: true });
    await workerAnswers(1, (worker) => worker.load());
    await preparing;
    expect(screen.state).toMatchObject({ phase: 'ready', installed: true, installation: { state: 'installed' } });
    expect(requested).toEqual(pinned.files.map(sourceUrl));
    expect(last(workers).sent[0].message).toEqual({ type: 'load', keyBase: KEY_BASE });
  });

  it('a good estimate at the click and a full storage at a write: nothing is installed, and the retry installs', async () => {
    const screen = openScreen();
    await screen.session.init();
    caches.failPut = (url) => url.endsWith('/model/weights.bin');
    await screen.session.install({ confirmed: true });
    expect(workers).toEqual([]);
    expect(screen.state).toMatchObject({ phase: 'no-model', installed: false, installation: { state: 'absent' } });
    expect(screen.state.notice).toContain('The browser refused to store model/weights.bin: its storage for this site is full.');
    expect(screen.state.notice).toContain('Do not clear the data of this site to make room');
    expect(staged()).toEqual([]);

    caches.failPut = null;
    const preparing = screen.session.install({ confirmed: true });
    await workerAnswers(1, (worker) => worker.load());
    await preparing;
    expect(screen.state.phase).toBe('ready');
    expect(await store().verify()).toEqual([]);
  });

  it('the storage fills up during the download: it ends before the next file, and nothing of it stays', async () => {
    const screen = openScreen();
    await screen.session.init();
    const first = gate();
    hold = { id: 'model/config.json', until: first.promise };
    const preparing = screen.session.install({ confirmed: true });
    for (let waited = 0; waited < 100 && requested.length < 1; waited += 1) await turn();
    // Something else on this site took the room meanwhile.
    manager.usage = 199_000_000;
    first.open();
    await preparing;
    expect(requested).toEqual([sourceUrl(pinned.files[0])]);
    expect(screen.state).toMatchObject({ phase: 'no-model', installed: false, installation: { state: 'absent' } });
    expect(screen.state.notice).toContain('there is not enough room for it in this browser');
    expect(staged()).toEqual([]);
  });

  it('a download that was interrupted by closing the page: a fresh screen shows the leftovers as unusable, and a retry replaces them', async () => {
    // The first page stored two files and was closed. No marker was written.
    await store().stage(pinned.files[0], files['model/config.json'].slice().buffer as ArrayBuffer);
    await store().stage(pinned.files[1], files['model/weights.bin'].slice().buffer as ArrayBuffer);

    const screen = openScreen();
    await screen.session.init();
    expect(screen.state).toMatchObject({ phase: 'no-model', installed: false, installation: { state: 'incomplete', files: 2, bytes: 140 } });
    // Loading is not possible, and it starts no download: that is asked for separately, with its confirmation.
    await screen.session.prepare();
    expect(requested).toEqual([]);
    expect(workers).toEqual([]);
    expect(screen.state).toMatchObject({ phase: 'no-model', installed: false, installation: { state: 'incomplete', files: 2 } });

    const preparing = screen.session.install({ confirmed: true });
    await workerAnswers(1, (worker) => worker.load());
    await preparing;
    expect(screen.state).toMatchObject({ phase: 'ready', installation: { state: 'installed' } });
    expect(requested).toEqual(pinned.files.map(sourceUrl));
  });

  it('a cancelled download leaves nothing, and the next one installs', async () => {
    const screen = openScreen();
    await screen.session.init();
    const second = gate();
    hold = { id: 'model/weights.bin', until: second.promise };
    const preparing = screen.session.install({ confirmed: true });
    for (let waited = 0; waited < 100 && requested.length < 2; waited += 1) await turn();
    expect(screen.state.phase).toBe('installing');
    expect(staged()).toHaveLength(1);
    screen.session.cancelPrepare();
    second.open();
    await preparing;
    expect(screen.state).toMatchObject({ phase: 'no-model', installed: false, notice: null, installation: { state: 'absent' } });
    expect(staged()).toEqual([]);
    expect(locks.held()).toEqual([]);

    hold = null;
    const again = screen.session.install({ confirmed: true });
    await workerAnswers(1, (worker) => worker.load());
    await again;
    expect(screen.state.phase).toBe('ready');
  });

  it('deleting the model while this screen installs it ends the installation first, and then removes: it is not refused as busy', async () => {
    const screen = openScreen();
    await screen.session.init();
    hold = { id: 'model/weights.bin', until: gate().promise };
    const preparing = screen.session.install({ confirmed: true });
    for (let waited = 0; waited < 100 && requested.length < 2; waited += 1) await turn();
    expect(screen.state.phase).toBe('installing');
    expect(locks.held()).toEqual([MODEL_LOCK_NAME]);
    expect(staged()).toHaveLength(1);

    await screen.session.removeModel();
    await preparing;
    expect(screen.state).toMatchObject({ phase: 'no-model', installed: false, notice: null, working: null, installation: { state: 'absent' } });
    expect(caches.names()).toEqual(['another-cache']);
    expect(locks.held()).toEqual([]);
    // Nothing more was requested after the removal.
    expect(requested).toHaveLength(2);
  });

  it('a damaged file is refused at loading: nothing is ready, the file is named, and removing then downloading recovers', async () => {
    const first = openScreen();
    await first.session.init();
    let preparing = first.session.install({ confirmed: true });
    await workerAnswers(1, (worker) => worker.load());
    await preparing;
    first.session.dispose();

    // The stored file changes while no page is open. Its length stays the same.
    caches.corrupt(MODEL_CACHE_NAME, store().fileKey(pinned.files[1]), syntheticBytes(9, 100));

    const screen = openScreen();
    await screen.session.init();
    // By its lengths the installation looks complete. It is offered for loading, not as ready.
    expect(screen.state).toMatchObject({ phase: 'no-model', installed: true, installation: { state: 'installed' } });
    preparing = screen.session.prepare();
    // The Worker reads the file, finds another hash and refuses, as recognizer.worker.ts does.
    await workerAnswers(2, (worker) => {
      worker.emit({ type: 'ready' });
      worker.emit({ type: 'load-failed', reason: 'integrity', message: 'model/weights.bin: does not have the pinned SHA-256' });
    });
    await preparing;
    expect(last(workers).terminated).toBe(true);
    expect(screen.state.phase).toBe('no-model');
    expect(screen.state.fileProblems).toEqual(['model/weights.bin: does not have the pinned SHA-256']);
    expect(screen.state.notice).toContain('so they were not used');

    await screen.session.removeModel();
    expect(caches.names()).toEqual(['another-cache']);
    expect(screen.state).toMatchObject({ phase: 'no-model', installed: false, fileProblems: null, installation: { state: 'absent' } });

    preparing = screen.session.install({ confirmed: true });
    await workerAnswers(3, (worker) => worker.load());
    await preparing;
    expect(screen.state.phase).toBe('ready');
    expect(await store().verify()).toEqual([]);
  });

  it('a missing file makes the installation "damaged": it is not offered for loading, and a new download replaces it', async () => {
    const first = openScreen();
    await first.session.init();
    let preparing = first.session.install({ confirmed: true });
    await workerAnswers(1, (worker) => worker.load());
    await preparing;
    first.session.dispose();
    await (await caches.open(MODEL_CACHE_NAME)).delete(store().fileKey(pinned.files[2]));

    const screen = openScreen();
    await screen.session.init();
    expect(screen.state).toMatchObject({ phase: 'no-model', installed: false, installation: { state: 'damaged', problems: ['runtime/runtime.wasm is missing'] } });
    requested = [];
    preparing = screen.session.install({ confirmed: true });
    await workerAnswers(2, (worker) => worker.load());
    await preparing;
    expect(screen.state).toMatchObject({ phase: 'ready', installation: { state: 'installed' } });
    expect(requested).toEqual(pinned.files.map(sourceUrl));
  });

  it('installing and removing in turn, across fresh screens, never touches another cache', async () => {
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      const screen = openScreen();
      await screen.session.init();
      expect(screen.state).toMatchObject({ phase: 'no-model', installed: false, installation: { state: 'absent' } });
      const preparing = screen.session.install({ confirmed: true });
      await workerAnswers(cycle, (worker) => worker.load());
      await preparing;
      expect(screen.state.phase).toBe('ready');
      screen.session.dispose();

      // A fresh screen finds the installation, and removes it.
      const next = openScreen();
      await next.session.init();
      expect(next.state).toMatchObject({ phase: 'no-model', installed: true, installation: { state: 'installed' } });
      await next.session.removeModel();
      expect(next.state).toMatchObject({ installed: false, installation: { state: 'absent' } });
      expect(caches.names()).toEqual(['another-cache']);
      next.session.dispose();
    }
    expect(caches.entries('another-cache')).toEqual(['http://localhost:3000/kept']);
    expect(await (await (await caches.open('another-cache')).match('http://localhost:3000/kept'))!.text()).toBe('kept');
    expect(locks.held()).toEqual([]);
  });

  it('two tabs: while one installs, the other can neither install nor remove, and the first one completes', async () => {
    const first = openScreen();
    const second = openScreen();
    await first.session.init();
    await second.session.init();

    const held = gate();
    hold = { id: 'model/weights.bin', until: held.promise };
    const installing = first.session.install({ confirmed: true });
    for (let waited = 0; waited < 100 && requested.length < 2; waited += 1) await turn();
    expect(staged()).toHaveLength(1);

    const before = requested.length;
    await second.session.install({ confirmed: true });
    expect(second.state.notice).toBe('The speech model is being installed or removed at this moment, in this or another tab of this browser. This request changed nothing.');
    expect(requested).toHaveLength(before);
    await second.session.removeModel();
    expect(second.state.notice).toContain('The model could not be deleted: The speech model is being installed or removed at this moment');
    // Neither request removed the file that the first tab had stored.
    expect(staged()).toHaveLength(1);

    held.open();
    await workerAnswers(1, (worker) => worker.load());
    await installing;
    expect(first.state).toMatchObject({ phase: 'ready', installation: { state: 'installed' } });
    expect(await store().verify()).toEqual([]);
  });

  // ---- ENG-V3-R1B-RC1: the schedules of the independent review, with the real modules -------------

  const GONE = 'The speech model is not in this browser any more. It may have been removed in another tab. Nothing was downloaded. To record, download the model again.';

  /** Installs the model from a screen of its own and leaves that screen, as an earlier visit did. */
  async function installedEarlier(): Promise<void> {
    const screen = openScreen();
    await screen.session.init();
    const preparing = screen.session.install({ confirmed: true });
    await workerAnswers(workers.length + 1, (worker) => worker.load());
    await preparing;
    expect(screen.state.phase).toBe('ready');
    screen.session.dispose();
  }

  it('F1: tab B removes the model, tab A still offers "Load": the click downloads nothing and starts no Worker', async () => {
    await installedEarlier();
    const a = openScreen();
    const b = openScreen();
    await a.session.init();
    await b.session.init();
    expect(a.state).toMatchObject({ phase: 'no-model', installed: true });

    await b.session.removeModel();
    expect(caches.names()).toEqual(['another-cache']);
    const before = { requests: requested.length, workers: workers.length };
    // A was not told: it still believes in the model.
    expect(a.state.installed).toBe(true);
    await a.session.prepare();

    expect(requested).toHaveLength(before.requests);
    expect(workers).toHaveLength(before.workers);
    expect(a.state).toMatchObject({ phase: 'no-model', installed: false, installation: { state: 'absent' }, fileProblems: null, notice: GONE });
    // Loading wrote nothing either.
    expect(caches.names()).toEqual(['another-cache']);
  });

  it('F1: the reviewer\'s sequence: B removes, A reads again, A loads. "Read again" takes the Load away, and loading requests nothing', async () => {
    await installedEarlier();
    const a = openScreen();
    const b = openScreen();
    await a.session.init();
    await b.session.init();
    await b.session.removeModel();
    await a.session.refreshStorage();
    // The review found { installed: true, inspection: 'absent' } here.
    expect({ phase: a.state.phase, installed: a.state.installed, inspection: a.state.installation?.state }).toEqual({ phase: 'no-model', installed: false, inspection: 'absent' });

    const before = requested.length;
    await a.session.prepare();
    expect(requested).toHaveLength(before);
    expect(a.state).toMatchObject({ phase: 'no-model', installed: false, notice: GONE });

    // The download is a request of its own, and it needs the confirmation.
    await a.session.install();
    expect(requested).toHaveLength(before);
    const installing = a.session.install({ confirmed: true });
    await workerAnswers(workers.length + 1, (worker) => worker.load());
    await installing;
    expect(a.state).toMatchObject({ phase: 'ready', installed: true });
    expect(requested).toHaveLength(before + pinned.files.length);
  });

  it('F1: the other direction: B installs, A reads again and can load, without reopening the screen and without a request', async () => {
    const a = openScreen();
    await a.session.init();
    expect(a.state).toMatchObject({ installed: false, installation: { state: 'absent' } });

    await installedEarlier();
    const before = requested.length;
    // Not told yet.
    expect(a.state.installed).toBe(false);
    await a.session.refreshStorage();
    // The review found { installed: false, inspection: 'installed' } here.
    expect({ phase: a.state.phase, installed: a.state.installed, inspection: a.state.installation?.state }).toEqual({ phase: 'no-model', installed: true, inspection: 'installed' });

    const loading = a.session.prepare();
    await workerAnswers(workers.length + 1, (worker) => worker.load());
    await loading;
    expect(a.state.phase).toBe('ready');
    expect(requested).toHaveLength(before);
  });

  it('F1: B installs while A still offers "Download": A\'s confirmed download finds the model complete, requests nothing and removes nothing', async () => {
    const a = openScreen();
    await a.session.init();
    await installedEarlier();
    const before = requested.length;
    const entries = caches.entries(MODEL_CACHE_NAME);
    expect(a.state.installed).toBe(false);

    const loading = a.session.install({ confirmed: true });
    await workerAnswers(workers.length + 1, (worker) => worker.load());
    await loading;
    expect(a.state).toMatchObject({ phase: 'ready', installed: true });
    expect(requested).toHaveLength(before);
    expect(caches.entries(MODEL_CACHE_NAME)).toEqual(entries);
  });

  it('F1: the files disappear after the recognizer looked and before the Worker reads: the Worker refuses, and nothing is downloaded', async () => {
    await installedEarlier();
    const a = openScreen();
    const b = openScreen();
    await a.session.init();
    await b.session.init();
    const before = requested.length;

    const loading = a.session.prepare();
    for (let waited = 0; waited < 100 && a.state.phase !== 'loading'; waited += 1) await turn();
    const started = workers.length;
    for (let waited = 0; waited < 100 && workers.length === started && a.state.phase === 'loading'; waited += 1) await turn();
    // The Worker has started and has not read anything yet. Now the other tab removes the model.
    await b.session.removeModel();
    const worker = last(workers);
    worker.emit({ type: 'ready' });
    // What recognizer.worker.ts answers when the store finds no cache.
    worker.emit({ type: 'load-failed', reason: 'not-installed', message: 'The speech model is not installed: no model cache' });
    await loading;

    expect(worker.terminated).toBe(true);
    expect(requested).toHaveLength(before);
    expect(a.state).toMatchObject({ phase: 'no-model', installed: false, installation: { state: 'absent' }, fileProblems: null, notice: GONE });
  });

  it('F1: a model that is loaded in A stays loaded when B removes its files, and A says that the files are gone', async () => {
    await installedEarlier();
    const a = openScreen();
    const b = openScreen();
    await a.session.init();
    await b.session.init();
    const loading = a.session.prepare();
    await workerAnswers(workers.length + 1, (worker) => worker.load());
    await loading;
    expect(a.state).toMatchObject({ phase: 'ready', installed: true });
    const worker = last(workers);

    await b.session.removeModel();
    expect(caches.names()).toEqual(['another-cache']);
    await a.session.refreshStorage();
    // In memory: still there. On the device: gone. The two are not mixed up.
    expect(a.state).toMatchObject({ phase: 'ready', installed: false, installation: { state: 'absent' } });
    expect(worker.terminated).toBe(false);
    expect(requested).toHaveLength(pinned.files.length);
  });

  it('F2: a browser without locks installs nothing, and the screen is told why', async () => {
    const screen = openScreen(null);
    await screen.session.init();
    expect(screen.state.storage?.canCoordinate).toBe(false);
    await screen.session.install({ confirmed: true });
    expect(requested).toEqual([]);
    expect(workers).toEqual([]);
    expect(caches.names()).toEqual(['another-cache']);
    expect(screen.state).toMatchObject({ phase: 'no-model', installed: false });
    expect(screen.state.notice).toBe(new NoCoordinationError('it has no Web Locks').message);
  });

  it('F2: a browser without locks removes nothing, also not leftovers, and a complete model can still be loaded', async () => {
    await installedEarlier();
    const entries = caches.entries(MODEL_CACHE_NAME);
    const screen = openScreen(null);
    await screen.session.init();
    expect(screen.state).toMatchObject({ installed: true, storage: { canCoordinate: false } });

    await screen.session.removeModel();
    expect(caches.entries(MODEL_CACHE_NAME)).toEqual(entries);
    expect(screen.state.installed).toBe(true);
    expect(screen.state.notice).toContain('The model could not be deleted: This browser cannot make sure that only one tab changes the speech model at a time (it has no Web Locks).');

    // Loading changes nothing in the cache, so it needs no lock.
    const loading = screen.session.prepare();
    await workerAnswers(workers.length + 1, (worker) => worker.load());
    await loading;
    expect(screen.state.phase).toBe('ready');
  });

  it('F2: a lock that the browser does not give is a refusal too: nothing is requested, and the reason is shown', async () => {
    const screen = openScreen();
    await screen.session.init();
    locks.refuse = new DOMException('The operation is insecure.', 'SecurityError');
    await screen.session.install({ confirmed: true });
    expect(requested).toEqual([]);
    expect(caches.names()).toEqual(['another-cache']);
    expect(screen.state.phase).toBe('no-model');
    expect(screen.state.notice).toBe('This browser cannot make sure that only one tab changes the speech model at a time (the browser gave no lock: The operation is insecure.). So the model is not downloaded, replaced or removed here. This request changed nothing.');

    // With the lock again, the same request installs.
    locks.refuse = null;
    const installing = screen.session.install({ confirmed: true });
    await workerAnswers(1, (worker) => worker.load());
    await installing;
    expect(screen.state.phase).toBe('ready');
  });
});
