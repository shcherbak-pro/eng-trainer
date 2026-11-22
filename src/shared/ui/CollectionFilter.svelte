<script lang="ts">
  import type { ContentCatalog } from '../../content/catalog';
  import { resolvedCollection } from '../../content/userCatalog';
  import { settings } from '../../state/settings';
  export let catalog: ContentCatalog;
</script>

{#if catalog.collections.length}
  <label class="filter-select">
    <span class="visually-hidden">Collection</span>
    <select aria-label="Collection" value={resolvedCollection(catalog, $settings.collectionFilter)} on:change={(event) => settings.setCollectionFilter((event.target as HTMLSelectElement).value)}>
      <option value="">All collections</option>
      <option value="built-in">Built-in vocabulary</option>
      {#each catalog.collections as collection (collection.id)}
        <option value={collection.id}>{collection.name}</option>
      {/each}
    </select>
  </label>
{/if}
