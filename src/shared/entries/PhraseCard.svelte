<script lang="ts">
  import { progress } from '../../state/progress';
  import type { Phrase, WordExample } from '../../content/types';
  import { splitAlternatives, translationLang } from '../text';
  import SpeakButton from '../speech/SpeakButton.svelte';
  import Button from '../ui/Button.svelte';
  import Icon from '../ui/Icon.svelte';
  import EntryExamples from './EntryExamples.svelte';
  import FocusButton from './FocusButton.svelte';
  import HideButton from './HideButton.svelte';

  export let phrase: Phrase;

  function getExamples(item: Phrase): WordExample[] {
    if (item.examples?.length) return item.examples.slice(0, 2);
    return item.example ? [{ en: item.example }] : [];
  }

  $: learned = $progress.learnedPhrases.includes(phrase.id);
  $: hidden = $progress.hiddenPhrases.includes(phrase.id);
  $: alternatives = splitAlternatives(phrase.commonAlternatives);
  $: examples = getExamples(phrase);
  $: lang = translationLang(phrase);
</script>

<article class:hidden class:learned class="entry phrase-card">
  <SpeakButton text={phrase.phrase} />
  <div class="entry__body">
    <h3 class="entry__term" lang="en" translate="no">{phrase.phrase}</h3>
    <p class="entry__translation" {lang}>{phrase.translation}</p>
    {#if phrase.transcription}<p class="entry__ipa ipa" translate="no">{phrase.transcription}</p>{/if}
    <p class="entry__meta">
      {#if phrase.level}<span class="badge">{phrase.level}</span>{/if}
      <span>{phrase.category}</span>
      {#if learned}<span class="state state--learned"><Icon name="check" size={16} />Learned</span>{/if}
      {#if hidden}<span class="state">Hidden</span>{/if}
    </p>
    <EntryExamples {examples} {alternatives} {lang} />
    <div class="entry__actions">
      <Button
        variant="secondary"
        size="sm"
        icon="check"
        class={learned ? 'is-active' : ''}
        label={learned ? 'Mark as not learned' : 'Mark as learned'}
        onClick={() => progress.toggleLearnedPhrase(phrase.id)}
      >{learned ? 'Learned' : 'Mark as learned'}</Button>
      <FocusButton kind="phrase" id={phrase.id} />
      <HideButton kind="phrase" id={phrase.id} name={phrase.phrase} />
    </div>
  </div>
</article>
