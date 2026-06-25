<script lang="ts">
  import { progress } from '../stores/progress';
  import type { FocusKind } from '../types/materials';

  export let kind: FocusKind;
  export let id: string;

  $: list = kind === 'block' ? $progress.favoriteBlocks : kind === 'phrase' ? $progress.favoritePhrases : kind === 'word' ? $progress.favoriteWords : $progress.favoriteIrregular;
  $: active = list.includes(id);
</script>

<button class:active class="btn focus" type="button" on:click={() => progress.toggleFavorite(kind, id)}>
  {active ? '★ In focus' : '☆ Add focus'}
</button>
