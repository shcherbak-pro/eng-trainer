<script lang="ts">
  import { progress, type HideKind } from '../../state/progress';
  import IconButton from '../ui/IconButton.svelte';

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
