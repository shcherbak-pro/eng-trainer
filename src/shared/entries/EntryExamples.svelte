<script lang="ts">
  import type { WordExample } from '../../content/types';
  import SpeakButton from '../speech/SpeakButton.svelte';

  export let examples: WordExample[] = [];
  export let alternatives: string[] = [];
  /** Language of the example translations ("" when unknown). */
  export let lang: 'uk' | '' = 'uk';

  $: summary = examples.length && alternatives.length ? 'Examples and alternatives' : examples.length ? (examples.length === 1 ? 'Example' : 'Examples') : 'Alternatives';
</script>

{#if examples.length || alternatives.length}
  <details class="entry__more">
    <summary>{summary}</summary>
    <div class="entry__more-body">
      {#each examples as example}
        <div class="example">
          <div>
            <p class="example__text" lang="en" translate="no">{example.en}</p>
            {#if example.ua}<p class="example__translation" {lang}>{example.ua}</p>{/if}
          </div>
          <SpeakButton text={example.en} label="Listen to example" />
        </div>
      {/each}
      {#if alternatives.length}
        <p class="alternatives">Also said: <span lang="en" translate="no">{alternatives.join('; ')}</span></p>
      {/if}
    </div>
  </details>
{/if}
