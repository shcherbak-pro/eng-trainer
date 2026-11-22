<script lang="ts">
  import Icon from '../shared/ui/Icon.svelte';
  import type { IconName } from '../shared/ui/icons';
  import { settings, type ThemePreference } from '../state/settings';

  const sequence: ThemePreference[] = ['system', 'light', 'dark'];

  const labels: Record<ThemePreference, string> = {
    system: 'System',
    light: 'Light',
    dark: 'Dark'
  };

  const icons: Record<ThemePreference, IconName> = {
    system: 'contrast',
    light: 'sun',
    dark: 'moon'
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
  class="theme-toggle"
  on:click={() => settings.setTheme(next)}
  aria-label={`Theme: ${labels[theme]}. Switch to ${labels[next]}.`}
  title={`Theme: ${labels[theme]}. Click to switch to ${labels[next]}.`}
>
  <Icon name={icons[theme]} />
  <span>Theme: {labels[theme]}</span>
</button>
