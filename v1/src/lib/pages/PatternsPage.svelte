<script lang="ts">
  import type { Pattern } from '../types/materials';
  import SpeakButton from '../components/SpeakButton.svelte';

  export let patterns: Pattern[];

  function normalizeAlternatives(value: Pattern['commonAlternatives']): string[] {
    if (!value) return [];
    return Array.isArray(value) ? value.filter(Boolean) : value.split(';').map((item) => item.trim()).filter(Boolean);
  }
</script>

<section class="section-stack">
  <div class="toolbar-card">
    <div>
      <h2>Answer Patterns</h2>
      <p>Structured frameworks for B2 → C1 speaking answers, with use cases, examples, transcription and alternatives.</p>
    </div>
  </div>

  <div class="cards-list">
    {#each patterns as pattern}
      {@const alternatives = normalizeAlternatives(pattern.commonAlternatives)}
      <article class="card">
        <p class="tag-row">
          {#if pattern.level}<span>{pattern.level}</span>{/if}
          {#if pattern.tag}<span>{pattern.tag}</span>{/if}
        </p>
        <h3>{pattern.title}</h3>
        <p class="formula">{pattern.formula}</p>
        {#if pattern.transcription}
          <p class="meta-line"><strong>Transcription:</strong> <span>{pattern.transcription}</span></p>
        {/if}
        {#if alternatives.length}
          <p class="meta-line common-alternatives"><strong>Common alternatives:</strong> <em>{alternatives.join('; ')}</em></p>
        {/if}
        <p><strong>Use:</strong> {pattern.use}</p>
        <p class="example">{pattern.example}</p>
        <p class="translation">{pattern.translation}</p>
        <SpeakButton text={pattern.example} label="Speak example" icon="record_voice_over" />
      </article>
    {/each}
  </div>
</section>
