<script lang="ts">
  /**
   * The Pronunciation screen of the experimental product (ENG-V3-02, stage A): a
   * prototype for disposable browser profiles with made-up learning data.
   *
   * The learner picks a phrase, records it and reads what the recognizer heard. The
   * recognizer is a downloaded model that runs on this device. Nothing is scored,
   * compared or saved, and nothing is marked as learned.
   *
   * This folder is experimental-only. The single way in is the guarded dynamic import
   * in App.svelte, so the stable build contains neither this module nor a request for it.
   */
  import { onDestroy, onMount } from 'svelte';
  import type { ContentCatalog } from '../../content/catalog';
  import { stopSectionSpeech } from '../../shared/speech/sectionSpeech';
  import Button from '../../shared/ui/Button.svelte';
  import Icon from '../../shared/ui/Icon.svelte';
  import Notice from '../../shared/ui/Notice.svelte';
  import { browserCaptureEnvironment, createRecorder } from './capture/capture';
  import { MAX_SECONDS } from './capture/levels';
  import { MODEL, RUNTIME, TOTAL_BYTES } from './models/pinned';
  import { KIND_LABELS, practiceGroups } from './practiceItems';
  import { isLoopbackHost } from './prototypeHost';
  import { runtimeWasmUrl, workerModuleUrl, workletModuleUrl } from './recognition/assets';
  import { createBrowserRecognizer } from './recognition/localMl';
  import { createPracticeSession, type PracticeSession, type PracticeState } from './session';

  export let catalog: ContentCatalog;
  /** Tests pass their own session. The application leaves this out. */
  export let createSession: (() => PracticeSession) | undefined = undefined;

  const VERSION_LABELS: Record<(typeof __ENG_VERSION_LINKS__)[number]['product'], string> = {
    'stable-v2': 'Open the stable version',
    'legacy-v1': 'Open the previous version (v1)',
    'experimental-v3': 'Open the experimental version'
  };

  function browserSession(): PracticeSession {
    const downloadOffered = isLoopbackHost(window.location.hostname);
    return createPracticeSession({
      recognizer: createBrowserRecognizer({ runtimeWasmUrl, workerModuleUrl, mayDownload: () => downloadOffered }),
      recorder: createRecorder(browserCaptureEnvironment(workletModuleUrl)),
      downloadOffered,
      stopPlayback: () => {
        stopSectionSpeech();
        window.speechSynthesis?.cancel();
      }
    });
  }

  const session = (createSession ?? browserSession)();
  let state: PracticeState;
  const unsubscribe = session.subscribe((next) => (state = next));

  $: groups = practiceGroups(catalog);
  let groupId = '';
  let position = 0;
  $: group = groups.find((item) => item.id === groupId) ?? groups[0];
  $: item = group?.items[Math.min(position, group.items.length - 1)];

  let seconds = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  $: busy = state.phase === 'starting' || state.phase === 'recording' || state.phase === 'recognizing';
  $: modelLoaded = state.phase === 'ready' || busy;

  const megabytes = (bytes: number): string => (bytes / 1_000_000).toFixed(1);

  /** Another phrase: a recording in progress and the last result belong to the previous one. */
  function choose(nextGroup: string, nextPosition: number): void {
    session.cancel();
    session.clearOutcome();
    groupId = nextGroup;
    position = nextPosition;
  }

  function step(by: number): void {
    if (!group) return;
    choose(group.id, (Math.min(position, group.items.length - 1) + by + group.items.length) % group.items.length);
  }

  // The click is the learner's explicit action: the microphone is asked for here and nowhere else.
  function record(): void {
    void session.record();
  }

  function onVisibility(): void {
    if (document.visibilityState === 'hidden') session.pageHidden();
  }

  onMount(() => {
    void session.init();
    document.addEventListener('visibilitychange', onVisibility);
    timer = setInterval(() => (seconds = session.recordedSeconds()), 200);
  });

  onDestroy(() => {
    document.removeEventListener('visibilitychange', onVisibility);
    clearInterval(timer);
    unsubscribe();
    // Leaving the screen releases the microphone and the model's memory.
    session.dispose();
  });
</script>

<div class="page-stack" data-experimental-feature="pronunciation-prototype" data-phase={state.phase}>
  <Notice tone="info" title="Prototype: use a disposable browser profile" role="none">
    <p>This screen is a first test of recording and speech recognition. Use it only in a browser profile made for testing, with made-up learning data.</p>
    <p>Your speech is recognized on this device. The recording is not stored and is not sent anywhere. The result shows what the recognizer heard. It is not a score of your pronunciation.</p>
  </Notice>

  <section class="panel" aria-labelledby="speech-model">
    <h2 id="speech-model" class="panel__title">Speech model</h2>
    <div aria-live="polite" data-model-state>
      {#if state.phase === 'checking'}
        <p>Checking the speech model…</p>
      {:else if state.phase === 'unsupported'}
        <p>Recording is not available here. {state.notice}</p>
      {:else if state.phase === 'installing'}
        <p>Downloading and checking the speech model…</p>
        <progress max={state.progress?.total ?? 1} value={state.progress?.loaded ?? 0} aria-label="Download of the speech model"></progress>
        <p class="muted">{megabytes(state.progress?.loaded ?? 0)} of {megabytes(state.progress?.total ?? TOTAL_BYTES)} MB</p>
      {:else if state.phase === 'loading'}
        <p>Loading the speech model…</p>
      {:else if state.phase === 'no-model' && state.installed}
        <p>The speech model is in this browser. Load it to record.</p>
      {:else if state.phase === 'no-model' && state.downloadOffered}
        <p>Recording needs a speech model of {megabytes(state.downloadBytes)} MB ({state.downloadBytes.toLocaleString('en-US')} bytes). It is downloaded once from this site, checked file by file and kept in this browser.</p>
      {:else if state.phase === 'no-model'}
        <p>This page does not offer a model download, so recording is not available here.</p>
      {:else}
        <p>The speech model is loaded.</p>
      {/if}
    </div>

    {#if state.notice && state.phase === 'no-model'}
      <Notice tone="error" title="The speech model is not loaded"><p>{state.notice}</p></Notice>
    {/if}

    <div class="model-actions">
      {#if state.phase === 'no-model' && state.installed}
        <Button variant="primary" onClick={() => void session.prepare()} data-action="load-model">Load the speech model</Button>
      {:else if state.phase === 'no-model' && state.downloadOffered}
        <Button variant="primary" icon="download" onClick={() => void session.prepare()} data-action="install-model">Download and install ({megabytes(state.downloadBytes)} MB)</Button>
      {:else if state.phase === 'installing' || state.phase === 'loading'}
        <Button onClick={() => session.cancelPrepare()} data-action="cancel-install">Cancel</Button>
      {/if}
      {#if state.installed && (state.phase === 'no-model' || state.phase === 'ready')}
        <Button variant="quiet" icon="trash" onClick={() => void session.removeModel()} data-action="delete-model">Delete downloaded model</Button>
      {/if}
    </div>

    <dl class="facts">
      <dt>Model</dt>
      <dd data-model-fact="model">{MODEL.name} ({MODEL.repository}, revision {MODEL.revision.slice(0, 12)}, {MODEL.licence})</dd>
      <dt>Runtime</dt>
      <dd data-model-fact="runtime">{RUNTIME.package} {RUNTIME.version}, WebAssembly, one thread ({RUNTIME.licence})</dd>
    </dl>
  </section>

  {#if modelLoaded && item && group}
    <section class="panel" aria-labelledby="say-this">
      <h2 id="say-this" class="panel__title">Say this</h2>

      <label class="group-choice">
        <span>Topic</span>
        <select value={group.id} on:change={(event) => choose(event.currentTarget.value, 0)} disabled={busy} data-control="group">
          {#each groups as option (option.id)}<option value={option.id}>{option.title} ({option.items.length})</option>{/each}
        </select>
      </label>

      <article class="prompt-card" data-target-kind={item.target.kind} data-target-entry={item.target.entryId}>
        <p class="muted">{KIND_LABELS[item.target.kind]} {Math.min(position, group.items.length - 1) + 1} of {group.items.length}</p>
        <p class="prompt-card__text" lang="en" translate="no" data-target-text>{item.target.text}</p>
        {#if item.translation}<p class="muted" lang="uk">{item.translation}</p>{/if}
        {#if item.source}<p class="muted">From: <span lang="en" translate="no">{item.source}</span></p>{/if}
        <div class="row-actions">
          <Button size="sm" onClick={() => step(-1)} disabled={busy} data-action="previous">Previous</Button>
          <Button size="sm" onClick={() => step(1)} disabled={busy} data-action="next">Next</Button>
        </div>
      </article>

      <div class="record-actions">
        {#if state.phase === 'ready'}
          <Button variant="primary" size="lg" onClick={record} data-action="record">{state.outcome ? 'Record again' : 'Record'}</Button>
          <span class="muted">Recording stops by itself after {MAX_SECONDS} seconds.</span>
        {:else if state.phase === 'starting'}
          <Button onClick={() => session.cancel()} data-action="cancel">Cancel</Button>
        {:else if state.phase === 'recording'}
          <Button variant="primary" size="lg" icon="stop" onClick={() => void session.stop()} data-action="stop">Stop</Button>
          <Button onClick={() => session.cancel()} data-action="cancel">Cancel</Button>
        {:else}
          <Button onClick={() => session.cancel()} data-action="cancel">Cancel</Button>
        {/if}
      </div>

      <div aria-live="polite" data-record-status>
        {#if state.phase === 'starting'}
          <p>Waiting for the microphone. The browser may ask for permission.</p>
        {:else if state.phase === 'recording'}
          <p><span class="recording-dot" aria-hidden="true"></span>Recording: {seconds.toFixed(1)} s. Say the phrase, then choose Stop.</p>
        {:else if state.phase === 'recognizing'}
          <p>Recognizing on this device…</p>
        {/if}
      </div>

      <div aria-live="polite" data-outcome={state.outcome?.kind ?? 'none'}>
        {#if state.outcome?.kind === 'heard'}
          <div class="heard">
            <p class="heard__label">The recognizer heard:</p>
            {#if state.outcome.text}
              <p class="heard__text" lang="en" translate="no" data-heard-text>{state.outcome.text}</p>
            {:else}
              <p class="heard__text heard__text--empty" data-heard-text>(no words)</p>
            {/if}
            <p class="muted">{state.outcome.audioSeconds.toFixed(1)} s recorded, recognized in {(state.outcome.elapsedMs / 1000).toFixed(1)} s.</p>
            <p class="muted">A recognizer can mishear correct speech, and it can also turn a mispronounced word into the expected one. A difference is not a mistake, and a match is not a proof.</p>
          </div>
        {:else if state.outcome?.kind === 'unable'}
          <Notice tone="warning" title="No result for this recording" role="none"><p data-unable-reason>{state.outcome.message}</p></Notice>
        {/if}
      </div>
    </section>
  {:else if modelLoaded}
    <section class="panel"><p>There is no phrase to record in the current learning material.</p></section>
  {/if}

  <section class="panel" aria-labelledby="experimental-build">
    <h2 id="experimental-build" class="panel__title">About this build</h2>
    <p>This is the experimental version of the trainer. It keeps its learning data in its own browser database. It reads the data of the other versions only on the Backup screen, and it writes that data only when you recover it there from a backup file and confirm.</p>
    <dl class="facts">
      <dt>Product</dt>
      <dd data-build-fact="product">{__ENG_PRODUCT__}</dd>
      <dt>Browser database</dt>
      <dd data-build-fact="database">{__ENG_DATABASE__}</dd>
    </dl>
  </section>

  <section class="panel" aria-labelledby="experimental-versions">
    <h2 id="experimental-versions" class="panel__title">Other versions</h2>
    <p>Each version keeps its own, separate progress.</p>
    {#each __ENG_VERSION_LINKS__ as version (version.product)}
      <p><a class="link-button" href={version.href} data-version-link={version.product}><Icon name="external" size={18} />{VERSION_LABELS[version.product]}</a></p>
    {/each}
  </section>
</div>

<style>
  .model-actions,
  .record-actions,
  .row-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  .model-actions:empty {
    display: none;
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    color: var(--color-text-secondary);
  }
  .facts dd {
    margin: 0;
  }
  .group-choice {
    display: grid;
    gap: var(--space-1);
    max-width: 28rem;
  }
  .group-choice select {
    min-height: 44px;
    font: inherit;
  }
  progress {
    width: 100%;
    max-width: 28rem;
  }
  .heard {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-4);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
  }
  .heard__label {
    margin: 0;
    font-weight: 600;
  }
  .heard__text {
    margin: 0;
    font-size: 1.25rem;
  }
  .heard__text--empty {
    color: var(--color-text-muted);
  }
  .recording-dot {
    display: inline-block;
    width: 0.65em;
    height: 0.65em;
    margin-right: 0.5em;
    border-radius: 50%;
    background: currentColor;
  }
</style>
