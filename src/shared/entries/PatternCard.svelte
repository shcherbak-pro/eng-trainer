<script lang="ts">
  import type { Pattern } from '../../content/types';
  import { splitAlternatives } from '../text';
  import SpeakButton from '../speech/SpeakButton.svelte';

  /**
   * A speaking pattern on the Patterns screen, or a rule inside a learning topic: there
   * the surrounding subsection names it, so only the formula and its use are shown.
   */
  export let pattern: Pick<Pattern, 'formula'> & Partial<Omit<Pattern, 'formula'>>;
  export let headingLevel: 'h2' | 'h3' | 'h4' = 'h2';
  /** Visible label before the formula, e.g. "Pattern". Empty on the Patterns screen. */
  export let formulaLabel = '';

  $: alternatives = splitAlternatives(pattern.commonAlternatives);
</script>

{#if pattern.title}
  <p class="entry__meta">
    {#if pattern.level}<span class="badge">{pattern.level}</span>{/if}
    {#if pattern.tag}<span>{pattern.tag}</span>{/if}
  </p>
  <svelte:element this={headingLevel}>{pattern.title}</svelte:element>
{/if}
{#if formulaLabel}
  <p class="reading-card__formula"><span class="reading-card__formula-label">{formulaLabel}:</span> <span lang="en" translate="no">{pattern.formula}</span></p>
{:else}
  <p class="reading-card__formula" lang="en" translate="no">{pattern.formula}</p>
{/if}
{#if pattern.transcription}<p class="entry__ipa ipa" translate="no">{pattern.transcription}</p>{/if}
{#if pattern.use}<p><strong>Use:</strong> {pattern.use}</p>{/if}
{#if pattern.example}
  <p class="reading-card__english" lang="en" translate="no">{pattern.example}</p>
  {#if pattern.translation}<p class="reading-card__translation" lang="uk">{pattern.translation}</p>{/if}
{/if}
{#if alternatives.length}<p class="alternatives">Also said: <span lang="en" translate="no">{alternatives.join('; ')}</span></p>{/if}
{#if pattern.example}<div><SpeakButton text={pattern.example} label="Listen to example" withText /></div>{/if}
