<script lang="ts">
  import IconButton from '../ui/IconButton.svelte';
  import { speak } from './speech';

  export let text: string;
  export let label = 'Speak';
  export let icon = 'volume_up';
</script>

<IconButton {icon} {label} variant="secondary" onClick={() => speak(text)} />
