<script lang="ts">
  /**
   * The Backup screen of the experimental product (ENG-V3-R1A, ENG-V3-R1A-RC1).
   *
   * Two things happen here, each only after the learner asks for it:
   *
   * - A backup file is made. That reads the saved data of all three products and writes
   *   nothing.
   * - A backup file is checked and shown. Each part of it can then be recovered into the
   *   product it belongs to, one part at a time, after a confirmation that names that
   *   product, and only when that product holds no learning data in this browser.
   *
   * This file writes this product's own database only. The storage of the stable product
   * and of the first version is written by recoveryWriter.ts, a file of its own that is
   * loaded here after the confirmation and nowhere else.
   *
   * This folder is experimental-only. The single way in is the guarded dynamic import in
   * App.svelte, so the stable build contains neither this module nor a request for it.
   */
  import { tick } from 'svelte';
  import { userVocabulary } from '../../collections/service';
  import { progress } from '../../state';
  import { saveStatus } from '../../state/persistence';
  import { downloadFile } from '../../shared/download';
  import Button from '../../shared/ui/Button.svelte';
  import Icon from '../../shared/ui/Icon.svelte';
  import Notice from '../../shared/ui/Notice.svelte';
  import { inspectLegacyDestination, inspectStableDestination, type LegacyPlan, type StableDestination } from './destinations';
  import { collectSections, composeBackup, type CollectedSections, type SourceReport } from './exportBackup';
  import { BackupError, EXPERIMENTAL_PRODUCT, LEGACY_PRODUCT, MAX_BACKUP_BYTES, PRODUCTS, STABLE_PRODUCT, type BackupFile, type DatabaseSection, type LegacySection, type ProductId } from './format';
  import { inspectDestination, restoreOwnSection, type Destination } from './restore';
  import { legacyTheme, summarizeDatabaseSection, summarizeLegacySection, type SectionSummary } from './summary';
  import { readBackup } from './validate';

  const PRODUCT_LABELS: Record<ProductId, string> = {
    [EXPERIMENTAL_PRODUCT]: 'This version (experimental v3)',
    [STABLE_PRODUCT]: 'Stable version (v2)',
    [LEGACY_PRODUCT]: 'Previous version (v1)'
  };
  /** How a product is named inside a sentence. */
  const PRODUCT_NAMES: Record<ProductId, string> = {
    [EXPERIMENTAL_PRODUCT]: 'this version',
    [STABLE_PRODUCT]: 'the stable version',
    [LEGACY_PRODUCT]: 'the previous version (v1)'
  };
  /** How a product is named at the start of a sentence. */
  const PRODUCT_SUBJECTS: Record<ProductId, string> = {
    [EXPERIMENTAL_PRODUCT]: 'This version',
    [STABLE_PRODUCT]: 'The stable version',
    [LEGACY_PRODUCT]: 'The previous version (v1)'
  };

  const count = (value: number, one: string, many: string): string => `${value} ${value === 1 ? one : many}`;
  const joined = (parts: string[]): string => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? ''));

  /** A summary in words. A section without learning data says so. */
  function describe(summary: SectionSummary): string {
    const parts: string[] = [];
    if (summary.learned) parts.push(count(summary.learned, 'learned item', 'learned items'));
    if (summary.hidden) parts.push(count(summary.hidden, 'hidden item', 'hidden items'));
    if (summary.focus) parts.push(count(summary.focus, 'Focus item', 'Focus items'));
    if (summary.learnPasses) parts.push(count(summary.learnPasses, 'Learn pass', 'Learn passes'));
    if (summary.flashcardDecks) parts.push(count(summary.flashcardDecks, 'flashcard deck with a saved place', 'flashcard decks with a saved place'));
    for (const collection of summary.collections) parts.push(`the collection “${collection.name}” (${count(collection.entries, 'entry', 'entries')})`);
    const preferences = summary.preferences ? count(summary.preferences, 'saved preference', 'saved preferences') : '';
    if (!parts.length) return preferences ? `No learning data yet, ${preferences}.` : 'No learning data yet.';
    return `${joined(preferences ? [...parts, preferences] : parts)}.`;
  }

  /** A part of a backup file in words: its summary and, for the first version, its theme. */
  const describePart = (part: { summary: SectionSummary; theme: string | null }): string => `${describe(part.summary)}${part.theme ? ` Theme: ${part.theme}.` : ''}`;

  // ---- Making a backup ---------------------------------------------------------------------

  type ExportPhase = 'idle' | 'reading' | 'blocked' | 'done' | 'failed';
  let exportPhase: ExportPhase = 'idle';
  let reports: SourceReport[] = [];
  /** What was read, kept while the learner decides about an incomplete backup. */
  let collected: CollectedSections | null = null;
  let madeFile = '';
  let exportFailure = '';
  let exportNotice: HTMLDivElement | undefined;

  $: failedReports = reports.filter((report): report is Extract<SourceReport, { state: 'failed' }> => report.state === 'failed');
  $: failedNames = joined(failedReports.map((report) => PRODUCT_NAMES[report.product]));

  /** The click is the learner's explicit request: the other products' data is read for a backup here and nowhere else. */
  async function makeBackup(): Promise<void> {
    if (exportPhase === 'reading') return;
    exportPhase = 'reading';
    exportFailure = '';
    madeFile = '';
    collected = null;
    try {
      const next = await collectSections();
      reports = next.reports;
      if (next.reports.some((report) => report.state === 'failed')) {
        collected = next;
        exportPhase = 'blocked';
      } else {
        await saveFile(next);
      }
    } catch (error) {
      failExport(error);
    }
    await tick();
    exportNotice?.focus();
  }

  /** The learner saw which product is missing and asked for the file without it. Nothing is read again. */
  async function makeIncompleteBackup(): Promise<void> {
    if (!collected || exportPhase !== 'blocked') return;
    const pending = collected;
    exportPhase = 'reading';
    try {
      await saveFile(pending);
    } catch (error) {
      failExport(error);
    }
    await tick();
    exportNotice?.focus();
  }

  async function saveFile(sections: CollectedSections): Promise<void> {
    const file = await composeBackup(sections.sections);
    downloadFile(file.fileName, [file.text], 'application/json;charset=utf-8');
    madeFile = file.fileName;
    collected = null;
    exportPhase = 'done';
  }

  function failExport(error: unknown): void {
    exportFailure = error instanceof Error ? error.message : String(error);
    collected = null;
    exportPhase = 'failed';
  }

  // ---- Recovering from a backup ------------------------------------------------------------

  type LoadedSection = { product: ProductId; summary: SectionSummary; theme: string | null };
  type Loaded = { fileName: string; file: BackupFile; madeAt: string; sections: LoadedSection[] };
  type Outcome = { tone: 'success' | 'error'; title: string; text: string; reload?: boolean; open?: Link };
  /** What the storage of one product holds now, as the module of that product's destination reported it. */
  type Found =
    | { product: typeof EXPERIMENTAL_PRODUCT; destination: Destination }
    | { product: typeof STABLE_PRODUCT; destination: StableDestination }
    | { product: typeof LEGACY_PRODUCT; destination: LegacyPlan };
  type Link = { href: string; label: string };
  /**
   * The line under a part of the file: where it would go and whether that is possible now.
   * `action` is the label of the button that starts the recovery. A refused part can be
   * looked at again, and `open` leads to the product that has to be opened first.
   */
  type Target = { state: 'empty' | 'partial' | 'identical' | 'recovered' | 'unverified' | 'absent' | 'occupied' | 'unavailable'; text: string; action: string | null; refused: boolean; open?: Link };

  // Every file selection gets a number: only the latest one may update the screen.
  let selection = 0;
  let reading = '';
  let loaded: Loaded | null = null;
  let found: Partial<Record<ProductId, Found>> = {};
  /** The parts of the open file that were recovered while it was open. */
  let recovered: ProductId[] = [];
  /**
   * The parts of the open file that were written while it was open, but could not be checked.
   * Their destination holds data that may be the backup's: it is never shown as data to be reset.
   */
  let unverified: ProductId[] = [];
  let problem: { title: string; text: string } | null = null;
  let outcome: Outcome | null = null;
  /** The product that the open confirmation asks about. */
  let asking: ProductId | null = null;
  let restoring = false;
  let fileInput: HTMLInputElement | undefined;
  let reviewHeading: HTMLHeadingElement | undefined;
  let problemNotice: HTMLDivElement | undefined;
  let outcomeNotice: HTMLDivElement | undefined;
  let dialog: HTMLDialogElement | undefined;
  let cancelButton: HTMLButtonElement | undefined;

  // What the running application holds, for the hint below. The recovery itself asks the database.
  $: holdsNothing =
    $saveStatus.state !== 'disabled' &&
    !$userVocabulary.collections.length &&
    !$progress.learnPasses.length &&
    !Object.keys($progress.flashcardSessions).length &&
    ![$progress.learnedPhrases, $progress.hiddenPhrases, $progress.hiddenWords, $progress.hiddenIrregular, $progress.favoriteBlocks, $progress.favoritePhrases, $progress.favoriteWords, $progress.favoriteIrregular].some((list) => list.length);

  const PROBLEM_TITLES: Partial<Record<BackupError['code'], string>> = {
    'too-large': 'This file is too large to be a backup',
    'empty': 'This file is empty',
    'not-utf8': 'This file is not a backup',
    'not-json': 'This file is cut short or damaged',
    'not-a-backup': 'This file is not a backup',
    'unsupported-version': 'This backup needs another version of the application',
    'malformed': 'This file does not have the form of a backup',
    'integrity': 'This backup is damaged or was changed',
    'invalid-record': 'This backup holds a record that cannot be accepted'
  };

  /** How to make room for a recovery, per product. A backup of the present data comes first. */
  const MAKE_ROOM: Record<ProductId, string> = {
    [EXPERIMENTAL_PRODUCT]: 'To use this file anyway, make a backup of the present data first, then choose Reset learning progress in Settings and remove your collections.',
    [STABLE_PRODUCT]: 'To use this file anyway, make a backup of the present data first, then open the stable version, choose Reset learning progress in Settings and remove your collections.',
    [LEGACY_PRODUCT]: 'To use this file anyway, make a backup of the present data first, then open the previous version and choose Reset progress.'
  };

  function summarize(file: BackupFile): LoadedSection[] {
    return PRODUCTS.filter((product) => file.sections[product]).map((product) =>
      product === LEGACY_PRODUCT
        ? { product, summary: summarizeLegacySection(file.sections[product] as LegacySection), theme: legacyTheme(file.sections[product] as LegacySection) }
        : { product, summary: summarizeDatabaseSection(file.sections[product] as DatabaseSection), theme: null }
    );
  }

  /**
   * Reads what the destination of one part holds now, and only reads. For the other two
   * products this runs for a part that the selected file holds, never before a file is chosen.
   */
  async function inspect(product: ProductId, file: BackupFile): Promise<Found> {
    // A database is compared with the digest of its part, so data that is exactly the backup's is recognised.
    if (product === STABLE_PRODUCT) return { product, destination: await inspectStableDestination(file.integrity.sections[STABLE_PRODUCT]) };
    if (product === LEGACY_PRODUCT) return { product, destination: inspectLegacyDestination(file.sections[LEGACY_PRODUCT] as LegacySection) };
    return { product: EXPERIMENTAL_PRODUCT, destination: await inspectDestination(file.integrity.sections[EXPERIMENTAL_PRODUCT]) };
  }

  /** The address of another product, for a link that lets the learner open it. */
  function linkTo(product: ProductId): Link | undefined {
    const link = __ENG_VERSION_LINKS__.find((item) => item.product === product);
    return link ? { href: link.href, label: `Open ${PRODUCT_NAMES[product]}` } : undefined;
  }

  function targetOf(product: ProductId, place: Found | undefined, done: boolean, unchecked: boolean): Target | null {
    if (done) return { state: 'recovered', text: `Recovered from this file: ${PRODUCT_NAMES[product]} holds this data in this browser now.`, action: null, refused: false };
    if (!place) return null;
    const name = PRODUCT_NAMES[product];
    const destination = place.destination;
    // Written a moment ago, and the check failed. Unless the storage is now seen to hold exactly the
    // data of this part, the line says that, and never that there is data to reset.
    if (unchecked && destination.state !== 'identical') {
      return {
        state: 'unverified',
        text: `Written, but not checked. The data of this part may already be in ${name} in this browser. Do not reset or remove anything because of this message. Open ${name} and look at your data, or check again: that compares the storage with this file.${destination.state === 'unavailable' ? ` ${destination.reason}` : ''}`,
        action: null,
        refused: true,
        open: linkTo(product)
      };
    }
    switch (destination.state) {
      case 'empty':
        return { state: 'empty', text: `Can be recovered into ${name} in this browser: it holds no learning data here.`, action: `Recover into ${name}…`, refused: false };
      case 'partial':
        return {
          state: 'partial',
          text: `Partly recovered. The learning data of this backup is already in ${name} in this browser, unchanged. Its theme is not. You can complete the recovery.`,
          action: `Complete the recovery of ${name}…`,
          refused: false
        };
      case 'identical':
        return { state: 'identical', text: `Nothing to recover: ${name} already holds exactly this data in this browser.`, action: null, refused: false };
      case 'absent':
        return {
          state: 'absent',
          text: `Cannot be recovered yet. ${PRODUCT_SUBJECTS[product]} has no storage for its data in this browser. It creates that storage when it is opened, and nothing else may. Open ${name} once, change nothing there, then come back and check again.`,
          action: null,
          refused: true,
          open: linkTo(product)
        };
      case 'occupied':
        return {
          state: 'occupied',
          text: `Cannot be recovered now. ${PRODUCT_SUBJECTS[product]} already holds learning data in this browser: ${joined(destination.holds)}. A recovery never overwrites data. ${MAKE_ROOM[product]}`,
          action: null,
          refused: true
        };
      default:
        return { state: 'unavailable', text: `Cannot be recovered now. ${destination.reason}`, action: null, refused: true };
    }
  }

  $: targets = Object.fromEntries((loaded?.sections ?? []).map((section) => [section.product, targetOf(section.product, found[section.product], recovered.includes(section.product), unverified.includes(section.product))])) as Partial<Record<ProductId, Target | null>>;
  $: asked = asking && loaded ? (loaded.sections.find((section) => section.product === asking) ?? null) : null;
  $: askedPlace = asking ? found[asking] : undefined;
  $: completing = askedPlace?.destination.state === 'partial';

  function closeFile(): void {
    loaded = null;
    found = {};
    recovered = [];
    unverified = [];
    problem = null;
  }

  async function selectFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // The File is kept; clearing the input lets the same file be chosen again.
    input.value = '';
    if (!file || restoring) return;

    const token = ++selection;
    closeFile();
    outcome = null;
    reading = file.name;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new BackupError('too-large', `The file is larger than ${MAX_BACKUP_BYTES / 1024 / 1024} MiB. A backup of this application is much smaller.`);
      const backup = await readBackup(await file.arrayBuffer());
      if (token !== selection) return;
      const sections = summarize(backup);
      const places: Partial<Record<ProductId, Found>> = {};
      for (const section of sections) places[section.product] = await inspect(section.product, backup);
      if (token !== selection) return;
      loaded = { fileName: file.name, file: backup, madeAt: new Date(backup.exportedAt).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' }), sections };
      found = places;
      reading = '';
      await tick();
      if (token === selection) reviewHeading?.focus();
    } catch (error) {
      if (token !== selection) return;
      reading = '';
      problem = {
        title: (error instanceof BackupError && PROBLEM_TITLES[error.code]) || 'This file could not be read',
        text: error instanceof Error ? error.message : String(error)
      };
      await tick();
      if (token === selection) problemNotice?.focus();
    }
  }

  function chooseAnotherFile(): void {
    fileInput?.focus();
    fileInput?.click();
  }

  async function askToRecover(product: ProductId): Promise<void> {
    if (restoring || !dialog || !targets[product]?.action) return;
    asking = product;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    await tick();
    cancelButton?.focus();
  }

  function closeDialog(): void {
    asking = null;
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  /** Cancel and Escape do nothing while the recovery runs: the dialog keeps the rest of the page out of reach until it has finished. */
  function cancelRecover(): void {
    if (restoring) return;
    closeDialog();
  }

  /**
   * Looks at the destination of one part again. The learner asks for it, for example after
   * opening the stable version once or after making room in another tab. It only reads.
   */
  async function checkAgain(product: ProductId): Promise<void> {
    if (!loaded || restoring) return;
    const current = loaded;
    const place = await inspect(product, current.file);
    if (loaded === current) found = { ...found, [product]: place };
  }

  /** Writes one part into the product it belongs to. The writer for the other two products is loaded here, after the confirmation. */
  async function write(product: ProductId, file: BackupFile): Promise<void> {
    if (product === EXPERIMENTAL_PRODUCT) {
      // The recovery starts its transaction only while this screen is open: where the learner has left it,
      // nobody would see how it ends. Once it has started, the application keeps this screen open until
      // the end (see `stateHeld` in App.svelte). The confirmation is part of the page while the screen is.
      await restoreOwnSection(file, { screenOpen: () => Boolean(dialog?.isConnected) });
      return;
    }
    let writer: typeof import('./recoveryWriter');
    try {
      writer = await import('./recoveryWriter');
    } catch (error) {
      throw new BackupError('unavailable', 'The part of the application that writes the other versions could not be loaded, so nothing was changed. Check the connection and try again.', { cause: error });
    }
    if (product === STABLE_PRODUCT) await writer.restoreStableSection(file);
    else await writer.restoreLegacySection(file);
  }

  /** The result is reported only after the data was written and read back. */
  async function recover(): Promise<void> {
    if (!loaded || !asked || restoring) return;
    const current = loaded;
    const { product, summary } = asked;
    restoring = true;
    try {
      await write(product, current.file);
      recovered = [...recovered, product];
      outcome = {
        tone: 'success',
        title: 'Recovery complete',
        text: `The data of ${PRODUCT_NAMES[product]} from “${current.fileName}” is in this browser again: ${describe(summary)} It was read back after writing and matches the backup file.`,
        open: linkTo(product)
      };
    } catch (error) {
      const code = error instanceof BackupError ? error.code : null;
      // `verification` is every failure after the writing transaction completed: the data is in the
      // storage. It is never reported as "nothing was recovered".
      const written = code === 'verification';
      const own = product === EXPERIMENTAL_PRODUCT;
      // Once a recovery of this version is written, this tab is detached from its storage. It is
      // attached again only by loading the state from the database. Where that did not happen, the tab
      // saves nothing, whatever the learner does next, until the page is reloaded. A recovery that was
      // refused or rolled back detaches nothing: the tab goes on as it was.
      const detached = own && $saveStatus.state === 'disabled';
      outcome = {
        tone: 'error',
        title: written ? 'Written, but not checked' : code === 'partial' ? 'The recovery is not complete' : 'Nothing was recovered',
        text: error instanceof Error ? error.message : String(error),
        reload: detached,
        open: written && !own ? linkTo(product) : undefined
      };
      if (written && !own) unverified = [...unverified.filter((item) => item !== product), product];
      // The running application holds another state than its database now: only a reload settles that.
      if (written && own) {
        selection += 1;
        closeFile();
      }
    } finally {
      restoring = false;
      closeDialog();
    }
    // The destination has changed, or may have. It is judged again before anything is offered.
    if (loaded === current) {
      const place = await inspect(product, current.file);
      if (loaded === current) found = { ...found, [product]: place };
    }
    await tick();
    outcomeNotice?.focus();
  }
</script>

<div class="page-stack backup-page" data-experimental-feature="backup-recovery" data-export-phase={exportPhase} data-restore-phase={restoring ? 'restoring' : loaded ? 'preview' : 'idle'}>
  <Notice tone="info" title="Your learning data is kept only in this browser" role="none">
    <p>A browser can remove saved data, for example when its storage runs low or when the data of this site is cleared. A backup file is the only copy outside the browser.</p>
    <p>All versions of the trainer share the storage of this browser. One backup file holds the data of each of them.</p>
  </Notice>

  <section class="panel" aria-labelledby="backup-make">
    <h2 id="backup-make" class="panel__title">Make a backup file</h2>
    <p>The file holds the learning data that this browser has for this version, for the stable version and for the previous version (v1): progress, Focus list, Learn passes, flashcard places, preferences and imported collections.</p>
    <p>Making it reads that data and changes nothing. The file holds no speech model and no recording.</p>
    <div class="backup-actions">
      <Button variant="primary" icon="download" busy={exportPhase === 'reading'} disabled={exportPhase === 'reading'} onClick={makeBackup} data-backup-action="make">
        {exportPhase === 'reading' ? 'Reading the saved data…' : 'Make a backup file'}
      </Button>
    </div>

    {#if exportPhase === 'done'}
      <Notice tone={failedReports.length ? 'warning' : 'success'} title={`Backup file made: ${madeFile}`} focusable bind:element={exportNotice}>
        {#if failedReports.length}<p><strong>This backup is incomplete.</strong> It does not hold the data of {failedNames}.</p>{/if}
        <p>Your browser saved the file or asked where to save it. Keep it outside this browser, for example in a folder that is copied to another device.</p>
        <p>The application cannot check that you kept the file.</p>
      </Notice>
    {:else if exportPhase === 'blocked'}
      <Notice tone="error" title="No file was made yet" focusable bind:element={exportNotice}>
        <p>The saved data of {failedNames} could not be read or checked, so a backup would not be complete.</p>
        <svelte:fragment slot="actions">
          {#if collected && Object.keys(collected.sections).length}
            <Button variant="secondary" size="sm" icon="download" onClick={makeIncompleteBackup} data-backup-action="make-incomplete">Make the file without {failedNames}</Button>
          {/if}
          <Button variant="secondary" size="sm" icon="reset" onClick={makeBackup} data-backup-action="retry">Try again</Button>
        </svelte:fragment>
      </Notice>
    {:else if exportPhase === 'failed'}
      <Notice tone="error" title="No file was made" focusable bind:element={exportNotice}>
        <p data-backup-failure>{exportFailure}</p>
      </Notice>
    {/if}

    {#if reports.length && exportPhase !== 'reading'}
      <ul class="backup-sections" aria-label="What was found in this browser">
        {#each reports as report (report.product)}
          <li class="backup-section" data-backup-source={report.product} data-backup-source-state={report.state}>
            <span class="backup-section__name">{PRODUCT_LABELS[report.product]}</span>
            {#if report.state === 'included'}
              <span class="count-chip">{exportPhase === 'done' ? 'In the file' : 'Read'}</span>
              <span class="backup-section__text">{describe(report.summary)}</span>
            {:else if report.state === 'absent'}
              <span class="count-chip">Nothing saved</span>
              <span class="backup-section__text">This browser has no saved data of {PRODUCT_NAMES[report.product]}.</span>
            {:else}
              <span class="count-chip count-chip--error">Not in the file</span>
              <span class="backup-section__text">{report.reason}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="panel" aria-labelledby="backup-recover">
    <h2 id="backup-recover" class="panel__title">Recover from a backup file</h2>
    {#if holdsNothing}
      <p data-backup-empty-profile>This version holds no learning data in this browser. If you had data here before, the browser may have removed it. The application cannot tell. You can recover it from a backup file.</p>
    {/if}
    <div class="file-picker" aria-busy={reading ? 'true' : undefined}>
      <p>Choose a backup file. It is checked and shown first, and nothing is changed until you confirm. Each version is recovered on its own, and only where it holds no learning data. The file stays in this browser.</p>
      <input
        bind:this={fileInput}
        id="backup-file"
        class="file-picker__input visually-hidden"
        type="file"
        accept=".json,application/json"
        aria-describedby="backup-file-hint"
        disabled={restoring}
        on:change={selectFile}
      />
      <label for="backup-file" class="btn btn--secondary btn--md file-picker__button"><Icon name="upload" />Choose a backup file</label>
      <p id="backup-file-hint" class="field__hint">A file that this screen made, named like eng-trainer-backup-20261125-140322.json.</p>
      {#if reading}
        <div class="file-picker__status"><p role="status"><span class="spinner" aria-hidden="true"></span>Checking “{reading}”…</p></div>
      {/if}
    </div>

    {#if problem}
      <Notice tone="error" title={problem.title} focusable bind:element={problemNotice}>
        <p data-backup-problem>{problem.text}</p>
        <p class="notice__detail">Nothing was changed.</p>
        <svelte:fragment slot="actions">
          <Button variant="secondary" size="sm" icon="upload" onClick={chooseAnotherFile}>Choose another file</Button>
        </svelte:fragment>
      </Notice>
    {/if}

    {#if outcome}
      <Notice tone={outcome.tone} title={outcome.title} focusable bind:element={outcomeNotice}>
        <p data-backup-outcome={outcome.tone}>{outcome.text}</p>
        {#if outcome.reload}
          <div class="backup-actions">
            <Button variant="secondary" size="sm" icon="reset" onClick={() => location.reload()}>Reload page</Button>
          </div>
        {/if}
        {#if outcome.open}
          <p><a href={outcome.open.href} data-backup-open>{outcome.open.label}</a></p>
        {/if}
      </Notice>
    {/if}

    {#if loaded}
      <section class="review" aria-labelledby="backup-review">
        <h3 id="backup-review" class="review__title" tabindex="-1" bind:this={reviewHeading}>Backup file “{loaded.fileName}”</h3>
        <p>Made on {loaded.madeAt}. The file passed every check: its form, the digest of each part and every record.</p>
        <ul class="backup-sections" aria-label="What this backup holds">
          {#each loaded.sections as section (section.product)}
            {@const target = targets[section.product]}
            <li class="backup-section" data-backup-section={section.product}>
              <span class="backup-section__name">{PRODUCT_LABELS[section.product]}</span>
              <span class="backup-section__text">{describePart(section)}</span>
              {#if target}
                <span class="backup-section__target" class:backup-section__target--refused={target.refused} data-backup-destination={target.state}>{target.text}</span>
                {#if target.action}
                  <Button variant="primary" icon="check" disabled={restoring} onClick={() => askToRecover(section.product)} data-backup-action="recover" data-backup-product={section.product}>{target.action}</Button>
                {:else if target.refused}
                  <div class="backup-actions">
                    {#if target.open}<a href={target.open.href} target="_blank" rel="noopener" data-backup-open-first={section.product}>{target.open.label}</a>{/if}
                    <Button variant="secondary" size="sm" icon="reset" disabled={restoring} onClick={() => checkAgain(section.product)} data-backup-action="check-again" data-backup-product={section.product}>Check again</Button>
                  </div>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
        <div class="backup-actions">
          <Button variant="secondary" disabled={restoring} onClick={() => { selection += 1; closeFile(); }} data-backup-action="close-file">Close this file</Button>
        </div>
      </section>
    {/if}
  </section>
</div>

<dialog bind:this={dialog} class="dialog" aria-labelledby="backup-confirm-title" aria-describedby="backup-confirm-body" aria-busy={restoring ? 'true' : undefined} data-backup-confirm={asking} on:cancel|preventDefault={cancelRecover}>
  <h2 id="backup-confirm-title" class="dialog__title">{#if asking}{completing ? `Complete the recovery of ${PRODUCT_NAMES[asking]}?` : `Recover into ${PRODUCT_NAMES[asking]}?`}{/if}</h2>
  <div id="backup-confirm-body" class="dialog__body">
    {#if loaded && asked}
      {#if asked.product === EXPERIMENTAL_PRODUCT}
        <p>This writes the data of this version from “{loaded.fileName}” into this browser: {describe(asked.summary)}</p>
        <ul>
          <li>This version holds no learning data here, so nothing is overwritten.</li>
          <li>Your preferences in this version, such as the theme and the list sizes, are replaced by those of the backup.</li>
          <li>The stable version and the previous version (v1) are not changed.</li>
        </ul>
        <p>Close other tabs of this application first. A tab that stays open could later save its older state over the recovered data.</p>
        {#if restoring}<p role="status" data-backup-holding>Recovering… Until this has finished, this tab accepts no changes and keeps this screen open.</p>{/if}
      {:else if asked.product === STABLE_PRODUCT}
        <p>This writes the data of the stable version from “{loaded.fileName}” into the storage of the stable version in this browser: {describe(asked.summary)}</p>
        <ul>
          <li>The stable version holds no learning data here, so nothing is overwritten.</li>
          <li>Your preferences in the stable version, such as the theme and the list sizes, are replaced by those of the backup.</li>
          <li>This version and the previous version (v1) are not changed.</li>
        </ul>
        <p>Close every tab of the stable version first. A tab that stays open could later save its older state over the recovered data.</p>
      {:else if completing}
        <p>The learning data of the previous version (v1) from “{loaded.fileName}” is already in this browser, and it is unchanged. This writes only what is still missing: the theme{asked.theme ? ` (${asked.theme})` : ''}.</p>
        <ul>
          <li>The learning data is not written again.</li>
          <li>This version and the stable version are not changed.</li>
        </ul>
        <p>Close every tab of the previous version first. A tab that stays open could later save its older state over the recovered data.</p>
      {:else}
        <p>This writes the data of the previous version (v1) from “{loaded.fileName}” into the storage of the previous version in this browser: {describePart(asked)}</p>
        <ul>
          <li>The previous version holds no learning data here, so nothing is overwritten.</li>
          <li>Its preferences, such as the theme, the last screen and the list sizes, are replaced by those of the backup.</li>
          <li>The previous version keeps two records, and a browser cannot write them in one step. If the second one cannot be written, this screen says so, and the recovery can be completed later.</li>
          <li>This version and the stable version are not changed.</li>
        </ul>
        <p>Close every tab of the previous version first. A tab that stays open could later save its older state over the recovered data.</p>
      {/if}
    {/if}
  </div>
  <div class="dialog__actions">
    <button bind:this={cancelButton} type="button" class="btn btn--secondary btn--md" disabled={restoring} on:click={cancelRecover} data-backup-action="cancel-recover">Cancel</button>
    <button type="button" class="btn btn--primary btn--md" disabled={restoring} aria-busy={restoring || undefined} on:click={recover} data-backup-action="confirm-recover">{restoring ? 'Recovering…' : completing ? 'Complete the recovery' : 'Recover'}</button>
  </div>
</dialog>

<style>
  .backup-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  .backup-sections {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .backup-section {
    display: grid;
    gap: var(--space-1);
    justify-items: start;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
  }
  .backup-section__name {
    font-weight: 600;
  }
  .backup-section__text,
  .backup-section__target {
    color: var(--color-text-secondary);
    overflow-wrap: anywhere;
  }
  .backup-section__target--refused {
    color: var(--color-text);
  }
</style>
