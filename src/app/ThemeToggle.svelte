<script lang="ts">
  import MaterialIcon from '../shared/ui/MaterialIcon.svelte';
  import { settings, type ThemePreference } from '../state/settings';

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

  $: theme = $settings.theme;
  $: next = nextPreference(theme);
</script>

<button
  type="button"
  class="theme-toggle btn--icon-only"
  on:click={() => settings.setTheme(next)}
  aria-label={`Theme: ${labels[theme]}. Switch to ${labels[next]}.`}
  title={`Theme: ${labels[theme]}. Click to switch to ${labels[next]}.`}
>
  <MaterialIcon name={icons[theme]} />
</button>
