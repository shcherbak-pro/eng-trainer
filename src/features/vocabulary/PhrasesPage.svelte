<script lang="ts">
  import type { ContentCatalog } from '../../content/catalog';
  import { inCollection, resolvedCollection } from '../../content/userCatalog';
  import CollectionFilter from '../../shared/ui/CollectionFilter.svelte';
  import type { Phrase } from '../../content/types';
  import { progress } from '../../state/progress';
  import { settings } from '../../state/settings';
  import { viewState } from '../../state/viewState';
  import PhraseCard from '../../shared/entries/PhraseCard.svelte';
  import EmptyState from '../../shared/ui/EmptyState.svelte';
  import SectionSpeechControl from '../../shared/speech/SectionSpeechControl.svelte';
  import { phraseToSpeechItem } from '../../shared/speech/speechFormatters';
  import IconButton from '../../shared/ui/IconButton.svelte';
  import PaginationControls from '../../shared/ui/PaginationControls.svelte';
  import { paginate, totalPages, type PageSizeOption } from '../../shared/pagination';

  export let catalog: ContentCatalog;

  const pageSizeOptions: PageSizeOption[] = [5, 10, 20, 'all'];

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

<section class="section-stack">
  <div class="toolbar-card controls-stack">
    <div class="controls-stack__header">
      <div>
        <h2>Phrases</h2>
        <p>Фрази, переклади, transcription, alternatives, examples, learned / hide / focus.</p>
      </div>
      <div class="control-actions">
        <IconButton
          icon={$settings.showHiddenPhrases ? 'visibility_off' : 'visibility'}
          label={$settings.showHiddenPhrases ? 'Hide hidden phrases' : 'Show hidden phrases'}
          variant="secondary"
          onClick={() => settings.toggleShowHidden('phrase')}
        />
        {#if availableHiddenIds.length}
          <IconButton icon="settings_backup_restore" label="Unhide all phrases" variant="danger" onClick={() => progress.unhideAll('phrase', availableHiddenIds)} />
        {/if}
      </div>
    </div>

    <div class="controls-stack__row controls-stack__row--filters-listen">
      <div class="controls-filter-stack">
        <CollectionFilter {catalog} />
        <label>
          Search
          <input value={$viewState.phraseQuery} on:input={(e) => viewState.setPhraseQuery((e.target as HTMLInputElement).value)} placeholder="AI, otherwise, meeting…" />
        </label>
        <label>
          Category
          <select value={$settings.phraseCategory} on:change={(e) => settings.setPhraseCategory((e.target as HTMLSelectElement).value)}>
            {#each categories as category}
              <option value={category}>{category}</option>
            {/each}
          </select>
        </label>
      </div>
      <SectionSpeechControl controlId="phrases-visible" label="Listen phrases" items={speechItems} help="Reads current page phrases, translations, alternatives and examples." />
    </div>
  </div>

  {#if pagedVisible.length}
    {#if showSectionGroups}
      <div class="sectioned-list">
        {#each sectionGroups as group}
          <section class="phrase-section">
            <h3>{group.section}</h3>
            <div class="cards-list">
              {#each group.items as phrase (phrase.id)}
                <PhraseCard {phrase} />
              {/each}
            </div>
          </section>
        {/each}
      </div>
    {:else}
      <div class="cards-list">
        {#each pagedVisible as phrase (phrase.id)}
          <PhraseCard {phrase} />
        {/each}
      </div>
    {/if}
  {:else}
    <EmptyState title="No phrases found" />
  {/if}

  {#if visible.length}
    <div class="pagination-footer">
      <PaginationControls
        total={visible.length}
        page={currentPage}
        pageSize={$settings.phrasePageSize}
        {pageSizeOptions}
        label="Phrases pagination"
        onPageChange={(page) => viewState.setPhrasePage(page)}
        onPageSizeChange={setPageSize}
      />
    </div>
  {/if}
</section>
