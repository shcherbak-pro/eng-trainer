<script lang="ts">
  import Icon from '../../shared/ui/Icon.svelte';

  export let title: string;
  export let description = '';
  export let open = true;
  export let headingLevel: 'h2' | 'h3' = 'h2';
  export let onToggle: () => void;

  const id = `panel-${Math.random().toString(36).slice(2, 10)}`;
</script>

<section class="expansion-panel">
  <svelte:element this={headingLevel} class="expansion-panel__heading">
    <button class="expansion-panel__header" type="button" aria-expanded={open} aria-controls={id} on:click={onToggle}>
      <span class="expansion-panel__title">
        <strong>{title}</strong>
        {#if description}<span>{description}</span>{/if}
      </span>
      <Icon name={open ? 'chevron-up' : 'chevron-down'} />
    </button>
  </svelte:element>

  {#if open}
    <div class="expansion-panel__body" {id}>
      <slot />
    </div>
  {/if}
</section>
