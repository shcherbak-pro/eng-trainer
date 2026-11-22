<script lang="ts">
  import { progress, type FocusKind } from '../../state/progress';
  import Button from '../ui/Button.svelte';

  export let kind: FocusKind;
  export let id: string;

  $: list = kind === 'block' ? $progress.favoriteBlocks : kind === 'phrase' ? $progress.favoritePhrases : kind === 'word' ? $progress.favoriteWords : $progress.favoriteIrregular;
  $: active = list.includes(id);
</script>

<!-- The name changes with the state; the visible word "Focus" is part of both names. -->
<Button
  variant="focus"
  size="sm"
  icon="star"
  class={active ? 'is-active' : ''}
  label={active ? 'Remove from Focus List' : 'Add to Focus List'}
  onClick={() => progress.toggleFavorite(kind, id)}
>Focus</Button>
