<script lang="ts">
  import type { WordIndexItem } from '../../content/types';
  import { progress } from '../../state/progress';
  import { splitAlternatives, translationLang } from '../text';
  import SpeakButton from '../speech/SpeakButton.svelte';
  import EntryExamples from './EntryExamples.svelte';
  import FocusButton from './FocusButton.svelte';
  import HideButton from './HideButton.svelte';

  export let item: WordIndexItem;

  const letters = (value: string) => value.replace(/[^\p{L}]/gu, '').toLowerCase();

  // Some built-in entries store the plain English text as "pronunciation"; show only a real transcription.
  $: transcription = item.transcription ?? item.pronunciation;
  $: showTranscription = Boolean(transcription) && letters(transcription ?? '') !== letters(item.term);
  $: alternatives = splitAlternatives(item.commonAlternatives);
  $: hidden = $progress.hiddenWords.includes(item.id);
  $: lang = translationLang(item);
</script>

<article class="entry word-card" class:hidden>
  <SpeakButton text={item.term} />
  <div class="entry__body">
    <h3 class="entry__term" lang="en" translate="no">{item.term}</h3>
    <p class="entry__translation" {lang}>{item.meaning}</p>
    {#if showTranscription}<p class="entry__ipa ipa" translate="no">{transcription}</p>{/if}
    <p class="entry__meta">
      {#if item.level}<span class="badge">{item.level}</span>{/if}
      <span>{item.category}</span>
      {#if hidden}<span class="state">Hidden</span>{/if}
    </p>
    <EntryExamples examples={item.examples.slice(0, 2)} {alternatives} {lang} />
    <div class="entry__actions">
      <FocusButton kind="word" id={item.id} />
      <HideButton kind="word" id={item.id} name={item.term} />
    </div>
  </div>
</article>
