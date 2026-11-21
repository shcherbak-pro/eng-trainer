<script lang="ts">
  import { progress } from '../stores/progress';
  import type { FocusKind } from '../types/materials';
  import IconButton from './IconButton.svelte';

  export let kind: FocusKind;
  export let id: string;

  $: list = kind === 'block' ? $progress.favoriteBlocks : kind === 'phrase' ? $progress.favoritePhrases : kind === 'word' ? $progress.favoriteWords : $progress.favoriteIrregular;
  $: active = list.includes(id);
</script>

<IconButton
  icon={active ? 'remove' : 'add'}
  label={active ? 'Remove from Focus List' : 'Add to Focus List'}
  variant="focus"
  {active}
  onClick={() => progress.toggleFavorite(kind, id)}
/>
