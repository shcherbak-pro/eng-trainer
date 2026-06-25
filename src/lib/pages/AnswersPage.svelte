<script lang="ts">
  import type { ReadyAnswer } from '../types/materials';
  import SpeakButton from '../components/SpeakButton.svelte';
  export let answers: ReadyAnswer[];
</script>

<section class="section-stack">
  <div class="toolbar-card">
    <div>
      <h2>Ready-Made Answers</h2>
      <p>Assessment-style answers with translation.</p>
    </div>
  </div>

  <div class="cards-list">
    {#each answers as item}
      <article class="card">
        <p class="tag-row"><span>{item.topic}</span></p>
        <h3>{item.question}</h3>
        <p class="example">{item.answer}</p>
        <p class="translation">{item.translation}</p>
        <SpeakButton text={item.answer} label="Speak answer" />
      </article>
    {/each}
  </div>
</section>
