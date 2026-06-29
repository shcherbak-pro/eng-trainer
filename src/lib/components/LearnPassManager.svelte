<script lang="ts">
  import { DEFAULT_LEARN_PASS_ID, progress } from '../stores/progress';
  import type { LearnPass, TrainingBlock } from '../types/materials';
  import { matchesQuery } from '../utils/filters';

  export let allBlocks: TrainingBlock[];

  let builderOpen = false;
  let editingId: string | null = null;
  let draftName = '';
  let draftDescription = '';
  let draftBlockIds: string[] = [];
  let materialQuery = '';

  $: selectedPass = $progress.learnPasses.find((pass) => pass.id === $progress.selectedLearnPassId) ?? null;
  $: filteredPasses = $progress.learnPasses.filter((pass) => matchesQuery($progress.learnPassSearch, pass.name, pass.description, pass.blockIds.join(' ')));
  $: filteredBlocks = allBlocks.filter((block) => matchesQuery(materialQuery, block.title, block.description, block.type, block.category, block.tag));
  $: selectedBlockCount = $progress.selectedLearnPassId === DEFAULT_LEARN_PASS_ID ? allBlocks.length : selectedPass?.blockIds.length ?? 0;

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

  function deletePass(pass: LearnPass): void {
    const confirmed = typeof window === 'undefined' || window.confirm(`Delete learn pass "${pass.name}"?`);
    if (!confirmed) return;
    progress.deleteLearnPass(pass.id);
    if (editingId === pass.id) {
      cancelBuilder();
    }
  }
</script>

<div class="learn-pass-panel card">
  <div class="learn-pass-panel__main">
    <div>
      <p class="eyebrow local">Learn Pass</p>
      <h2>Choose your learning track</h2>
      <p class="muted">Default shows all available materials. Custom passes keep only selected blocks on the Index page and in navigation.</p>
    </div>

    <div class="learn-pass-selectors">
      <label>
        Active pass
        <select value={$progress.selectedLearnPassId} on:change={onPassChange}>
          <option value={DEFAULT_LEARN_PASS_ID}>Default — all materials</option>
          {#each $progress.learnPasses as pass}
            <option value={pass.id}>{pass.name}</option>
          {/each}
        </select>
      </label>
      <p class="learn-pass-summary">{selectedBlockCount} block{selectedBlockCount === 1 ? '' : 's'} visible</p>
    </div>
  </div>

  <div class="learn-pass-panel__actions">
    <button class="btn primary" type="button" on:click={startCreate}>New pass</button>
    <button class="btn secondary" type="button" on:click={() => selectedPass && startEdit(selectedPass)} disabled={!selectedPass}>Edit selected</button>
  </div>

  <div class="learn-pass-manager">
    <label>
      Search learn passes
      <input
        value={$progress.learnPassSearch}
        on:input={(event) => progress.setLearnPassSearch((event.target as HTMLInputElement).value)}
        placeholder="verbs, meetings, assessment…"
      />
    </label>

    {#if filteredPasses.length}
      <div class="learn-pass-list">
        {#each filteredPasses as pass}
          <article class="learn-pass-row" class:active={$progress.selectedLearnPassId === pass.id}>
            <button class="learn-pass-row__body" type="button" on:click={() => progress.setSelectedLearnPass(pass.id)}>
              <strong>{pass.name}</strong>
              <small>{pass.blockIds.length} block{pass.blockIds.length === 1 ? '' : 's'}{pass.description ? ` · ${pass.description}` : ''}</small>
            </button>
            <div class="learn-pass-row__actions">
              <button class="btn secondary" type="button" on:click={() => startEdit(pass)}>Edit</button>
              <button class="btn danger" type="button" on:click={() => deletePass(pass)}>Delete</button>
            </div>
          </article>
        {/each}
      </div>
    {:else if $progress.learnPasses.length}
      <p class="muted">No learn passes match your search.</p>
    {:else}
      <p class="muted">No custom learn passes yet. Create one to focus on selected materials.</p>
    {/if}
  </div>

  {#if builderOpen}
    <form class="learn-pass-builder" on:submit|preventDefault={savePass}>
      <div class="learn-pass-builder__header">
        <div>
          <h3>{editingId ? 'Edit Learn Pass' : 'Create Learn Pass'}</h3>
          <p class="muted">Select the blocks that should stay visible when this pass is active.</p>
        </div>
        <button class="btn secondary" type="button" on:click={cancelBuilder}>Close</button>
      </div>

      <div class="learn-pass-builder__fields">
        <label>
          Name
          <input bind:value={draftName} required maxlength="60" placeholder="Example: Irregular verbs focus" />
        </label>
        <label>
          Description
          <input bind:value={draftDescription} maxlength="120" placeholder="Optional short note" />
        </label>
        <label>
          Search materials
          <input bind:value={materialQuery} placeholder="verbs, phrases, patterns…" />
        </label>
      </div>

      <div class="learn-pass-builder__tools">
        <span class="muted">{draftBlockIds.length} selected</span>
        <button class="btn secondary" type="button" on:click={selectVisibleBlocks}>Select visible</button>
        <button class="btn danger" type="button" on:click={clearBlocks}>Clear</button>
      </div>

      <div class="learn-pass-blocks">
        {#each filteredBlocks as block}
          <label class="learn-pass-block" class:active={draftBlockIds.includes(block.id)}>
            <input type="checkbox" checked={draftBlockIds.includes(block.id)} on:change={() => toggleBlock(block.id)} />
            <span>
              <strong>{block.title}</strong>
              <small>{block.tag ?? block.type}{block.itemsCount ? ` · ${block.itemsCount} items` : ''}</small>
            </span>
          </label>
        {/each}
      </div>

      <div class="learn-pass-builder__footer">
        <button class="btn primary" type="submit" disabled={!draftName.trim() || !draftBlockIds.length}>Save Learn Pass</button>
        <button class="btn secondary" type="button" on:click={cancelBuilder}>Cancel</button>
      </div>
    </form>
  {/if}
</div>
