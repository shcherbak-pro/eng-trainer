<script lang="ts">
  import type { IrregularVerb } from '../types/materials';
  import SpeakButton from './SpeakButton.svelte';
  import FocusButton from './FocusButton.svelte';
  import HideButton from './HideButton.svelte';

  export let verb: IrregularVerb;

  function normalizeAlternatives(value: IrregularVerb['commonAlternatives']): string[] {
    if (!value) return [];
    return Array.isArray(value) ? value.filter(Boolean) : value.split(';').map((entry) => entry.trim()).filter(Boolean);
  }

  $: alternatives = normalizeAlternatives(verb.commonAlternatives);
</script>

<article class="card verb-card">
  <div class="card__header">
    <div>
      <p class="tag-row"><span>{verb.group}</span></p>
      <h3>{verb.base} → {verb.pastSimple} → {verb.pastParticiple}</h3>
      <p class="meta-line"><strong>Transcription:</strong> <span>{verb.transcription}</span></p>
      {#if alternatives.length}
        <p class="meta-line common-alternatives"><strong>Common alternatives:</strong> <em>{alternatives.join('; ')}</em></p>
      {/if}
    </div>
  </div>
  <p class="translation"><strong>Translation:</strong> {verb.translation}</p>
  <div class="examples">
    {#each verb.examples.slice(0, 2) as example, index}
      <div class="example-box">
        <strong>Example {index + 1}</strong>
        <p>{example.en}</p>
        {#if example.ua}<p class="translation">{example.ua}</p>{/if}
        <SpeakButton text={example.en} label="Speak example" icon="record_voice_over" />
      </div>
    {/each}
  </div>
  <div class="card__actions">
    <SpeakButton text={`${verb.base}, ${verb.pastSimple}, ${verb.pastParticiple}`} label="Speak forms" />
    <FocusButton kind="irregular" id={verb.id} />
    <HideButton kind="irregular" id={verb.id} />
  </div>
</article>
