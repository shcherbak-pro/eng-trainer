<script lang="ts">
  import { progress, type IndexPageSize } from '../stores/progress';
  import type { TrainingBlock } from '../types/materials';
  import EmptyState from '../components/EmptyState.svelte';
  import FocusButton from '../components/FocusButton.svelte';
  import LearnPassManager from '../components/LearnPassManager.svelte';
  import IconButton from '../components/IconButton.svelte';
  import PaginationControls from '../components/PaginationControls.svelte';
  import type { PageSizeOption } from '../types/pagination';

  export let blocks: TrainingBlock[];
  export let allBlocks: TrainingBlock[];
  export let onOpenBlock: (block: TrainingBlock) => void;

  type TagOption = {
    tag: string;
    count: number;
  };

  const pageSizeOptions: PageSizeOption[] = [6, 12, 'all'];

  function getTagOptions(items: TrainingBlock[]): TagOption[] {
    const counts = new Map<string, number>();

    for (const item of items) {
      const tag = item.tag?.trim();
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }

  function paginate(items: TrainingBlock[], page: number, pageSize: IndexPageSize): TrainingBlock[] {
    if (pageSize === 'all') return items;
    const start = (Math.max(1, page) - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }

  function totalPages(total: number, pageSize: IndexPageSize): number {
    return pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / pageSize));
  }

  function setPageSize(value: PageSizeOption): void {
    progress.setIndexPageSize(value === 'all' ? 'all' : value === 12 ? 12 : 6);
  }

  $: tagOptions = getTagOptions(blocks);
  $: selectedTagExists = !$progress.indexTagFilter || tagOptions.some((option) => option.tag === $progress.indexTagFilter);
  $: filteredBlocks = selectedTagExists && $progress.indexTagFilter
    ? blocks.filter((block) => block.tag === $progress.indexTagFilter)
    : blocks;
  $: pageCount = totalPages(filteredBlocks.length, $progress.indexPageSize);
  $: currentPage = Math.min(Math.max(1, $progress.indexPage), pageCount);
  $: pagedBlocks = paginate(filteredBlocks, currentPage, $progress.indexPageSize);

  $: if ($progress.indexPage !== currentPage) {
    progress.setIndexPage(currentPage);
  }
</script>

<section class="section-stack">
  <LearnPassManager {allBlocks} />

  <div class="toolbar-card index-toolbar">
    <div>
      <h2>Learning blocks</h2>
      <p>Index page with access to materials from your active Learn Pass.</p>
    </div>
    <PaginationControls
      total={filteredBlocks.length}
      page={currentPage}
      pageSize={$progress.indexPageSize}
      {pageSizeOptions}
      label="Learning blocks pagination"
      onPageChange={(page) => progress.setIndexPage(page)}
      onPageSizeChange={setPageSize}
    />
    <IconButton icon="restart_alt" label="Reset progress" variant="secondary" onClick={() => progress.resetAll()} />
  </div>

  {#if tagOptions.length}
    <section class="card tag-cloud-panel" aria-label="Learning block tags">
      <div>
        <h3>Tag cloud</h3>
        <p class="muted">Filter the index by topic and keep the current Learn Pass focused.</p>
      </div>
      <div class="tag-cloud">
        <button class:active={!$progress.indexTagFilter} type="button" on:click={() => progress.setIndexTagFilter('')}>
          All <span>{blocks.length}</span>
        </button>
        {#each tagOptions as option}
          <button class:active={$progress.indexTagFilter === option.tag} type="button" on:click={() => progress.setIndexTagFilter(option.tag)}>
            {option.tag} <span>{option.count}</span>
          </button>
        {/each}
      </div>
    </section>
  {/if}

  {#if filteredBlocks.length}
    <div class="block-grid">
      {#each pagedBlocks as block}
        <article class="card block-card">
          <p class="tag-row">
            {#if block.tag}
              <button
                class:active={$progress.indexTagFilter === block.tag}
                class="chip-button"
                type="button"
                on:click={() => progress.setIndexTagFilter(block.tag ?? '')}
              >{block.tag}</button>
            {:else}
              <span>{block.type}</span>
            {/if}
            {#if block.itemsCount}<span>{block.itemsCount} items</span>{/if}
          </p>
          <h3>{block.title}</h3>
          <p>{block.description}</p>
          <div class="card__actions">
            <IconButton icon="arrow_forward" label={`Open ${block.title}`} variant="primary" onClick={() => onOpenBlock(block)} />
            <FocusButton kind="block" id={block.id} />
          </div>
        </article>
      {/each}
    </div>
  {:else if blocks.length}
    <EmptyState title="No blocks for this tag" text="Select another tag or switch back to All." />
  {:else}
    <EmptyState title="No blocks in this Learn Pass" text="Edit the active Learn Pass and select at least one learning block." />
  {/if}
</section>
