<script lang="ts">
  /**
   * Integration seam of the experimental product (ENG-V3-01).
   *
   * This folder is experimental-only. The single way in is the guarded dynamic import
   * in App.svelte, so the stable build contains neither this module nor a request for
   * it. The screen is a placeholder: it records nothing, recognizes nothing and loads
   * nothing. It uses no microphone, audio, Worker, Cache Storage or other host.
   */
  import Icon from '../../shared/ui/Icon.svelte';
  import Notice from '../../shared/ui/Notice.svelte';

  const VERSION_LABELS: Record<(typeof __ENG_VERSION_LINKS__)[number]['product'], string> = {
    'stable-v2': 'Open the stable version',
    'legacy-v1': 'Open the previous version (v1)',
    'experimental-v3': 'Open the experimental version'
  };
</script>

<div class="page-stack" data-experimental-feature="pronunciation-placeholder">
  <Notice tone="info" title="Not available yet" role="none">
    <p>Pronunciation practice is not part of this build. Nothing is recorded, recognized or downloaded here.</p>
  </Notice>

  <section class="panel" aria-labelledby="experimental-build">
    <h2 id="experimental-build" class="panel__title">About this build</h2>
    <p>This is the experimental version of the trainer. It keeps its learning data in its own browser database and does not read or change the data of the other versions.</p>
    <dl>
      <dt>Product</dt>
      <dd data-build-fact="product">{__ENG_PRODUCT__}</dd>
      <dt>Browser database</dt>
      <dd data-build-fact="database">{__ENG_DATABASE__}</dd>
    </dl>
  </section>

  <section class="panel" aria-labelledby="experimental-versions">
    <h2 id="experimental-versions" class="panel__title">Other versions</h2>
    <p>Each version keeps its own, separate progress.</p>
    {#each __ENG_VERSION_LINKS__ as version (version.product)}
      <p><a class="link-button" href={version.href} data-version-link={version.product}><Icon name="external" size={18} />{VERSION_LABELS[version.product]}</a></p>
    {/each}
  </section>
</div>
