<script lang="ts">
  import Icon from './Icon.svelte';
  import { dismissToast, pauseToast, resumeToast, toast } from './toast';

  function act(): void {
    const current = $toast;
    dismissToast();
    current?.onAction?.();
  }
</script>

<!-- The region stays in the page so that new messages are announced. -->
<div class="toast-region" role="status" aria-live="polite" aria-atomic="true">
  {#if $toast}
    {#key $toast.id}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="toast" on:mouseenter={pauseToast} on:mouseleave={resumeToast} on:focusin={pauseToast} on:focusout={resumeToast}>
        <p class="toast__message">{$toast.message}</p>
        {#if $toast.actionLabel}
          <button type="button" class="toast__action" on:click={act}>{$toast.actionLabel}</button>
        {/if}
        <button type="button" class="toast__close" aria-label="Dismiss message" on:click={dismissToast}><Icon name="close" size={18} /></button>
      </div>
    {/key}
  {/if}
</div>
