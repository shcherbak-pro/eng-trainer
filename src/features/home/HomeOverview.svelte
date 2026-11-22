<script lang="ts">
  import type { HomeProgress, LibraryOverview } from './homeStats';
  import { percentLabel } from './homeStats';

  /** Your progress, then Library overview (ENG-V2-03). Values come from pure selectors. */
  export let stats: HomeProgress;
  export let library: LibraryOverview;

  const number = new Intl.NumberFormat('en');
  const pair = (learned: number, available: number): string => `${number.format(learned)} / ${number.format(available)}`;

  $: vocabulary = stats.vocabulary;
  $: percent = percentLabel(vocabulary.learned, vocabulary.available);
  $: libraryItems = [
    { label: 'Words', value: library.words },
    { label: 'Phrases', value: library.phrases },
    { label: 'Verbs', value: library.verbs },
    { label: 'Topics', value: library.topics },
    { label: 'Your collections', value: library.collections }
  ];
</script>

<div class="home-overview">
  <section class="home-panel" aria-labelledby="home-progress-title">
    <div class="home-panel__head">
      <h2 id="home-progress-title" class="home-panel__title">Your progress</h2>
      <p class="home-panel__note">Progress reflects the vocabulary currently in your library.</p>
    </div>

    <div class="home-meter">
      <p class="home-meter__row">
        <span class="home-meter__label" id="home-vocabulary-label">Vocabulary learned</span>
        {#if vocabulary.available}
          <span class="home-meter__value"><strong>{pair(vocabulary.learned, vocabulary.available)}</strong> <span class="home-meter__percent">{percent}</span></span>
        {:else}
          <span class="home-meter__value">No vocabulary yet</span>
        {/if}
      </p>
      {#if vocabulary.available}
        <div
          class="home-meter__bar"
          role="progressbar"
          aria-labelledby="home-vocabulary-label"
          aria-valuemin="0"
          aria-valuemax={vocabulary.available}
          aria-valuenow={vocabulary.learned}
          aria-valuetext={`${number.format(vocabulary.learned)} of ${number.format(vocabulary.available)} learned, ${percent}`}
        >
          <span style={`transform: scaleX(${vocabulary.learned / vocabulary.available})`}></span>
        </div>
      {/if}
    </div>

    <dl class="home-stats">
      <div class="home-stat">
        <dt>Topics completed</dt>
        <dd>{stats.topics.eligible ? pair(stats.topics.completed, stats.topics.eligible) : 'No topics yet'}</dd>
      </div>
      <div class="home-stat">
        <dt>In Focus</dt>
        <dd>{number.format(stats.focus)}</dd>
      </div>
    </dl>

    <details class="home-details">
      <summary>View details</summary>
      <div class="home-details__body">
        <dl class="home-stats home-stats--details">
          <div class="home-stat">
            <dt>Words learned</dt>
            <dd>{stats.words.available ? pair(stats.words.learned, stats.words.available) : 'No words yet'}</dd>
          </div>
          <div class="home-stat">
            <dt>Phrases learned</dt>
            <dd>{stats.phrases.available ? pair(stats.phrases.learned, stats.phrases.available) : 'No phrases yet'}</dd>
          </div>
          <div class="home-stat">
            <dt>Remaining vocabulary</dt>
            <dd>{vocabulary.available ? number.format(vocabulary.remaining) : 'No vocabulary yet'}</dd>
          </div>
        </dl>
        <p class="home-panel__note">These categories can overlap.</p>
        <p class="home-panel__note">A topic is complete when all its practice cards are marked as learned. Hidden vocabulary is included.</p>
      </div>
    </details>
  </section>

  <section class="home-panel" aria-labelledby="home-library-title">
    <div class="home-panel__head">
      <h2 id="home-library-title" class="home-panel__title">Library overview</h2>
      <p class="home-panel__note">Built-in content and your collections</p>
    </div>
    <dl class="home-stats home-stats--library">
      {#each libraryItems as item (item.label)}
        <div class="home-stat">
          <dt>{item.label}</dt>
          <dd>{number.format(item.value)}</dd>
        </div>
      {/each}
    </dl>
  </section>
</div>
