<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { speak } from '../utils/speech';

  export let text: string;
  export let label = 'Speak';
</script>

<IconButton icon="volume_up" {label} variant="secondary" onClick={() => speak(text)} />
