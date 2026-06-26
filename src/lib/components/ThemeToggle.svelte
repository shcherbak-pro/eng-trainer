<script lang="ts">
  import { theme, type ThemePreference } from '../stores/theme';

  const sequence: ThemePreference[] = ['system', 'light', 'dark'];

  const labels: Record<ThemePreference, string> = {
    system: 'System',
    light: 'Light',
    dark: 'Dark'
  };

  const icons: Record<ThemePreference, string> = {
    system: '◐',
    light: '☀',
    dark: '☾'
  };

  function nextPreference(current: ThemePreference): ThemePreference {
    const currentIndex = sequence.indexOf(current);
    return sequence[(currentIndex + 1) % sequence.length];
  }

  function cycleTheme(): void {
    theme.set(nextPreference($theme));
  }

  $: next = nextPreference($theme);
</script>

<button
  type="button"
  class="theme-toggle"
  on:click={cycleTheme}
  aria-label={`Theme: ${labels[$theme]}. Switch to ${labels[next]}.`}
  title={`Theme: ${labels[$theme]}. Click to switch to ${labels[next]}.`}
>
  <span class="theme-toggle__icon" aria-hidden="true">{icons[$theme]}</span>
  <span class="theme-toggle__label">{labels[$theme]}</span>
</button>
