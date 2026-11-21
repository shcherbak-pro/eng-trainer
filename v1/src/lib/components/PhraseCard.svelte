<script lang="ts">
  import { progress } from '../stores/progress';
  import type { Phrase, WordExample } from '../types/materials';
  import SpeakButton from './SpeakButton.svelte';
  import FocusButton from './FocusButton.svelte';
  import HideButton from './HideButton.svelte';
  import IconButton from './IconButton.svelte';

  export let phrase: Phrase;

  function normalizeAlternatives(value: Phrase['commonAlternatives']): string[] {
    if (!value) return [];
    return Array.isArray(value) ? value.filter(Boolean) : value.split(';').map((item) => item.trim()).filter(Boolean);
  }

  function getExamples(item: Phrase): WordExample[] {
    if (item.examples?.length) return item.examples.slice(0, 2);
    return item.example ? [{ en: item.example }] : [];
  }

  $: learned = $progress.learnedPhrases.includes(phrase.id);
  $: hidden = $progress.hiddenPhrases.includes(phrase.id);
  $: alternatives = normalizeAlternatives(phrase.commonAlternatives);
  $: examples = getExamples(phrase);
  $: exampleSpeech = examples.map((example) => example.en).join(' ');
</script>

<article class:hidden class:learned class="card phrase-card">
  <div class="card__header">
    <div>
      <p class="tag-row"><span>{phrase.category}</span>{#if phrase.level}<span>{phrase.level}</span>{/if}{#if phrase.tag}<span>{phrase.tag}</span>{/if}</p>
      <h3>{phrase.phrase}</h3>
      {#if phrase.transcription}
        <p class="meta-line"><strong>Transcription:</strong> <span>{phrase.transcription}</span></p>
      {/if}
      {#if alternatives.length}
        <p class="meta-line common-alternatives"><strong>Common alternatives:</strong> <em>{alternatives.join('; ')}</em></p>
      {/if}
    </div>
    <IconButton
      icon={learned ? 'task_alt' : 'check_circle'}
      label={learned ? 'Mark as not learned' : 'Mark as learned'}
      variant="learned-btn"
      active={learned}
      onClick={() => progress.toggleLearnedPhrase(phrase.id)}
    />
  </div>

  <p class="translation">{phrase.translation}</p>

  {#if examples.length}
    <div class="examples">
      {#each examples as example, index}
        <div class="example-box">
          <strong>Example {index + 1}</strong>
          <p class="example">{example.en}</p>
          {#if example.ua}<p class="translation">{example.ua}</p>{/if}
        </div>
      {/each}
    </div>
  {/if}

  <div class="card__actions">
    <SpeakButton text={phrase.phrase} />
    {#if exampleSpeech}<SpeakButton text={exampleSpeech} label="Speak example" icon="record_voice_over" />{/if}
    <FocusButton kind="phrase" id={phrase.id} />
    <HideButton kind="phrase" id={phrase.id} />
  </div>
</article>
