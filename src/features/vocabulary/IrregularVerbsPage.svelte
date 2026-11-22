<script lang="ts">
  import { blockDescriptionLang } from '../../content/descriptionLanguage';
  import type { ContentCatalog } from '../../content/catalog';
  import { progress } from '../../state/progress';
  import { settings } from '../../state/settings';
  import { viewState } from '../../state/viewState';
  import IrregularVerbCard from '../../shared/entries/IrregularVerbCard.svelte';
  import SectionSpeechControl from '../../shared/speech/SectionSpeechControl.svelte';
  import { irregularVerbToSpeechItem } from '../../shared/speech/speechFormatters';
  import Button from '../../shared/ui/Button.svelte';
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
    settings.setIrregularPageSize(value === 'all' ? 'all' : value === 10 ? 10 : value === 20 ? 20 : 5);
  }

  function uniqueInOrder(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
      if (!value || seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }

    return result;
  }

  function clearFilters(): void {
    viewState.setIrregularQuery('');
    settings.setIrregularGroup('All');
  }

  // "Unhide all" covers every available hidden verb, whatever the filters (RC1 contract).
  function unhideAll(): void {
    confirmUnhide = false;
    progress.unhideAll('irregular', availableHiddenIds);
  }

  $: verbSetOptions = catalog.verbSets;
  $: availableHiddenIds = catalog.irregularVerbs.filter((item) => $progress.hiddenIrregular.includes(item.id)).map((item) => item.id);
  $: selectedSet = verbSetOptions.some((option) => option.id === $settings.irregularSet)
    ? $settings.irregularSet
    : verbSetOptions[0]?.id ?? 'all';
  $: activeSet = verbSetOptions.find((option) => option.id === selectedSet);
  $: currentSetVerbs = selectedSet === 'all'
    ? catalog.irregularVerbs
    : catalog.irregularVerbs.filter((item) => item.verbSet === selectedSet);
  $: groups = ['All', ...uniqueInOrder(currentSetVerbs.map((item) => item.group))];
  $: visible = catalog.searchVerbs($viewState.irregularQuery).filter((item) => {
    if (selectedSet !== 'all' && item.verbSet !== selectedSet) return false;
    const hidden = $progress.hiddenIrregular.includes(item.id);
    if (hidden && !$settings.showHiddenIrregular) return false;
    if ($settings.irregularGroup !== 'All' && item.group !== $settings.irregularGroup) return false;
    return true;
  });
  $: pageCount = totalPages(visible.length, $settings.irregularPageSize);
  $: currentPage = Math.min(Math.max(1, $viewState.irregularPage), pageCount);
  $: pagedVisible = paginate(visible, currentPage, $settings.irregularPageSize);
  $: speechItems = pagedVisible.map(irregularVerbToSpeechItem);

  $: if (selectedSet !== $settings.irregularSet) {
    settings.setIrregularSet(selectedSet);
  }

  $: if ($viewState.irregularPage !== currentPage) {
    viewState.setIrregularPage(currentPage);
  }
</script>

<div class="toolbar">
  <SearchField label="Search verbs" value={$viewState.irregularQuery} placeholder="be, took, been, говорити…" onInput={(value) => viewState.setIrregularQuery(value)} />
  <div class="filters">
    {#if verbSetOptions.length > 1}
      <label class="filter-select">
        <span class="visually-hidden">Verb set</span>
        <select aria-label="Verb set" value={selectedSet} on:change={(e) => settings.setIrregularSet((e.target as HTMLSelectElement).value)}>
          {#each verbSetOptions as option}
            <option value={option.id}>{option.title} ({option.count})</option>
          {/each}
        </select>
      </label>
    {/if}
    <label class="filter-select">
      <span class="visually-hidden">Group</span>
      <select aria-label="Group" value={$settings.irregularGroup} on:change={(e) => settings.setIrregularGroup((e.target as HTMLSelectElement).value)}>
        {#each groups as group}
          <option value={group}>{group === 'All' ? 'All groups' : group}</option>
        {/each}
      </select>
    </label>
    {#if availableHiddenIds.length || $settings.showHiddenIrregular}
      <button type="button" class="chip-toggle" aria-pressed={$settings.showHiddenIrregular} on:click={() => settings.toggleShowHidden('irregular')}>
        Show hidden ({availableHiddenIds.length})
      </button>
    {/if}
  </div>
</div>

<div class="list-header">
  <p class="list-header__count" role="status">{number.format(visible.length)} {visible.length === 1 ? 'verb' : 'verbs'}</p>
  <SectionSpeechControl controlId="irregular-visible" label="Listen to this page" items={speechItems} help="Reads the verbs on this page: the three forms, translations, alternatives and examples." />
</div>

{#if availableHiddenIds.length}
  <div class="list-note">
    <span>{availableHiddenIds.length} hidden {availableHiddenIds.length === 1 ? 'verb' : 'verbs'}.</span>
    <Button variant="quiet" size="sm" icon="eye" onClick={() => (confirmUnhide = true)}>Unhide all verbs</Button>
  </div>
{/if}

{#if pagedVisible.length}
  <h2 class="visually-hidden">Verb list</h2>
  <ul class="entry-list">
    {#each pagedVisible as verb (verb.id)}<li><IrregularVerbCard {verb} /></li>{/each}
  </ul>
{:else}
  <EmptyState title="No verbs found" text="Try a different search or group.">
    <Button variant="secondary" size="sm" onClick={clearFilters}>Clear search and group</Button>
  </EmptyState>
{/if}

{#if visible.length}
  <PaginationControls
    total={visible.length}
    page={currentPage}
    pageSize={$settings.irregularPageSize}
    {pageSizeOptions}
    label="Verb pages"
    onPageChange={(page) => viewState.setIrregularPage(page)}
    onPageSizeChange={setPageSize}
  />
{/if}

{#if activeSet?.description}<p class="list-note">About this set: <span lang={blockDescriptionLang(activeSet.blockId)}>{activeSet.description}</span></p>{/if}

<ConfirmDialog
  open={confirmUnhide}
  title={`Show all ${availableHiddenIds.length} hidden ${availableHiddenIds.length === 1 ? 'verb' : 'verbs'}?`}
  confirmLabel="Show all hidden verbs"
  tone="primary"
  onConfirm={unhideAll}
  onCancel={() => (confirmUnhide = false)}
  returnFocus={() => document.querySelector<HTMLElement>('main input[type="search"]')}
>
  <p>Every hidden verb that is currently available becomes visible again, whatever search, set or group is selected.</p>
</ConfirmDialog>
