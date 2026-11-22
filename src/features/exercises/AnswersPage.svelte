<script lang="ts">
  import type { ReadyAnswer } from '../../content/types';
  import { splitAlternatives } from '../../shared/text';
  import SpeakButton from '../../shared/speech/SpeakButton.svelte';

  export let answers: ReadyAnswer[];
</script>

<div class="page-stack">
  <p class="muted">Assessment-style answers with translation, transcription and alternatives.</p>
  <ul class="reading-list">
    {#each answers as item}
      {@const alternatives = splitAlternatives(item.commonAlternatives)}
      <li class="reading-card">
        <p class="entry__meta">
          <span>{item.topic}</span>
          {#if item.level}<span class="badge">{item.level}</span>{/if}
          {#if item.tag}<span>{item.tag}</span>{/if}
        </p>
        <h2 lang="en" translate="no">{item.question}</h2>
        {#if item.transcription}<p class="entry__ipa ipa" translate="no">{item.transcription}</p>{/if}
        <p class="reading-card__english" lang="en" translate="no">{item.answer}</p>
        <p class="reading-card__translation" lang="uk">{item.translation}</p>
        {#if alternatives.length}<p class="alternatives">Also said: <span lang="en" translate="no">{alternatives.join('; ')}</span></p>{/if}
        <div><SpeakButton text={item.answer} label="Listen to the answer" withText /></div>
      </li>
    {/each}
  </ul>
</div>
