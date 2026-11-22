<script lang="ts">
  import type { ContentCatalog } from '../../content/catalog';
  import { DEFAULT_LEARN_PASS_ID, progress, type LearnPass } from '../../state/progress';
  import { viewState } from '../../state/viewState';
  import { matchesQuery } from '../../shared/text';
  import Button from '../../shared/ui/Button.svelte';
  import ConfirmDialog from '../../shared/ui/ConfirmDialog.svelte';
  import IconButton from '../../shared/ui/IconButton.svelte';
  import SearchField from '../../shared/ui/SearchField.svelte';

  export let catalog: ContentCatalog;

  let builderOpen = false;
  let editingId: string | null = null;
  let draftName = '';
  let draftDescription = '';
  let draftBlockIds: string[] = [];
  let materialQuery = '';
  let pendingDelete: LearnPass | null = null;
  let deletedPosition = -1;
  let createButton: HTMLButtonElement | undefined;

  /** The Delete buttons of the passes shown, in order. */
  function deleteButtons(): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>('.learn-pass-list [data-pass-delete]')];
  }

  /**
   * The deleted pass took its Delete button with it. Focus goes to the pass that took its place,
   * else the one before it; with no pass left in the list, to "Create a Learn Pass".
   */
  function afterDeleteFocus(): HTMLElement | null {
    const buttons = deleteButtons();
    return buttons[Math.min(deletedPosition, buttons.length - 1)] ?? createButton ?? null;
  }

  $: selectedPass = $progress.learnPasses.find((pass) => pass.id === $progress.selectedLearnPassId) ?? null;
  $: filteredPasses = $progress.learnPasses.filter((pass) => matchesQuery($viewState.learnPassSearch, pass.name, pass.description, pass.blockIds.join(' ')));
  $: filteredBlocks = catalog.searchBlocks(materialQuery);
  $: selectedBlockCount = $progress.selectedLearnPassId === DEFAULT_LEARN_PASS_ID ? catalog.blocks.length : selectedPass?.blockIds.length ?? 0;

  function onPassChange(event: Event): void {
    progress.setSelectedLearnPass((event.target as HTMLSelectElement).value);
  }

  function resetDraft(): void {
    editingId = null;
    draftName = '';
    draftDescription = '';
    draftBlockIds = [];
    materialQuery = '';
  }

  function startCreate(): void {
    resetDraft();
    builderOpen = true;
  }

  function startEdit(pass: LearnPass): void {
    editingId = pass.id;
    draftName = pass.name;
    draftDescription = pass.description ?? '';
    draftBlockIds = [...pass.blockIds];
    materialQuery = '';
    builderOpen = true;
  }

  function cancelBuilder(): void {
    builderOpen = false;
    resetDraft();
  }

  function toggleBlock(blockId: string): void {
    draftBlockIds = draftBlockIds.includes(blockId)
      ? draftBlockIds.filter((id) => id !== blockId)
      : [...draftBlockIds, blockId];
  }

  function selectVisibleBlocks(): void {
    draftBlockIds = [...new Set([...draftBlockIds, ...filteredBlocks.map((block) => block.id)])];
  }

  function clearBlocks(): void {
    draftBlockIds = [];
  }

  function savePass(): void {
    progress.saveLearnPass({
      id: editingId ?? undefined,
      name: draftName,
      description: draftDescription,
      blockIds: draftBlockIds
    });
    builderOpen = false;
    resetDraft();
  }

  function confirmDelete(): void {
    const pass = pendingDelete;
    if (pass) deletedPosition = deleteButtons().findIndex((button) => button.dataset.passDelete === pass.id);
    pendingDelete = null;
    if (!pass) return;
    progress.deleteLearnPass(pass.id);
    if (editingId === pass.id) {
      cancelBuilder();
    }
  }
</script>

<div class="learn-pass-panel">
  <div class="learn-pass-panel__main">
    <p class="muted">The default pass shows all material. A custom pass keeps only the blocks you choose on Home and in the navigation.</p>
    <label class="field">
      <span class="field__label">Active pass</span>
      <select value={$progress.selectedLearnPassId} on:change={onPassChange}>
        <option value={DEFAULT_LEARN_PASS_ID}>Default: all materials</option>
        {#each $progress.learnPasses as pass}
          <option value={pass.id}>{pass.name}</option>
        {/each}
      </select>
    </label>
    <p class="learn-pass-summary">{selectedBlockCount} {selectedBlockCount === 1 ? 'block' : 'blocks'} visible</p>
  </div>

  <div class="learn-pass-panel__actions">
    <Button variant="secondary" size="sm" icon="plus" bind:element={createButton} onClick={startCreate}>Create a Learn Pass</Button>
    <Button variant="quiet" size="sm" icon="edit" disabled={!selectedPass} onClick={() => selectedPass && startEdit(selectedPass)}>Edit the selected pass</Button>
  </div>

  {#if $progress.learnPasses.length}
    <SearchField label="Search Learn Passes" value={$viewState.learnPassSearch} placeholder="verbs, meetings, assessment…" onInput={(value) => viewState.setLearnPassSearch(value)} />
    {#if filteredPasses.length}
      <ul class="learn-pass-list">
        {#each filteredPasses as pass (pass.id)}
          <li class="learn-pass-row" class:active={$progress.selectedLearnPassId === pass.id}>
            <button class="learn-pass-row__body" type="button" aria-pressed={$progress.selectedLearnPassId === pass.id} on:click={() => progress.setSelectedLearnPass(pass.id)}>
              <strong>{pass.name}</strong>
              <small>{pass.blockIds.length} {pass.blockIds.length === 1 ? 'block' : 'blocks'}{pass.description ? `. ${pass.description}` : ''}</small>
            </button>
            <div class="learn-pass-row__actions">
              <IconButton icon="edit" label={`Edit ${pass.name}`} onClick={() => startEdit(pass)} />
              <IconButton icon="trash" label={`Delete ${pass.name}`} data-pass-delete={pass.id} onClick={() => (pendingDelete = pass)} />
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">No Learn Passes match your search.</p>
    {/if}
  {:else}
    <p class="muted">No custom Learn Passes yet. Create one to focus on selected materials.</p>
  {/if}

  {#if builderOpen}
    <form class="learn-pass-builder" on:submit|preventDefault={savePass}>
      <div class="learn-pass-builder__header">
        <div>
          <h3>{editingId ? 'Edit Learn Pass' : 'Create a Learn Pass'}</h3>
          <p class="muted">Select the blocks that stay visible while this pass is active.</p>
        </div>
        <IconButton icon="close" label="Close the Learn Pass editor" onClick={cancelBuilder} />
      </div>

      <div class="learn-pass-builder__fields">
        <label class="field">
          <span class="field__label">Name</span>
          <input bind:value={draftName} required maxlength="60" autocomplete="off" placeholder="For example, irregular verbs…" />
        </label>
        <label class="field">
          <span class="field__label">Description (optional)</span>
          <input bind:value={draftDescription} maxlength="120" autocomplete="off" placeholder="A short note…" />
        </label>
        <label class="field">
          <span class="field__label">Search materials</span>
          <input type="search" bind:value={materialQuery} autocomplete="off" placeholder="verbs, phrases, patterns…" />
        </label>
      </div>

      <div class="learn-pass-builder__tools">
        <span class="muted">{draftBlockIds.length} selected</span>
        <Button variant="quiet" size="sm" icon="select-all" onClick={selectVisibleBlocks}>Select all shown</Button>
        <Button variant="quiet" size="sm" icon="close" onClick={clearBlocks}>Clear selection</Button>
      </div>

      <div class="learn-pass-blocks">
        {#each filteredBlocks as block (block.id)}
          <label class="learn-pass-block" class:active={draftBlockIds.includes(block.id)}>
            <input type="checkbox" checked={draftBlockIds.includes(block.id)} on:change={() => toggleBlock(block.id)} />
            <span>
              <strong>{block.title}</strong>
              <small>{block.tag ?? block.type}{block.itemsCount ? `, ${block.itemsCount} items` : ''}</small>
            </span>
          </label>
        {/each}
      </div>

      <div class="learn-pass-builder__footer">
        <Button variant="primary" type="submit" icon="check" disabled={!draftName.trim() || !draftBlockIds.length}>Save Learn Pass</Button>
        <Button variant="secondary" onClick={cancelBuilder}>Cancel</Button>
      </div>
    </form>
  {/if}
</div>

<ConfirmDialog
  open={pendingDelete !== null}
  title={`Delete the Learn Pass “${pendingDelete?.name ?? ''}”?`}
  confirmLabel="Delete Learn Pass"
  onConfirm={confirmDelete}
  onCancel={() => (pendingDelete = null)}
  returnFocus={afterDeleteFocus}
>
  <p>The pass is removed. Your learning progress, Focus list and vocabulary are not changed.</p>
</ConfirmDialog>
