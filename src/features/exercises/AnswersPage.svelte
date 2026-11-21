<script lang="ts">
  import type { ReadyAnswer } from '../../content/types';
  import { splitAlternatives } from '../../shared/text';
  import SpeakButton from '../../shared/speech/SpeakButton.svelte';

  export let answers: ReadyAnswer[];
</script>

<section class="section-stack">
  <div class="toolbar-card">
    <div>
      <h2>Ready-Made Answers</h2>
      <p>Assessment-style answers with translation, transcription and optional alternatives.</p>
    </div>
  </div>

  <div class="cards-list">
    {#each answers as item}
      {@const alternatives = splitAlternatives(item.commonAlternatives)}
      <article class="card">
        <p class="tag-row">
          <span>{item.topic}</span>
          {#if item.level}<span>{item.level}</span>{/if}
          {#if item.tag}<span>{item.tag}</span>{/if}
        </p>
        <h3>{item.question}</h3>
        {#if item.transcription}
          <p class="meta-line"><strong>Transcription:</strong> <span>{item.transcription}</span></p>
        {/if}
        {#if alternatives.length}
          <p class="meta-line common-alternatives"><strong>Common alternatives:</strong> <em>{alternatives.join('; ')}</em></p>
        {/if}
        <p class="example">{item.answer}</p>
        <p class="translation">{item.translation}</p>
        <SpeakButton text={item.answer} label="Speak answer" />
      </article>
    {/each}
  </div>
</section>
