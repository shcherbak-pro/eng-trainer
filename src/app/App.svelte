<script lang="ts">
  import { onMount } from 'svelte';
  import { loadBuiltInCatalog } from '../content/builtIn';
  import type { ContentCatalog } from '../content/catalog';
  import { combineCatalog } from '../content/userCatalog';
  import { userVocabulary } from '../collections/service';
  import { StorageAbortError } from '../storage/database';
  import CollectionsPage from '../features/collections/CollectionsPage.svelte';
  import type { TrainingBlock } from '../content/types';
  import { initState, initStateWithoutStorage, progress, settings, stateHeld } from '../state';
  import { availablePagesFor, blocksForLearnPass, pageForBlock, pageFromHash, topicIdOf, topicRoute } from './navigation';
  import AppHeader from './AppHeader.svelte';
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
  import SettingsPage from '../features/settings/SettingsPage.svelte';
  import TopicPage from '../features/topics/TopicPage.svelte';
  import Icon from '../shared/ui/Icon.svelte';

  type Phase = 'loading' | 'storage-blocked' | 'storage-error' | 'content-error' | 'ready';

  let phase: Phase = 'loading';
  let errorMessage = '';
  let builtIn: ContentCatalog | null = null;
  let catalog: ContentCatalog | null = null;
  let activePage = 'index';
  let mounted = false;
  /** Each start-up attempt has a number. Results of older attempts are ignored. */
  let attempt = 0;
  let startup: AbortController | null = null;
  let blockedChecks = 0;

  $: catalog = builtIn ? combineCatalog(builtIn, $userVocabulary) : null;

  $: blocks = catalog ? blocksForLearnPass(catalog.blocks, $progress.selectedLearnPassId, $progress.learnPasses) : [];
  $: availablePages = availablePagesFor(blocks, catalog?.topics ?? []);
  $: activeTopic = catalog?.topics.find((topic) => topicRoute(topic.id) === activePage) ?? null;
  /** Topic screens the Phrases screen can link to: the topics of the active Learn Pass. */
  $: topicLinks = (catalog?.topics ?? [])
    .filter((topic) => availablePages.includes(topicRoute(topic.id)))
    .map((topic) => ({ title: topic.title, page: topicRoute(topic.id) }));

  // The saved theme may replace the system theme during start-up: no fade then.
  $: if (mounted && phase !== 'loading' && phase !== 'storage-blocked') document.documentElement.setAttribute('data-theme-ready', '');

  function fail(token: number, next: Phase, error: unknown): void {
    if (!mounted || token !== attempt) return;
    errorMessage = error instanceof Error ? error.message : String(error);
    phase = next;
  }

  /** Startup order: saved state first, then content, then the first screen. */
  async function start(): Promise<void> {
    const token = ++attempt;
    startup?.abort();
    const controller = new AbortController();
    startup = controller;
    phase = 'loading';

    // The content download does not depend on storage, so it starts right away.
    const content = loadBuiltInCatalog();
    content.catch(() => undefined);

    try {
      await initState({
        signal: controller.signal,
        // Another tab holds the old database version: show the guidance while
        // the request keeps waiting. It continues by itself once that tab closes.
        onBlocked: () => {
          if (mounted && token === attempt) phase = 'storage-blocked';
        }
      });
    } catch (error) {
      if (error instanceof StorageAbortError) return;
      fail(token, 'storage-error', error);
      return;
    }
    if (!mounted || token !== attempt) return;

    await showContent(content, token);
  }

  /** While blocked, a check joins the waiting request instead of starting a competing one. */
  function checkAgain(): void {
    blockedChecks += 1;
    void start();
  }

  async function showContent(content: Promise<ContentCatalog>, token: number): Promise<void> {
    phase = 'loading';

    let loaded: ContentCatalog;
    try {
      loaded = await content;
    } catch (error) {
      fail(token, 'content-error', error);
      return;
    }
    if (!mounted || token !== attempt) return;

    const pages = availablePagesFor(blocksForLearnPass(loaded.blocks, $progress.selectedLearnPassId, $progress.learnPasses), loaded.topics);
    const requested = pageFromHash() || $settings.activePage;

    builtIn = loaded;
    activePage = pages.includes(requested) ? requested : 'index';
    settings.setActivePage(activePage);
    phase = 'ready';
  }

  /** The user's choice wins: a database connection that opens later is closed, not used. */
  function continueWithoutSaving(): void {
    const token = ++attempt;
    startup?.abort();
    startup = null;
    initStateWithoutStorage();
    void showContent(loadBuiltInCatalog(), token);
  }

  function retryContent(): void {
    void showContent(loadBuiltInCatalog(), attempt);
  }

  function syncPageFromHash(): void {
    if (phase !== 'ready') return;
    // A recovery from a backup is being written (experimental product only, ENG-V3-R1A-RC3). Until
    // it has finished, the open screen stays open: the address is put back, and nothing else happens.
    if (__ENG_BACKUP__ && stateHeld()) {
      if (pageFromHash() !== activePage) history.replaceState(history.state, '', `#${activePage}`);
      return;
    }
    const next = pageFromHash() || $settings.activePage;
    activePage = availablePages.includes(next) ? next : 'index';
    settings.setActivePage(activePage);
  }

  function navigate(page: string): void {
    if (__ENG_BACKUP__ && stateHeld()) return;
    window.location.hash = page;
    activePage = page;
    settings.setActivePage(page);
  }

  function openBlock(block: TrainingBlock): void {
    const page = pageForBlock(block, catalog?.topics ?? []);
    // A topic screen shows its own material, so the Phrases filter is left as the learner set it.
    if (topicIdOf(page) === null) {
      if (block.type === 'phraseCategory' && block.category) settings.setPhraseCategory(block.category);
      if (block.type === 'irregularVerbs' && block.verbSet) settings.setIrregularSet(block.verbSet);
    }
    navigate(page);
  }

  // A Learn Pass can remove the screen that is currently open.
  $: if (phase === 'ready' && !availablePages.includes(activePage)) {
    navigate('index');
  }

  // The last branches of the screen list below belong to the experimental product only (ENG-V3-01,
  // ENG-V3-R1A). They must stay last, hold no comment or text of their own, and start their condition
  // with a bare compile-time constant: the stable build then drops each branch together with its import,
  // and its compiled output stays byte-identical to the released one. The released-site lock checks it.

  onMount(() => {
    mounted = true;
    window.addEventListener('hashchange', syncPageFromHash);
    void start();

    return () => {
      mounted = false;
      startup?.abort();
      window.removeEventListener('hashchange', syncPageFromHash);
    };
  });
</script>

{#if phase === 'loading'}
  <div class="startup-shell">
    <AppHeader />
    <main class="startup" aria-busy="true">
      <p class="startup__status" role="status"><span class="spinner" aria-hidden="true"></span>Loading training materials…</p>
    </main>
  </div>
{:else if phase === 'storage-blocked'}
  <div class="startup-shell">
    <AppHeader />
    <main class="startup">
      <section class="startup__panel" aria-labelledby="blocked-title">
        <Icon name="tabs" size={40} />
        <h1 id="blocked-title">Close other eng-trainer tabs</h1>
        <p>Your saved progress needs a quick upgrade. Another eng-trainer tab or window still uses the previous version, so the upgrade has to wait.</p>
        <ol class="startup__steps">
          <li>Switch to the other eng-trainer tabs or windows.</li>
          <li>Close or reload them.</li>
          <li>Come back here. This page continues by itself.</li>
        </ol>
        <p class="startup__waiting" role="status">
          <span class="spinner" aria-hidden="true"></span>
          {blockedChecks ? 'Still waiting for the other tabs to close.' : 'Waiting for the other tabs to close…'}
        </p>
        <div class="startup__actions">
          <button type="button" class="btn btn--secondary btn--md" on:click={checkAgain}>Check again</button>
          <button type="button" class="btn btn--secondary btn--md" on:click={continueWithoutSaving}>Continue without saving</button>
        </div>
        <p class="startup__note">Without saving you can study now, but your changes are lost when you close this page.</p>
        <details class="startup__details">
          <summary>Technical details</summary>
          <p>The upgrade of the browser database to version 2 is waiting for another open connection to close.</p>
        </details>
      </section>
    </main>
  </div>
{:else if phase === 'storage-error'}
  <div class="startup-shell">
    <AppHeader />
    <main class="startup">
      <section class="startup__panel error-card" role="alert" aria-labelledby="storage-error-title">
        <Icon name="error" size={40} />
        <h1 id="storage-error-title">Unable to open your saved progress</h1>
        <p>The browser storage could not be opened or read. To protect your saved progress, the app did not start with empty progress on top of it.</p>
        <p>Try again, or continue without saving: you can study, but nothing you change is kept after this page is closed.</p>
        <div class="startup__actions">
          <button type="button" class="btn btn--primary btn--md" on:click={() => void start()}>Try again</button>
          <button type="button" class="btn btn--secondary btn--md" on:click={continueWithoutSaving}>Continue without saving</button>
        </div>
        <details class="startup__details">
          <summary>Technical details</summary>
          <p><code>{errorMessage}</code></p>
        </details>
      </section>
    </main>
  </div>
{:else if phase === 'content-error' || !catalog}
  <div class="startup-shell">
    <AppHeader />
    <main class="startup">
      <section class="startup__panel error-card" role="alert" aria-labelledby="content-error-title">
        <Icon name="error" size={40} />
        <h1 id="content-error-title">The study material could not be loaded</h1>
        <p>Check your internet connection and try again. Your saved progress is not affected.</p>
        <div class="startup__actions">
          <button type="button" class="btn btn--primary btn--md" on:click={retryContent}>Try again</button>
        </div>
        <details class="startup__details">
          <summary>Technical details</summary>
          <p><code>{errorMessage}</code></p>
        </details>
      </section>
    </main>
  </div>
{:else}
  <AppShell {catalog} {availablePages} {activePage} onNavigate={navigate}>
    {#if activePage === 'index'}
      <IndexPage {catalog} {blocks} onOpenBlock={openBlock} />
    {:else if activePage === 'phrases'}
      <PhrasesPage {catalog} {topicLinks} />
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
    {:else if activePage === 'collections'}
      <CollectionsPage {catalog} />
    {:else if activePage === 'settings'}
      <SettingsPage />
    {:else if activeTopic}
      <TopicPage {catalog} topic={activeTopic} onNavigate={navigate} />
    {:else if __ENG_PRONUNCIATION__ && activePage === 'pronunciation'}
      {#await import('../features/pronunciation/PronunciationPage.svelte') then feature}
        <svelte:component this={feature.default} {catalog} />
      {/await}
    {:else if __ENG_BACKUP__ && activePage === 'backup'}
      {#await import('../features/backup/BackupPage.svelte') then feature}
        <svelte:component this={feature.default} />
      {/await}
    {/if}
  </AppShell>
{/if}
