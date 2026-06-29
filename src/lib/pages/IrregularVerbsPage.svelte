<script lang="ts">
  import { progress, type ListPageSize } from '../stores/progress';
  import type { IrregularVerb, Materials, TrainingBlock } from '../types/materials';
  import { matchesQuery } from '../utils/filters';
  import IrregularVerbCard from '../components/IrregularVerbCard.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import SectionSpeechControl from '../components/SectionSpeechControl.svelte';
  import { irregularVerbToSpeechItem } from '../utils/speechFormatters';
  import IconButton from '../components/IconButton.svelte';
  import PaginationControls from '../components/PaginationControls.svelte';
  import type { PageSizeOption } from '../types/pagination';

  export let materials: Materials;

  const pageSizeOptions: PageSizeOption[] = [5, 10, 20, 'all'];

  type VerbSetOption = {
    id: string;
    title: string;
    description?: string;
    count: number;
  };

  function paginate(items: IrregularVerb[], page: number, pageSize: ListPageSize): IrregularVerb[] {
    if (pageSize === 'all') return items;
    const start = (Math.max(1, page) - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }

  function totalPages(total: number, pageSize: ListPageSize): number {
    return pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / pageSize));
  }

  function setPageSize(value: PageSizeOption): void {
    progress.setIrregularPageSize(value === 'all' ? 'all' : value === 10 ? 10 : value === 20 ? 20 : 5);
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

  function getVerbSetOptions(blocks: TrainingBlock[], verbs: IrregularVerb[]): VerbSetOption[] {
    return blocks
      .filter((block) => block.type === 'irregularVerbs' && block.verbSet)
      .map((block) => ({
        id: block.verbSet as string,
        title: block.title,
        description: block.description,
        count: verbs.filter((item) => item.verbSet === block.verbSet).length
      }))
      .filter((option) => option.count > 0);
  }

  $: verbSetOptions = getVerbSetOptions(materials.blocks, materials.irregularVerbs);
  $: selectedSet = verbSetOptions.some((option) => option.id === $progress.irregularSet)
    ? $progress.irregularSet
    : verbSetOptions[0]?.id ?? 'all';
  $: activeSet = verbSetOptions.find((option) => option.id === selectedSet);
  $: currentSetVerbs = selectedSet === 'all'
    ? materials.irregularVerbs
    : materials.irregularVerbs.filter((item) => item.verbSet === selectedSet);
  $: groups = ['All', ...uniqueInOrder(currentSetVerbs.map((item) => item.group))];
  $: visible = currentSetVerbs.filter((item) => {
    const hidden = $progress.hiddenIrregular.includes(item.id);
    if (hidden && !$progress.showHiddenIrregular) return false;
    if ($progress.irregularGroup !== 'All' && item.group !== $progress.irregularGroup) return false;
    return matchesQuery(
      $progress.irregularQuery,
      item.base,
      item.pastSimple,
      item.pastParticiple,
      item.translation,
      item.transcription,
      Array.isArray(item.commonAlternatives) ? item.commonAlternatives.join(' ') : item.commonAlternatives,
      item.group
    );
  });
  $: pageCount = totalPages(visible.length, $progress.irregularPageSize);
  $: currentPage = Math.min(Math.max(1, $progress.irregularPage), pageCount);
  $: pagedVisible = paginate(visible, currentPage, $progress.irregularPageSize);
  $: speechItems = pagedVisible.map(irregularVerbToSpeechItem);

  $: if (selectedSet !== $progress.irregularSet) {
    progress.setIrregularSet(selectedSet);
  }

  $: if ($progress.irregularPage !== currentPage) {
    progress.setIrregularPage(currentPage);
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
          icon={$progress.showHiddenIrregular ? 'visibility_off' : 'visibility'}
          label={$progress.showHiddenIrregular ? 'Hide hidden verbs' : 'Show hidden verbs'}
          variant="secondary"
          onClick={() => progress.toggleShowHidden('irregular')}
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
          <select value={selectedSet} on:change={(e) => progress.setIrregularSet((e.target as HTMLSelectElement).value)}>
            {#each verbSetOptions as option}
              <option value={option.id}>{option.title} ({option.count})</option>
            {/each}
          </select>
        </label>
      {/if}
      <label>
        Search
        <input value={$progress.irregularQuery} on:input={(e) => progress.setIrregularQuery((e.target as HTMLInputElement).value)} placeholder="be, took, been, говорити…" />
      </label>
      <label>
        Group
        <select value={$progress.irregularGroup} on:change={(e) => progress.setIrregularGroup((e.target as HTMLSelectElement).value)}>
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
        pageSize={$progress.irregularPageSize}
        {pageSizeOptions}
        label="Irregular verbs pagination"
        onPageChange={(page) => progress.setIrregularPage(page)}
        onPageSizeChange={setPageSize}
      />
    </div>
  {/if}
</section>
