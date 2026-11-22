<script lang="ts">
  import type { ContentCatalog } from '../../content/catalog';
  import { inCollection, resolvedCollection } from '../../content/userCatalog';
  import { progress } from '../../state/progress';
  import { settings } from '../../state/settings';
  import { viewState } from '../../state/viewState';
  import WordCard from '../../shared/entries/WordCard.svelte';
  import SectionSpeechControl from '../../shared/speech/SectionSpeechControl.svelte';
  import { wordToSpeechItem } from '../../shared/speech/speechFormatters';
  import Button from '../../shared/ui/Button.svelte';
  import CollectionFilter from '../../shared/ui/CollectionFilter.svelte';
  import ConfirmDialog from '../../shared/ui/ConfirmDialog.svelte';
  import EmptyState from '../../shared/ui/EmptyState.svelte';
  import PaginationControls from '../../shared/ui/PaginationControls.svelte';
  import SearchField from '../../shared/ui/SearchField.svelte';
  import { paginate, totalPages, type PageSizeOption } from '../../shared/pagination';

  export let catalog: ContentCatalog;

  const pageSizeOptions: PageSizeOption[] = [5, 10, 20, 'all'];
  const number = new Intl.NumberFormat('en');
  let confirmUnhide = false;

  function setPageSize(value: PageSizeOption): void {
    settings.setWordPageSize(value === 'all' ? 'all' : value === 10 ? 10 : value === 20 ? 20 : 5);
  }

  function clearFilters(): void {
    viewState.setWordQuery('');
    settings.setWordCategory('All');
    settings.setCollectionFilter('');
  }

  // "Unhide all" covers every available hidden word, whatever the filters (RC1 contract).
  function unhideAll(): void {
    confirmUnhide = false;
    progress.unhideAll('word', availableHiddenIds);
  }

  $: categories = ['All', ...catalog.wordCategories];
  $: availableHiddenIds = catalog.wordIndex.filter((item) => $progress.hiddenWords.includes(item.id)).map((item) => item.id);
  $: collectionFilter = resolvedCollection(catalog, $settings.collectionFilter);
  $: visible = catalog.searchWords($viewState.wordQuery).filter((item) => {
    if (!inCollection(item, collectionFilter)) return false;
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
</script>

<div class="toolbar">
  <SearchField label="Search words" value={$viewState.wordQuery} placeholder="Search English or Ukrainian…" onInput={(value) => viewState.setWordQuery(value)} />
  <div class="filters">
    <label class="filter-select">
      <span class="visually-hidden">Category</span>
      <select aria-label="Category" value={$settings.wordCategory} on:change={(e) => settings.setWordCategory((e.target as HTMLSelectElement).value)}>
        {#each categories as category}
          <option value={category}>{category === 'All' ? 'All categories' : category}</option>
        {/each}
      </select>
    </label>
    <CollectionFilter {catalog} />
    {#if availableHiddenIds.length || $settings.showHiddenWords}
      <button type="button" class="chip-toggle" aria-pressed={$settings.showHiddenWords} on:click={() => settings.toggleShowHidden('word')}>
        Show hidden ({availableHiddenIds.length})
      </button>
    {/if}
  </div>
</div>

<div class="list-header">
  <p class="list-header__count" role="status">{number.format(visible.length)} {visible.length === 1 ? 'word' : 'words'}</p>
  <SectionSpeechControl controlId="words-visible" label="Listen to this page" items={speechItems} help="Reads the words on this page with their translations and examples." />
</div>

{#if availableHiddenIds.length}
  <div class="list-note">
    <span>{availableHiddenIds.length} hidden {availableHiddenIds.length === 1 ? 'word' : 'words'}.</span>
    <Button variant="quiet" size="sm" icon="eye" onClick={() => (confirmUnhide = true)}>Unhide all words</Button>
  </div>
{/if}

{#if pagedVisible.length}
  <h2 class="visually-hidden">Word list</h2>
  <ul class="entry-list">
    {#each pagedVisible as item (item.id)}<li><WordCard {item} /></li>{/each}
  </ul>
{:else}
  <EmptyState title="No words found" text="Try a different search, category or collection.">
    <Button variant="secondary" size="sm" onClick={clearFilters}>Clear search and filters</Button>
  </EmptyState>
{/if}

{#if visible.length}
  <PaginationControls
    total={visible.length}
    page={currentPage}
    pageSize={$settings.wordPageSize}
    {pageSizeOptions}
    label="Word pages"
    onPageChange={(page) => viewState.setWordPage(page)}
    onPageSizeChange={setPageSize}
  />
{/if}

<ConfirmDialog
  open={confirmUnhide}
  title={`Show all ${availableHiddenIds.length} hidden ${availableHiddenIds.length === 1 ? 'word' : 'words'}?`}
  confirmLabel="Show all hidden words"
  tone="primary"
  onConfirm={unhideAll}
  onCancel={() => (confirmUnhide = false)}
  returnFocus={() => document.querySelector<HTMLElement>('main input[type="search"]')}
>
  <p>Every hidden word that is currently available becomes visible again, whatever search, category or collection is selected.</p>
  <p>Words from collections you removed keep their hidden state until you import them again.</p>
</ConfirmDialog>
