<script lang="ts">
  import { progress } from '../stores/progress';
  import type { Materials } from '../types/materials';
  import { matchesQuery, uniqueSorted } from '../utils/filters';
  import IrregularVerbCard from '../components/IrregularVerbCard.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import SectionSpeechControl from '../components/SectionSpeechControl.svelte';
  import { irregularVerbToSpeechItem } from '../utils/speechFormatters';

  export let materials: Materials;

  $: groups = ['All', ...uniqueSorted(materials.irregularVerbs.map((item) => item.group))];
  $: visible = materials.irregularVerbs.filter((item) => {
    const hidden = $progress.hiddenIrregular.includes(item.id);
    if (hidden && !$progress.showHiddenIrregular) return false;
    if ($progress.irregularGroup !== 'All' && item.group !== $progress.irregularGroup) return false;
    return matchesQuery($progress.irregularQuery, item.base, item.pastSimple, item.pastParticiple, item.translation, item.transcription, item.group);
  });
  $: speechItems = visible.map(irregularVerbToSpeechItem);
</script>

<section class="section-stack">
  <div class="toolbar-card controls-grid">
    <div>
      <h2>100 Irregular Verbs</h2>
      <p>3 форми, переклад, транскрипція, 2 приклади, групування за контекстом.</p>
    </div>
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
    <SectionSpeechControl controlId="irregular-visible" label="Listen verbs" items={speechItems} help="Reads visible verb forms, translations and examples." />
    <div class="control-actions">
      <button class="btn secondary" on:click={() => progress.toggleShowHidden('irregular')}>{$progress.showHiddenIrregular ? 'Hide hidden' : 'Show hidden'}</button>
      {#if $progress.hiddenIrregular.length}
        <button class="btn danger" on:click={() => progress.unhideAll('irregular')}>Unhide all</button>
      {/if}
    </div>
  </div>

  {#if visible.length}
    <div class="cards-list">
      {#each visible as verb (verb.id)}
        <IrregularVerbCard {verb} />
      {/each}
    </div>
  {:else}
    <EmptyState title="No verbs found" />
  {/if}
</section>
