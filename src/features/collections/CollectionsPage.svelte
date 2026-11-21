<script lang="ts">
  import type { ContentCatalog } from '../../content/catalog';
  import { MAX_FILE_BYTES, parseImport, type ParsedImport } from '../../collections/format';
  import { acceptImport, exportCollection, prepareImport, removeCollection, renameCollection, userVocabulary, type ImportPlan } from '../../collections/service';
  import EmptyState from '../../shared/ui/EmptyState.svelte';

  export let catalog: ContentCatalog;
  let parsed: ParsedImport | null = null;
  let plan: ImportPlan | null = null;
  let collectionName = '';
  let acknowledge = false;
  let busy = false;
  let error = '';
  let message = '';
  let renameId = '';
  let renameName = '';
  let removeId = '';

  function preview(): void {
    if (!parsed) return;
    parsed = { ...parsed, collection: { ...parsed.collection, name: collectionName } };
    plan = prepareImport(parsed, catalog);
  }
  async function selectFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    parsed = null; plan = null; error = ''; message = ''; acknowledge = false; busy = true;
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('Choose a file no larger than 2 MiB.');
      let source: string;
      try { source = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
      catch { throw new Error('The file could not be read as UTF-8. Save it as CSV UTF-8 or native JSON and try again.'); }
      parsed = parseImport(source, file.name);
      collectionName = parsed.collection.name;
      preview();
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; input.value = ''; }
  }
  async function action(run: () => Promise<void>): Promise<void> {
    busy = true; error = ''; message = '';
    try { await run(); }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; }
  }
  async function importFile(): Promise<void> {
    if (!plan) return;
    const result = await acceptImport(plan, acknowledge);
    message = result.added ? `Imported ${result.added} entries. ${result.skipped} identical entries were already present.` : `No changes needed. All ${result.skipped} entries are already present.`;
    plan = null; parsed = null;
  }
  function download(id: string, name: string): void {
    error = '';
    try {
      const url = URL.createObjectURL(new Blob([exportCollection(id)], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${name.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80) || 'vocabulary'}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  }
</script>

<section class="section-stack collections-page">
  <div class="toolbar-card controls-stack">
    <h2>Your vocabulary collections</h2>
    <p>Import words and phrases, then find them in Words, Phrases and Flashcards. Your files stay in this browser.</p>
    <p class="muted">CSV UTF-8 headers: <code>english,translation,topic,example</code>. Only English and translation are required. Optional <code>kind</code> is <code>word</code> (default) or <code>phrase</code>. Comma and semicolon separators are supported.</p>
    <p class="muted">Native JSON exports preserve entry IDs and can be imported again. Maximum: 2 MiB per file and 1,000 entries per collection. Export JSON to keep a backup; exports contain vocabulary, not learning progress.</p>
    <label>
      Import vocabulary file
      <input type="file" accept=".csv,.json" on:change={selectFile} disabled={busy || !$userVocabulary.available} />
    </label>
    {#if !$userVocabulary.available}<p role="alert">Collections require browser storage. Reopen the app with saving enabled to import or manage vocabulary.</p>{/if}
    {#if busy}<p role="status">Working…</p>{/if}
    {#if error}<div class="notice" role="alert">{error}</div>{/if}
    {#if message}<div class="notice" role="status">{message}</div>{/if}
  </div>

  {#if plan}
    <div class="card controls-stack import-preview">
      <h3>Review import</h3>
      <p>{plan.parsed.fileName}: {plan.additions.length} new entries; {plan.skipped} identical entries already present.</p>
      {#if plan.existing}
        <p>Import into <strong>{plan.target.name}</strong>. Its current name and existing entries will be kept.</p>
      {:else}
        <label>Collection name<input maxlength="100" bind:value={collectionName} on:input={preview} disabled={busy} /></label>
      {/if}
      {#if plan.issues.length}
        <div role="alert">
          <strong>Nothing can be imported until these issues are fixed:</strong>
          <ul>{#each plan.issues as issue}<li>{issue.row ? `Record ${issue.row}: ` : ''}{issue.message}</li>{/each}</ul>
        </div>
      {/if}
      {#if plan.duplicates.length}
        <p>{plan.duplicates.length} entries have possible text duplicates. Different meanings are allowed; entries are never merged by their text.</p>
        <label class="duplicate-ack"><input type="checkbox" bind:checked={acknowledge} disabled={busy} /> I reviewed these possible duplicates</label>
      {/if}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrollable preview must be keyboard reachable.) -->
      <div class="preview-scroll" tabindex="0" role="region" aria-label="Import entries">
        <table>
          <thead><tr><th>Kind</th><th>English</th><th>Translation</th><th>Topic / examples</th><th>Review</th></tr></thead>
          <tbody>{#each plan.parsed.entries as entry, index (index)}
            <tr>
              <td>{entry.kind}</td><td>{entry.english}</td><td>{entry.translation}</td>
              <td>{entry.topic}{#each entry.examples as example}<p>{example.en}{#if example.translation}<br />{example.translation}{/if}</p>{/each}</td>
              <td>{plan.duplicates.includes(entry.id) ? 'Possible duplicate' : plan.additions.some((item) => item.id === entry.id) ? 'New' : 'Existing ID'}</td>
            </tr>
          {/each}</tbody>
        </table>
      </div>
      <div class="card__actions">
        <button type="button" class="btn primary" disabled={busy || !!plan.issues.length || (!!plan.duplicates.length && !acknowledge) || !$userVocabulary.available} on:click={() => action(importFile)}>Confirm import</button>
        <button type="button" class="btn secondary" disabled={busy} on:click={() => { plan = null; parsed = null; }}>Cancel import</button>
      </div>
    </div>
  {/if}

  {#each $userVocabulary.collections as collection (collection.id)}
    <article class="card controls-stack collection-card">
      <h3>{collection.name}</h3>
      {#if collection.description}<p>{collection.description}</p>{/if}
      <p>{$userVocabulary.entries.filter((entry) => entry.collectionId === collection.id).length} entries · Last import: {collection.lastImport.fileName}</p>
      <div class="card__actions">
        <button type="button" class="btn secondary" disabled={busy} on:click={() => { renameId = collection.id; renameName = collection.name; }}>Rename {collection.name}</button>
        <button type="button" class="btn secondary" disabled={busy} on:click={() => download(collection.id, collection.name)}>Export {collection.name} as JSON</button>
        <button type="button" class="btn danger" disabled={busy} on:click={() => removeId = collection.id}>Remove {collection.name}</button>
      </div>
      {#if renameId === collection.id}
        <form class="controls-stack" on:submit|preventDefault={() => action(async () => { await renameCollection(collection.id, renameName); renameId = ''; message = 'Collection renamed.'; })}>
          <label>New collection name<input maxlength="100" bind:value={renameName} disabled={busy} /></label>
          <div class="card__actions"><button class="btn primary" disabled={busy || !renameName.trim()}>Save name</button><button type="button" class="btn secondary" disabled={busy} on:click={() => renameId = ''}>Cancel rename</button></div>
        </form>
      {/if}
      {#if removeId === collection.id}
        <div class="notice controls-stack" role="group" aria-label="Confirm collection removal">
          <p>Remove <strong>{collection.name}</strong> and its vocabulary from this browser? Export it first if you want a backup.</p>
          <p>Learning progress is kept under the original IDs and becomes visible again if you import the same native JSON. Other collections and built-in vocabulary stay intact.</p>
          <div class="card__actions"><button type="button" class="btn danger" disabled={busy} on:click={() => action(async () => { await removeCollection(collection.id); removeId = ''; message = 'Collection removed. Its progress is retained for native reimport.'; })}>Confirm removal</button><button type="button" class="btn secondary" disabled={busy} on:click={() => removeId = ''}>Keep collection</button></div>
        </div>
      {/if}
    </article>
  {:else}
    <EmptyState title="No user collections yet" />
  {/each}
</section>

<style>
  .preview-scroll { max-height: 30rem; overflow: auto; }
  table { width: 100%; border-collapse: collapse; text-align: left; }
  th, td { padding: .75rem; border-bottom: 1px solid var(--input-border); vertical-align: top; overflow-wrap: anywhere; min-width: 6rem; }
  td p { margin: .5rem 0; }
  .duplicate-ack { display: flex; align-items: center; gap: .75rem; }
  .duplicate-ack input { min-height: auto; width: auto; }
  .collections-page code { overflow-wrap: anywhere; }
  .collection-card h3, .collections-page p, .collection-card .btn { overflow-wrap: anywhere; }
  input[type="file"] { width: 100%; min-width: 0; }
</style>
