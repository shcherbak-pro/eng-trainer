<script lang="ts">
  import Button from '../../shared/ui/Button.svelte';
  import { viewState } from '../../state/viewState';

  export let drills: string[];

  function randomPrompt(): void {
    const prompt = drills[Math.floor(Math.random() * drills.length)] ?? '';
    viewState.setCurrentPrompt(prompt);
  }
</script>

<div class="page-stack">
  <article class="prompt-card">
    <!-- The live region stays in place; only a prompt (study text) is protected from translation, not the hint. -->
    <div aria-live="polite">
      {#if $viewState.currentPrompt}
        <p class="prompt-card__text" lang="en" translate="no">{$viewState.currentPrompt}</p>
      {:else}
        <p class="prompt-card__text">Choose “Random prompt” to get a speaking task.</p>
      {/if}
    </div>
    <p class="muted">Suggested flow: think for 10 seconds, speak for 60 seconds, then repeat with a better structure.</p>
    <div><Button variant="primary" icon="shuffle" onClick={randomPrompt}>Random prompt</Button></div>
  </article>

  <section class="entry-group">
    <h2>All prompts</h2>
    <ul class="drill-list">
      {#each drills as drill}<li lang="en" translate="no">{drill}</li>{/each}
    </ul>
  </section>
</div>
