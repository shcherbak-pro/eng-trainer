<script lang="ts">
  import type { IrregularVerb } from '../types/materials';
  import SpeakButton from './SpeakButton.svelte';
  import FocusButton from './FocusButton.svelte';
  import HideButton from './HideButton.svelte';

  export let verb: IrregularVerb;
</script>

<article class="card verb-card">
  <div class="card__header">
    <div>
      <p class="tag-row"><span>{verb.group}</span></p>
      <h3>{verb.base} → {verb.pastSimple} → {verb.pastParticiple}</h3>
      <p class="muted">{verb.transcription}</p>
    </div>
  </div>
  <p class="translation"><strong>Translation:</strong> {verb.translation}</p>
  <div class="examples">
    {#each verb.examples.slice(0, 2) as example, index}
      <div class="example-box">
        <strong>Example {index + 1}</strong>
        <p>{example.en}</p>
        <p class="translation">{example.ua}</p>
        <SpeakButton text={example.en} label="Speak" />
      </div>
    {/each}
  </div>
  <div class="card__actions">
    <SpeakButton text={`${verb.base}, ${verb.pastSimple}, ${verb.pastParticiple}`} label="Speak forms" />
    <FocusButton kind="irregular" id={verb.id} />
    <HideButton kind="irregular" id={verb.id} />
  </div>
</article>
