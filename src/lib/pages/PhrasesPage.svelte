<script lang="ts">
  import { progress, type ListPageSize } from '../stores/progress';
  import type { Materials, Phrase } from '../types/materials';
  import { matchesQuery, uniqueSorted } from '../utils/filters';
  import PhraseCard from '../components/PhraseCard.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import SectionSpeechControl from '../components/SectionSpeechControl.svelte';
  import { phraseToSpeechItem } from '../utils/speechFormatters';
  import IconButton from '../components/IconButton.svelte';
  import PaginationControls from '../components/PaginationControls.svelte';
  import type { PageSizeOption } from '../types/pagination';

  export let materials: Materials;

  const pageSizeOptions: PageSizeOption[] = [5, 10, 20, 'all'];

  type PhraseGroup = {
    section: string;
    items: Phrase[];
  };



  function paginate(items: Phrase[], page: number, pageSize: ListPageSize): Phrase[] {
    if (pageSize === 'all') return items;
    const start = (Math.max(1, page) - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }

  function totalPages(total: number, pageSize: ListPageSize): number {
    return pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / pageSize));
  }

  function setPageSize(value: PageSizeOption): void {
    progress.setPhrasePageSize(value === 'all' ? 'all' : value === 10 ? 10 : value === 20 ? 20 : 5);
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

  $: categories = ['All', ...uniqueSorted(materials.phrases.map((item) => item.category))];
  $: visible = materials.phrases.filter((item) => {
    const hidden = $progress.hiddenPhrases.includes(item.id);
    if (hidden && !$progress.showHiddenPhrases) return false;
    if ($progress.phraseCategory !== 'All' && item.category !== $progress.phraseCategory) return false;
    return matchesQuery(
      $progress.phraseQuery,
      item.phrase,
      item.example,
      ...(item.examples ?? []).flatMap((example) => [example.en, example.ua ?? '']),
      item.translation,
      item.transcription,
      Array.isArray(item.commonAlternatives) ? item.commonAlternatives.join(' ') : item.commonAlternatives,
      item.category,
      item.section,
      item.tag
    );
  });
  $: pageCount = totalPages(visible.length, $progress.phrasePageSize);
  $: currentPage = Math.min(Math.max(1, $progress.phrasePage), pageCount);
  $: pagedVisible = paginate(visible, currentPage, $progress.phrasePageSize);
  $: speechItems = pagedVisible.map(phraseToSpeechItem);
  $: showSectionGroups = $progress.phraseCategory !== 'All' && pagedVisible.some((item) => item.section || item.sequence);
  $: sectionGroups = showSectionGroups ? groupBySection(pagedVisible) : [];

  $: if ($progress.phrasePage !== currentPage) {
    progress.setPhrasePage(currentPage);
  }
</script>

<section class="section-stack">
  <div class="toolbar-card controls-grid">
    <div>
      <h2>Phrases</h2>
      <p>Фрази, переклади, transcription, alternatives, examples, learned / hide / focus.</p>
    </div>
    <label>
      Search
      <input value={$progress.phraseQuery} on:input={(e) => progress.setPhraseQuery((e.target as HTMLInputElement).value)} placeholder="AI, otherwise, meeting…" />
    </label>
    <label>
      Category
      <select value={$progress.phraseCategory} on:change={(e) => progress.setPhraseCategory((e.target as HTMLSelectElement).value)}>
        {#each categories as category}
          <option value={category}>{category}</option>
        {/each}
      </select>
    </label>
    <SectionSpeechControl controlId="phrases-visible" label="Listen phrases" items={speechItems} help="Reads current page phrases, translations, alternatives and examples." />
    <PaginationControls
      total={visible.length}
      page={currentPage}
      pageSize={$progress.phrasePageSize}
      {pageSizeOptions}
      label="Phrases pagination"
      onPageChange={(page) => progress.setPhrasePage(page)}
      onPageSizeChange={setPageSize}
    />
    <div class="control-actions">
      <IconButton
        icon={$progress.showHiddenPhrases ? 'visibility_off' : 'visibility'}
        label={$progress.showHiddenPhrases ? 'Hide hidden phrases' : 'Show hidden phrases'}
        variant="secondary"
        onClick={() => progress.toggleShowHidden('phrase')}
      />
      {#if $progress.hiddenPhrases.length}
        <IconButton icon="settings_backup_restore" label="Unhide all phrases" variant="danger" onClick={() => progress.unhideAll('phrase')} />
      {/if}
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
</section>
