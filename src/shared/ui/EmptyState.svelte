<script lang="ts">
  export let title = 'Nothing here yet';
  export let text = '';
  /** Heading level that fits the surrounding outline. */
  export let level: 'h2' | 'h3' = 'h2';
</script>

<div class="empty-state">
  <svelte:element this={level}>{title}</svelte:element>
  {#if text}<p>{text}</p>{/if}
  {#if $$slots.default}<slot />{/if}
</div>
