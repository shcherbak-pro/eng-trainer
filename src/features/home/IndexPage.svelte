<script lang="ts">
  import { blockDescriptionLang } from '../../content/descriptionLanguage';
  import type { ContentCatalog } from '../../content/catalog';
  import type { IrregularVerb, Phrase, TrainingBlock, WordExample, WordIndexItem } from '../../content/types';
  import { pageForBlock } from '../../app/navigation';
  import { progress } from '../../state/progress';
  import { settings } from '../../state/settings';
  import { viewState } from '../../state/viewState';
  import EntryExamples from '../../shared/entries/EntryExamples.svelte';
  import FocusButton from '../../shared/entries/FocusButton.svelte';
  import SpeakButton from '../../shared/speech/SpeakButton.svelte';
  import Button from '../../shared/ui/Button.svelte';
  import EmptyState from '../../shared/ui/EmptyState.svelte';
  import PaginationControls from '../../shared/ui/PaginationControls.svelte';
  import { paginate, totalPages, type PageSizeOption } from '../../shared/pagination';
  import { splitAlternatives } from '../../shared/text';
  import { buildFlashcards } from '../flashcards/flashcards';
  import ExpansionPanel from './ExpansionPanel.svelte';
  import HomeOverview from './HomeOverview.svelte';
  import { homeProgress, libraryOverview } from './homeStats';
  import LearnPassManager from './LearnPassManager.svelte';
  import TopicCards from './TopicCards.svelte';

  export let catalog: ContentCatalog;
  /** The blocks of the active Learn Pass. */
  export let blocks: TrainingBlock[];
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

  function setPageSize(value: PageSizeOption): void {
    settings.setIndexPageSize(value === 'all' ? 'all' : value === 12 ? 12 : 6);
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
      alternatives: splitAlternatives(item.commonAlternatives),
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
      alternatives: splitAlternatives(item.commonAlternatives),
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
      alternatives: splitAlternatives(item.commonAlternatives),
      examples,
      tag: item.group,
      focusKind: 'irregular',
      focusId: item.id,
      speakText: [`${item.base}, ${item.pastSimple}, ${item.pastParticiple}`, item.translation, ...examples.map((example) => example.en)].filter(Boolean).join('. ')
    };
  }

  function getDailyCandidates(data: ContentCatalog, activeBlocks: TrainingBlock[]): DailyItem[] {
    const candidates: DailyItem[] = [];
    const phraseCategories = new Set(
      activeBlocks
        .filter((block) => block.type === 'phraseCategory' && block.category)
        .map((block) => block.category as string)
    );
    const hasWordIndex = activeBlocks.some((block) => block.type === 'wordIndex');
    const activeVerbSets = new Set(
      activeBlocks
        .filter((block) => block.type === 'irregularVerbs' && block.verbSet)
        .map((block) => block.verbSet as string)
    );
    const hasIrregularVerbs = activeBlocks.some((block) => block.type === 'irregularVerbs');

    if (phraseCategories.size) {
      candidates.push(...data.phrases.filter((item) => phraseCategories.has(item.category)).map(phraseToDaily));
    }

    if (hasWordIndex) {
      candidates.push(...data.wordIndex.map(wordToDaily));
    }

    if (hasIrregularVerbs) {
      const verbs = activeVerbSets.size
        ? data.irregularVerbs.filter((item) => item.verbSet && activeVerbSets.has(item.verbSet))
        : data.irregularVerbs;
      candidates.push(...verbs.map(verbToDaily));
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

  // Home statistics (ENG-V2-03): derived from the whole current catalog, never from a filtered view.
  $: cards = buildFlashcards(catalog);
  $: stats = homeProgress(catalog, $progress, cards);
  $: library = libraryOverview(catalog, cards);

  $: tagOptions = getTagOptions(blocks);
  $: selectedTagExists = !$settings.indexTagFilter || tagOptions.some((option) => option.tag === $settings.indexTagFilter);
  $: filteredBlocks = selectedTagExists && $settings.indexTagFilter
    ? blocks.filter((block) => block.tag === $settings.indexTagFilter)
    : blocks;
  $: pageCount = totalPages(filteredBlocks.length, $settings.indexPageSize);
  $: currentPage = Math.min(Math.max(1, $viewState.indexPage), pageCount);
  $: pagedBlocks = paginate(filteredBlocks, currentPage, $settings.indexPageSize);
  $: dailyCandidates = getDailyCandidates(catalog, blocks);
  $: nextDailyPoolSignature = getPoolSignature(dailyCandidates);
  $: dailyItem = dailyCandidates.find((item) => item.key === dailyItemKey) ?? dailyCandidates[0] ?? null;

  $: if ($viewState.indexPage !== currentPage) {
    viewState.setIndexPage(currentPage);
  }

  $: if (nextDailyPoolSignature && nextDailyPoolSignature !== dailyPoolSignature) {
    dailyPoolSignature = nextDailyPoolSignature;
    pickDailyItem();
  }
</script>

<div class="home">
  <HomeOverview {stats} {library} />

  <TopicCards topics={catalog.topics} {blocks} completion={stats.topics.list} {onOpenBlock} />

  <ExpansionPanel
    title="Learn Pass"
    description="Choose or create a focused learning track."
    open={$settings.indexLearnPassExpanded}
    onToggle={() => settings.toggleIndexPanel('learnPass')}
  >
    <LearnPassManager {catalog} />
  </ExpansionPanel>

  {#if tagOptions.length}
    <ExpansionPanel
      title="Tags"
      description="Show only the learning blocks with one tag."
      open={$settings.indexTagCloudExpanded}
      onToggle={() => settings.toggleIndexPanel('tagCloud')}
    >
      <div class="tag-cloud" role="group" aria-label="Tag filter">
        <button aria-pressed={!$settings.indexTagFilter} type="button" on:click={() => settings.setIndexTagFilter('')}>
          All <span>{blocks.length}</span>
        </button>
        {#each tagOptions as option}
          <button aria-pressed={$settings.indexTagFilter === option.tag} type="button" on:click={() => settings.setIndexTagFilter(option.tag)}>
            {option.tag} <span>{option.count}</span>
          </button>
        {/each}
      </div>
    </ExpansionPanel>
  {/if}

  <ExpansionPanel
    title="Learning blocks"
    description="Materials from your active Learn Pass."
    open={$settings.indexLearningBlocksExpanded}
    onToggle={() => settings.toggleIndexPanel('learningBlocks')}
  >
    {#if filteredBlocks.length}
      <ul class="block-list">
        {#each pagedBlocks as block (block.id)}
          <li class="block-row">
            <a class="block-row__open" href={`#${pageForBlock(block, catalog.topics)}`} on:click|preventDefault={() => onOpenBlock(block)}>
              <span class="block-row__title">{block.title}</span>
              <span class="block-row__meta">
                {#if block.tag}{block.tag}{:else}{block.type}{/if}{#if block.itemsCount}, {block.itemsCount} items{/if}
              </span>
              {#if block.description}<span class="block-row__meta" lang={blockDescriptionLang(block.id)}>{block.description}</span>{/if}
            </a>
            <div class="block-row__actions"><FocusButton kind="block" id={block.id} /></div>
          </li>
        {/each}
      </ul>

      <PaginationControls
        total={filteredBlocks.length}
        page={currentPage}
        pageSize={$settings.indexPageSize}
        {pageSizeOptions}
        label="Learning block pages"
        onPageChange={(page) => viewState.setIndexPage(page)}
        onPageSizeChange={setPageSize}
      />
    {:else if blocks.length}
      <EmptyState level="h3" title="No blocks with this tag" text="Choose another tag, or All.">
        <Button variant="secondary" size="sm" onClick={() => settings.setIndexTagFilter('')}>Show all tags</Button>
      </EmptyState>
    {:else}
      <EmptyState level="h3" title="No blocks in this Learn Pass" text="Edit the active Learn Pass and select at least one learning block." />
    {/if}
  </ExpansionPanel>

  <ExpansionPanel
    title="Phrase or word of the day"
    description="A random item from your Learn Pass for quick practice."
    open={$settings.indexDailyExpanded}
    onToggle={() => settings.toggleIndexPanel('daily')}
  >
    {#if dailyItem}
      <article class="daily">
        <p class="entry__meta"><span class="badge">{dailyItem.kind}</span>{#if dailyItem.subtitle}<span>{dailyItem.subtitle}</span>{/if}</p>
        <h3 class="daily__term" lang="en" translate="no">{dailyItem.title}</h3>
        <p class="entry__translation" lang="uk">{dailyItem.translation}</p>
        {#if dailyItem.transcription}<p class="entry__ipa ipa" translate="no">{dailyItem.transcription}</p>{/if}
        <EntryExamples examples={dailyItem.examples} alternatives={dailyItem.alternatives} lang="uk" />
        <div class="daily__actions">
          <SpeakButton text={dailyItem.speakText} label="Listen" withText />
          <FocusButton kind={dailyItem.focusKind} id={dailyItem.focusId} />
          <Button variant="quiet" size="sm" icon="shuffle" onClick={pickDailyItem}>Show another</Button>
        </div>
      </article>
    {:else}
      <EmptyState level="h3" title="No daily item available" text="Add words or phrases to the active Learn Pass." />
    {/if}
  </ExpansionPanel>
</div>
