import { settings, type ThemePreference } from '../state/settings';

type ResolvedTheme = 'light' | 'dark';

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(preference: ThemePreference): void {
  const resolved = preference === 'system' ? systemTheme() : preference;
  const root = document.documentElement;

  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.content = resolved === 'dark' ? '#111820' : '#263238';
  }
}

/**
 * Keeps the document theme in line with the theme preference.
 *
 * `index.html` applies the system theme before the app starts. The saved
 * preference is applied as soon as the settings have been loaded.
 */
export function startThemeSync(): void {
  let current: ThemePreference = 'system';

  settings.subscribe((state) => {
    current = state.theme;
    applyTheme(current);
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (current === 'system') applyTheme('system');
  });
}
