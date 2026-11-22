<script lang="ts">
  import type { Pattern } from '../../content/types';
  import { splitAlternatives } from '../../shared/text';
  import SpeakButton from '../../shared/speech/SpeakButton.svelte';

  export let patterns: Pattern[];
</script>

<div class="page-stack">
  <p class="muted">Structured frameworks for B2 to C1 speaking answers, with use cases, examples, transcription and alternatives.</p>
  <ul class="reading-list">
    {#each patterns as pattern}
      {@const alternatives = splitAlternatives(pattern.commonAlternatives)}
      <li class="reading-card">
        <p class="entry__meta">
          {#if pattern.level}<span class="badge">{pattern.level}</span>{/if}
          {#if pattern.tag}<span>{pattern.tag}</span>{/if}
        </p>
        <h2>{pattern.title}</h2>
        <p class="reading-card__formula" lang="en" translate="no">{pattern.formula}</p>
        {#if pattern.transcription}<p class="entry__ipa ipa" translate="no">{pattern.transcription}</p>{/if}
        <p><strong>Use:</strong> {pattern.use}</p>
        <p class="reading-card__english" lang="en" translate="no">{pattern.example}</p>
        <p class="reading-card__translation" lang="uk">{pattern.translation}</p>
        {#if alternatives.length}<p class="alternatives">Also said: <span lang="en" translate="no">{alternatives.join('; ')}</span></p>{/if}
        <div><SpeakButton text={pattern.example} label="Listen to example" withText /></div>
      </li>
    {/each}
  </ul>
</div>
