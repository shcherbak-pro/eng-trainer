<script lang="ts">
  /**
   * The Pronunciation screen of the experimental product (ENG-V3-02, stage A): a
   * prototype for disposable browser profiles with made-up learning data.
   *
   * The learner picks a phrase, records it and reads what the recognizer heard. The
   * recognizer is a downloaded model that runs on this device. Nothing is scored,
   * compared or saved, and nothing is marked as learned.
   *
   * Storage (ENG-V3-R1B). The model shares the browser's storage for this site with the
   * learning data of every version. So this screen says what the browser reports about
   * that storage, what the model cache holds, and it asks before a download: the numbers,
   * what a browser may do with a site's data, and the backup file as the only protection.
   * It removes nothing but the model's own files, and only when asked to.
   *
   * Two controls, two requests (ENG-V3-R1B-RC1). "Load" asks the session to load what is
   * installed, which can start no download. "Download" opens the question, and only its
   * confirmation asks the session to install. What is offered follows the cache each time
   * it is read. The numbers are the browser's estimate: the screen says that they are
   * approximate and that nothing is reserved.
   *
   * This folder is experimental-only. The single way in is the guarded dynamic import
   * in App.svelte, so the stable build contains neither this module nor a request for it.
   */
  import { onDestroy, onMount, tick } from 'svelte';
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
  import { createBrowserModelStorage, createBrowserRecognizer } from './recognition/localMl';
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
      modelStorage: createBrowserModelStorage(),
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
  /** A size as people read it: megabytes, or gigabytes for a browser's limit. */
  const size = (bytes: number): string => (bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${megabytes(bytes)} MB`);

  $: installation = state.installation;
  $: storage = state.storage;
  $: capacity = storage?.capacity ?? null;
  /** A check of every file found something wrong, or a loading refused the files. */
  $: filesDamaged = Boolean(state.fileProblems?.length);
  /** Files that are in the model cache and that this build will never use. */
  $: leftovers = Boolean(installation && (installation.state === 'incomplete' || installation.state === 'damaged' || installation.otherBytes > 0)) || filesDamaged;
  $: settled = state.phase === 'no-model' || state.phase === 'ready';
  /** A download is offered: the files are not here, this page may download, and no other request runs. */
  $: canOffer = state.phase === 'no-model' && !state.installed && state.downloadOffered;
  /** Whether this browser can make sure that only one tab changes the model cache. Where it cannot, no change is offered. */
  $: coordinated = storage?.canCoordinate !== false;

  let installDialog: HTMLDialogElement | undefined;
  let installCancel: HTMLButtonElement | undefined;
  /** The question before a download is open. */
  let asking = false;
  /** The learner's own statement about a backup file. The application cannot check it. */
  let acknowledged = false;

  /**
   * The click on "Download" asks first. The numbers are read again, and the question is
   * shown only when the browser's estimate leaves room. Nothing is requested here.
   */
  async function askToInstall(): Promise<void> {
    if (asking) return;
    await session.refreshStorage();
    if (asking) return;
    if (!installDialog || !canOffer || !state.storage?.canCoordinate || state.storage.capacity.state !== 'sufficient') return;
    acknowledged = false;
    asking = true;
    if (typeof installDialog.showModal === 'function') installDialog.showModal();
    else installDialog.setAttribute('open', '');
    await tick();
    installCancel?.focus();
  }

  function closeInstall(): void {
    asking = false;
    acknowledged = false;
    if (!installDialog) return;
    if (typeof installDialog.close === 'function') installDialog.close();
    else installDialog.removeAttribute('open');
  }

  function confirmInstall(): void {
    if (!acknowledged || state.storage?.capacity.state !== 'sufficient') return;
    closeInstall();
    // The one place that gives the learner's confirmation. Loading never passes one.
    void session.install({ confirmed: true });
  }

  // The click is the learner's explicit action: the browser is asked here and nowhere else.
  function askForPersistence(): void {
    void session.askForPersistence();
  }

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
      {:else if state.phase === 'no-model' && state.installed && filesDamaged}
        <p>The files of the speech model in this browser are damaged. They are not used. Remove them, then download the model again.</p>
      {:else if state.phase === 'no-model' && state.installed}
        <p>The speech model is in this browser. Load it to record.</p>
      {:else if state.phase === 'no-model' && installation?.state === 'incomplete'}
        <p>This browser holds {installation.files} {installation.files === 1 ? 'file' : 'files'} ({megabytes(installation.bytes)} MB) of a download that did not finish. They are not used.{state.downloadOffered ? ' A new download replaces them.' : ''}</p>
      {:else if state.phase === 'no-model' && installation?.state === 'damaged'}
        <p>The speech model in this browser is damaged, so it is not used.{state.downloadOffered ? ' A new download replaces it.' : ''}</p>
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

    {#if state.fileProblems && settled}
      {#if filesDamaged}
        <Notice tone="error" title="The installed files are not the expected ones" role="none">
          <ul data-file-problems>
            {#each state.fileProblems as problem}<li>{problem}</li>{/each}
          </ul>
          {#if state.phase === 'ready'}
            <p data-files-loaded-note>The model that is loaded now was checked when it was read. It cannot be loaded again from these files: remove them, then download the model again.</p>
          {/if}
        </Notice>
      {:else}
        <p role="status" data-files-checked>Checked now: every installed file is the expected one, by its size and its SHA-256.</p>
      {/if}
    {/if}

    {#if canOffer && capacity && capacity.state !== 'sufficient'}
      <Notice tone="warning" title="The model cannot be downloaded now" role="none">
        {#if capacity.state === 'insufficient'}
          <p data-capacity-reason>The browser estimates {size(capacity.free)} of free storage for this site. A download asks for {size(capacity.need.total)}, so {size(capacity.shortBy)} are missing.</p>
        {:else}
          <p data-capacity-reason>{capacity.reason} Without an estimate the model is not downloaded.</p>
        {/if}
        <p>Your learning data is not changed. Do not clear the data of this site to make room: that would remove your learning data too.</p>
      </Notice>
    {:else if canOffer && !storage}
      <Notice tone="warning" title="The model cannot be downloaded now" role="none">
        <p data-capacity-reason>The browser's storage could not be asked, so there is no estimate to decide on.</p>
      </Notice>
    {/if}

    {#if settled && storage && !storage.canCoordinate}
      <Notice tone="warning" title="The speech model cannot be downloaded or removed in this browser" role="none">
        <p data-no-coordination>This browser has no way to make sure that only one tab changes the speech model at a time. Without that, one tab could remove files that another tab has just stored. So nothing is downloaded and nothing is removed here.{state.installed ? ' The model that is in this browser can still be loaded.' : ''}</p>
      </Notice>
    {/if}

    <div class="model-actions">
      {#if state.phase === 'no-model' && state.installed && !filesDamaged}
        <Button variant="primary" onClick={() => void session.prepare()} data-action="load-model">Load the speech model</Button>
      {:else if canOffer && coordinated && capacity?.state === 'sufficient'}
        <Button variant="primary" icon="download" onClick={() => void askToInstall()} data-action="install-model">Download and install ({megabytes(state.downloadBytes)} MB)</Button>
      {:else if canOffer && coordinated}
        <Button onClick={() => void session.refreshStorage()} data-action="check-storage">Check the storage again</Button>
      {:else if state.phase === 'installing' || state.phase === 'loading'}
        <Button onClick={() => session.cancelPrepare()} data-action="cancel-install">Cancel</Button>
      {/if}
      {#if settled && coordinated && state.installed && !filesDamaged}
        <Button variant="quiet" icon="trash" disabled={state.working !== null} onClick={() => void session.removeModel()} data-action="delete-model">Delete downloaded model</Button>
      {:else if settled && coordinated && leftovers}
        <Button variant="quiet" icon="trash" disabled={state.working !== null} onClick={() => void session.removeModel()} data-action="remove-model-files">Remove these files</Button>
      {/if}
    </div>
    {#if settled && coordinated && (state.installed || leftovers)}
      <p class="muted">Removing deletes the files of the speech model and nothing else. Learning data, settings and the other versions stay as they are.</p>
    {/if}

    <dl class="facts">
      <dt>Model</dt>
      <dd data-model-fact="model">{MODEL.name} ({MODEL.repository}, revision {MODEL.revision.slice(0, 12)}, {MODEL.licence})</dd>
      <dt>Runtime</dt>
      <dd data-model-fact="runtime">{RUNTIME.package} {RUNTIME.version}, WebAssembly, one thread ({RUNTIME.licence})</dd>
    </dl>
  </section>

  {#if settled && (storage || installation)}
    <section class="panel" aria-labelledby="model-storage" data-storage-panel data-capacity={capacity?.state ?? 'unread'} data-persistence={storage?.persistence ?? 'unread'} data-installation={installation?.state ?? 'unread'}>
      <h2 id="model-storage" class="panel__title">Storage in this browser</h2>
      <p>Every version of the trainer keeps its data in the storage that this browser gives to this site: the learning data of this version, of the stable version and of the previous version (v1), and the speech model. The browser limits that storage as a whole. When a browser removes a site's data, it removes all of it.</p>
      <dl class="facts" aria-live="polite">
        {#if capacity && capacity.state !== 'unknown'}
          <dt>Used by this site</dt>
          <dd data-storage-fact="usage">{size(capacity.usage)} of {size(capacity.quota)}, by the browser's estimate, all versions together</dd>
          <dt>Free</dt>
          <dd data-storage-fact="free">{size(capacity.free)}</dd>
        {:else}
          <dt>Used by this site</dt>
          <dd data-storage-fact="usage">Not known. {capacity ? capacity.reason : 'The browser could not be asked.'}</dd>
        {/if}
        {#if capacity}
          <dt>A download asks for</dt>
          <dd data-storage-fact="need">{size(capacity.need.total)} of free storage, by the browser's estimate: {size(capacity.need.files)} for the files, {size(capacity.need.verifying)} while a file is being stored, and {size(capacity.need.reserve)} of headroom for learning data</dd>
        {/if}
        <dt>Speech model here</dt>
        <dd data-storage-fact="installation">
          {#if !installation}
            Not known: the model's files could not be looked at.
          {:else if installation.state === 'installed'}
            Installed, {megabytes(installation.bytes)} MB. Complete by the list of files and their sizes.
          {:else if installation.state === 'incomplete'}
            {installation.files} {installation.files === 1 ? 'file' : 'files'} of a download that did not finish, {megabytes(installation.bytes)} MB. Never used.
          {:else if installation.state === 'damaged'}
            Damaged, {megabytes(installation.bytes)} MB: {installation.problems.join('; ')}. Never used.
          {:else}
            Not in this browser.
          {/if}
          {#if installation && installation.otherBytes > 0}
            <span data-storage-fact="other-version">Also {megabytes(installation.otherBytes)} MB of another version of the model, which this build does not use.</span>
          {/if}
          {#if state.phase === 'ready' && installation && installation.state !== 'installed'}
            <span data-storage-fact="in-memory">The model that is loaded now stays in memory until you leave this screen. It cannot be loaded again without a new download.</span>
          {/if}
        </dd>
        <dt>Kept by the browser</dt>
        <dd data-storage-fact="persistence">
          {#if storage?.persistence === 'persistent'}
            The browser says that it will not remove this site's data by itself.
          {:else if storage?.persistence === 'best-effort'}
            The browser may remove this site's data by itself, for example when the device runs low on storage.
          {:else}
            This browser does not say whether it may remove this site's data by itself. Assume that it may.
          {/if}
        </dd>
      </dl>

      {#if capacity}
        <p data-estimate-limits>These numbers are the browser's estimate. They are approximate, and the trainer cannot reserve storage. A download that succeeds does not mean that {size(capacity.need.reserve)} are left afterwards. A later save of learning data, or a recovery from a backup, can still be refused for lack of room.</p>
      {/if}

      {#if storage?.answer === 'granted'}
        <p role="status" data-persistence-answer="granted">The browser agreed to keep this site's data. That is not a backup.</p>
      {:else if storage?.answer === 'declined'}
        <p role="status" data-persistence-answer="declined">The browser did not agree. Some browsers decide this by themselves, without asking you. Nothing changed.</p>
      {:else if storage?.answer === 'unsupported'}
        <p role="status" data-persistence-answer="unsupported">This browser cannot be asked to keep this site's data.</p>
      {:else if storage?.answer === 'failed'}
        <p role="status" data-persistence-answer="failed">The browser could not be asked. Nothing changed.</p>
      {/if}

      <p data-not-a-backup>None of this is a backup. Whatever the browser says, the data of this site is lost when the site's data is cleared, with the browser profile, and with the device. Only a backup file that is kept outside this browser protects your learning data. <a href="#backup" data-action="open-backup">Open the Backup screen</a></p>

      <div class="model-actions">
        <Button size="sm" onClick={() => void session.refreshStorage()} data-action="refresh-storage">Read again</Button>
        {#if installation?.state === 'installed' && !filesDamaged}
          <Button size="sm" disabled={state.working !== null} busy={state.working === 'files'} onClick={() => void session.checkFiles()} data-action="check-files">{state.working === 'files' ? 'Checking the files…' : 'Check the installed files'}</Button>
        {/if}
        {#if storage?.canAskForPersistence && storage.persistence !== 'persistent'}
          <Button size="sm" disabled={state.askingPersistence} onClick={askForPersistence} data-action="ask-persistence">{state.askingPersistence ? 'Waiting for the browser’s answer…' : 'Ask the browser to keep this site’s data'}</Button>
        {/if}
      </div>
      {#if state.askingPersistence}
        <p class="muted" role="status">The browser may be asking you now. Everything else on this screen keeps working.</p>
      {/if}
    </section>
  {/if}

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

<dialog bind:this={installDialog} class="dialog" aria-labelledby="install-confirm-title" aria-describedby="install-confirm-body" data-install-confirm={asking ? 'open' : 'closed'} on:cancel|preventDefault={closeInstall}>
  <h2 id="install-confirm-title" class="dialog__title">Download the speech model?</h2>
  <div id="install-confirm-body" class="dialog__body">
    {#if asking && capacity && capacity.state === 'sufficient'}
      <p>This stores {megabytes(state.downloadBytes)} MB in this browser, in the same storage as your learning data. The browser estimates {size(capacity.free)} of free storage for this site, and this site uses {size(capacity.usage)} now.</p>
      <ul>
        <li>A browser that runs short of storage can remove everything that this site keeps, in one step: the learning data of every version together with the model.</li>
        <li>The model makes this site use much more storage than before. The trainer cannot stop a browser from removing a site's data, and it cannot reserve storage. The numbers are estimates: the browser can still refuse to store a file, and after the download less room can be left than the estimate says. A later save of learning data, or a recovery from a backup, can then be refused.</li>
        <li>Only a backup file that is kept outside this browser protects your learning data. The trainer cannot see whether you have one.</li>
      </ul>
      <p><a href="#backup" on:click={closeInstall} data-action="open-backup-first">Save a backup file first</a> on the Backup screen. That closes this question, and nothing is downloaded.</p>
      <label class="acknowledge">
        <input type="checkbox" bind:checked={acknowledged} data-control="backup-acknowledged" />
        <span>I have saved a backup file of the learning data in this browser, or this browser profile holds nothing that I want to keep.</span>
      </label>
    {:else if asking}
      <p data-install-changed>The browser's estimate changed while this question was open: there is no room for the model now. Nothing was downloaded.</p>
    {/if}
  </div>
  {#if asking}
    <div class="dialog__actions">
      <button bind:this={installCancel} type="button" class="btn btn--secondary btn--md" on:click={closeInstall} data-action="cancel-install-confirm">Cancel</button>
      <button type="button" class="btn btn--primary btn--md" disabled={!acknowledged || capacity?.state !== 'sufficient'} on:click={confirmInstall} data-action="confirm-install">Download and install</button>
    </div>
  {/if}
</dialog>

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
  .acknowledge {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-2);
    align-items: start;
    color: var(--color-text);
  }
  .acknowledge input {
    width: 1.25rem;
    height: 1.25rem;
    margin: 0.15rem 0 0;
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
