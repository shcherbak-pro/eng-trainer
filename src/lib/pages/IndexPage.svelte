<script lang="ts">
  import { progress, type IndexPageSize } from '../stores/progress';
  import type { IrregularVerb, Materials, Phrase, TrainingBlock, WordExample, WordIndexItem } from '../types/materials';
  import EmptyState from '../components/EmptyState.svelte';
  import FocusButton from '../components/FocusButton.svelte';
  import LearnPassManager from '../components/LearnPassManager.svelte';
  import IconButton from '../components/IconButton.svelte';
  import PaginationControls from '../components/PaginationControls.svelte';
  import ExpansionPanel from '../components/ExpansionPanel.svelte';
  import SpeakButton from '../components/SpeakButton.svelte';
  import type { PageSizeOption } from '../types/pagination';

  export let materials: Materials;
  export let blocks: TrainingBlock[];
  export let allBlocks: TrainingBlock[];
  export let onOpenBlock: (block: TrainingBlock) => void;

  type TagOption = {
    tag: string;
    count: number;
  };

  type DailyItem = {
    key: string;
    kind: 'Phrase' | 'Word' | 'Verb';
    title: string;
    subtitle?: string;
    translation: string;
    transcription?: string;
    alternatives: string[];
    examples: WordExample[];
    tag?: string;
    focusKind: 'phrase' | 'word' | 'irregular';
    focusId: string;
    speakText: string;
  };

  const pageSizeOptions: PageSizeOption[] = [6, 12, 'all'];
  let dailyItemKey = '';
  let dailyPoolSignature = '';

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

  function normalizeAlternatives(value: string[] | string | undefined): string[] {
    if (!value) return [];
    return Array.isArray(value) ? value.filter(Boolean) : value.split(';').map((item) => item.trim()).filter(Boolean);
  }

  function phraseExamples(item: Phrase): WordExample[] {
    if (item.examples?.length) return item.examples.slice(0, 2);
    return item.example ? [{ en: item.example }] : [];
  }

  function phraseToDaily(item: Phrase): DailyItem {
    const examples = phraseExamples(item);
    return {
      key: `phrase:${item.id}`,
      kind: 'Phrase',
      title: item.phrase,
      subtitle: item.category,
      translation: item.translation,
      transcription: item.transcription,
      alternatives: normalizeAlternatives(item.commonAlternatives),
      examples,
      tag: item.tag,
      focusKind: 'phrase',
      focusId: item.id,
      speakText: [item.phrase, item.translation, ...examples.map((example) => example.en)].filter(Boolean).join('. ')
    };
  }

  function wordToDaily(item: WordIndexItem): DailyItem {
    const examples = item.examples.slice(0, 2);
    return {
      key: `word:${item.id}`,
      kind: 'Word',
      title: item.term,
      subtitle: item.category,
      translation: item.meaning,
      transcription: item.transcription ?? item.pronunciation,
      alternatives: normalizeAlternatives(item.commonAlternatives),
      examples,
      tag: item.tag,
      focusKind: 'word',
      focusId: item.id,
      speakText: [item.term, item.meaning, ...examples.map((example) => example.en)].filter(Boolean).join('. ')
    };
  }

  function verbToDaily(item: IrregularVerb): DailyItem {
    const examples = item.examples.slice(0, 2);
    return {
      key: `verb:${item.id}`,
      kind: 'Verb',
      title: item.base,
      subtitle: `${item.base} — ${item.pastSimple} — ${item.pastParticiple}`,
      translation: item.translation,
      transcription: item.transcription,
      alternatives: normalizeAlternatives(item.commonAlternatives),
      examples,
      tag: item.group,
      focusKind: 'irregular',
      focusId: item.id,
      speakText: [`${item.base}, ${item.pastSimple}, ${item.pastParticiple}`, item.translation, ...examples.map((example) => example.en)].filter(Boolean).join('. ')
    };
  }

  function getDailyCandidates(data: Materials, activeBlocks: TrainingBlock[]): DailyItem[] {
    const candidates: DailyItem[] = [];
    const phraseCategories = new Set(
      activeBlocks
        .filter((block) => block.type === 'phraseCategory' && block.category)
        .map((block) => block.category as string)
    );
    const hasWordIndex = activeBlocks.some((block) => block.type === 'wordIndex');
    const hasIrregularVerbs = activeBlocks.some((block) => block.type === 'irregularVerbs');

    if (phraseCategories.size) {
      candidates.push(...data.phrases.filter((item) => phraseCategories.has(item.category)).map(phraseToDaily));
    }

    if (hasWordIndex) {
      candidates.push(...data.wordIndex.map(wordToDaily));
    }

    if (hasIrregularVerbs) {
      candidates.push(...data.irregularVerbs.map(verbToDaily));
    }

    if (!candidates.length) {
      candidates.push(...data.phrases.map(phraseToDaily), ...data.wordIndex.map(wordToDaily));
    }

    return candidates;
  }

  function getPoolSignature(items: DailyItem[]): string {
    return items.map((item) => item.key).join('|');
  }

  function pickDailyItem(): void {
    if (!dailyCandidates.length) {
      dailyItemKey = '';
      return;
    }

    const index = Math.floor(Math.random() * dailyCandidates.length);
    dailyItemKey = dailyCandidates[index].key;
  }

  $: tagOptions = getTagOptions(blocks);
  $: selectedTagExists = !$progress.indexTagFilter || tagOptions.some((option) => option.tag === $progress.indexTagFilter);
  $: filteredBlocks = selectedTagExists && $progress.indexTagFilter
    ? blocks.filter((block) => block.tag === $progress.indexTagFilter)
    : blocks;
  $: pageCount = totalPages(filteredBlocks.length, $progress.indexPageSize);
  $: currentPage = Math.min(Math.max(1, $progress.indexPage), pageCount);
  $: pagedBlocks = paginate(filteredBlocks, currentPage, $progress.indexPageSize);
  $: dailyCandidates = getDailyCandidates(materials, blocks);
  $: nextDailyPoolSignature = getPoolSignature(dailyCandidates);
  $: dailyItem = dailyCandidates.find((item) => item.key === dailyItemKey) ?? dailyCandidates[0] ?? null;

  $: if ($progress.indexPage !== currentPage) {
    progress.setIndexPage(currentPage);
  }

  $: if (nextDailyPoolSignature && nextDailyPoolSignature !== dailyPoolSignature) {
    dailyPoolSignature = nextDailyPoolSignature;
    pickDailyItem();
  }
</script>

<section class="section-stack">
  <ExpansionPanel
    title="Learn Pass"
    description="Choose or create a focused learning track."
    open={$progress.indexLearnPassExpanded}
    onToggle={() => progress.toggleIndexPanel('learnPass')}
  >
    <LearnPassManager {allBlocks} />
  </ExpansionPanel>

  {#if tagOptions.length}
    <ExpansionPanel
      title="Tag cloud"
      description="Filter visible learning blocks by topic."
      open={$progress.indexTagCloudExpanded}
      onToggle={() => progress.toggleIndexPanel('tagCloud')}
    >
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
    </ExpansionPanel>
  {/if}

  <ExpansionPanel
    title="Learning blocks"
    description="Materials from your active Learn Pass."
    open={$progress.indexLearningBlocksExpanded}
    onToggle={() => progress.toggleIndexPanel('learningBlocks')}
  >
    <div class="panel-actions">
      <IconButton icon="restart_alt" label="Reset progress" variant="secondary" onClick={() => progress.resetAll()} />
    </div>

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

      <div class="pagination-footer">
        <PaginationControls
          total={filteredBlocks.length}
          page={currentPage}
          pageSize={$progress.indexPageSize}
          {pageSizeOptions}
          label="Learning blocks pagination"
          onPageChange={(page) => progress.setIndexPage(page)}
          onPageSizeChange={setPageSize}
        />
      </div>
    {:else if blocks.length}
      <EmptyState title="No blocks for this tag" text="Select another tag or switch back to All." />
    {:else}
      <EmptyState title="No blocks in this Learn Pass" text="Edit the active Learn Pass and select at least one learning block." />
    {/if}
  </ExpansionPanel>

  <ExpansionPanel
    title="Phrase / Word of the day"
    description="A random focus card for quick daily practice."
    open={$progress.indexDailyExpanded}
    onToggle={() => progress.toggleIndexPanel('daily')}
  >
    {#if dailyItem}
      <article class="card daily-card">
        <div class="card__header">
          <div>
            <p class="tag-row"><span>{dailyItem.kind}</span>{#if dailyItem.tag}<span>{dailyItem.tag}</span>{/if}</p>
            <h3>{dailyItem.title}</h3>
            {#if dailyItem.subtitle}<p class="meta-line"><strong>Context:</strong> <span>{dailyItem.subtitle}</span></p>{/if}
            {#if dailyItem.transcription}<p class="meta-line"><strong>Transcription:</strong> <span>{dailyItem.transcription}</span></p>{/if}
            {#if dailyItem.alternatives.length}
              <p class="meta-line common-alternatives"><strong>Common alternatives:</strong> <em>{dailyItem.alternatives.join('; ')}</em></p>
            {/if}
          </div>
          <IconButton icon="shuffle" label="Show another random item" variant="secondary" onClick={pickDailyItem} />
        </div>

        <p class="translation"><strong>Meaning:</strong> {dailyItem.translation}</p>

        {#if dailyItem.examples.length}
          <div class="examples">
            {#each dailyItem.examples as example, index}
              <div class="example-box">
                <strong>Example {index + 1}</strong>
                <p class="example">{example.en}</p>
                {#if example.ua}<p class="translation">{example.ua}</p>{/if}
              </div>
            {/each}
          </div>
        {/if}

        <div class="card__actions">
          <SpeakButton text={dailyItem.speakText} />
          <FocusButton kind={dailyItem.focusKind} id={dailyItem.focusId} />
        </div>
      </article>
    {:else}
      <EmptyState title="No daily item available" text="Add words or phrases to the active Learn Pass." />
    {/if}
  </ExpansionPanel>
</section>
