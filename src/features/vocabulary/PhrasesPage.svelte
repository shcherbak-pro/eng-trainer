<script lang="ts">
  import type { ContentCatalog } from '../../content/catalog';
  import { inCollection, resolvedCollection } from '../../content/userCatalog';
  import type { Phrase } from '../../content/types';
  import { progress } from '../../state/progress';
  import { settings } from '../../state/settings';
  import { viewState } from '../../state/viewState';
  import PhraseCard from '../../shared/entries/PhraseCard.svelte';
  import SectionSpeechControl from '../../shared/speech/SectionSpeechControl.svelte';
  import { phraseToSpeechItem } from '../../shared/speech/speechFormatters';
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

  type PhraseGroup = {
    section: string;
    items: Phrase[];
  };

  function setPageSize(value: PageSizeOption): void {
    settings.setPhrasePageSize(value === 'all' ? 'all' : value === 10 ? 10 : value === 20 ? 20 : 5);
  }

  function groupBySection(items: Phrase[]): PhraseGroup[] {
    const groups: PhraseGroup[] = [];
    const indexBySection = new Map<string, PhraseGroup>();

    for (const item of items) {
      const section = item.section ?? item.tag ?? item.category;
      let group = indexBySection.get(section);
      if (!group) {
        group = { section, items: [] };
        indexBySection.set(section, group);
        groups.push(group);
      }
      group.items.push(item);
    }

    return groups;
  }

  function clearFilters(): void {
    viewState.setPhraseQuery('');
    settings.setPhraseCategory('All');
    settings.setCollectionFilter('');
  }

  // "Unhide all" covers every available hidden phrase, whatever the filters (RC1 contract).
  function unhideAll(): void {
    confirmUnhide = false;
    progress.unhideAll('phrase', availableHiddenIds);
  }

  $: categories = ['All', ...catalog.phraseCategories];
  $: availableHiddenIds = catalog.phrases.filter((item) => $progress.hiddenPhrases.includes(item.id)).map((item) => item.id);
  $: collectionFilter = resolvedCollection(catalog, $settings.collectionFilter);
  $: visible = catalog.searchPhrases($viewState.phraseQuery).filter((item) => {
    if (!inCollection(item, collectionFilter)) return false;
    const hidden = $progress.hiddenPhrases.includes(item.id);
    if (hidden && !$settings.showHiddenPhrases) return false;
    if ($settings.phraseCategory !== 'All' && item.category !== $settings.phraseCategory) return false;
    return true;
  });
  $: pageCount = totalPages(visible.length, $settings.phrasePageSize);
  $: currentPage = Math.min(Math.max(1, $viewState.phrasePage), pageCount);
  $: pagedVisible = paginate(visible, currentPage, $settings.phrasePageSize);
  $: speechItems = pagedVisible.map(phraseToSpeechItem);
  $: showSectionGroups = $settings.phraseCategory !== 'All' && pagedVisible.some((item) => item.section || item.sequence);
  $: sectionGroups = showSectionGroups ? groupBySection(pagedVisible) : [];

  $: if ($viewState.phrasePage !== currentPage) {
    viewState.setPhrasePage(currentPage);
  }
</script>

<div class="toolbar">
  <SearchField label="Search phrases" value={$viewState.phraseQuery} placeholder="Search English or Ukrainian…" onInput={(value) => viewState.setPhraseQuery(value)} />
  <div class="filters">
    <label class="filter-select">
      <span class="visually-hidden">Category</span>
      <select aria-label="Category" value={$settings.phraseCategory} on:change={(e) => settings.setPhraseCategory((e.target as HTMLSelectElement).value)}>
        {#each categories as category}
          <option value={category}>{category === 'All' ? 'All categories' : category}</option>
        {/each}
      </select>
    </label>
    <CollectionFilter {catalog} />
    {#if availableHiddenIds.length || $settings.showHiddenPhrases}
      <button type="button" class="chip-toggle" aria-pressed={$settings.showHiddenPhrases} on:click={() => settings.toggleShowHidden('phrase')}>
        Show hidden ({availableHiddenIds.length})
      </button>
    {/if}
  </div>
</div>

<div class="list-header">
  <p class="list-header__count" role="status">{number.format(visible.length)} {visible.length === 1 ? 'phrase' : 'phrases'}</p>
  <SectionSpeechControl controlId="phrases-visible" label="Listen to this page" items={speechItems} help="Reads the phrases on this page with their translations, alternatives and examples." />
</div>

{#if availableHiddenIds.length}
  <div class="list-note">
    <span>{availableHiddenIds.length} hidden {availableHiddenIds.length === 1 ? 'phrase' : 'phrases'}.</span>
    <Button variant="quiet" size="sm" icon="eye" onClick={() => (confirmUnhide = true)}>Unhide all phrases</Button>
  </div>
{/if}

{#if pagedVisible.length}
  {#if showSectionGroups}
    {#each sectionGroups as group}
      <section class="entry-group">
        <h2>{group.section}</h2>
        <ul class="entry-list">
          {#each group.items as phrase (phrase.id)}<li><PhraseCard {phrase} /></li>{/each}
        </ul>
      </section>
    {/each}
  {:else}
    <h2 class="visually-hidden">Phrase list</h2>
    <ul class="entry-list">
      {#each pagedVisible as phrase (phrase.id)}<li><PhraseCard {phrase} /></li>{/each}
    </ul>
  {/if}
{:else}
  <EmptyState title="No phrases found" text="Try a different search, category or collection.">
    <Button variant="secondary" size="sm" onClick={clearFilters}>Clear search and filters</Button>
  </EmptyState>
{/if}

{#if visible.length}
  <PaginationControls
    total={visible.length}
    page={currentPage}
    pageSize={$settings.phrasePageSize}
    {pageSizeOptions}
    label="Phrase pages"
    onPageChange={(page) => viewState.setPhrasePage(page)}
    onPageSizeChange={setPageSize}
  />
{/if}

<ConfirmDialog
  open={confirmUnhide}
  title={`Show all ${availableHiddenIds.length} hidden ${availableHiddenIds.length === 1 ? 'phrase' : 'phrases'}?`}
  confirmLabel="Show all hidden phrases"
  tone="primary"
  onConfirm={unhideAll}
  onCancel={() => (confirmUnhide = false)}
  returnFocus={() => document.querySelector<HTMLElement>('main input[type="search"]')}
>
  <p>Every hidden phrase that is currently available becomes visible again, whatever search, category or collection is selected.</p>
  <p>Phrases from collections you removed keep their hidden state until you import them again.</p>
</ConfirmDialog>
