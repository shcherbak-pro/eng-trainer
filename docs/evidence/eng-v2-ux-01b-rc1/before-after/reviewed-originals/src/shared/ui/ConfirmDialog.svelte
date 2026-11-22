<script lang="ts">
  import { tick } from 'svelte';

  /**
   * A confirmation step for actions that cannot be undone or that change many items.
   * Opening and cancelling change nothing. Focus starts on Cancel and returns to the
   * element that opened the dialog. Escape cancels.
   */
  export let open = false;
  export let title: string;
  export let confirmLabel: string;
  export let cancelLabel = 'Cancel';
  export let tone: 'danger' | 'primary' = 'danger';
  export let onConfirm: () => void;
  export let onCancel: () => void;

  let dialog: HTMLDialogElement | undefined;
  let cancelButton: HTMLButtonElement | undefined;
  let opener: Element | null = null;
  const id = `confirm-${Math.random().toString(36).slice(2, 10)}`;

  $: if (dialog) void sync(open);

  function isShown(element: HTMLDialogElement): boolean {
    return element.open === true || element.hasAttribute('open');
  }

  async function sync(next: boolean): Promise<void> {
    if (!dialog) return;
    if (next && !isShown(dialog)) {
      opener = document.activeElement;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      await tick();
      cancelButton?.focus();
    } else if (!next && isShown(dialog)) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      opener = null;
    }
  }
</script>

<dialog bind:this={dialog} class="dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`} on:cancel|preventDefault={onCancel}>
  <h2 id={`${id}-title`} class="dialog__title">{title}</h2>
  <div id={`${id}-body`} class="dialog__body"><slot /></div>
  <div class="dialog__actions">
    <button bind:this={cancelButton} type="button" class="btn btn--secondary btn--md" on:click={onCancel}>{cancelLabel}</button>
    <button type="button" class={`btn btn--${tone} btn--md`} on:click={onConfirm}>{confirmLabel}</button>
  </div>
</dialog>
