<script lang="ts">
  import { progress } from '../stores/progress';
  import type { Materials, Phrase } from '../types/materials';
  import { matchesQuery, uniqueSorted } from '../utils/filters';
  import PhraseCard from '../components/PhraseCard.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import SectionSpeechControl from '../components/SectionSpeechControl.svelte';
  import { phraseToSpeechItem } from '../utils/speechFormatters';
  import IconButton from '../components/IconButton.svelte';

  export let materials: Materials;

  type PhraseGroup = {
    section: string;
    items: Phrase[];
  };

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
  $: speechItems = visible.map(phraseToSpeechItem);
  $: showSectionGroups = $progress.phraseCategory !== 'All' && visible.some((item) => item.section || item.sequence);
  $: sectionGroups = showSectionGroups ? groupBySection(visible) : [];
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
    <SectionSpeechControl controlId="phrases-visible" label="Listen phrases" items={speechItems} help="Reads visible phrases, translations, alternatives and examples." />
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

  {#if visible.length}
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
        {#each visible as phrase (phrase.id)}
          <PhraseCard {phrase} />
        {/each}
      </div>
    {/if}
  {:else}
    <EmptyState title="No phrases found" />
  {/if}
</section>
