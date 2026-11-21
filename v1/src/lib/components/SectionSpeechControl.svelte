<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { progress, type ProgressState } from '../stores/progress';
  import { sectionSpeech, speakSection, stopSectionSpeech, type SectionSpeechItem, type SpeechRepeatCount } from '../utils/sectionSpeech';

  export let controlId: string;
  export let label = 'Read aloud';
  export let items: SectionSpeechItem[] = [];
  export let help = 'Reads visible materials in this section.';

  const options: SpeechRepeatCount[] = [10, 20, 50];

  $: isActive = $sectionSpeech.activeControlId === controlId && $sectionSpeech.isSpeaking;
  $: isBusy = Boolean($sectionSpeech.activeControlId) && $sectionSpeech.isSpeaking;
  $: repeatCount = $progress.speechRepeatCount;
  $: status = isActive
    ? `Repeat ${$sectionSpeech.currentRepeat}/${$sectionSpeech.repeats} · Item ${$sectionSpeech.currentItem}/${$sectionSpeech.totalItems}`
    : `${items.length} item${items.length === 1 ? '' : 's'}`;

  function onRepeatChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value) as ProgressState['speechRepeatCount'];
    progress.setSpeechRepeatCount(value);
  }

  function onStart(): void {
    speakSection(controlId, items, repeatCount);
  }
</script>

<div class="listen-control" aria-live="polite">
  <div class="listen-control__meta">
    <strong>{label}</strong>
    <small>{isActive ? $sectionSpeech.currentLabel : help}</small>
  </div>

  <div class="listen-control__actions">
    <label class="listen-control__select">
      Repeats
      <select value={repeatCount} on:change={onRepeatChange} disabled={isBusy}>
        {#each options as option}
          <option value={option}>{option}x</option>
        {/each}
      </select>
    </label>

    {#if isActive}
      <IconButton icon="stop_circle" label="Stop reading" variant="danger" onClick={stopSectionSpeech} />
    {:else}
      <IconButton icon="record_voice_over" label={`Read ${label.toLowerCase()}`} variant="primary" disabled={!items.length || isBusy} onClick={onStart} />
    {/if}
  </div>

  <p class="listen-control__status">{status}</p>
</div>
