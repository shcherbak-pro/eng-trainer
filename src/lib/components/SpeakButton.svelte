<script lang="ts">
  import { speak } from '../utils/speech';
  export let text: string;
  export let label = 'Speak';
</script>

<button class="btn secondary" on:click={() => speak(text)} type="button">{label}</button>
