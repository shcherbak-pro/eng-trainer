<script lang="ts">
  import type { IrregularVerb } from '../../content/types';
  import { progress } from '../../state/progress';
  import { splitAlternatives } from '../text';
  import SpeakButton from '../speech/SpeakButton.svelte';
  import EntryExamples from './EntryExamples.svelte';
  import FocusButton from './FocusButton.svelte';
  import HideButton from './HideButton.svelte';

  export let verb: IrregularVerb;

  $: alternatives = splitAlternatives(verb.commonAlternatives);
  $: forms = `${verb.base} → ${verb.pastSimple} → ${verb.pastParticiple}`;
  $: hidden = $progress.hiddenIrregular.includes(verb.id);
</script>

<article class="entry verb-card" class:hidden>
  <SpeakButton text={`${verb.base}, ${verb.pastSimple}, ${verb.pastParticiple}`} label="Listen to the three forms" />
  <div class="entry__body">
    <h3 class="entry__term" lang="en" translate="no">{forms}</h3>
    <p class="entry__translation" lang="uk">{verb.translation}</p>
    {#if verb.transcription}<p class="entry__ipa ipa" translate="no">{verb.transcription}</p>{/if}
    <p class="entry__meta">
      <span>{verb.group}</span>
      {#if hidden}<span class="state">Hidden</span>{/if}
    </p>
    <EntryExamples examples={verb.examples.slice(0, 2)} {alternatives} lang="uk" />
    <div class="entry__actions">
      <FocusButton kind="irregular" id={verb.id} />
      <HideButton kind="irregular" id={verb.id} name={verb.base} />
    </div>
  </div>
</article>
