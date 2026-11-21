<script lang="ts">
  import { progress, type FocusKind } from '../../state/progress';
  import IconButton from '../ui/IconButton.svelte';

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
