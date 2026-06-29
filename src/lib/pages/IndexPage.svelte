<script lang="ts">
  import { progress } from '../stores/progress';
  import type { TrainingBlock } from '../types/materials';
  import EmptyState from '../components/EmptyState.svelte';
  import FocusButton from '../components/FocusButton.svelte';
  import LearnPassManager from '../components/LearnPassManager.svelte';

  export let blocks: TrainingBlock[];
  export let allBlocks: TrainingBlock[];
  export let onOpenBlock: (block: TrainingBlock) => void;
</script>

<section class="section-stack">
  <LearnPassManager {allBlocks} />

  <div class="toolbar-card">
    <div>
      <h2>Learning blocks</h2>
      <p>Index page with access to materials from your active Learn Pass.</p>
    </div>
    <button class="btn secondary" on:click={() => progress.resetAll()}>Reset progress</button>
  </div>

  {#if blocks.length}
    <div class="block-grid">
      {#each blocks as block}
        <article class="card block-card">
          <p class="tag-row"><span>{block.tag ?? block.type}</span>{#if block.itemsCount}<span>{block.itemsCount} items</span>{/if}</p>
          <h3>{block.title}</h3>
          <p>{block.description}</p>
          <div class="card__actions">
            <button class="btn primary" on:click={() => onOpenBlock(block)}>Open</button>
            <FocusButton kind="block" id={block.id} />
          </div>
        </article>
      {/each}
    </div>
  {:else}
    <EmptyState title="No blocks in this Learn Pass" text="Edit the active Learn Pass and select at least one learning block." />
  {/if}
</section>
