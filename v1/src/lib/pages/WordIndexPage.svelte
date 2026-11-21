<script lang="ts">
  import { progress, type ListPageSize } from '../stores/progress';
  import type { Materials, WordIndexItem } from '../types/materials';
  import { matchesQuery, uniqueSorted } from '../utils/filters';
  import WordCard from '../components/WordCard.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import SectionSpeechControl from '../components/SectionSpeechControl.svelte';
  import { wordToSpeechItem } from '../utils/speechFormatters';
  import IconButton from '../components/IconButton.svelte';
  import PaginationControls from '../components/PaginationControls.svelte';
  import type { PageSizeOption } from '../types/pagination';

  export let materials: Materials;

  const pageSizeOptions: PageSizeOption[] = [5, 10, 20, 'all'];

  let selected: WordIndexItem | null = null;


  function paginate(items: WordIndexItem[], page: number, pageSize: ListPageSize): WordIndexItem[] {
    if (pageSize === 'all') return items;
    const start = (Math.max(1, page) - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }

  function totalPages(total: number, pageSize: ListPageSize): number {
    return pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / pageSize));
  }

  function setPageSize(value: PageSizeOption): void {
    progress.setWordPageSize(value === 'all' ? 'all' : value === 10 ? 10 : value === 20 ? 20 : 5);
  }

  $: categories = ['All', ...uniqueSorted(materials.wordIndex.map((item) => item.category))];
  $: visible = materials.wordIndex.filter((item) => {
    const hidden = $progress.hiddenWords.includes(item.id);
    if (hidden && !$progress.showHiddenWords) return false;
    if ($progress.wordCategory !== 'All' && item.category !== $progress.wordCategory) return false;
    return matchesQuery(
      $progress.wordQuery,
      item.term,
      item.meaning,
      item.pronunciation,
      item.transcription,
      Array.isArray(item.commonAlternatives) ? item.commonAlternatives.join(' ') : item.commonAlternatives,
      ...(item.examples ?? []).flatMap((example) => [example.en, example.ua ?? '']),
      item.category,
      item.section,
      item.tag
    );
  }).sort((a, b) => {
    if (a.category === 'Presentation Phrases' && b.category === 'Presentation Phrases') {
      return (a.sequence ?? 0) - (b.sequence ?? 0);
    }
    return a.term.localeCompare(b.term);
  });

  $: pageCount = totalPages(visible.length, $progress.wordPageSize);
  $: currentPage = Math.min(Math.max(1, $progress.wordPage), pageCount);
  $: pagedVisible = paginate(visible, currentPage, $progress.wordPageSize);
  $: speechItems = pagedVisible.map(wordToSpeechItem);

  $: if ($progress.wordPage !== currentPage) {
    progress.setWordPage(currentPage);
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

    <div class="controls-stack__row controls-stack__row--filters-listen">
      <div class="controls-filter-stack">
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
        pageSize={$progress.wordPageSize}
        {pageSizeOptions}
        label="Word index pagination"
        onPageChange={(page) => progress.setWordPage(page)}
        onPageSizeChange={setPageSize}
      />
    </div>
  {/if}
</section>
