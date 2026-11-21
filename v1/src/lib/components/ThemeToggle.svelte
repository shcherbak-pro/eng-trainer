<script lang="ts">
  import MaterialIcon from './MaterialIcon.svelte';
  import { theme, type ThemePreference } from '../stores/theme';

  const sequence: ThemePreference[] = ['system', 'light', 'dark'];

  const labels: Record<ThemePreference, string> = {
    system: 'System',
    light: 'Light',
    dark: 'Dark'
  };

  const icons: Record<ThemePreference, string> = {
    system: 'contrast',
    light: 'light_mode',
    dark: 'dark_mode'
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
  class="theme-toggle btn--icon-only"
  on:click={cycleTheme}
  aria-label={`Theme: ${labels[$theme]}. Switch to ${labels[next]}.`}
  title={`Theme: ${labels[$theme]}. Click to switch to ${labels[next]}.`}
>
  <MaterialIcon name={icons[$theme]} />
</button>
