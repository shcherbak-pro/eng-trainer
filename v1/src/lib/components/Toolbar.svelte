<script lang="ts">
  export let title = '';
  export let description = '';
</script>

<div class="toolbar-card">
  <div>
    <h2>{title}</h2>
    {#if description}<p>{description}</p>{/if}
  </div>
  <slot />
</div>
