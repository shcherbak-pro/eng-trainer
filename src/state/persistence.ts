import { writable } from 'svelte/store';
import type { AppStorage, WriteOp } from '../storage/database';

/**
 * The write side of persistence.
 *
 * The state services change their in-memory state first and then hand the
 * matching storage operations to `persist`. Operations are committed in order.
 * Everything handed over during the same tick goes into one transaction, so a
 * user action that touches several records is saved completely or not at all.
 *
 * `saveStatus` tells the shell what actually happened:
 * - `saved` is set only after the transaction has completed;
 * - `error` keeps the failed operations queued, so nothing is reported as saved
 *   and the next change or an explicit retry tries again;
 * - `disabled` means the app runs without storage and nothing is saved.
 */
export type SaveStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved' }
  | { state: 'error'; message: string }
  | { state: 'disabled' };

export const saveStatus = writable<SaveStatus>({ state: 'idle' });

let storage: AppStorage | null = null;
let queue: WriteOp[] = [];
let scheduled = false;
let running: Promise<void> | null = null;

/** Called once at startup, after the saved state has been loaded. */
export function connectStorage(next: AppStorage): void {
  storage = next;
  queue = [];
  saveStatus.set({ state: 'idle' });
}

/** The app keeps working in memory, and the shell says so. */
export function disablePersistence(): void {
  storage = null;
  queue = [];
  saveStatus.set({ state: 'disabled' });
}

export function persist(ops: WriteOp[]): void {
  if (!storage || !ops.length) return;

  queue.push(...ops);
  saveStatus.set({ state: 'saving' });

  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    void flush();
  });
}

function flush(): Promise<void> {
  running ??= commitQueue().finally(() => {
    running = null;
  });
  return running;
}

async function commitQueue(): Promise<void> {
  while (storage && queue.length) {
    const batch = queue;
    queue = [];

    try {
      await storage.write(batch);
    } catch (error) {
      // Keep the failed operations first, so a retry replays them in order.
      queue = [...batch, ...queue];
      saveStatus.set({ state: 'error', message: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  if (storage) saveStatus.set({ state: 'saved' });
}

/** Tries to save the changes that could not be saved before. */
export function retrySave(): Promise<void> {
  if (!storage || !queue.length) return Promise.resolve();
  saveStatus.set({ state: 'saving' });
  return flush();
}

/** Resolves when no write is scheduled or running. Used by tests. */
export async function persistenceSettled(): Promise<void> {
  await Promise.resolve();
  while (running) await running;
}
