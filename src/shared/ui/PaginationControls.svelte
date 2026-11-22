<script lang="ts">
  import IconButton from './IconButton.svelte';
  import type { PageSizeOption } from '../pagination';

  export let total = 0;
  export let page = 1;
  export let pageSize: PageSizeOption = 5;
  export let pageSizeOptions: PageSizeOption[] = [5, 10, 20, 'all'];
  export let label = 'Pagination';
  export let onPageChange: (page: number) => void;
  export let onPageSizeChange: (pageSize: PageSizeOption) => void;

  const number = new Intl.NumberFormat('en');

  function parsePageSize(value: string): PageSizeOption {
    return value === 'all' ? 'all' : Number(value);
  }

  function optionLabel(option: PageSizeOption): string {
    return option === 'all' ? 'All' : String(option);
  }

  $: totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / pageSize));
  $: currentPage = Math.min(Math.max(1, page), totalPages);
  $: from = total === 0 ? 0 : pageSize === 'all' ? 1 : ((currentPage - 1) * pageSize) + 1;
  $: to = total === 0 ? 0 : pageSize === 'all' ? total : Math.min(total, currentPage * pageSize);
  $: pageSizeValue = pageSize === 'all' ? 'all' : String(pageSize);
</script>

<nav class="pagination" aria-label={label}>
  <label class="pagination__size">
    Show
    <select value={pageSizeValue} on:change={(e) => onPageSizeChange(parsePageSize((e.target as HTMLSelectElement).value))}>
      {#each pageSizeOptions as option}
        <option value={option === 'all' ? 'all' : String(option)}>{optionLabel(option)}</option>
      {/each}
    </select>
  </label>

  <div class="pagination__pages">
    <IconButton icon="chevron-left" label="Previous page" variant="secondary" disabled={currentPage <= 1 || total === 0} onClick={() => onPageChange(currentPage - 1)} />
    <span class="pagination__status">{number.format(from)}–{number.format(to)} of {number.format(total)}</span>
    <IconButton icon="chevron-right" label="Next page" variant="secondary" disabled={currentPage >= totalPages || total === 0} onClick={() => onPageChange(currentPage + 1)} />
  </div>
</nav>
