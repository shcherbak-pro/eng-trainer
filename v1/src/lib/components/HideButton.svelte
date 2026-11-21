<script lang="ts">
  import { progress } from '../stores/progress';
  import type { HideKind } from '../types/materials';
  import IconButton from './IconButton.svelte';

  export let kind: HideKind;
  export let id: string;

  $: hiddenList = kind === 'phrase' ? $progress.hiddenPhrases : kind === 'word' ? $progress.hiddenWords : $progress.hiddenIrregular;
  $: hidden = hiddenList.includes(id);
</script>

<IconButton
  icon={hidden ? 'visibility' : 'visibility_off'}
  label={hidden ? 'Show item' : 'Hide item'}
  variant="danger"
  onClick={() => hidden ? progress.unhideItem(kind, id) : progress.hideItem(kind, id)}
/>
