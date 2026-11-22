<script lang="ts">
  import type { Pattern } from '../../content/types';
  import PatternCard from '../../shared/entries/PatternCard.svelte';

  export let patterns: Pattern[];
</script>

<div class="page-stack">
  <p class="muted">Structured frameworks for B2 to C1 speaking answers, with use cases, examples, transcription and alternatives.</p>
  <ul class="reading-list">
    {#each patterns as pattern}
      <li class="reading-card"><PatternCard {pattern} /></li>
    {/each}
  </ul>
</div>
