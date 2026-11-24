<script lang="ts">
  import { RESET_PROGRESS_SUMMARY, resetAllState } from '../../state';
  import { settings, type SpeechRepeatCount, type ThemePreference } from '../../state/settings';
  import Button from '../../shared/ui/Button.svelte';
  import ConfirmDialog from '../../shared/ui/ConfirmDialog.svelte';
  import Icon from '../../shared/ui/Icon.svelte';
  import { showToast } from '../../shared/ui/toast';

  /** v1 is published at the site base, whichever path this product is published at. */
  const v1Url = `${__SITE_BASE__}v1/`;
  const themes: { value: ThemePreference; label: string; hint: string }[] = [
    { value: 'system', label: 'System', hint: 'Follow the device setting' },
    { value: 'light', label: 'Light', hint: '' },
    { value: 'dark', label: 'Dark', hint: '' }
  ];
  const repeats: SpeechRepeatCount[] = [10, 20, 50];

  let confirmReset = false;

  function chooseTheme(event: Event): void {
    settings.setTheme((event.currentTarget as HTMLInputElement).value as ThemePreference);
  }

  function chooseRepeats(event: Event): void {
    settings.setSpeechRepeatCount(Number((event.currentTarget as HTMLSelectElement).value) as SpeechRepeatCount);
  }

  function reset(): void {
    confirmReset = false;
    resetAllState();
    showToast('Learning progress was reset.');
  }
</script>

<div class="page-stack settings-page">
  <section class="panel" aria-labelledby="settings-appearance">
    <h2 id="settings-appearance" class="panel__title">Appearance</h2>
    <fieldset class="choice-group">
      <legend>Theme</legend>
      {#each themes as theme (theme.value)}
        <label class="choice">
          <input type="radio" name="theme" value={theme.value} checked={$settings.theme === theme.value} on:change={chooseTheme} />
          <span>{theme.label}{#if theme.hint}{' '}<small class="muted">({theme.hint.toLowerCase()})</small>{/if}</span>
        </label>
      {/each}
    </fieldset>
  </section>

  <section class="panel" aria-labelledby="settings-listening">
    <h2 id="settings-listening" class="panel__title">Listening</h2>
    <label class="field">
      <span class="field__label">Repeats when you listen to a whole page</span>
      <select value={$settings.speechRepeatCount} on:change={chooseRepeats}>
        {#each repeats as option}<option value={option}>{option} times</option>{/each}
      </select>
    </label>
  </section>

  <section class="panel" aria-labelledby="settings-vocabulary">
    <h2 id="settings-vocabulary" class="panel__title">Your vocabulary</h2>
    <p>Import your own words and phrases from a CSV file, or manage, export and remove your collections.</p>
    <p><a class="link-button" href="#collections"><Icon name="folder" size={18} />Open Collections</a></p>
  </section>

  <section class="panel panel--danger" aria-labelledby="settings-reset">
    <h2 id="settings-reset" class="panel__title">Learning progress</h2>
    <p>Start over with your learning state. Your imported collections and the built-in material are kept.</p>
    <div><Button variant="danger" icon="reset" onClick={() => (confirmReset = true)}>Reset learning progress…</Button></div>
  </section>

  <section class="panel" aria-labelledby="settings-v1">
    <h2 id="settings-v1" class="panel__title">Previous version</h2>
    <p>The first version of the trainer is still available. It keeps its own, separate progress.</p>
    <p><a class="link-button" href={v1Url}><Icon name="external" size={18} />Open the previous version (v1)</a></p>
  </section>
</div>

<ConfirmDialog
  open={confirmReset}
  title="Reset all learning progress?"
  confirmLabel="Reset progress"
  onConfirm={reset}
  onCancel={() => (confirmReset = false)}
>
  <p>This clears:</p>
  <ul>
    {#each RESET_PROGRESS_SUMMARY.clears as item}<li>{item.label}</li>{/each}
  </ul>
  <p>These stay: {RESET_PROGRESS_SUMMARY.keeps.join(', ').toLowerCase()}.</p>
  <p><strong>This cannot be undone.</strong></p>
</ConfirmDialog>
