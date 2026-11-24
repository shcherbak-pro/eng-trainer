<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { ContentCatalog } from '../content/catalog';
  import { progress } from '../state/progress';
  import { retrySave, saveStatus } from '../state/persistence';
  import { DESTINATIONS, PAGE_LABELS, destinationOf, destinationPages, pageTitle, topicIdOf, type Destination } from './navigation';
  import { focusCount as countFocus } from '../features/home/homeStats';
  import AppHeader from './AppHeader.svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  import Button from '../shared/ui/Button.svelte';
  import Icon from '../shared/ui/Icon.svelte';
  import Notice from '../shared/ui/Notice.svelte';
  import ToastRegion from '../shared/ui/ToastRegion.svelte';

  export let catalog: ContentCatalog;
  export let availablePages: string[];
  export let activePage: string;
  /** Opens a screen immediately. Links still carry the #hash for new tabs and copying. */
  export let onNavigate: (page: string) => void;

  // A plain click navigates in place; modified clicks (new tab, new window) keep the browser default.
  function go(event: MouseEvent, page: string): void {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(page);
  }

  /**
   * The preserved v1 application is published at the site base, next to every product.
   * This product's own base path can be a sub-path of the site, so it is not used here.
   */
  const v1Url = `${__SITE_BASE__}v1/`;

  let heading: HTMLHeadingElement | undefined;
  let main: HTMLElement | undefined;
  let moreSheet: HTMLDialogElement | undefined;
  let moreButton: HTMLButtonElement | undefined;
  let moreOpen = false;
  let shownPage = '';
  let tabBar: HTMLElement | undefined;

  // The space kept free above the phone tab bar follows its real height, which grows when the
  // text is enlarged. Without ResizeObserver (or while the bar is hidden) the CSS default applies.
  onMount(() => {
    if (!tabBar || typeof ResizeObserver !== 'function') return;
    const bar = tabBar;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      if (bar.offsetHeight > 0) root.style.setProperty('--tab-bar-space', `${bar.offsetHeight}px`);
      else root.style.removeProperty('--tab-bar-space');
    });
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--tab-bar-space');
    };
  });

  // Keyboard focus must never sit under the tab bar. Browsers scroll a focused control into view, but
  // Firefox ignores scroll-padding for a control that is already inside the window, so lift it here.
  function keepFocusAboveTabBar(event: FocusEvent): void {
    const target = event.target;
    if (!tabBar || !(target instanceof HTMLElement) || tabBar.offsetHeight === 0) return;
    if (target.closest('.tab-bar, dialog') || !target.matches(':focus-visible')) return;
    const limit = tabBar.getBoundingClientRect().top - 8;
    const bottom = target.getBoundingClientRect().bottom;
    if (bottom > limit) window.scrollBy({ top: bottom - limit, behavior: 'instant' });
  }

  onMount(() => {
    document.addEventListener('focusin', keepFocusAboveTabBar);
    return () => document.removeEventListener('focusin', keepFocusAboveTabBar);
  });

  // Removed user entries retain progress for reimport, but do not inflate visible counts.
  // The same selector gives the "In Focus" value on Home.
  $: focusCount = countFocus(catalog, $progress);

  $: current = destinationOf(activePage);
  $: destinations = DESTINATIONS.map((destination) => ({ ...destination, pages: destinationPages(destination, availablePages) })).filter(
    (destination) => destination.pages.length > 0
  );
  // A topic screen names itself in its visible heading; the Library tabs would mark no current tab.
  $: sections = (current.id === 'library' || current.id === 'practice') && topicIdOf(activePage) === null ? destinationPages(current, availablePages) : [];
  $: title = pageTitle(activePage, catalog.topics);

  function hrefFor(destination: Destination): string {
    return `#${destination.id === current.id && destination.pages.includes(activePage) ? activePage : destination.pages[0]}`;
  }

  // A new screen starts at the top, and keyboard and screen-reader users land on its heading.
  $: void onPageShown(activePage);

  async function onPageShown(page: string): Promise<void> {
    const first = shownPage === '';
    shownPage = page;
    if (first) return;
    closeMore();
    await tick();
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    heading?.focus({ preventScroll: true });
  }

  function skipToContent(event: MouseEvent): void {
    event.preventDefault();
    main?.focus();
  }

  function openMore(): void {
    if (!moreSheet) return;
    moreOpen = true;
    if (typeof moreSheet.showModal === 'function') moreSheet.showModal();
    else moreSheet.setAttribute('open', '');
  }

  function closeMore(): void {
    if (!moreSheet || !moreOpen) return;
    moreOpen = false;
    if (typeof moreSheet.close === 'function') moreSheet.close();
    else moreSheet.removeAttribute('open');
  }

  function onSheetClosed(): void {
    const wasOpen = moreOpen;
    moreOpen = false;
    if (wasOpen && current.id !== 'more') moreButton?.focus();
  }

  // A click on the dimmed backdrop (the dialog element itself) closes the sheet.
  function onSheetClick(event: MouseEvent): void {
    if (event.target === moreSheet) closeMore();
  }
</script>

<div class="app-shell">
  <a class="skip-link" href="#main" on:click={skipToContent}>Skip to content</a>

  <!-- The shared header replaces the former side-navigation brand. Wide screens show it
       at the top of the navigation column, small screens as a compact bar above the page. -->
  <div class="app-chrome">
    <AppHeader onHome={(event) => go(event, 'index')} />
    <aside class="side-nav">
      <nav aria-label="Main">
        <ul class="side-nav__list">
          {#each destinations as destination (destination.id)}
            {#if destination.id === 'library' || destination.id === 'practice' || destination.id === 'more'}
              <li class="side-nav__group">
                <span class="side-nav__group-label">{destination.label}</span>
                <ul>
                  {#each destination.pages as page (page)}
                    <li>
                      <a class="side-nav__link side-nav__link--sub" href={`#${page}`} on:click={(event) => go(event, page)} aria-current={activePage === page ? 'page' : undefined}>{PAGE_LABELS[page]}</a>
                    </li>
                  {/each}
                </ul>
              </li>
            {:else}
              <li>
                <a class="side-nav__link" href={`#${destination.pages[0]}`} on:click={(event) => go(event, destination.pages[0])} aria-current={activePage === destination.pages[0] ? 'page' : undefined}>
                  <Icon name={destination.icon} />
                  <span>{destination.id === 'focus' ? 'Focus list' : destination.label}</span>
                  {#if destination.id === 'focus' && focusCount > 0}
                    <span class="nav-count">{focusCount}<span class="visually-hidden">{focusCount === 1 ? ' item' : ' items'}</span></span>
                  {/if}
                </a>
              </li>
            {/if}
          {/each}
        </ul>
      </nav>
      <div class="side-nav__footer">
        <ThemeToggle />
        <a class="side-nav__v1" href={v1Url}>Previous version (v1)</a>
      </div>
    </aside>
  </div>

  <main id="main" class="page-wrap" class:page-wrap--tabs={sections.length > 0} tabindex="-1" bind:this={main}>
    {#if $saveStatus.state === 'error'}
      <Notice tone="error" class="storage-notice" title="Your latest changes are not saved.">
        <p>They stay on screen, but will be lost when this page is closed unless saving succeeds.</p>
        <p class="notice__detail">{$saveStatus.message}</p>
        <svelte:fragment slot="actions"><Button variant="primary" size="sm" onClick={retrySave}>Try saving again</Button></svelte:fragment>
      </Notice>
    {:else if $saveStatus.state === 'disabled'}
      <Notice tone="warning" class="storage-notice" title="Saving is off.">
        <p>The browser storage could not be opened, so changes are lost when this page is closed. Reload the app to try again.</p>
      </Notice>
    {/if}

    <header class="page-header" class:page-header--hidden={sections.length > 0}>
      <h1 bind:this={heading} tabindex="-1" class:visually-hidden={sections.length > 0}>{title}</h1>
    </header>

    {#if sections.length}
      <nav class="section-nav" aria-label={`${current.label} sections`}>
        <ul class="section-nav__list">
          {#each sections as page (page)}
            <li><a class="section-nav__link" href={`#${page}`} on:click={(event) => go(event, page)} aria-current={activePage === page ? 'page' : undefined}>{PAGE_LABELS[page]}</a></li>
          {/each}
        </ul>
        {#if current.id === 'library'}
          <a class="section-nav__extra" href="#collections" on:click={(event) => go(event, 'collections')}><Icon name="upload" size={18} /><span>Import words</span></a>
        {/if}
      </nav>
    {/if}

    <slot />
  </main>

  <nav class="tab-bar" aria-label="Main" bind:this={tabBar}>
    {#each destinations as destination (destination.id)}
      {#if destination.id === 'more'}
        <button
          bind:this={moreButton}
          type="button"
          class="tab-bar__item"
          class:is-current={current.id === 'more'}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          aria-controls="more-sheet"
          on:click={openMore}
        >
          <span class="tab-bar__icon"><Icon name={destination.icon} size={22} /></span>
          <span class="tab-bar__label">{destination.label}{#if current.id === 'more'}<span class="visually-hidden">, current: {title}</span>{/if}</span>
        </button>
      {:else}
        <a class="tab-bar__item" class:is-current={current.id === destination.id} href={hrefFor(destination)} on:click={(event) => go(event, hrefFor(destination).slice(1))} aria-current={current.id === destination.id ? 'page' : undefined}>
          <span class="tab-bar__icon"><Icon name={destination.icon} size={22} />{#if destination.id === 'focus' && focusCount > 0}<span class="nav-count nav-count--tab">{focusCount}<span class="visually-hidden">{focusCount === 1 ? ' item' : ' items'}</span></span>{/if}</span>
          <span class="tab-bar__label">{destination.label}</span>
        </a>
      {/if}
    {/each}
  </nav>

  <!-- Escape and the Close button close the sheet; the backdrop click is a pointer shortcut. -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
  <dialog bind:this={moreSheet} id="more-sheet" class="sheet" aria-labelledby="more-title" on:close={onSheetClosed} on:click={onSheetClick}>
    <div class="sheet__content">
      <h2 id="more-title" class="sheet__title">More</h2>
      <ul class="sheet__list">
        {#each destinationPages(DESTINATIONS[4], availablePages) as page (page)}
          <li>
            <a class="sheet__link" href={`#${page}`} aria-current={activePage === page ? 'page' : undefined} on:click={(event) => { closeMore(); go(event, page); }}>
              <Icon name={page === 'collections' ? 'folder' : 'settings'} />{PAGE_LABELS[page]}
            </a>
          </li>
        {/each}
        <li><a class="sheet__link" href={v1Url}><Icon name="external" />Previous version (v1)</a></li>
      </ul>
      <Button variant="secondary" wide onClick={closeMore}>Close</Button>
    </div>
  </dialog>

  <ToastRegion />
</div>
