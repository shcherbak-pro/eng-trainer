<script lang="ts">
  import type { ContentCatalog } from '../../content/catalog';
  import { progress } from '../../state/progress';
  import { settings } from '../../state/settings';
  import { viewState } from '../../state/viewState';
  import IrregularVerbCard from '../../shared/entries/IrregularVerbCard.svelte';
  import EmptyState from '../../shared/ui/EmptyState.svelte';
  import SectionSpeechControl from '../../shared/speech/SectionSpeechControl.svelte';
  import { irregularVerbToSpeechItem } from '../../shared/speech/speechFormatters';
  import IconButton from '../../shared/ui/IconButton.svelte';
  import PaginationControls from '../../shared/ui/PaginationControls.svelte';
  import { paginate, totalPages, type PageSizeOption } from '../../shared/pagination';

  export let catalog: ContentCatalog;

  const pageSizeOptions: PageSizeOption[] = [5, 10, 20, 'all'];

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

  $: verbSetOptions = catalog.verbSets;
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

<section class="section-stack">
  <div class="toolbar-card controls-stack">
    <div class="controls-stack__header">
      <div>
        <h2>{activeSet?.title ?? 'Irregular Verbs'}</h2>
        <p>{activeSet?.description ?? '3 forms, Ukrainian translation, transcription, alternatives, examples and logical grouping.'}</p>
      </div>
      <div class="control-actions">
        <IconButton
          icon={$settings.showHiddenIrregular ? 'visibility_off' : 'visibility'}
          label={$settings.showHiddenIrregular ? 'Hide hidden verbs' : 'Show hidden verbs'}
          variant="secondary"
          onClick={() => settings.toggleShowHidden('irregular')}
        />
        {#if $progress.hiddenIrregular.length}
          <IconButton icon="settings_backup_restore" label="Unhide all verbs" variant="danger" onClick={() => progress.unhideAll('irregular')} />
        {/if}
      </div>
    </div>

    <div class="controls-stack__row">
      {#if verbSetOptions.length > 1}
        <label>
          Set
          <select value={selectedSet} on:change={(e) => settings.setIrregularSet((e.target as HTMLSelectElement).value)}>
            {#each verbSetOptions as option}
              <option value={option.id}>{option.title} ({option.count})</option>
            {/each}
          </select>
        </label>
      {/if}
      <label>
        Search
        <input value={$viewState.irregularQuery} on:input={(e) => viewState.setIrregularQuery((e.target as HTMLInputElement).value)} placeholder="be, took, been, говорити…" />
      </label>
      <label>
        Group
        <select value={$settings.irregularGroup} on:change={(e) => settings.setIrregularGroup((e.target as HTMLSelectElement).value)}>
          {#each groups as group}
            <option value={group}>{group}</option>
          {/each}
        </select>
      </label>
      <SectionSpeechControl controlId="irregular-visible" label="Listen verbs" items={speechItems} help="Reads current page verb forms, translations, alternatives and examples." />
    </div>
  </div>

  {#if pagedVisible.length}
    <div class="cards-list">
      {#each pagedVisible as verb (verb.id)}
        <IrregularVerbCard {verb} />
      {/each}
    </div>
  {:else}
    <EmptyState title="No verbs found" />
  {/if}

  {#if visible.length}
    <div class="pagination-footer">
      <PaginationControls
        total={visible.length}
        page={currentPage}
        pageSize={$settings.irregularPageSize}
        {pageSizeOptions}
        label="Irregular verbs pagination"
        onPageChange={(page) => viewState.setIrregularPage(page)}
        onPageSizeChange={setPageSize}
      />
    </div>
  {/if}
</section>
