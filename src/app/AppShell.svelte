<script lang="ts">
  import type { ContentCatalog } from '../content/catalog';
  import { progress } from '../state/progress';
  import { retrySave, saveStatus } from '../state/persistence';
  import { MOBILE_PAGES, PAGE_LABELS } from './navigation';
  import ThemeToggle from './ThemeToggle.svelte';

  export let catalog: ContentCatalog;
  export let availablePages: string[];
  export let activePage: string;
  export let onNavigate: (page: string) => void;
  /** Shows only the page title in the hero, for pages that need the screen space. */
  export let compactHero = false;

  /** The preserved v1 application is published next to this one. */
  const v1Url = `${import.meta.env.BASE_URL}v1/`;

  $: focusCount = $progress.favoriteBlocks.length + $progress.favoritePhrases.length + $progress.favoriteWords.length + $progress.favoriteIrregular.length;
  $: hiddenCount = $progress.hiddenPhrases.length + $progress.hiddenWords.length + $progress.hiddenIrregular.length;
</script>

<div class="app-shell">
  <header class="topbar">
    <div class="topbar__inner">
      <button class="brand" on:click={() => onNavigate('index')} aria-label="Go to index">
        <span class="brand__mark">EA</span>
        <span>
          <strong>{catalog.meta.title}</strong>
          <small>{catalog.meta.version} · B1+ → B2</small>
        </span>
      </button>

      <div class="topbar__actions">
        <nav class="desktop-nav" aria-label="Main navigation">
          {#each availablePages as page}
            <button class:active={activePage === page} on:click={() => onNavigate(page)}>
              {PAGE_LABELS[page] ?? page}
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

  <section class="hero" class:hero--compact={compactHero}>
    <div>
      <p class="eyebrow">Speaking assessment trainer</p>
      <h1>{PAGE_LABELS[activePage] ?? 'Trainer'}</h1>
      <p>{catalog.meta.goal}</p>
    </div>
    <div class="hero__stats">
      <span><strong>{catalog.phrases.length}</strong> phrases</span>
      <span><strong>{catalog.wordIndex.length}</strong> words</span>
      <span><strong>{catalog.irregularVerbs.length}</strong> verbs</span>
      <span><strong>{focusCount}</strong> focus</span>
      <span><strong>{hiddenCount}</strong> hidden</span>
    </div>
  </section>

  <main class="page-wrap">
    {#if $saveStatus.state === 'error'}
      <div class="notice storage-notice" role="alert">
        <p>
          <strong>Your latest changes are not saved.</strong>
          They stay on screen, but will be lost when this page is closed unless saving succeeds.
          <small class="muted">{$saveStatus.message}</small>
        </p>
        <button type="button" class="btn primary" on:click={retrySave}>Try saving again</button>
      </div>
    {:else if $saveStatus.state === 'disabled'}
      <div class="notice storage-notice" role="alert">
        <p>
          <strong>Saving is off.</strong>
          The browser storage could not be opened, so changes are lost when this page is closed.
        </p>
      </div>
    {/if}

    <slot />

    <footer class="app-footer">
      <a href={v1Url}>Open the previous version (v1)</a>
      <span class="muted">v1 is kept as it was and has its own separate progress.</span>
    </footer>
  </main>

  <nav class="bottom-nav" aria-label="Mobile navigation">
    {#each MOBILE_PAGES as page}
      {#if availablePages.includes(page)}
        <button class:active={activePage === page} on:click={() => onNavigate(page)}>
          <span>{PAGE_LABELS[page]}</span>
        </button>
      {/if}
    {/each}
  </nav>
</div>
