<script lang="ts">
  import type { ContentCatalog } from '../../content/catalog';
  import type { LearningTopic, TopicSection } from '../../content/types';
  import { resolvedCollection } from '../../content/userCatalog';
  import { progress } from '../../state/progress';
  import { settings } from '../../state/settings';
  import { viewState } from '../../state/viewState';
  import AnswerCard from '../../shared/entries/AnswerCard.svelte';
  import PatternCard from '../../shared/entries/PatternCard.svelte';
  import PhraseCard from '../../shared/entries/PhraseCard.svelte';
  import SectionSpeechControl from '../../shared/speech/SectionSpeechControl.svelte';
  import SpeakButton from '../../shared/speech/SpeakButton.svelte';
  import { phraseToSpeechItem } from '../../shared/speech/speechFormatters';
  import Button from '../../shared/ui/Button.svelte';
  import EmptyState from '../../shared/ui/EmptyState.svelte';
  import SearchField from '../../shared/ui/SearchField.svelte';
  import { hasPlaceholder, topicPhraseIds, topicSectionViews } from './topicView';
  import { revealFocusedChip } from './revealFocusedChip';

  /**
   * The one shared, data-driven screen for every learning topic (ENG-V2-03). It composes
   * the existing phrase, pattern and answer components; only the listed phrases are cards.
   * A topic whose subsections act as filters also gets chips and a search field.
   */
  export let catalog: ContentCatalog;
  export let topic: LearningTopic;
  export let onNavigate: (page: string) => void;

  type Level = 'h2' | 'h3' | 'h4';

  $: phraseById = new Map(catalog.phrases.map((phrase) => [phrase.id, phrase]));
  $: answerById = new Map(catalog.answers.filter((answer) => answer.id).map((answer) => [answer.id as string, answer]));
  $: query = topic.filter ? ($viewState.topicQueries[topic.id] ?? '') : '';
  $: selectedSection = topic.filter ? ($viewState.topicSections[topic.id] ?? '') : '';
  // The shared phrase search decides what matches, exactly as on the Phrases screen.
  $: matches = query.trim() ? new Set(catalog.searchPhrases(query).map((phrase) => phrase.id)) : null;
  $: hiddenPhraseIds = new Set($progress.hiddenPhrases);
  $: phraseIds = topicPhraseIds(topic);
  $: hiddenInTopic = phraseIds.filter((id) => hiddenPhraseIds.has(id)).length;
  $: views = topicSectionViews(topic, phraseById, answerById, {
    matches,
    sectionId: selectedSection,
    hiddenPhraseIds,
    showHidden: $settings.showHiddenPhrases
  });
  $: visibleRows = views.flatMap((view) => view.rows);
  $: speechItems = visibleRows.map(phraseToSpeechItem);
  $: placeholders = phraseIds.some((id) => hasPlaceholder(phraseById.get(id)?.phrase ?? ''));

  /** Subsections with questions, a structure or a model answer get their own subheadings. */
  function detailed(section: TopicSection): boolean {
    return Boolean(section.questions?.length || section.structure || section.answerId);
  }

  function heading(level: number): Level {
    return level <= 2 ? 'h2' : level === 3 ? 'h3' : 'h4';
  }

  function rowHeading(level: number): 'h3' | 'h4' {
    return level <= 3 ? 'h3' : 'h4';
  }

  function headingId(section: TopicSection): string {
    return `topic-${topic.id}-${section.id}`;
  }

  function clearFilters(): void {
    viewState.setTopicQuery(topic.id, '');
    viewState.setTopicSection(topic.id, '');
  }

  /** Opens the existing flashcard deck of this topic. */
  function practice(): void {
    // A selected user collection would leave this built-in topic's deck empty.
    const collection = resolvedCollection(catalog, $settings.collectionFilter);
    if (collection && collection !== 'built-in') settings.setCollectionFilter('');
    settings.setFlashcardMode('topic');
    settings.setFlashcardTopic(topic.title);
    onNavigate('flashcards');
  }
</script>

<div class="topic-page">
  <div class="topic-intro">
    <p class="topic-intro__description">{topic.description}</p>
    {#if topic.note}<p class="topic-intro__note">{topic.note}</p>{/if}
    {#if placeholders}<p class="topic-intro__hint">Replace the text in brackets with your own details.</p>{/if}
  </div>

  <div class="topic-actions">
    <Button variant="primary" icon="practice" onClick={practice}>Practice this topic</Button>
    {#if hiddenInTopic || $settings.showHiddenPhrases}
      <button type="button" class="chip-toggle" aria-pressed={$settings.showHiddenPhrases} on:click={() => settings.toggleShowHidden('phrase')}>
        Show hidden ({hiddenInTopic})
      </button>
    {/if}
  </div>

  {#if topic.filter}
    <div class="topic-toolbar">
      <SearchField
        label={`Search ${topic.title} phrases`}
        value={query}
        placeholder="Search English or Ukrainian…"
        onInput={(value) => viewState.setTopicQuery(topic.id, value)}
      />
      <div class="chip-row" role="group" aria-label={topic.filter.label} use:revealFocusedChip>
        <button type="button" class="chip-toggle" aria-pressed={!selectedSection} on:click={() => viewState.setTopicSection(topic.id, '')}>{topic.filter.all}</button>
        {#each topic.sections as section (section.id)}
          <button type="button" class="chip-toggle" aria-pressed={selectedSection === section.id} on:click={() => viewState.setTopicSection(topic.id, section.id)}>{section.title}</button>
        {/each}
      </div>
    </div>
  {/if}

  <div class="list-header">
    <p class="list-header__count" role="status">{visibleRows.length} practice {visibleRows.length === 1 ? 'phrase' : 'phrases'}</p>
    <SectionSpeechControl
      controlId={`topic-${topic.id}`}
      label="Listen to all"
      items={speechItems}
      help="Reads the practice phrases shown on this screen with their translations."
    />
  </div>

  {#if views.length}
    {#each views as view (view.section.id)}
      {@const level = view.section.group ? 3 : 2}
      {#if view.groupHeading}<h2 class="topic-group">{view.groupHeading}</h2>{/if}
      <section class="topic-section" aria-labelledby={headingId(view.section)}>
        <svelte:element this={heading(level)} id={headingId(view.section)} class="topic-section__title">{view.section.title}</svelte:element>
        {#if view.section.note}<p class="topic-section__note">{view.section.note}</p>{/if}
        {#if view.section.pattern}
          <div class="reading-card topic-rule">
            <PatternCard pattern={{ formula: view.section.pattern, use: view.section.use }} formulaLabel="Pattern" />
          </div>
        {/if}

        {#if detailed(view.section)}
          {#if view.section.questions?.length}
            <svelte:element this={heading(level + 1)} class="topic-section__subheading">Typical questions</svelte:element>
            <ul class="topic-questions">
              {#each view.section.questions as question (question.en)}
                <li class="topic-question">
                  <div class="topic-question__text">
                    <p class="topic-question__english" lang="en" translate="no">{question.en}</p>
                    <p class="entry__translation" lang="uk">{question.ua}</p>
                  </div>
                  <SpeakButton text={question.en} label={`Listen: ${question.en}`} />
                </li>
              {/each}
            </ul>
          {/if}
          {#if view.section.structure}
            <svelte:element this={heading(level + 1)} class="topic-section__subheading">Answer structure</svelte:element>
            <p class="reading-card__formula topic-structure">{view.section.structure}</p>
          {/if}
          <svelte:element this={heading(level + 1)} class="topic-section__subheading">Answer frames</svelte:element>
          {#if view.rows.length}
            <ul class="entry-list">
              {#each view.rows as phrase (phrase.id)}<li><PhraseCard {phrase} headingLevel={rowHeading(level + 2)} /></li>{/each}
            </ul>
          {:else}
            <p class="muted topic-section__empty">Every answer frame here is hidden.</p>
          {/if}
          {#if view.answer}
            <div class="reading-card topic-answer">
              <AnswerCard answer={view.answer} variant="model" headingLevel={heading(level + 1)} />
            </div>
          {/if}
        {:else if view.rows.length}
          <ul class="entry-list">
            {#each view.rows as phrase (phrase.id)}<li><PhraseCard {phrase} headingLevel={rowHeading(level + 1)} /></li>{/each}
          </ul>
        {:else}
          <p class="muted topic-section__empty">Every practice phrase here is hidden.</p>
        {/if}
      </section>
    {/each}
  {:else}
    <EmptyState title="No phrases found" text={`Try a different search, or choose ${topic.filter?.all ?? 'another subsection'}.`}>
      <Button variant="secondary" size="sm" onClick={clearFilters}>Clear search and filter</Button>
    </EmptyState>
  {/if}

  {#if topic.usageNote}
    <section class="topic-usage" aria-labelledby={`topic-${topic.id}-usage`}>
      <h2 id={`topic-${topic.id}-usage`}>Usage note</h2>
      <p>{topic.usageNote}</p>
    </section>
  {/if}
</div>
