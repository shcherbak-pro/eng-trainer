import { writable } from 'svelte/store';

/**
 * One short confirmation at a time, optionally with one action such as Undo.
 * A toast never holds the only way to reverse something: every Undo has a
 * permanent alternative elsewhere in the interface.
 */
/**
 * A toast action may return the element that should receive keyboard focus once
 * it has finished (for Undo: the restored entry), or null when there is none.
 */
export type ToastAction = () => HTMLElement | null | void | Promise<HTMLElement | null | void>;

export type Toast = {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: ToastAction;
};

const DEFAULT_DURATION = 6000;
const store = writable<Toast | null>(null);
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;
let remaining = DEFAULT_DURATION;
let startedAt = 0;
let paused = false;

function schedule(ms: number): void {
  clearTimeout(timer);
  remaining = ms;
  startedAt = Date.now();
  timer = setTimeout(() => store.set(null), ms);
}

export const toast = { subscribe: store.subscribe };

export function showToast(message: string, options: { actionLabel?: string; onAction?: ToastAction; duration?: number } = {}): void {
  paused = false;
  store.set({ id: nextId++, message, actionLabel: options.actionLabel, onAction: options.onAction });
  schedule(options.duration ?? DEFAULT_DURATION);
}

export function dismissToast(): void {
  clearTimeout(timer);
  paused = false;
  store.set(null);
}

/** Hover or keyboard focus keeps the toast on screen. */
export function pauseToast(): void {
  if (paused) return;
  paused = true;
  clearTimeout(timer);
  remaining = Math.max(1500, remaining - (Date.now() - startedAt));
}

export function resumeToast(): void {
  if (!paused) return;
  paused = false;
  schedule(remaining);
}
