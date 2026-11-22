<script lang="ts">
  import Button from '../ui/Button.svelte';
  import { settings } from '../../state/settings';
  import { sectionSpeech, speakSection, stopSectionSpeech, type SectionSpeechItem, type SpeechRepeatCount } from './sectionSpeech';

  export let controlId: string;
  /** Visible button text, for example "Listen to this page". */
  export let label = 'Listen to this page';
  export let items: SectionSpeechItem[] = [];
  /** Describes what is read aloud (button description for assistive technology). */
  export let help = 'Reads the items shown on this page.';

  const options: SpeechRepeatCount[] = [10, 20, 50];
  const describedBy = `${controlId}-help`;

  $: isActive = $sectionSpeech.activeControlId === controlId && $sectionSpeech.isSpeaking;
  $: isBusy = Boolean($sectionSpeech.activeControlId) && $sectionSpeech.isSpeaking;
  $: repeatCount = $settings.speechRepeatCount;
  $: status = isActive
    ? `Reading item ${$sectionSpeech.currentItem} of ${$sectionSpeech.totalItems}, repeat ${$sectionSpeech.currentRepeat} of ${$sectionSpeech.repeats}.`
    : '';

  function onRepeatChange(event: Event): void {
    settings.setSpeechRepeatCount(Number((event.target as HTMLSelectElement).value) as SpeechRepeatCount);
  }
</script>

<div class="listen-control">
  {#if isActive}
    <Button variant="primary" size="sm" icon="stop" onClick={stopSectionSpeech}>Stop reading</Button>
  {:else}
    <Button variant="secondary" size="sm" icon="listen" disabled={!items.length || isBusy} describedby={describedBy} onClick={() => speakSection(controlId, items, repeatCount)}>{label}</Button>
  {/if}
  <label>
    <span class="visually-hidden">Repeats</span>
    <select value={repeatCount} on:change={onRepeatChange} disabled={isBusy}>
      {#each options as option}<option value={option}>{option}×</option>{/each}
    </select>
  </label>
  <span id={describedBy} class="visually-hidden">{help}</span>
  <p class="listen-control__status" aria-live="polite">{status}</p>
</div>
