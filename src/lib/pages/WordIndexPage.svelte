<script lang="ts">
  import { progress } from '../stores/progress';
  import type { Materials, WordIndexItem } from '../types/materials';
  import { matchesQuery, uniqueSorted } from '../utils/filters';
  import WordCard from '../components/WordCard.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import SectionSpeechControl from '../components/SectionSpeechControl.svelte';
  import { wordToSpeechItem } from '../utils/speechFormatters';
  import IconButton from '../components/IconButton.svelte';

  export let materials: Materials;

  let selected: WordIndexItem | null = null;

  $: categories = ['All', ...uniqueSorted(materials.wordIndex.map((item) => item.category))];
  $: visible = materials.wordIndex.filter((item) => {
    const hidden = $progress.hiddenWords.includes(item.id);
    if (hidden && !$progress.showHiddenWords) return false;
    if ($progress.wordCategory !== 'All' && item.category !== $progress.wordCategory) return false;
    return matchesQuery($progress.wordQuery, item.term, item.meaning, item.pronunciation, item.category, item.tag);
  }).sort((a, b) => a.term.localeCompare(b.term));

  $: speechItems = visible.map(wordToSpeechItem);

  $: if (!selected && visible.length) selected = visible[0];
  $: if (selected && !visible.some((item) => item.id === selected?.id)) selected = visible[0] ?? null;
</script>

<section class="section-stack">
  <div class="toolbar-card controls-grid">
    <div>
      <h2>Word Index</h2>
      <p>Клік по фразі відкриває переклад, pronunciation і 2 приклади застосування.</p>
    </div>
    <label>
      Search
      <input value={$progress.wordQuery} on:input={(e) => progress.setWordQuery((e.target as HTMLInputElement).value)} placeholder="run into, lack, estimate…" />
    </label>
    <label>
      Category
      <select value={$progress.wordCategory} on:change={(e) => progress.setWordCategory((e.target as HTMLSelectElement).value)}>
        {#each categories as category}
          <option value={category}>{category}</option>
        {/each}
      </select>
    </label>
    <SectionSpeechControl controlId="words-visible" label="Listen words" items={speechItems} help="Reads visible words, translations and examples." />
    <div class="control-actions">
      <IconButton
        icon={$progress.showHiddenWords ? 'visibility_off' : 'visibility'}
        label={$progress.showHiddenWords ? 'Hide hidden words' : 'Show hidden words'}
        variant="secondary"
        onClick={() => progress.toggleShowHidden('word')}
      />
      {#if $progress.hiddenWords.length}
        <IconButton icon="settings_backup_restore" label="Unhide all words" variant="danger" onClick={() => progress.unhideAll('word')} />
      {/if}
    </div>
  </div>

  <div class="split-layout">
    <aside class="index-list card">
      {#each visible as item}
        <button class:active={selected?.id === item.id} on:click={() => selected = item}>
          <strong>{item.term}</strong>
          <small>{item.category}</small>
        </button>
      {/each}
    </aside>
    <div>
      {#if selected}
        <WordCard item={selected} />
      {:else}
        <EmptyState title="No words found" />
      {/if}
    </div>
  </div>
</section>
