<script lang="ts">
  import type { Pattern } from '../types/materials';
  import SpeakButton from '../components/SpeakButton.svelte';
  export let patterns: Pattern[];
</script>

<section class="section-stack">
  <div class="toolbar-card">
    <div>
      <h2>Answer Patterns</h2>
      <p>Frameworks for structured B2 speaking answers.</p>
    </div>
  </div>

  <div class="cards-list">
    {#each patterns as pattern}
      <article class="card">
        <h3>{pattern.title}</h3>
        <p class="formula">{pattern.formula}</p>
        <p><strong>Use:</strong> {pattern.use}</p>
        <p class="example">{pattern.example}</p>
        <p class="translation">{pattern.translation}</p>
        <SpeakButton text={pattern.example} label="Speak example" />
      </article>
    {/each}
  </div>
</section>
