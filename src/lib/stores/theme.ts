import { writable } from 'svelte/store';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'englishAssessmentTrainer.theme.v1';
const allowedPreferences: ThemePreference[] = ['system', 'light', 'dark'];

function canUseDom(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function readPreference(): ThemePreference {
  if (!canUseDom()) return 'system';

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY) as ThemePreference | null;
    return saved && allowedPreferences.includes(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

function getSystemTheme(): ResolvedTheme {
  if (!canUseDom()) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? getSystemTheme() : preference;
}

function applyTheme(preference: ThemePreference): void {
  if (!canUseDom()) return;

  const resolved = resolveTheme(preference);
  const root = document.documentElement;

  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.content = resolved === 'dark' ? '#111820' : '#263238';
  }
}

function savePreference(preference: ThemePreference): void {
  if (!canUseDom()) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // The theme still works when localStorage is unavailable.
  }
}

const initialPreference = readPreference();
const store = writable<ThemePreference>(initialPreference);
let currentPreference = initialPreference;

store.subscribe((preference) => {
  currentPreference = preference;
  savePreference(preference);
  applyTheme(preference);
});

if (canUseDom()) {
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  systemTheme.addEventListener('change', () => {
    if (currentPreference === 'system') {
      applyTheme('system');
    }
  });
}

export const theme = {
  subscribe: store.subscribe,
  set: (preference: ThemePreference) => store.set(preference)
};
