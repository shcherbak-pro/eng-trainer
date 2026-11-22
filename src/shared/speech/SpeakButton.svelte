<script lang="ts">
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import { speak } from './speech';

  export let text: string;
  export let label = 'Listen';
  /** Show the label next to the icon instead of an icon-only round button. */
  export let withText = false;
</script>

{#if withText}
  <Button variant="secondary" size="sm" icon="listen" onClick={() => speak(text)}>{label}</Button>
{:else}
  <IconButton icon="listen" {label} variant="secondary" round onClick={() => speak(text)} />
{/if}
