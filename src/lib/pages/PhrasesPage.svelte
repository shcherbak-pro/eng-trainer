<script lang="ts">
  import { progress } from '../stores/progress';
  import type { Materials } from '../types/materials';
  import { matchesQuery, uniqueSorted } from '../utils/filters';
  import PhraseCard from '../components/PhraseCard.svelte';
  import EmptyState from '../components/EmptyState.svelte';

  export let materials: Materials;

  $: categories = ['All', ...uniqueSorted(materials.phrases.map((item) => item.category))];
  $: visible = materials.phrases.filter((item) => {
    const hidden = $progress.hiddenPhrases.includes(item.id);
    if (hidden && !$progress.showHiddenPhrases) return false;
    if ($progress.phraseCategory !== 'All' && item.category !== $progress.phraseCategory) return false;
    return matchesQuery($progress.phraseQuery, item.phrase, item.example, item.translation, item.category, item.tag);
  });
</script>

<section class="section-stack">
  <div class="toolbar-card controls-grid">
    <div>
      <h2>Phrases</h2>
      <p>Фрази, приклади, переклади, learned / hide / focus.</p>
    </div>
    <label>
      Search
      <input value={$progress.phraseQuery} on:input={(e) => progress.setPhraseQuery((e.target as HTMLInputElement).value)} placeholder="AI, otherwise, meeting…" />
    </label>
    <label>
      Category
      <select value={$progress.phraseCategory} on:change={(e) => progress.setPhraseCategory((e.target as HTMLSelectElement).value)}>
        {#each categories as category}
          <option value={category}>{category}</option>
        {/each}
      </select>
    </label>
    <div class="control-actions">
      <button class="btn secondary" on:click={() => progress.toggleShowHidden('phrase')}>{$progress.showHiddenPhrases ? 'Hide hidden' : 'Show hidden'}</button>
      {#if $progress.hiddenPhrases.length}
        <button class="btn danger" on:click={() => progress.unhideAll('phrase')}>Unhide all</button>
      {/if}
    </div>
  </div>

  {#if visible.length}
    <div class="cards-list">
      {#each visible as phrase (phrase.id)}
        <PhraseCard {phrase} />
      {/each}
    </div>
  {:else}
    <EmptyState title="No phrases found" />
  {/if}
</section>
