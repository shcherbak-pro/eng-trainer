<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { speak } from '../utils/speech';

  export let text: string;
  export let label = 'Speak';
  export let icon = 'volume_up';
</script>

<IconButton {icon} {label} variant="secondary" onClick={() => speak(text)} />
