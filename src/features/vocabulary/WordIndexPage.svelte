<script lang="ts">
  import type { ContentCatalog } from '../../content/catalog';
  import type { WordIndexItem } from '../../content/types';
  import { progress } from '../../state/progress';
  import { settings } from '../../state/settings';
  import { viewState } from '../../state/viewState';
  import WordCard from '../../shared/entries/WordCard.svelte';
  import EmptyState from '../../shared/ui/EmptyState.svelte';
  import SectionSpeechControl from '../../shared/speech/SectionSpeechControl.svelte';
  import { wordToSpeechItem } from '../../shared/speech/speechFormatters';
  import IconButton from '../../shared/ui/IconButton.svelte';
  import PaginationControls from '../../shared/ui/PaginationControls.svelte';
  import { paginate, totalPages, type PageSizeOption } from '../../shared/pagination';

  export let catalog: ContentCatalog;

  const pageSizeOptions: PageSizeOption[] = [5, 10, 20, 'all'];

  let selected: WordIndexItem | null = null;

  function setPageSize(value: PageSizeOption): void {
    settings.setWordPageSize(value === 'all' ? 'all' : value === 10 ? 10 : value === 20 ? 20 : 5);
  }

  $: categories = ['All', ...catalog.wordCategories];
  $: visible = catalog.searchWords($viewState.wordQuery).filter((item) => {
    const hidden = $progress.hiddenWords.includes(item.id);
    if (hidden && !$settings.showHiddenWords) return false;
    if ($settings.wordCategory !== 'All' && item.category !== $settings.wordCategory) return false;
    return true;
  }).sort((a, b) => {
    if (a.category === 'Presentation Phrases' && b.category === 'Presentation Phrases') {
      return (a.sequence ?? 0) - (b.sequence ?? 0);
    }
    return a.term.localeCompare(b.term);
  });

  $: pageCount = totalPages(visible.length, $settings.wordPageSize);
  $: currentPage = Math.min(Math.max(1, $viewState.wordPage), pageCount);
  $: pagedVisible = paginate(visible, currentPage, $settings.wordPageSize);
  $: speechItems = pagedVisible.map(wordToSpeechItem);

  $: if ($viewState.wordPage !== currentPage) {
    viewState.setWordPage(currentPage);
  }

  $: if (!selected && pagedVisible.length) selected = pagedVisible[0];
  $: if (selected && !pagedVisible.some((item) => item.id === selected?.id)) selected = pagedVisible[0] ?? null;
</script>

<section class="section-stack">
  <div class="toolbar-card controls-stack">
    <div class="controls-stack__header">
      <div>
        <h2>Word Index</h2>
        <p>Клік по фразі відкриває переклад, transcription, alternatives і приклади застосування.</p>
      </div>
      <div class="control-actions">
        <IconButton
          icon={$settings.showHiddenWords ? 'visibility_off' : 'visibility'}
          label={$settings.showHiddenWords ? 'Hide hidden words' : 'Show hidden words'}
          variant="secondary"
          onClick={() => settings.toggleShowHidden('word')}
        />
        {#if $progress.hiddenWords.length}
          <IconButton icon="settings_backup_restore" label="Unhide all words" variant="danger" onClick={() => progress.unhideAll('word')} />
        {/if}
      </div>
    </div>

    <div class="controls-stack__row controls-stack__row--filters-listen">
      <div class="controls-filter-stack">
        <label>
          Search
          <input value={$viewState.wordQuery} on:input={(e) => viewState.setWordQuery((e.target as HTMLInputElement).value)} placeholder="run into, lack, estimate…" />
        </label>
        <label>
          Category
          <select value={$settings.wordCategory} on:change={(e) => settings.setWordCategory((e.target as HTMLSelectElement).value)}>
            {#each categories as category}
              <option value={category}>{category}</option>
            {/each}
          </select>
        </label>
      </div>
      <SectionSpeechControl controlId="words-visible" label="Listen words" items={speechItems} help="Reads current page words, translations and examples." />
    </div>
  </div>

  <div class="split-layout">
    <aside class="index-list card">
      {#each pagedVisible as item}
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

  {#if visible.length}
    <div class="pagination-footer">
      <PaginationControls
        total={visible.length}
        page={currentPage}
        pageSize={$settings.wordPageSize}
        {pageSizeOptions}
        label="Word index pagination"
        onPageChange={(page) => viewState.setWordPage(page)}
        onPageSizeChange={setPageSize}
      />
    </div>
  {/if}
</section>
