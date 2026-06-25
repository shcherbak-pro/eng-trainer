<script lang="ts">
  import { progress } from '../stores/progress';
  import type { HideKind } from '../types/materials';

  export let kind: HideKind;
  export let id: string;

  $: hiddenList = kind === 'phrase' ? $progress.hiddenPhrases : kind === 'word' ? $progress.hiddenWords : $progress.hiddenIrregular;
  $: hidden = hiddenList.includes(id);
</script>

<button class="btn danger" type="button" on:click={() => hidden ? progress.unhideItem(kind, id) : progress.hideItem(kind, id)}>
  {hidden ? 'Unhide' : 'Hide'}
</button>
