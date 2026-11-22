<script lang="ts">
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { dismissToast, pauseToast, resumeToast, toast } from './toast';

  let region: HTMLDivElement | undefined;
  /** The control that had focus before keyboard focus entered the message. */
  let cameFrom: HTMLElement | null = null;

  function enter(event: FocusEvent): void {
    pauseToast();
    const from = event.relatedTarget;
    if (from instanceof HTMLElement && !region?.contains(from)) cameFrom = from;
  }

  function hasFocus(): boolean {
    return Boolean(region && document.activeElement && region.contains(document.activeElement));
  }

  /** Focus that was on a control that has just been removed. */
  function focusLost(): boolean {
    const active = document.activeElement;
    return !active || active === document.body || !active.isConnected;
  }

  /**
   * When the user's own action removes the focused message, focus goes to the action's target
   * (for Undo, the restored entry), else back where the user came from, else to the main content.
   * Nothing moves if focus was elsewhere, if the action or the user already moved it, or when a
   * message simply expires.
   */
  async function settleFocus(hadFocus: boolean, preferred: HTMLElement | null): Promise<void> {
    if (!hadFocus) return;
    await tick();
    if (!focusLost()) return;
    const target = [preferred, cameFrom].find((element) => element?.isConnected) ?? document.getElementById('main');
    target?.focus();
  }

  async function act(): Promise<void> {
    const current = $toast;
    const hadFocus = hasFocus();
    dismissToast();
    const target = await current?.onAction?.();
    await settleFocus(hadFocus, target instanceof HTMLElement ? target : null);
  }

  async function close(): Promise<void> {
    const hadFocus = hasFocus();
    dismissToast();
    await settleFocus(hadFocus, null);
  }

  // A new message starts without a remembered origin.
  $: if ($toast) cameFrom = null;
</script>

<!-- The region stays in the page so that new messages are announced. -->
<div class="toast-region" role="status" aria-live="polite" aria-atomic="true" bind:this={region}>
  {#if $toast}
    {#key $toast.id}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="toast" on:mouseenter={pauseToast} on:mouseleave={resumeToast} on:focusin={enter} on:focusout={resumeToast}>
        <p class="toast__message">{$toast.message}</p>
        {#if $toast.actionLabel}
          <button type="button" class="toast__action" on:click={act}>{$toast.actionLabel}</button>
        {/if}
        <button type="button" class="toast__close" aria-label="Dismiss message" on:click={close}><Icon name="close" size={18} /></button>
      </div>
    {/key}
  {/if}
</div>
