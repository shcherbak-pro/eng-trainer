<script lang="ts">
  import type { ReadyAnswer } from '../../content/types';
  import AnswerCard from '../../shared/entries/AnswerCard.svelte';

  export let answers: ReadyAnswer[];
</script>

<div class="page-stack">
  <p class="muted">Assessment-style answers with translation, transcription and alternatives.</p>
  <ul class="reading-list">
    {#each answers as item}
      <li class="reading-card"><AnswerCard answer={item} /></li>
    {/each}
  </ul>
</div>
