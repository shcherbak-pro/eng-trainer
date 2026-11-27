import type { CaptureEnvironment } from './capture/capture';
import { judgeCapacity, needFor, type Estimate, type Persistence, type PersistenceAnswer, type StorageManagerLike } from './models/capacity';
import type { LockManagerLike } from './models/exclusive';
import type { ModelStorage, StorageFacts } from './models/management';
import { PINNED_FILES, type PinnedFile, type PinnedSet } from './models/pinned';
import type { CacheStorageLike, Installation } from './models/store';
import { sha256Hex } from './models/verify';
import type { RecognizerWorker } from './recognition/bootstrap';
import type { FromWorker, ToWorker } from './recognition/protocol';

/**
 * Test helpers of the pronunciation feature: an in-memory Cache Storage, a storage manager
 * and locks under the test's control, small pinned files with real hashes, server answers
 * shaped like a browser's, a fake microphone with a fake audio context, and a fake Worker.
 * Synthetic data only. Nothing here is used by the application.
 */
export type FakeCacheStorage = CacheStorageLike & {
  /** Names of the caches that exist. */
  names(): string[];
  /** Entry addresses of one cache, in the order they were stored. */
  entries(name: string): string[];
  /** Every `put`, in order: `<cache name> <address>`. */
  puts: string[];
  /** Set it to make a `put` for a matching address fail like a full disk. */
  failPut: ((url: string) => boolean) | null;
  /** The name of that failure. Browsers differ: see models/install.ts. */
  failName: string;
  /** Set it to make the deletion of a matching entry fail. */
  failDelete: ((url: string) => boolean) | null;
  /** Replaces the stored bytes of an entry, as a damaged disk would: what was stored with the entry, its length too, stays as it was. */
  corrupt(name: string, url: string, bytes: Uint8Array): void;
  /** The addresses of the entries whose bodies were read, in order. Looking at an entry reads nothing. */
  bodiesRead: string[];
};

const urlOf = (key: RequestInfo | URL): string => (typeof key === 'string' ? key : key instanceof URL ? key.href : key.url);

export function fakeCacheStorage(): FakeCacheStorage {
  const cachesByName = new Map<string, Map<string, { bytes: Uint8Array; type: string; length: string | null }>>();
  const puts: string[] = [];
  const bodiesRead: string[] = [];

  const storage: FakeCacheStorage = {
    puts,
    bodiesRead,
    failPut: null,
    failName: 'QuotaExceededError',
    failDelete: null,
    names: () => [...cachesByName.keys()],
    entries: (name) => [...(cachesByName.get(name)?.keys() ?? [])],
    corrupt(name, url, bytes) {
      const entry = cachesByName.get(name)?.get(url);
      if (!entry) throw new Error(`no entry ${url} in ${name}`);
      entry.bytes = bytes;
    },
    has: async (name) => cachesByName.has(name),
    delete: async (name) => cachesByName.delete(name),
    async open(name) {
      if (!cachesByName.has(name)) cachesByName.set(name, new Map());
      const entries = cachesByName.get(name)!;
      const cache = {
        async match(key: RequestInfo | URL) {
          const url = urlOf(key);
          const entry = entries.get(url);
          if (!entry) return undefined;
          const bytes = entry.bytes.slice();
          // The body is handed out when it is asked for, so a test can tell a look from a read.
          const body = new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                bodiesRead.push(url);
                controller.enqueue(bytes);
                controller.close();
              }
            },
            { highWaterMark: 0 }
          );
          return new Response(body, { headers: { 'Content-Type': entry.type, ...(entry.length === null ? {} : { 'Content-Length': entry.length }) } });
        },
        async put(key: RequestInfo | URL, response: Response) {
          const url = urlOf(key);
          if (storage.failPut?.(url)) throw new DOMException(storage.failName === 'QuotaExceededError' ? 'The quota has been exceeded.' : '', storage.failName);
          entries.set(url, { bytes: new Uint8Array(await response.arrayBuffer()), type: response.headers.get('Content-Type') ?? '', length: response.headers.get('Content-Length') });
          puts.push(`${name} ${url}`);
        },
        async delete(key: RequestInfo | URL) {
          if (storage.failDelete?.(urlOf(key))) throw new DOMException('The entry could not be deleted.', 'UnknownError');
          return entries.delete(urlOf(key));
        },
        async keys() {
          return [...entries.keys()].map((url) => ({ url }) as Request);
        }
      };
      return cache as unknown as Cache;
    }
  };
  return storage;
}

/**
 * A storage manager under the test's control. `usage` and `quota` are what the next
 * estimate says. Each member can be taken away, as in a browser that does not have it.
 */
export function fakeStorageManager(start: { usage?: number; quota?: number; persisted?: boolean; grant?: boolean } = {}) {
  const calls: string[] = [];
  const manager = {
    calls,
    usage: start.usage ?? 1_000_000,
    quota: start.quota ?? 10_000_000_000,
    persisted: start.persisted ?? false,
    /** What the browser answers to a request to keep the data. */
    grant: start.grant ?? false,
    /** Set it to make the next answers fail. */
    fail: null as Error | null,
    /** Set it to hold an answer back, as a browser that asks the learner. */
    wait: null as Gate | null,
    async estimate(): Promise<{ usage?: number; quota?: number }> {
      calls.push('estimate');
      if (manager.fail) throw manager.fail;
      return { usage: manager.usage, quota: manager.quota };
    },
    async persistedNow(): Promise<boolean> {
      calls.push('persisted');
      if (manager.fail) throw manager.fail;
      return manager.persisted;
    },
    async persist(): Promise<boolean> {
      calls.push('persist');
      if (manager.wait) await manager.wait.promise;
      if (manager.fail) throw manager.fail;
      if (manager.grant) manager.persisted = true;
      return manager.grant;
    }
  };
  /** The manager as the application sees it. */
  const like: StorageManagerLike = { estimate: () => manager.estimate(), persisted: () => manager.persistedNow(), persist: () => manager.persist() };
  return Object.assign(manager, { like });
}

/** An estimate with far more room than any test file needs. */
export const roomy = async (): Promise<Estimate> => ({ known: true, usage: 1_000_000, quota: 10_000_000_000 });

/** What `facts()` says for an estimate: for the application's own pinned files, unless `files` says otherwise. */
export function factsFor(estimate: Estimate, options: { files?: readonly Pick<PinnedFile, 'bytes'>[]; reserve?: number; persistence?: Persistence; canAskForPersistence?: boolean; canCoordinate?: boolean } = {}): StorageFacts {
  return {
    estimate,
    capacity: judgeCapacity(estimate, needFor(options.files ?? PINNED_FILES, options.reserve)),
    persistence: options.persistence ?? 'best-effort',
    canAskForPersistence: options.canAskForPersistence ?? true,
    canCoordinate: options.canCoordinate ?? true
  };
}

/**
 * The model's storage as a session sees it, under the test's control: what the cache
 * holds, what the browser says, and what a check of the files and a request to keep the
 * data answer. `fail` makes every answer fail; `wait` holds the browser's answer back.
 */
export function fakeModelStorage(start: { installation?: Installation; facts?: StorageFacts } = {}) {
  const calls: string[] = [];
  const storage = {
    calls,
    installation: start.installation ?? ({ state: 'absent', bytes: 0, otherBytes: 0 } as Installation),
    facts: start.facts ?? factsFor({ known: true, usage: 1_000_000, quota: 10_000_000_000 }),
    problems: [] as string[],
    answer: 'declined' as PersistenceAnswer,
    fail: null as Error | null,
    wait: null as Gate | null
  };
  const answer = async <T>(name: string, value: () => T): Promise<T> => {
    calls.push(name);
    if (storage.fail) throw storage.fail;
    return value();
  };
  const like: ModelStorage = {
    totalBytes: PINNED_FILES.reduce((sum, file) => sum + file.bytes, 0),
    facts: () => answer('facts', () => storage.facts),
    inspect: () => answer('inspect', () => storage.installation),
    verify: () => answer('verify', () => storage.problems),
    async askForPersistence() {
      calls.push('askForPersistence');
      if (storage.wait) await storage.wait.promise;
      if (storage.fail) throw storage.fail;
      if (storage.answer === 'granted') storage.facts = { ...storage.facts, persistence: 'persistent' };
      return storage.answer;
    }
  };
  return Object.assign(storage, { like });
}

/**
 * The browser's locks, for one name at a time: a second request with `ifAvailable` gets
 * no lock while the first one runs. `heldElsewhere` stands for another tab that holds it.
 */
export function fakeLocks() {
  const held = new Set<string>();
  const requests: string[] = [];
  const locks: LockManagerLike & { heldElsewhere: boolean; refuse: Error | null; requests: string[]; held(): string[] } = {
    heldElsewhere: false,
    /** Set it to make the browser give no lock at all: the request fails before anything runs. */
    refuse: null,
    requests,
    held: () => [...held],
    async request<T>(name: string, _options: { ifAvailable: true }, run: (lock: unknown) => Promise<T>): Promise<T> {
      requests.push(name);
      if (locks.refuse) throw locks.refuse;
      if (locks.heldElsewhere || held.has(name)) return run(null);
      held.add(name);
      try {
        return await run({ name });
      } finally {
        held.delete(name);
      }
    }
  };
  return locks;
}

/** The last item of a list. */
export function last<T>(items: readonly T[]): T {
  return items[items.length - 1];
}

/** Bytes of a small synthetic file: `size` bytes that depend on `seed`. */
export function syntheticBytes(seed: number, size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (seed * 31 + index * 7) % 251;
  return bytes;
}

/** A pinned list for the given files, with their real sizes and SHA-256. */
export async function pinnedSet(version: string, files: Record<string, Uint8Array>): Promise<PinnedSet> {
  const list: PinnedFile[] = [];
  for (const [id, bytes] of Object.entries(files)) {
    const [kind, ...rest] = id.split('/');
    list.push({ id, kind: kind as PinnedFile['kind'], path: rest.join('/'), bytes: bytes.byteLength, sha256: await sha256Hex(bytes) });
  }
  return { version, files: list };
}

/**
 * An answer as a browser gives it for a same-origin request: type "basic", and the
 * address that was asked for. `chunks` is the body, piece by piece.
 */
export function served(url: string, chunks: Uint8Array[], overrides: { status?: number; type?: string; url?: string; redirected?: boolean; failAfter?: number } = {}): Response {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (overrides.failAfter !== undefined && sent >= overrides.failAfter) {
        controller.error(new TypeError('network error'));
        return;
      }
      if (sent >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[sent]);
      sent += 1;
    }
  });
  const status = overrides.status ?? 200;
  // A redirect that was not followed has the status 0, which a Response cannot be built with.
  const response = new Response(status === 200 ? body : null, { status: status === 0 ? 200 : status });
  Object.defineProperties(response, {
    status: { value: status },
    ok: { value: status >= 200 && status < 300 },
    type: { value: overrides.type ?? 'basic' },
    url: { value: overrides.url ?? url },
    redirected: { value: overrides.redirected ?? false }
  });
  return response;
}

/** Splits bytes into pieces of `size`, so a download arrives in several reads. */
export function inPieces(bytes: Uint8Array, size: number): Uint8Array[] {
  const pieces: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) pieces.push(bytes.slice(offset, offset + size));
  return pieces;
}

/** Something a test holds back until it calls `open`: a browser step that has not finished yet. */
export type Gate = { promise: Promise<void>; open(): void };

export function gate(): Gate {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

export type FakeTrack = { readyState: 'live' | 'ended'; stopped: boolean; onended: (() => void) | null; stop(): void };
export type FakeContext = { state: string; sampleRate: number; closes: number };
export type FakeCollector = { port: { onmessage: ((event: MessageEvent<Float32Array>) => void) | null }; connected: boolean };

/**
 * A fake microphone and a fake audio context for the recorder. Every step answers at
 * once, unless the test puts a gate in `waits`: then that step stays pending, as a
 * browser may leave it, until the gate is opened.
 */
export function fakeAudio() {
  const log: string[] = [];
  const tracks: FakeTrack[] = [];
  const collectors: FakeCollector[] = [];
  const contexts: FakeContext[] = [];
  const waits: { permission: Gate | null; module: Gate | null; suspend: Gate | null; resume: Gate | null } = { permission: null, module: null, suspend: null, resume: null };
  let microphone: () => Promise<MediaStream> = async () => stream();
  let moduleFails = false;
  let sampleRate = 16000;

  function stream(): MediaStream {
    const track: FakeTrack = {
      readyState: 'live',
      stopped: false,
      onended: null,
      stop() {
        this.stopped = true;
        this.readyState = 'ended';
        log.push('track.stop');
      }
    };
    tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  }

  const environment: CaptureEnvironment = {
    workletUrl: '/eng-trainer/v3/assets/pcm-collector.worklet-abc.js',
    getUserMedia: async (constraints) => {
      log.push(`getUserMedia ${JSON.stringify(constraints)}`);
      const held = waits.permission;
      if (held) await held.promise;
      return microphone();
    },
    createContext: (rate) => {
      const context = {
        state: 'running',
        sampleRate: sampleRate === 16000 ? rate : sampleRate,
        closes: 0,
        destination: { name: 'destination' },
        audioWorklet: {
          addModule: async (url: string) => {
            log.push(`addModule ${url}`);
            const held = waits.module;
            if (held) await held.promise;
            if (moduleFails) throw new Error('the script could not be loaded');
          }
        },
        async suspend() {
          log.push('context.suspend');
          const held = waits.suspend;
          if (held) await held.promise;
          if (context.state !== 'closed') context.state = 'suspended';
        },
        async resume() {
          log.push('context.resume');
          const held = waits.resume;
          if (held) await held.promise;
          if (context.state !== 'closed') context.state = 'running';
        },
        async close() {
          context.state = 'closed';
          context.closes += 1;
          log.push('context.close');
        },
        createMediaStreamSource: () => ({ connect: () => log.push('source.connect'), disconnect: () => log.push('source.disconnect') })
      };
      contexts.push(context);
      log.push(`createContext ${rate}`);
      return context as unknown as AudioContext;
    },
    createCollector: () => {
      const collector = { port: { onmessage: null }, connected: false, connect() { collector.connected = true; }, disconnect() { collector.connected = false; } };
      collectors.push(collector);
      return collector as unknown as AudioWorkletNode;
    }
  };

  return {
    environment, log, tracks, collectors, contexts, waits,
    /** Delivers a block of samples, as the worklet does. */
    hear: (samples: Float32Array) => last(collectors).port.onmessage?.({ data: samples } as MessageEvent<Float32Array>),
    setMicrophone: (next: () => Promise<MediaStream>) => { microphone = next; },
    stream,
    failModule: () => { moduleFails = true; },
    setSampleRate: (rate: number) => { sampleRate = rate; }
  };
}

/** A Worker under the test's control: it records what it is sent, and answers or fails when told to. */
export class FakeRecognizerWorker implements RecognizerWorker {
  sent: { message: ToWorker; transfer: Transferable[] }[] = [];
  terminated = false;
  /** Set it to make the next `postMessage` throw, as for a message that cannot be copied. */
  refusePost: Error | null = null;
  private listeners = new Map<string, Set<(event: Event) => void>>();

  postMessage(message: unknown, transfer?: unknown): void {
    if (this.refusePost) throw this.refusePost;
    this.sent.push({ message: message as ToWorker, transfer: (transfer as Transferable[]) ?? [] });
  }
  terminate(): void {
    this.terminated = true;
  }
  addEventListener(type: string, listener: unknown): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener as (event: Event) => void);
  }
  removeEventListener(type: string, listener: unknown): void {
    this.listeners.get(type)?.delete(listener as (event: Event) => void);
  }
  /** A message from the Worker. */
  emit(message: FromWorker): void {
    for (const listener of [...(this.listeners.get('message') ?? [])]) listener({ data: message } as MessageEvent);
  }
  /** The Worker's own failure channels: an uncaught error, or a message that cannot be read. */
  fail(type: 'error' | 'messageerror' = 'error'): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(new Event(type));
  }
  /** The Worker module has started and has loaded the model. */
  load(): void {
    this.emit({ type: 'ready' });
    this.emit({ type: 'loaded', loadMs: 5 });
  }
  /** The numbers of the recordings it was asked to recognize. */
  requests(): number[] {
    return this.sent.map((item) => item.message).filter((message): message is Extract<ToWorker, { type: 'transcribe' }> => message.type === 'transcribe').map((message) => message.id);
  }
}
