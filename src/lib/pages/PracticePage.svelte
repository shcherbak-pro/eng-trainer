<script lang="ts">
  import { progress } from '../stores/progress';
  export let drills: string[];

  function randomPrompt(): void {
    const prompt = drills[Math.floor(Math.random() * drills.length)] ?? '';
    progress.setCurrentPrompt(prompt);
  }
</script>

<section class="section-stack">
  <div class="toolbar-card">
    <div>
      <h2>Practice Mode</h2>
      <p>Random prompts for active recall and 60–90 second speaking practice.</p>
    </div>
    <button class="btn primary" on:click={randomPrompt}>Random prompt</button>
  </div>

  <article class="card practice-card">
    <h3>{$progress.currentPrompt || 'Click “Random prompt” to start.'}</h3>
    <p class="muted">Suggested flow: think for 10 seconds → speak for 60 seconds → repeat with better structure.</p>
  </article>

  <div class="cards-list compact">
    {#each drills as drill}
      <article class="card compact-card">{drill}</article>
    {/each}
  </div>
</section>
