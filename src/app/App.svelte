<script lang="ts">
  import { onMount } from 'svelte';
  import { loadBuiltInCatalog } from '../content/builtIn';
  import type { ContentCatalog } from '../content/catalog';
  import type { TrainingBlock } from '../content/types';
  import { initState, initStateWithoutStorage, progress, settings } from '../state';
  import { availablePagesFor, blocksForLearnPass, pageForBlock, pageFromHash } from './navigation';
  import AppShell from './AppShell.svelte';
  import IndexPage from '../features/home/IndexPage.svelte';
  import PhrasesPage from '../features/vocabulary/PhrasesPage.svelte';
  import WordIndexPage from '../features/vocabulary/WordIndexPage.svelte';
  import IrregularVerbsPage from '../features/vocabulary/IrregularVerbsPage.svelte';
  import FlashcardsPage from '../features/flashcards/FlashcardsPage.svelte';
  import ReversePracticePage from '../features/exercises/ReversePracticePage.svelte';
  import PatternsPage from '../features/exercises/PatternsPage.svelte';
  import AnswersPage from '../features/exercises/AnswersPage.svelte';
  import PracticePage from '../features/exercises/PracticePage.svelte';
  import FocusListPage from '../features/focus/FocusListPage.svelte';

  type Phase = 'loading' | 'storage-error' | 'content-error' | 'ready';

  let phase: Phase = 'loading';
  let errorMessage = '';
  let catalog: ContentCatalog | null = null;
  let activePage = 'index';
  let mounted = false;

  $: blocks = catalog ? blocksForLearnPass(catalog.blocks, $progress.selectedLearnPassId, $progress.learnPasses) : [];
  $: availablePages = availablePagesFor(blocks);

  function fail(next: Phase, error: unknown): void {
    if (!mounted) return;
    errorMessage = error instanceof Error ? error.message : String(error);
    phase = next;
  }

  /** Startup order: saved state first, then content, then the first screen. */
  async function start(): Promise<void> {
    phase = 'loading';

    // The content download does not depend on storage, so it starts right away.
    const content = loadBuiltInCatalog();
    content.catch(() => undefined);

    try {
      await initState();
    } catch (error) {
      fail('storage-error', error);
      return;
    }

    await showContent(content);
  }

  async function showContent(content: Promise<ContentCatalog>): Promise<void> {
    phase = 'loading';

    let loaded: ContentCatalog;
    try {
      loaded = await content;
    } catch (error) {
      fail('content-error', error);
      return;
    }
    if (!mounted) return;

    const pages = availablePagesFor(blocksForLearnPass(loaded.blocks, $progress.selectedLearnPassId, $progress.learnPasses));
    const requested = pageFromHash() || $settings.activePage;

    catalog = loaded;
    activePage = pages.includes(requested) ? requested : 'index';
    settings.setActivePage(activePage);
    phase = 'ready';
  }

  function continueWithoutSaving(): void {
    initStateWithoutStorage();
    void showContent(loadBuiltInCatalog());
  }

  function syncPageFromHash(): void {
    if (phase !== 'ready') return;
    const next = pageFromHash() || $settings.activePage;
    activePage = availablePages.includes(next) ? next : 'index';
    settings.setActivePage(activePage);
  }

  function navigate(page: string): void {
    window.location.hash = page;
    activePage = page;
    settings.setActivePage(page);
  }

  function openBlock(block: TrainingBlock): void {
    if (block.type === 'phraseCategory' && block.category) settings.setPhraseCategory(block.category);
    if (block.type === 'irregularVerbs' && block.verbSet) settings.setIrregularSet(block.verbSet);
    navigate(pageForBlock(block));
  }

  // A Learn Pass can remove the screen that is currently open.
  $: if (phase === 'ready' && !availablePages.includes(activePage)) {
    navigate('index');
  }

  onMount(() => {
    mounted = true;
    window.addEventListener('hashchange', syncPageFromHash);
    void start();

    return () => {
      mounted = false;
      window.removeEventListener('hashchange', syncPageFromHash);
    };
  });
</script>

{#if phase === 'loading'}
  <main class="center-page">
    <div class="loader-card">Loading training materials…</div>
  </main>
{:else if phase === 'storage-error'}
  <main class="center-page">
    <div class="error-card" role="alert">
      <h1>Unable to open your saved progress</h1>
      <p>The browser storage (IndexedDB) could not be opened or read, so the app did not start with empty progress on top of it.</p>
      <p><code>{errorMessage}</code></p>
      <p>You can try again, or continue without saving: the app will work, but nothing you change will be kept after this page is closed.</p>
      <div class="card__actions">
        <button type="button" class="btn primary" on:click={start}>Try again</button>
        <button type="button" class="btn secondary" on:click={continueWithoutSaving}>Continue without saving</button>
      </div>
    </div>
  </main>
{:else if phase === 'content-error' || !catalog}
  <main class="center-page">
    <div class="error-card" role="alert">
      <h1>Unable to start the app</h1>
      <p>{errorMessage}</p>
      <p>For local development, run <code>npm run dev</code> or <code>npm run preview</code> after building.</p>
      <div class="card__actions">
        <button type="button" class="btn primary" on:click={() => showContent(loadBuiltInCatalog())}>Try again</button>
      </div>
    </div>
  </main>
{:else}
  <AppShell {catalog} {availablePages} {activePage} compactHero={activePage === 'flashcards'} onNavigate={navigate}>
    {#if activePage === 'index'}
      <IndexPage {catalog} {blocks} onOpenBlock={openBlock} />
    {:else if activePage === 'phrases'}
      <PhrasesPage {catalog} />
    {:else if activePage === 'wordIndex'}
      <WordIndexPage {catalog} />
    {:else if activePage === 'flashcards'}
      <FlashcardsPage {catalog} />
    {:else if activePage === 'reverse'}
      <ReversePracticePage {catalog} />
    {:else if activePage === 'irregularVerbs'}
      <IrregularVerbsPage {catalog} />
    {:else if activePage === 'patterns'}
      <PatternsPage patterns={catalog.patterns} />
    {:else if activePage === 'answers'}
      <AnswersPage answers={catalog.answers} />
    {:else if activePage === 'practice'}
      <PracticePage drills={catalog.drills} />
    {:else if activePage === 'favorites'}
      <FocusListPage {catalog} onOpenBlock={openBlock} />
    {/if}
  </AppShell>
{/if}
