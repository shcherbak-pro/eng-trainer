<script lang="ts">
  import { progress } from '../stores/progress';
  import type { Phrase } from '../types/materials';
  import SpeakButton from './SpeakButton.svelte';
  import FocusButton from './FocusButton.svelte';
  import HideButton from './HideButton.svelte';
  import IconButton from './IconButton.svelte';

  export let phrase: Phrase;

  $: learned = $progress.learnedPhrases.includes(phrase.id);
  $: hidden = $progress.hiddenPhrases.includes(phrase.id);
</script>

<article class:hidden class:learned class="card phrase-card">
  <div class="card__header">
    <div>
      <p class="tag-row"><span>{phrase.category}</span>{#if phrase.level}<span>{phrase.level}</span>{/if}{#if phrase.tag}<span>{phrase.tag}</span>{/if}</p>
      <h3>{phrase.phrase}</h3>
    </div>
    <IconButton
      icon={learned ? 'task_alt' : 'check_circle'}
      label={learned ? 'Mark as not learned' : 'Mark as learned'}
      variant="learned-btn"
      active={learned}
      onClick={() => progress.toggleLearnedPhrase(phrase.id)}
    />
  </div>
  <p class="example">{phrase.example}</p>
  <p class="translation">{phrase.translation}</p>
  <div class="card__actions">
    <SpeakButton text={phrase.phrase} />
    <SpeakButton text={phrase.example} label="Speak example" icon="record_voice_over" />
    <FocusButton kind="phrase" id={phrase.id} />
    <HideButton kind="phrase" id={phrase.id} />
  </div>
</article>
