<script lang="ts">
  /**
   * The compact brand panel at the top of every screen (ENG-V2-03). It carries no
   * progress or counts. The application shell links it to Home; start-up and error
   * screens show the same brand without a link, as there is no Home to open yet.
   */
  export let onHome: ((event: MouseEvent) => void) | undefined = undefined;

  /** Base-aware address of Home: the app's base path (GitHub Pages) plus the Home hash. */
  const homeHref = `${import.meta.env.BASE_URL}#index`;
</script>

<header class="app-header">
  {#if onHome}
    <a class="app-header__brand" href={homeHref} on:click={onHome}>Eng Trainer<span class="visually-hidden">, Home</span></a>
  {:else}
    <span class="app-header__brand">Eng Trainer</span>
  {/if}
  <span class="app-header__tagline">Practice English at your pace</span>
</header>
