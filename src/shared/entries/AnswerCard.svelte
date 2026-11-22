<script lang="ts">
  import type { ReadyAnswer } from '../../content/types';
  import { splitAlternatives } from '../text';
  import SpeakButton from '../speech/SpeakButton.svelte';

  /**
   * One ready answer. On the Answers screen ("list") the question is the heading. Inside a
   * learning topic ("model") the answer sits under the subheadings "Model answer" and
   * "Translation", and the question it answers is named in the text.
   */
  export let answer: ReadyAnswer;
  export let variant: 'list' | 'model' = 'list';
  export let headingLevel: 'h2' | 'h3' | 'h4' = 'h2';

  $: alternatives = splitAlternatives(answer.commonAlternatives);
</script>

{#if variant === 'model'}
  <svelte:element this={headingLevel}>Model answer</svelte:element>
  {#if answer.label}<p class="reading-card__label">{answer.label}</p>{/if}
  <p class="reading-card__question">Question: <span lang="en" translate="no">{answer.question}</span></p>
  <p class="reading-card__english" lang="en" translate="no">{answer.answer}</p>
  <div><SpeakButton text={answer.answer} label="Listen to the model answer" withText /></div>
  <svelte:element this={headingLevel}>Translation</svelte:element>
  <p class="reading-card__translation" lang="uk">{answer.translation}</p>
{:else}
  <p class="entry__meta">
    <span>{answer.topic}</span>
    {#if answer.level}<span class="badge">{answer.level}</span>{/if}
    {#if answer.tag}<span>{answer.tag}</span>{/if}
  </p>
  <svelte:element this={headingLevel} lang="en" translate="no">{answer.question}</svelte:element>
  {#if answer.transcription}<p class="entry__ipa ipa" translate="no">{answer.transcription}</p>{/if}
  {#if answer.label}<p class="reading-card__label">{answer.label}</p>{/if}
  <p class="reading-card__english" lang="en" translate="no">{answer.answer}</p>
  <p class="reading-card__translation" lang="uk">{answer.translation}</p>
  {#if alternatives.length}<p class="alternatives">Also said: <span lang="en" translate="no">{alternatives.join('; ')}</span></p>{/if}
  <div><SpeakButton text={answer.answer} label="Listen to the answer" withText /></div>
{/if}
