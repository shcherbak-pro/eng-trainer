<script lang="ts">
  import type { WordIndexItem } from '../types/materials';
  import SpeakButton from './SpeakButton.svelte';
  import FocusButton from './FocusButton.svelte';
  import HideButton from './HideButton.svelte';

  export let item: WordIndexItem;
</script>

<article class="card word-card">
  <div class="card__header">
    <div>
      <p class="tag-row"><span>{item.category}</span>{#if item.level}<span>{item.level}</span>{/if}{#if item.tag}<span>{item.tag}</span>{/if}</p>
      <h3>{item.term}</h3>
      <p class="muted">Pronunciation: {item.pronunciation}</p>
    </div>
  </div>
  <p class="translation"><strong>Meaning:</strong> {item.meaning}</p>
  <div class="examples">
    {#each item.examples.slice(0, 2) as example, index}
      <div class="example-box">
        <strong>Example {index + 1}</strong>
        <p>{example.en}</p>
        <p class="translation">{example.ua}</p>
        <SpeakButton text={example.en} label="Speak" />
      </div>
    {/each}
  </div>
  <div class="card__actions">
    <SpeakButton text={item.term} />
    <FocusButton kind="word" id={item.id} />
    <HideButton kind="word" id={item.id} />
  </div>
</article>
