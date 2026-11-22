<script lang="ts">
  import { tick } from 'svelte';
  import type { ContentCatalog } from '../../content/catalog';
  import { exportFileName } from '../../collections/fileName';
  import { checkImportFileSize, decodeImportFile, importFormatOf, parseImport, type ParsedImport } from '../../collections/format';
  import { CSV_TEMPLATE_FILE_NAME, csvTemplateParts, formatFileLimit } from '../../collections/importGuide';
  import {
    acceptImport,
    exportCollection,
    prepareImport,
    removeCollection,
    renameCollection,
    userVocabulary,
    type ImportPlan,
    type UserCollection
  } from '../../collections/service';
  import { downloadFile } from '../../shared/download';
  import Button from '../../shared/ui/Button.svelte';
  import ConfirmDialog from '../../shared/ui/ConfirmDialog.svelte';
  import EmptyState from '../../shared/ui/EmptyState.svelte';
  import Icon from '../../shared/ui/Icon.svelte';
  import Notice from '../../shared/ui/Notice.svelte';
  import ImportHelp from './ImportHelp.svelte';
  import { describeCollectionError, describeImportError, describeIssue, type ImportProblem } from './importFeedback';

  export let catalog: ContentCatalog;

  type Advice = { text: string; reload: boolean };

  // Import. Every file selection gets a number: only the latest selection may
  // update the preview, the messages or the focus. Cancel invalidates it too.
  let selection = 0;
  let reading = '';
  let parsed: ParsedImport | null = null;
  let plan: ImportPlan | null = null;
  let collectionName = '';
  let acknowledge = false;
  let problem: ImportProblem | null = null;
  let saving = false;
  let saveError: Advice | null = null;
  let importResult = '';
  let fileInput: HTMLInputElement | undefined;
  let reviewHeading: HTMLHeadingElement | undefined;
  let problemNotice: HTMLDivElement | undefined;
  /** The summary of record-level problems that block the import. */
  let issuesNotice: HTMLDivElement | undefined;
  let saveErrorNotice: HTMLDivElement | undefined;
  let resultNotice: HTMLDivElement | undefined;

  // Managing collections.
  let renameId = '';
  let renameName = '';
  let renameError: Advice | null = null;
  let renameInput: HTMLInputElement | undefined;
  let actionError: (Advice & { id: string }) | null = null;
  let listMessage = '';
  let busyId = '';
  let pendingRemove: UserCollection | null = null;
  let listHeading: HTMLHeadingElement | undefined;

  $: available = $userVocabulary.available;
  $: canImport = Boolean(plan) && !plan!.issues.length && (!plan!.duplicates.length || acknowledge) && available;

  function preview(): void {
    if (!parsed) return;
    parsed = { ...parsed, collection: { ...parsed.collection, name: collectionName } };
    plan = prepareImport(parsed, catalog);
  }

  function clearImport(): void {
    plan = null;
    parsed = null;
    problem = null;
    saveError = null;
    acknowledge = false;
  }

  async function selectFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // The File is kept; clearing the input lets the same (corrected) file be chosen again.
    input.value = '';
    if (!file) return;

    const token = ++selection;
    clearImport();
    importResult = '';
    reading = file.name;
    try {
      importFormatOf(file.name);
      checkImportFileSize(file.size);
      const buffer = await file.arrayBuffer();
      if (token !== selection) return;
      const next = parseImport(decodeImportFile(buffer), file.name);
      if (token !== selection) return;
      parsed = next;
      collectionName = next.collection.name;
      preview();
      reading = '';
      await tick();
      // Only the latest selection may move focus, and only once its result has rendered.
      // Blocking problems are summarized first; an importable preview (possibly with
      // duplicate warnings to acknowledge) starts at its heading.
      if (token !== selection) return;
      (plan?.issues.length ? issuesNotice : reviewHeading)?.focus();
    } catch (cause) {
      if (token !== selection) return;
      reading = '';
      problem = describeImportError(cause);
      await tick();
      if (token === selection) problemNotice?.focus();
    }
  }

  async function cancelImport(): Promise<void> {
    selection += 1;
    reading = '';
    clearImport();
    await tick();
    fileInput?.focus();
  }

  function chooseAnotherFile(): void {
    fileInput?.focus();
    fileInput?.click();
  }

  function downloadTemplate(): void {
    downloadFile(CSV_TEMPLATE_FILE_NAME, csvTemplateParts(), 'text/csv;charset=utf-8');
  }

  /** The result is reported only after the transaction has completed. */
  async function confirmImport(): Promise<void> {
    if (!plan || saving || !canImport) return;
    const current = plan;
    const token = selection;
    saving = true;
    saveError = null;
    try {
      const result = await acceptImport(current, acknowledge);
      importResult = result.added
        ? `Imported ${result.added} entries. ${result.skipped} identical entries were already present.`
        : `No changes needed. All ${result.skipped} entries are already present.`;
      if (token === selection) {
        clearImport();
        selection += 1;
      }
      await tick();
      resultNotice?.focus();
    } catch (cause) {
      saveError = describeCollectionError(cause, 'import');
      await tick();
      saveErrorNotice?.focus();
    } finally {
      saving = false;
    }
  }

  function trigger(id: string, action: 'rename' | 'export' | 'remove'): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-collection-id="${id}"] .collection-action--${action}`);
  }

  async function startRename(collection: UserCollection): Promise<void> {
    renameId = collection.id;
    renameName = collection.name;
    renameError = null;
    actionError = null;
    await tick();
    renameInput?.focus();
    renameInput?.select();
  }

  async function cancelRename(id: string): Promise<void> {
    renameId = '';
    renameError = null;
    await tick();
    trigger(id, 'rename')?.focus();
  }

  async function saveRename(collection: UserCollection): Promise<void> {
    if (busyId) return;
    busyId = collection.id;
    renameError = null;
    try {
      await renameCollection(collection.id, renameName);
      renameId = '';
      listMessage = 'Collection renamed.';
      await tick();
      trigger(collection.id, 'rename')?.focus();
    } catch (cause) {
      renameError = describeCollectionError(cause, 'rename');
    } finally {
      busyId = '';
    }
  }

  function exportOne(collection: UserCollection): void {
    actionError = null;
    try {
      const fileName = exportFileName(collection.name);
      downloadFile(fileName, [exportCollection(collection.id)], 'application/json;charset=utf-8');
      listMessage = `Exported “${collection.name}” as ${fileName}.`;
    } catch (cause) {
      actionError = { id: collection.id, ...describeCollectionError(cause, 'export') };
    }
  }

  async function confirmRemove(): Promise<void> {
    const collection = pendingRemove;
    pendingRemove = null;
    if (!collection || busyId) return;
    busyId = collection.id;
    actionError = null;
    try {
      await removeCollection(collection.id);
      listMessage = `Removed “${collection.name}”. Its learning progress is kept and returns if you import its JSON export again.`;
      await tick();
      listHeading?.focus();
    } catch (cause) {
      actionError = { id: collection.id, ...describeCollectionError(cause, 'remove') };
    } finally {
      busyId = '';
    }
  }

  function entryCount(id: string): number {
    return $userVocabulary.entries.filter((entry) => entry.collectionId === id).length;
  }
</script>

<div class="page-stack collections-page">
  <section class="import-panel" aria-labelledby="import-title">
    <h2 id="import-title" class="panel__title">Import words</h2>
    {#if !available}
      <Notice tone="warning" title="Collections need browser storage.">
        <p>Saving is off in this session, so you cannot import or change collections. Reload the app to try again.</p>
      </Notice>
    {/if}

    <div class="import-layout">
      <div class="file-picker" aria-busy={reading ? 'true' : undefined}>
        <p>Choose a CSV or JSON file. You can review everything before anything is saved, and your file stays in this browser.</p>
        <input
          bind:this={fileInput}
          id="import-file"
          class="file-picker__input visually-hidden"
          type="file"
          accept=".csv,.json,text/csv,application/json"
          aria-describedby="import-file-hint"
          disabled={saving || !available}
          on:change={selectFile}
        />
        <label for="import-file" class="btn btn--primary btn--md file-picker__button"><Icon name="upload" />Choose a file</label>
        <p id="import-file-hint" class="field__hint">CSV saved as UTF-8, or a JSON file exported from eng-trainer. Up to {formatFileLimit()}.</p>
        {#if reading}
          <div class="file-picker__status">
            <p role="status"><span class="spinner" aria-hidden="true"></span>Reading “{reading}”…</p>
            <Button variant="quiet" size="sm" onClick={cancelImport}>Cancel</Button>
          </div>
        {/if}
      </div>
      <ImportHelp />
    </div>

    {#if problem}
      <Notice tone="error" title={problem.title} focusable bind:element={problemNotice}>
        <p>{problem.text}</p>
        {#if problem.detail}<p class="notice__detail">{problem.detail}</p>{/if}
        <svelte:fragment slot="actions">
          {#if problem.offerTemplate}<Button variant="secondary" size="sm" icon="download" onClick={downloadTemplate}>Download CSV template</Button>{/if}
          <Button variant="secondary" size="sm" icon="upload" disabled={!available} onClick={chooseAnotherFile}>Choose another file</Button>
        </svelte:fragment>
      </Notice>
    {/if}

    {#if importResult}
      <Notice tone="success" title="Import complete" focusable bind:element={resultNotice}>
        <p>{importResult} Find the entries in Phrases, Words and Flashcards.</p>
      </Notice>
    {/if}

    {#if plan}
      <section class="review" aria-labelledby="review-title">
        <h3 id="review-title" class="review__title" tabindex="-1" bind:this={reviewHeading}>Review “{plan.parsed.fileName}”</h3>
        <div class="review__counts">
          <span class="count-chip">{plan.additions.length} new</span>
          {#if plan.skipped}<span class="count-chip">{plan.skipped} already present</span>{/if}
          {#if plan.duplicates.length}<span class="count-chip count-chip--warning">{plan.duplicates.length} possible {plan.duplicates.length === 1 ? 'duplicate' : 'duplicates'}</span>{/if}
          {#if plan.issues.length}<span class="count-chip count-chip--error">{plan.issues.length} {plan.issues.length === 1 ? 'problem' : 'problems'}</span>{/if}
        </div>

        {#if plan.existing}
          <p>Adds to your collection <strong>{plan.target.name}</strong>. Its name and the entries it already has stay as they are.</p>
        {:else}
          <label class="field">
            <span class="field__label">Collection name</span>
            <input maxlength="100" autocomplete="off" bind:value={collectionName} on:input={preview} disabled={saving} />
          </label>
        {/if}

        {#if plan.issues.length}
          <Notice tone="error" class="review__problems" title="Nothing can be imported until these problems are fixed in the file:" focusable bind:element={issuesNotice}>
            <ul class="review__issues">
              {#each plan.issues as issue}<li>{describeIssue(issue, plan.parsed.source)}</li>{/each}
            </ul>
            {#if plan.parsed.source === 'csv'}
              <p class="notice__detail">Records are counted from the header row (record 1). Blank lines are skipped, and a quoted value can span several lines.</p>
            {/if}
            <svelte:fragment slot="actions">
              <Button variant="secondary" size="sm" icon="upload" onClick={chooseAnotherFile}>Choose the corrected file</Button>
            </svelte:fragment>
          </Notice>
        {/if}

        {#if plan.duplicates.length}
          <Notice tone="warning" role="none">
            <p>{plan.duplicates.length} {plan.duplicates.length === 1 ? 'entry has' : 'entries have'} the same English text as vocabulary you already have, or as another row. They are added as separate entries, each with its own meaning; nothing is merged.</p>
            <label class="choice"><input type="checkbox" bind:checked={acknowledge} disabled={saving} />I’ve checked the possible duplicates</label>
          </Notice>
        {/if}

        <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrollable preview must be keyboard reachable.) -->
        <ul class="review__entries" tabindex="0" aria-label="Entries in this file">
          {#each plan.parsed.entries as entry, index (index)}
            <li class="review__entry">
              <span class="review__english" lang="en" translate="no">{entry.english}</span>
              <span class="review__status" class:review__status--warning={plan.duplicates.includes(entry.id)}>
                {plan.duplicates.includes(entry.id) ? 'Possible duplicate' : plan.additions.some((item) => item.id === entry.id) ? 'New' : 'Already present'}
              </span>
              <span class="review__translation" lang="">{entry.translation}</span>
              <span class="review__extra">
                {entry.kind === 'phrase' ? 'Phrase' : 'Word'}{#if entry.topic}, topic: {entry.topic}{/if}
              </span>
              {#each entry.examples as example}<span class="review__extra">Example: <span lang="en" translate="no">{example.en}</span></span>{/each}
            </li>
          {/each}
        </ul>

        <div class="review__actions">
          <Button variant="primary" icon="check" busy={saving} disabled={!canImport} onClick={confirmImport}>
            {saving ? 'Importing…' : plan.additions.length ? `Import ${plan.additions.length} ${plan.additions.length === 1 ? 'entry' : 'entries'}` : 'Confirm import'}
          </Button>
          <Button variant="secondary" disabled={saving} onClick={cancelImport}>Cancel import</Button>
        </div>

        {#if saveError}
          <Notice tone="error" focusable bind:element={saveErrorNotice}>
            <p>{saveError.text}</p>
            <svelte:fragment slot="actions">
              {#if saveError.reload}<Button variant="secondary" size="sm" icon="reset" onClick={() => location.reload()}>Reload page</Button>{/if}
            </svelte:fragment>
          </Notice>
        {/if}
      </section>
    {/if}
  </section>

  <section aria-labelledby="collections-title">
    <h2 id="collections-title" class="panel__title" tabindex="-1" bind:this={listHeading}>Your collections</h2>
    {#if listMessage}
      <Notice tone="success" class="collections-message"><p>{listMessage}</p></Notice>
    {/if}
    {#if $userVocabulary.collections.length}
      <ul class="collection-list">
        {#each $userVocabulary.collections as collection (collection.id)}
          <li class="collection-card" data-collection-id={collection.id}>
            <h3 lang="">{collection.name}</h3>
            {#if collection.description}<p lang="">{collection.description}</p>{/if}
            <p class="collection-card__meta">{entryCount(collection.id)} entries. Last import: {collection.lastImport.fileName}</p>
            <div class="collection-card__actions">
              <Button variant="secondary" size="sm" icon="edit" class="collection-action--rename" label={`Rename ${collection.name}`} disabled={Boolean(busyId) || !available} onClick={() => startRename(collection)}>Rename</Button>
              <Button variant="secondary" size="sm" icon="download" class="collection-action--export" label={`Export JSON: ${collection.name}`} onClick={() => exportOne(collection)}>Export JSON</Button>
              <Button variant="quiet" size="sm" icon="trash" class="collection-action--remove" label={`Remove ${collection.name}`} disabled={Boolean(busyId) || !available} onClick={() => (pendingRemove = collection)}>Remove</Button>
            </div>

            {#if renameId === collection.id}
              <form class="rename-form" on:submit|preventDefault={() => saveRename(collection)}>
                <label class="field">
                  <span class="field__label">New name for this collection</span>
                  <input bind:this={renameInput} maxlength="100" autocomplete="off" bind:value={renameName} disabled={busyId === collection.id} />
                </label>
                <div class="rename-form__actions">
                  <Button type="submit" variant="primary" size="sm" disabled={busyId === collection.id || !renameName.trim()}>Save name</Button>
                  <Button variant="secondary" size="sm" disabled={busyId === collection.id} onClick={() => cancelRename(collection.id)}>Cancel rename</Button>
                </div>
                {#if renameError}
                  <Notice tone="error">
                    <p>{renameError.text}</p>
                    <svelte:fragment slot="actions">
                      {#if renameError.reload}<Button variant="secondary" size="sm" icon="reset" onClick={() => location.reload()}>Reload page</Button>{/if}
                    </svelte:fragment>
                  </Notice>
                {/if}
              </form>
            {/if}

            {#if actionError?.id === collection.id}
              <Notice tone="error">
                <p>{actionError.text}</p>
                <svelte:fragment slot="actions">
                  {#if actionError.reload}<Button variant="secondary" size="sm" icon="reset" onClick={() => location.reload()}>Reload page</Button>{/if}
                </svelte:fragment>
              </Notice>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <EmptyState level="h3" title="No collections yet" text="Import a CSV file to create your first collection. Its words and phrases then appear in Phrases, Words and Flashcards." />
    {/if}
  </section>
</div>

<ConfirmDialog
  open={pendingRemove !== null}
  title={`Remove “${pendingRemove?.name ?? ''}”?`}
  confirmLabel="Remove collection"
  onConfirm={confirmRemove}
  onCancel={() => (pendingRemove = null)}
  returnFocus={() => listHeading ?? null}
>
  <p>The collection and its vocabulary are removed from this browser. Export it first if you want a backup.</p>
  <p>Learning progress is kept under the original identities and returns if you import the same JSON export again. Other collections and the built-in vocabulary are not changed.</p>
</ConfirmDialog>
