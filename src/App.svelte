<script lang="ts">
  import { onMount } from 'svelte';
  import { DEFAULT_LEARN_PASS_ID, progress } from './lib/stores/progress';
  import type { LearnPass, Materials, TrainingBlock } from './lib/types/materials';
  import AppShell from './lib/components/AppShell.svelte';
  import IndexPage from './lib/pages/IndexPage.svelte';
  import PhrasesPage from './lib/pages/PhrasesPage.svelte';
  import WordIndexPage from './lib/pages/WordIndexPage.svelte';
  import ReversePracticePage from './lib/pages/ReversePracticePage.svelte';
  import IrregularVerbsPage from './lib/pages/IrregularVerbsPage.svelte';
  import PatternsPage from './lib/pages/PatternsPage.svelte';
  import AnswersPage from './lib/pages/AnswersPage.svelte';
  import PracticePage from './lib/pages/PracticePage.svelte';
  import FocusListPage from './lib/pages/FocusListPage.svelte';

  let materials: Materials | null = null;
  let loading = true;
  let error = '';
  let activePage = 'index';

  const pageLabels: Record<string, string> = {
    index: 'Index',
    phrases: 'Phrases',
    wordIndex: 'Words',
    reverse: 'Reverse',
    irregularVerbs: 'Verbs',
    patterns: 'Patterns',
    answers: 'Answers',
    practice: 'Practice',
    favorites: 'Focus'
  };

  function blockHasContent(block: TrainingBlock, data: Materials): boolean {
    if (block.type === 'phraseCategory') return data.phrases.some((item) => item.category === block.category);
    if (block.type === 'wordIndex') return data.wordIndex.length > 0;
    if (block.type === 'reversePractice') return data.wordIndex.length > 0 || data.phrases.length > 0;
    if (block.type === 'irregularVerbs') {
      return block.verbSet
        ? data.irregularVerbs.some((item) => item.verbSet === block.verbSet)
        : data.irregularVerbs.length > 0;
    }
    if (block.type === 'patterns') return data.patterns.length > 0;
    if (block.type === 'answers') return data.answers.length > 0;
    if (block.type === 'practice') return data.drills.length > 0;
    return false;
  }

  function getBlocksForLearnPass(
    allBlocks: TrainingBlock[],
    selectedLearnPassId: string,
    learnPasses: LearnPass[]
  ): TrainingBlock[] {
    if (selectedLearnPassId === DEFAULT_LEARN_PASS_ID) return allBlocks;

    const activePass = learnPasses.find((pass) => pass.id === selectedLearnPassId);
    if (!activePass) return allBlocks;

    const allowed = new Set(activePass.blockIds);
    return allBlocks.filter((block) => allowed.has(block.id));
  }

  $: allBlocks = materials ? materials.blocks.filter((block) => blockHasContent(block, materials!)).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)) : [];
  $: selectedLearnPassId = $progress.selectedLearnPassId;
  $: learnPasses = $progress.learnPasses;
  $: blocks = getBlocksForLearnPass(allBlocks, selectedLearnPassId, learnPasses);
  $: availablePages = getAvailablePages(blocks);

  function getAvailablePages(blockList: TrainingBlock[]): string[] {
    const pages = ['index'];
    const types = new Set(blockList.map((block) => block.type));

    if (types.has('phraseCategory')) pages.push('phrases');
    if (types.has('wordIndex')) pages.push('wordIndex');
    if (types.has('reversePractice')) pages.push('reverse');
    if (types.has('irregularVerbs')) pages.push('irregularVerbs');
    if (types.has('patterns')) pages.push('patterns');
    if (types.has('answers')) pages.push('answers');
    if (types.has('practice')) pages.push('practice');

    pages.push('favorites');
    return pages;
  }

  function pageFromHash(): string {
    return (window.location.hash || '').replace('#', '') || $progress.activePage || 'index';
  }

  function syncPageFromHash(): void {
    const next = pageFromHash();
    activePage = availablePages.includes(next) ? next : 'index';
    progress.setActivePage(activePage);
  }

  function navigate(page: string): void {
    window.location.hash = page;
    activePage = page;
    progress.setActivePage(page);
  }

  function openBlock(block: TrainingBlock): void {
    if (block.type === 'phraseCategory' && block.category) {
      progress.setPhraseCategory(block.category);
      navigate('phrases');
      return;
    }
    if (block.type === 'irregularVerbs') {
      if (block.verbSet) progress.setIrregularSet(block.verbSet);
      navigate('irregularVerbs');
      return;
    }

    const map: Record<string, string> = {
      wordIndex: 'wordIndex',
      reversePractice: 'reverse',
      patterns: 'patterns',
      answers: 'answers',
      practice: 'practice'
    };
    navigate(map[block.type] ?? 'index');
  }

  $: if (!loading && materials && !availablePages.includes(activePage)) {
    navigate('index');
  }

  onMount(() => {
    let mounted = true;

    async function load(): Promise<void> {
      try {
        const url = `${import.meta.env.BASE_URL}data/materials.json`;
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Failed to load ${url}`);
        const loaded = await response.json();
        if (!mounted) return;
        materials = loaded;
        loading = false;
        const pages = getAvailablePages(loaded.blocks.filter((block: TrainingBlock) => blockHasContent(block, loaded)));
        const next = pageFromHash();
        activePage = pages.includes(next) ? next : 'index';
        progress.setActivePage(activePage);
        window.addEventListener('hashchange', syncPageFromHash);
      } catch (e) {
        if (!mounted) return;
        error = e instanceof Error ? e.message : 'Unable to load materials.';
        loading = false;
      }
    }

    load();

    return () => {
      mounted = false;
      window.removeEventListener('hashchange', syncPageFromHash);
    };
  });
</script>

{#if loading}
  <main class="center-page">
    <div class="loader-card">Loading training materials…</div>
  </main>
{:else if error || !materials}
  <main class="center-page">
    <div class="error-card">
      <h1>Unable to start the app</h1>
      <p>{error}</p>
      <p>For local development, run <code>npm run dev</code> or <code>npm run preview</code> after building.</p>
    </div>
  </main>
{:else}
  <AppShell {materials} {availablePages} {activePage} {pageLabels} onNavigate={navigate}>
    {#if activePage === 'index'}
      <IndexPage {materials} {blocks} {allBlocks} onOpenBlock={openBlock} />
    {:else if activePage === 'phrases'}
      <PhrasesPage {materials} />
    {:else if activePage === 'wordIndex'}
      <WordIndexPage {materials} />
    {:else if activePage === 'reverse'}
      <ReversePracticePage {materials} />
    {:else if activePage === 'irregularVerbs'}
      <IrregularVerbsPage {materials} />
    {:else if activePage === 'patterns'}
      <PatternsPage patterns={materials.patterns} />
    {:else if activePage === 'answers'}
      <AnswersPage answers={materials.answers} />
    {:else if activePage === 'practice'}
      <PracticePage drills={materials.drills} />
    {:else if activePage === 'favorites'}
      <FocusListPage {materials} blocks={allBlocks} onOpenBlock={openBlock} />
    {/if}
  </AppShell>
{/if}
