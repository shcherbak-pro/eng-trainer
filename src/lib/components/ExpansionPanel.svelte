<script lang="ts">
  import MaterialIcon from './MaterialIcon.svelte';

  export let title: string;
  export let description = '';
  export let open = true;
  export let headingLevel: 'h2' | 'h3' = 'h2';
  export let onToggle: () => void;
</script>

<section class="expansion-panel card" class:collapsed={!open}>
  <button
    class="expansion-panel__header"
    type="button"
    aria-expanded={open}
    on:click={onToggle}
  >
    <span class="expansion-panel__title">
      <svelte:element this={headingLevel}>{title}</svelte:element>
      {#if description}
        <span class="muted">{description}</span>
      {/if}
    </span>
    <span class="expansion-panel__icon" aria-hidden="true">
      <MaterialIcon name={open ? 'expand_less' : 'expand_more'} />
    </span>
  </button>

  {#if open}
    <div class="expansion-panel__body">
      <slot />
    </div>
  {/if}
</section>
