<script lang="ts">
  import type { WordIndexItem } from '../types/materials';
  import SpeakButton from './SpeakButton.svelte';
  import FocusButton from './FocusButton.svelte';
  import HideButton from './HideButton.svelte';

  export let item: WordIndexItem;

  function normalizeAlternatives(value: WordIndexItem['commonAlternatives']): string[] {
    if (!value) return [];
    return Array.isArray(value) ? value.filter(Boolean) : value.split(';').map((entry) => entry.trim()).filter(Boolean);
  }

  $: transcription = item.transcription ?? item.pronunciation;
  $: alternatives = normalizeAlternatives(item.commonAlternatives);
</script>

<article class="card word-card">
  <div class="card__header">
    <div>
      <p class="tag-row"><span>{item.category}</span>{#if item.level}<span>{item.level}</span>{/if}{#if item.tag}<span>{item.tag}</span>{/if}</p>
      <h3>{item.term}</h3>
      {#if transcription}<p class="meta-line"><strong>Transcription:</strong> <span>{transcription}</span></p>{/if}
      {#if alternatives.length}
        <p class="meta-line common-alternatives"><strong>Common alternatives:</strong> <em>{alternatives.join('; ')}</em></p>
      {/if}
    </div>
  </div>
  <p class="translation"><strong>Meaning:</strong> {item.meaning}</p>
  <div class="examples">
    {#each item.examples.slice(0, 2) as example, index}
      <div class="example-box">
        <strong>Example {index + 1}</strong>
        <p>{example.en}</p>
        {#if example.ua}<p class="translation">{example.ua}</p>{/if}
        <SpeakButton text={example.en} label="Speak example" icon="record_voice_over" />
      </div>
    {/each}
  </div>
  <div class="card__actions">
    <SpeakButton text={item.term} />
    <FocusButton kind="word" id={item.id} />
    <HideButton kind="word" id={item.id} />
  </div>
</article>
