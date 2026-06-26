<script lang="ts">
  import { progress } from '../stores/progress';
  import type { Materials } from '../types/materials';
  import ThemeToggle from './ThemeToggle.svelte';

  export let materials: Materials;
  export let availablePages: string[];
  export let activePage: string;
  export let pageLabels: Record<string, string>;
  export let onNavigate: (page: string) => void;

  $: focusCount = $progress.favoriteBlocks.length + $progress.favoritePhrases.length + $progress.favoriteWords.length + $progress.favoriteIrregular.length;
  $: hiddenCount = $progress.hiddenPhrases.length + $progress.hiddenWords.length + $progress.hiddenIrregular.length;
</script>

<div class="app-shell">
  <header class="topbar">
    <div class="topbar__inner">
      <button class="brand" on:click={() => onNavigate('index')} aria-label="Go to index">
        <span class="brand__mark">EA</span>
        <span>
          <strong>{materials.meta.title}</strong>
          <small>{materials.meta.version} · B1+ → B2</small>
        </span>
      </button>

      <div class="topbar__actions">
        <nav class="desktop-nav" aria-label="Main navigation">
          {#each availablePages as page}
            <button class:active={activePage === page} on:click={() => onNavigate(page)}>
              {pageLabels[page] ?? page}
              {#if page === 'favorites' && focusCount > 0}
                <span class="pill mini">{focusCount}</span>
              {/if}
            </button>
          {/each}
        </nav>

        <ThemeToggle />
      </div>
    </div>
  </header>

  <section class="hero">
    <div>
      <p class="eyebrow">Speaking assessment trainer</p>
      <h1>{pageLabels[activePage] ?? 'Trainer'}</h1>
      <p>{materials.meta.goal}</p>
    </div>
    <div class="hero__stats">
      <span><strong>{materials.phrases.length}</strong> phrases</span>
      <span><strong>{materials.wordIndex.length}</strong> words</span>
      <span><strong>{materials.irregularVerbs.length}</strong> verbs</span>
      <span><strong>{focusCount}</strong> focus</span>
      <span><strong>{hiddenCount}</strong> hidden</span>
    </div>
  </section>

  <main class="page-wrap">
    <slot />
  </main>

  <nav class="bottom-nav" aria-label="Mobile navigation">
    {#each ['index', 'phrases', 'wordIndex', 'reverse', 'irregularVerbs', 'favorites'] as page}
      {#if availablePages.includes(page)}
        <button class:active={activePage === page} on:click={() => onNavigate(page)}>
          <span>{pageLabels[page]}</span>
        </button>
      {/if}
    {/each}
  </nav>
</div>
